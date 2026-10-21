import { personalFm, personalFmToTrash } from "@/api/rec";
import { songUrl, unlockSongUrl } from "@/api/song";
import { describePlaybackFailure } from "@/api/platform/errorText";
import { kgSongUrl } from "@/api/platform/kugou";
import { qqSongUrl } from "@/api/platform/qqmusic";
import { qqSongFM } from "@/api/platform/songfm";
import { getPlatformLevel, mapPlatformQuality, type PlatformSongUrl } from "@/api/platform/types";
import { planPlayback, type PlaybackStep } from "@/core/player/playbackDecision";
import {
  useDataStore,
  useMusicStore,
  usePlatformStore,
  useSettingStore,
  useStatusStore,
  useStreamingStore,
} from "@/stores";
import { QualityType, type SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { isLogin } from "@/utils/auth";
import { isElectron } from "@/utils/env";
import { formatSongsList } from "@/utils/format";
import { handleSongQuality } from "@/utils/helper";
import { openUserLogin } from "@/utils/modal";
import { sanitizeUrl } from "@/utils/sanitize";

/**
 * 歌曲解锁服务器
 */
export enum SongUnlockServer {
  NETEASE = "netease",
  BODIAN = "bodian",
  KUWO = "kuwo",
  GEQUBAO = "gequbao",
}

/** 歌曲播放地址信息 */
export type AudioSource = {
  /** 歌曲id */
  id: number;
  /** 歌曲播放地址 */
  url?: string;
  /** 是否解锁 */
  isUnlocked?: boolean;
  /** 是否为试听 */
  isTrial?: boolean;
  /** 音质 */
  quality?: QualityType;
  /** 解锁源名称（如果使用了解锁服务） */
  unlockSource?: string | null;
};

/**
 * 取歌曲的来源平台
 * @param song 歌曲
 * @returns 来源平台，缺省为网易云
 */
const resolvePlatform = (song: SongType): ApiPlatform => song.platform ?? "netease";

/** 推荐流单批曲目数（QQ 音乐推荐流一批的取回数） */
const SONG_FM_BATCH_SIZE = 20;

/**
 * 生成歌曲的缓存键
 *
 * 平台歌曲用「平台-数字 ID」做键，避免与网易云同数字 ID 的歌曲互相覆盖缓存。
 * @param song 歌曲
 * @returns 缓存键
 */
const buildCacheKey = (song: SongType): string | number => {
  const platform = resolvePlatform(song);
  return platform === "netease" ? song.id : `${platform}-${song.id}`;
};

/**
 * 生成播放标识（平台 + 数字 ID），用于预载结果匹配
 * @param song 歌曲
 * @param songId 歌曲 ID
 * @returns 播放标识
 */
const buildPlayKey = (song: SongType, songId: number): string =>
  `${resolvePlatform(song)}:${songId}`;

class SongManager {
  /** 预载下一首歌曲播放信息 */
  private nextPrefetch: AudioSource | undefined;
  /** 预载歌曲的播放标识（平台 + 数字 ID） */
  private nextPrefetchKey: string | undefined;
  /** 最近一次第三方平台的播放失败详情（用于最终失败时的用户提示） */
  private lastPlatformFailure:
    | { platform: ApiPlatform; reason?: string; status?: number; privilege?: number | null }
    | undefined;

  /**
   * 预加载封面图片
   * @param song 歌曲信息
   */
  private prefetchCover(song: SongType): void {
    if (!song || song.path) return; // 本地歌曲跳过

    const coverUrls: string[] = [];

    // 收集需要预加载的封面 URL
    if (song.coverSize) {
      // 优先预加载大尺寸封面
      if (song.coverSize.xl) coverUrls.push(song.coverSize.xl);
      if (song.coverSize.l) coverUrls.push(song.coverSize.l);
    }
    if (song.cover && !coverUrls.includes(song.cover)) {
      coverUrls.push(song.cover);
    }
    // 预加载图片
    coverUrls.forEach((url) => {
      if (!url || !url.startsWith("http")) return;
      const img = new Image();
      // 清理
      const cleanup = () => {
        img.onload = null;
        img.onerror = null;
      };
      img.onload = cleanup;
      img.onerror = cleanup;
      img.src = url;
    });
  }

  /**
   * 检查本地缓存
   * @param id 缓存键（网易云为歌曲 ID，平台歌曲为「平台-歌曲 ID」）
   * @param quality 音质
   */
  private checkLocalCache = async (
    id: number | string,
    quality?: QualityType,
  ): Promise<string | null> => {
    const settingStore = useSettingStore();
    if (isElectron && settingStore.cacheEnabled && settingStore.songCacheEnabled) {
      try {
        const cachePath = await window.electron.ipcRenderer.invoke(
          "music-cache-check",
          id,
          quality,
        );
        if (cachePath) {
          console.log(`🚀 [${id}] 由本地音乐缓存提供`);
          return `file://${cachePath}`;
        }
      } catch (e) {
        console.error(`❌ [${id}] 检查缓存失败:`, e);
      }
    }
    return null;
  };

  /**
   * 触发缓存下载
   * @param id 缓存键（网易云为歌曲 ID，平台歌曲为「平台-歌曲 ID」）
   * @param url 下载地址
   * @param quality 音质
   */
  private triggerCacheDownload = (
    id: number | string,
    url: string,
    quality?: QualityType | string,
  ) => {
    const settingStore = useSettingStore();
    if (isElectron && settingStore.cacheEnabled && settingStore.songCacheEnabled && url) {
      window.electron.ipcRenderer.invoke("music-cache-download", id, url, quality || "standard");
    }
  };

  /**
   * 获取解锁源的中文名称
   * @param server 解锁服务器标识
   * @returns 中文名称
   */
  private getUnlockSourceName(server: SongUnlockServer): string {
    const nameMap: Record<SongUnlockServer, string> = {
      [SongUnlockServer.NETEASE]: "网易云",
      [SongUnlockServer.KUWO]: "酷我音乐",
      [SongUnlockServer.GEQUBAO]: "歌曲宝",
      [SongUnlockServer.BODIAN]: "波点音乐",
    };
    return nameMap[server] || server;
  }

  /**
   * Web 端 URL 统一处理：通过代理转发
   * Electron 端：直接返回原始 URL
   * @param url 原始 URL
   * @returns 处理后的 URL
   */
  private processUrlForWeb(url: string | null | undefined): string | null | undefined {
    if (!url || isElectron) return url;

    // 空字符串或无效 URL，返回 undefined
    if (url.trim() === "") {
      console.warn("⚠️ processUrlForWeb: 收到空字符串 URL");
      return undefined;
    }

    // 已经是代理 URL 或本地文件，直接返回
    if (url.startsWith("/api/proxy/audio") || url.startsWith("file://")) {
      return url;
    }

    // Web 端统一通过代理转发，解决 CORS 和证书问题
    try {
      const encodedUrl = encodeURIComponent(url);
      return `/api/proxy/audio?url=${encodedUrl}`;
    } catch (e) {
      console.error("❌ processUrlForWeb: URL 编码失败", e, sanitizeUrl(url));
      return undefined;
    }
  }

  /**
   * 获取官方播放链接
   *
   * 按歌曲来源平台分派：网易云走 `/song/url/v1`，QQ 音乐与酷狗走各自的平台模块。
   * 试听片段的直链会被记录并标记为 `isTrial`，但不会在此处直接返回给播放器 ——
   * 是否播放试听由播放决策树在解锁全败之后决定。
   * @param song 歌曲
   * @param songId 歌曲 ID（电台歌曲取 dj id）
   * @param isPc 是否云盘歌曲
   * @returns 在线播放信息
   */
  public getOnlineUrl = async (
    song: SongType,
    songId: number,
    isPc: boolean = false,
  ): Promise<AudioSource> => {
    const platform = resolvePlatform(song);
    if (platform === "qqmusic") return this.getQqOnlineUrl(song);
    if (platform === "kugou") return this.getKgOnlineUrl(song);
    return this.getNeteaseOnlineUrl(songId, isPc);
  };

  /**
   * 获取网易云官方播放链接
   * @param id 歌曲id
   * @param isPc 是否云盘歌曲
   * @returns 在线播放信息
   */
  private getNeteaseOnlineUrl = async (id: number, isPc: boolean = false): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const level = isPc ? "exhigh" : settingStore.songLevel;
    const res = await songUrl(id, level);
    console.log(`🌐 ${id} music data:`, {
      ...res,
      data: res.data?.map((item) => ({ ...item, url: sanitizeUrl(item.url) })),
    });
    const songData = res.data?.[0];
    // 是否有播放地址
    if (!songData || !songData?.url) {
      console.warn(`⚠️ [${id}] 官方链接获取失败：无播放地址`);
      return { id, url: undefined };
    }
    // 是否仅能试听
    const isTrial = songData?.freeTrialInfo !== null;
    // 统一使用原始 URL（与 Electron 端一致，不再进行 URL 转换）
    const originalUrl = songData.url;
    // 检查原始 URL 是否有效
    if (!originalUrl || originalUrl.trim() === "") {
      console.warn(`⚠️ [${id}] 官方链接无效：空 URL`);
      return { id, url: undefined, isTrial, quality: undefined };
    }
    // 若为试听且未开启试听播放，则将 url 置为空，仅标记为试听
    const finalUrl = isTrial && !settingStore.playSongDemo ? null : originalUrl;
    // 获取音质
    const quality = handleSongQuality(songData, "online");
    // 检查本地缓存（仅 Electron 端；试听片段不入缓存 —— 缓存里放的是整曲文件）
    if (finalUrl && quality && isElectron && !isTrial) {
      const cachedUrl = await this.checkLocalCache(id, quality);
      if (cachedUrl) {
        console.log(`✅ [${id}] 使用本地缓存播放`);
        return { id, url: cachedUrl, isTrial, quality, unlockSource: "cache" };
      }
    }
    // Web 端：统一通过代理转发（与 Electron 端逻辑对齐）
    let processedUrl = finalUrl;
    if (!isElectron && finalUrl) {
      processedUrl = this.processUrlForWeb(finalUrl);
      if (!processedUrl) {
        console.error(`❌ [${id}] Web 端 URL 处理失败，原始 URL:`, sanitizeUrl(finalUrl));
        return { id, url: undefined, isTrial, quality };
      }
      console.log(
        `🌐 [${id}] Web 端使用代理接口，原始 URL:`,
        sanitizeUrl(finalUrl),
        "代理 URL:",
        sanitizeUrl(processedUrl),
      );
    }
    // 缓存对应音质音乐（仅 Electron 端；试听片段不入缓存）
    if (finalUrl && isElectron && !isTrial) {
      this.triggerCacheDownload(id, finalUrl, quality);
    }
    // 确保 null/undefined 转换为 undefined，保持与 AudioSource 类型一致
    const finalProcessedUrl = processedUrl || undefined;
    console.log(`📦 [${id}] getOnlineUrl 最终返回:`, {
      url: sanitizeUrl(finalProcessedUrl),
      isTrial,
      quality,
    });
    return { id, url: finalProcessedUrl, isTrial, quality, unlockSource: "official" };
  };

  /**
   * 获取 QQ 音乐官方播放链接
   * @param song 歌曲
   * @returns 在线播放信息
   */
  private getQqOnlineUrl = async (song: SongType): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const mid = song.platformId ?? String(song.id);
    const level = getPlatformLevel("qqmusic", settingStore.songLevel);
    let res: PlatformSongUrl;
    try {
      res = await qqSongUrl(mid, level);
    } catch (error) {
      console.error(`❌ [${song.id}] QQ 音乐播放地址获取失败:`, error);
      return { id: song.id, url: undefined, isTrial: false, unlockSource: "official" };
    }
    console.log(`🌐 [${song.id}] QQ 音乐播放地址:`, {
      available: res.available,
      isTrial: res.isTrial,
      level: res.level,
      reason: res.reason,
    });
    // 失败原因留给最终失败提示用（付费 / 无授权 / 凭证异常）
    if (!res.available) {
      this.lastPlatformFailure = { platform: "qqmusic", reason: res.reason };
    }
    return this.buildPlatformAudioSource(song, res);
  };

  /**
   * 获取酷狗官方播放链接
   * @param song 歌曲
   * @returns 在线播放信息
   */
  private getKgOnlineUrl = async (song: SongType): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const hash = song.platformId ?? String(song.id);
    const level = getPlatformLevel("kugou", settingStore.songLevel);
    let res: PlatformSongUrl;
    try {
      res = await kgSongUrl(hash, level);
    } catch (error) {
      console.error(`❌ [${song.id}] 酷狗播放地址获取失败:`, error);
      return { id: song.id, url: undefined, isTrial: false, unlockSource: "official" };
    }
    console.log(`🌐 [${song.id}] 酷狗播放地址:`, {
      available: res.available,
      isTrial: res.isTrial,
      status: res.status,
      privilege: res.privilege,
      level: res.level,
    });
    // 播放状态与授权位留给最终失败提示用（付费墙 / 无授权）
    if (!res.available) {
      this.lastPlatformFailure = {
        platform: "kugou",
        status: res.status,
        privilege: res.privilege,
      };
    }
    return this.buildPlatformAudioSource(song, res);
  };

  /**
   * 整理平台播放地址为音频源
   *
   * 试听判据：QQ 音乐取 `isTrial`；酷狗取 `status === 2`（付费墙）或 `isTrial`。
   * 试听片段只记录不落缓存 —— 缓存里放的是整曲文件，片段会污染缓存键。
   * @param song 歌曲
   * @param res 平台播放地址
   * @returns 在线播放信息
   */
  private buildPlatformAudioSource = async (
    song: SongType,
    res: PlatformSongUrl,
  ): Promise<AudioSource> => {
    const id = song.id;
    const isTrial = res.isTrial === true || res.status === 2;
    const quality = mapPlatformQuality(res.level);
    const rawUrl = res.url?.trim() ? res.url.trim() : undefined;
    if (!rawUrl) {
      console.warn(`⚠️ [${id}] 官方链接获取失败：无播放地址`);
      return { id, url: undefined, isTrial, quality, unlockSource: "official" };
    }
    const cacheKey = buildCacheKey(song);
    // 检查本地缓存（仅 Electron 端，试听片段不入缓存）
    if (!isTrial && quality && isElectron) {
      const cachedUrl = await this.checkLocalCache(cacheKey, quality);
      if (cachedUrl) {
        console.log(`✅ [${id}] 使用本地缓存播放`);
        return { id, url: cachedUrl, isTrial, quality, unlockSource: "cache" };
      }
    }
    // Web 端：统一通过代理转发（与 Electron 端逻辑对齐）
    let processedUrl: string | undefined = rawUrl;
    if (!isElectron) {
      processedUrl = this.processUrlForWeb(rawUrl) ?? undefined;
      if (!processedUrl) {
        console.error(`❌ [${id}] Web 端 URL 处理失败，原始 URL:`, sanitizeUrl(rawUrl));
        return { id, url: undefined, isTrial, quality, unlockSource: "official" };
      }
      console.log(
        `🌐 [${id}] Web 端使用代理接口，原始 URL:`,
        sanitizeUrl(rawUrl),
        "代理 URL:",
        sanitizeUrl(processedUrl),
      );
    }
    // 缓存对应音质音乐（仅 Electron 端，试听片段不入缓存）
    if (!isTrial && isElectron) {
      this.triggerCacheDownload(cacheKey, rawUrl, quality);
    }
    console.log(`📦 [${id}] getOnlineUrl 最终返回:`, {
      url: sanitizeUrl(processedUrl),
      isTrial,
      quality,
    });
    return { id, url: processedUrl, isTrial, quality, unlockSource: "official" };
  };

  /**
   * 获取解锁播放链接
   *
   * 源优先级：网易云歌曲 `网易云 → 波点 → 歌曲宝 → 酷我`；
   * QQ 音乐 / 酷狗歌曲 `网易云检索 → 波点 → 歌曲宝 → 酷我` ——
   * 网易云解锁源对第三方平台的歌曲只能**按关键词检索网易云曲库**（两套 id 编号空间不同，
   * 拿第三方 id 直查会静默播错歌），因此第三方歌曲在网易云源上走关键词寻址分支。
   * 站外源额外携带歌曲声明时长，参与服务端「歌名 / 歌手 / 时长」三重校验。
   * @param songData 歌曲数据
   * @returns 解锁播放信息
   */
  public getUnlockSongUrl = async (song: SongType): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const songId = song.id;
    const artist = Array.isArray(song.artists) ? song.artists[0].name : song.artists;
    const keyWord = song.name + "-" + artist;
    if (!songId || !keyWord) {
      return { id: songId, url: undefined };
    }

    // 第三方平台的歌曲不参与网易云按 id 寻址，改走关键词检索
    const isNeteaseSong = resolvePlatform(song) === "netease";
    const priorityOrder = [
      SongUnlockServer.NETEASE,
      SongUnlockServer.BODIAN,
      SongUnlockServer.GEQUBAO,
      SongUnlockServer.KUWO,
    ];

    // 获取启用的音源列表，并按优先级排序
    const enabledServers = settingStore.songUnlockServer.filter((s) => s.enabled).map((s) => s.key);

    if (enabledServers.length === 0) {
      return { id: songId, url: undefined };
    }

    // 按优先级顺序排序启用的服务器
    const sortedServers = priorityOrder.filter((server) => enabledServers.includes(server));

    // 歌曲声明时长（秒），参与站外源的时长校验
    const duration = song.duration > 0 ? Math.round(song.duration / 1000) : undefined;
    // 缓存键：平台歌曲与网易云歌曲分开存放
    const cacheKey = buildCacheKey(song);

    // 按顺序请求，一旦成功就返回
    console.log(`🔓 [${songId}] 开始按优先级尝试解锁服务`);
    console.log(
      `   📋 启用的服务: ${enabledServers.map((s) => this.getUnlockSourceName(s)).join(", ")}`,
    );
    console.log(
      `   🎯 优先级顺序: ${sortedServers.map((s) => this.getUnlockSourceName(s)).join(" -> ")}`,
    );

    // 检查是否有服务被跳过（在优先级列表中但未启用）
    const skippedServers = priorityOrder.filter((server) => !enabledServers.includes(server));
    if (skippedServers.length > 0) {
      console.log(
        `   ⚠️ 跳过的服务（未启用）: ${skippedServers.map((s) => this.getUnlockSourceName(s)).join(", ")}`,
      );
    }

    for (const server of sortedServers) {
      try {
        const sourceName = this.getUnlockSourceName(server);
        console.log(`🔓 [${songId}] 正在尝试解锁服务: ${sourceName} (${server})...`);
        const result = await unlockSongUrl(
          songId,
          keyWord,
          server,
          song.name,
          artist,
          duration,
          !isNeteaseSong,
        );
        console.log(`🔓 [${songId}] ${sourceName} 返回结果:`, {
          ...result,
          url: sanitizeUrl(result.url),
        });

        // 检查是否成功
        if (result.code === 200 && result.url && result.url.trim() !== "") {
          const originalUrl = result.url.trim();

          // Web 端：统一通过代理转发（与 Electron 端逻辑对齐）
          // Electron 端：直接使用原始 URL（MPV 不受浏览器限制）
          const unlockUrl = this.processUrlForWeb(originalUrl);
          if (!isElectron) {
            console.log(`🌐 [${songId}] Web 端使用代理接口，原始 URL:`, sanitizeUrl(originalUrl));
          }

          const finalUnlockUrl = unlockUrl || undefined;

          // 推断音质
          let quality = QualityType.HQ;
          if (originalUrl.includes(".flac") || originalUrl.includes(".wav")) {
            quality = QualityType.SQ;
          }

          // 调试信息：显示使用的解锁源
          console.log(`✅ [${songId}] 解锁成功！`);
          console.log(`   📍 解锁源: ${sourceName} (${server})`);
          console.log(`   🎵 音质: ${quality}`);
          console.log(`   🔗 原始 URL: ${sanitizeUrl(originalUrl)}`);
          if (!isElectron) {
            console.log(`   🌐 代理 URL: ${sanitizeUrl(finalUnlockUrl)}`);
          }

          // 解锁成功后，触发下载（使用原始 URL，仅 Electron 端）
          this.triggerCacheDownload(cacheKey, originalUrl);

          return {
            id: songId,
            url: finalUnlockUrl,
            isUnlocked: true,
            quality,
            unlockSource: server,
          };
        } else {
          console.warn(`⚠️ [${songId}] ${sourceName} 返回失败，继续尝试下一个服务...`);
        }
      } catch (error) {
        const sourceName = this.getUnlockSourceName(server);
        console.error(`❌ [${songId}] ${sourceName} 请求失败:`, error);
        // 继续尝试下一个服务
      }
    }

    console.warn(`⚠️ [${songId}] 所有解锁服务均失败`);
    return { id: songId, url: undefined };
  };

  /**
   * 执行播放决策树的单一步骤
   *
   * 步骤未命中时返回 undefined，由调用方继续走下一步。
   * @param step 决策步骤
   * @param song 歌曲
   * @param songId 歌曲 ID
   * @param official 官方直链信息
   * @param notify 是否弹出提示（预载阶段不打扰用户）
   * @returns 命中的音频源
   */
  private resolvePlaybackStep = async (
    step: PlaybackStep,
    song: SongType,
    songId: number,
    official: AudioSource,
    notify: boolean,
  ): Promise<AudioSource | undefined> => {
    switch (step) {
      case "official": {
        if (!official.url) return undefined;
        return { ...official, id: songId };
      }
      case "unlock": {
        console.log(`🔓 [${songId}] 官方链接无效或仅可试听，尝试解锁兜底...`);
        const unlockResult = await this.getUnlockSongUrl(song);
        if (unlockResult.url && unlockResult.url.trim() !== "") {
          console.log(`✅ [${songId}] 解锁成功，使用解锁链接播放`);
          return unlockResult;
        }
        return undefined;
      }
      case "trial": {
        if (!official.url) return undefined;
        console.warn(`⚠️ [${songId}] 解锁失败，回落官方试听片段`);
        if (notify) window.$message.warning("当前歌曲仅可试听");
        return {
          id: songId,
          url: official.url,
          quality: official.quality,
          isUnlocked: false,
          isTrial: true,
          unlockSource: "official",
        };
      }
      case "cache": {
        const fallbackUrl = await this.checkLocalCache(buildCacheKey(song));
        if (!fallbackUrl) return undefined;
        console.log(`🚀 [${songId}] 网络请求失败，使用本地缓存兜底`);
        return { id: songId, url: fallbackUrl, isUnlocked: true, unlockSource: "cache" };
      }
      default:
        return undefined;
    }
  };

  /**
   * 预载下一首歌曲播放信息
   * @returns 预载数据
   */
  public getNextSongUrl = async (): Promise<AudioSource | undefined> => {
    try {
      const dataStore = useDataStore();
      const statusStore = useStatusStore();
      const settingStore = useSettingStore();

      // 无列表或私人FM模式直接跳过
      const playList = dataStore.playList;
      if (!playList?.length || statusStore.personalFmMode) {
        return;
      }

      // 计算下一首（循环到首）
      let nextIndex = statusStore.playIndex + 1;
      if (nextIndex >= playList.length) nextIndex = 0;
      const nextSong = playList[nextIndex];
      if (!nextSong) return;

      // 预加载封面图片
      this.prefetchCover(nextSong);

      // 本地歌曲跳过
      if (nextSong.path) return;

      // 流媒体歌曲
      if (nextSong.type === "streaming" && nextSong.streamUrl) {
        this.nextPrefetch = {
          id: nextSong.id,
          url: nextSong.streamUrl,
          isUnlocked: false,
          quality: QualityType.SQ,
          unlockSource: "streaming",
        };
        this.nextPrefetchKey = buildPlayKey(nextSong, nextSong.id);
        return this.nextPrefetch;
      }

      // 在线歌曲：优先官方，其次解灰
      const songId = nextSong.type === "radio" ? nextSong.dj?.id : nextSong.id;
      if (!songId) return;

      // 是否可解锁（移除 isElectron 限制，允许 Web 端也使用解锁功能）
      const canUnlock = nextSong.type !== "radio" && settingStore.useSongUnlock;

      // 官方链接（与正式播放同口径：云盘歌曲同样按 exhigh 取音质）
      const official = await this.getOnlineUrl(nextSong, songId, !!nextSong.pc);
      const steps = planPlayback({
        hasOfficialUrl: Boolean(official.url),
        isTrial: Boolean(official.isTrial),
        canUnlock,
        playSongDemo: settingStore.playSongDemo,
      });

      for (const step of steps) {
        const source = await this.resolvePlaybackStep(step, nextSong, songId, official, false);
        if (source) {
          this.nextPrefetch = source;
          this.nextPrefetchKey = buildPlayKey(nextSong, songId);
          return this.nextPrefetch;
        }
      }
      // 无可用源
      return;
    } catch (error) {
      console.error("❌ 预加载下一首歌曲地址失败", error);
      return;
    }
  };

  /**
   * 清除预加载缓存
   */
  public clearPrefetch() {
    this.nextPrefetch = undefined;
    this.nextPrefetchKey = undefined;
    console.log("🧹 已清除歌曲 URL 缓存");
  }

  /**
   * 播放最终失败时给用户可见提示
   *
   * 第三方平台的失败原因（付费 / 无授权 / 凭证异常）由平台模块给出，
   * 这里翻译成用户可读文案，走与「当前歌曲仅可试听」同款的提示通道。
   */
  private notifyPlaybackFailure = (): void => {
    const failure = this.lastPlatformFailure;
    this.lastPlatformFailure = undefined;
    if (!failure) return;
    window.$message.warning(describePlaybackFailure(failure.platform, failure));
  };

  /**
   * 获取音频源
   * 始终从此方法获取对应歌曲播放信息
   * @param song 歌曲
   * @returns 音频源
   */
  public getAudioSource = async (song: SongType): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const songId = song.type === "radio" ? song.dj?.id : song.id;
    console.log(`🎵 [${songId || song.id}] 开始获取音频源，类型: ${song.type}`, {
      isElectron,
      song,
    });

    // 本地文件直接返回（仅 Electron 端）
    if (song.path && song.type !== "streaming") {
      if (!isElectron) {
        console.warn(`⚠️ [${song.id}] Web 端不支持本地文件播放`);
        return { id: song.id, url: undefined };
      }
      // 检查本地文件是否存在
      const result = await window.electron.ipcRenderer.invoke("file-exists", song.path);
      if (!result) {
        this.nextPrefetch = undefined;
        console.error("❌ 本地文件不存在");
        return { id: song.id, url: undefined };
      }
      const encodedPath = song.path.replace(/#/g, "%23").replace(/\?/g, "%3F");
      console.log(`✅ [${song.id}] 使用本地文件播放`);
      return { id: song.id, url: `file://${encodedPath}`, unlockSource: "local" };
    }

    // Stream songs (Subsonic / Jellyfin)
    if (song.type === "streaming" && song.streamUrl) {
      const streamingStore = useStreamingStore();
      const finalUrl = streamingStore.getSongUrl(song);
      console.log(`🔄 [${song.id}] Stream URL:`, sanitizeUrl(finalUrl));
      // 验证流媒体 URL 是否有效
      if (!finalUrl || finalUrl.trim() === "") {
        console.warn(`⚠️ [${song.id}] 流媒体 URL 无效`);
        return { id: song.id, url: undefined, isUnlocked: false, quality: song.quality };
      }
      return {
        id: song.id,
        url: finalUrl,
        isUnlocked: false,
        quality: song.quality || QualityType.SQ,
        unlockSource: "streaming",
      };
    }

    // 在线歌曲
    if (!songId) return { id: 0, url: undefined, quality: undefined, isUnlocked: false };

    // 检查缓存并返回
    const playKey = buildPlayKey(song, songId);
    if (this.nextPrefetch && this.nextPrefetchKey === playKey && settingStore.useNextPrefetch) {
      const cachedSource = this.nextPrefetch;
      // 验证缓存的 URL 是否有效
      if (cachedSource.url && cachedSource.url.trim() !== "") {
        console.log(`🚀 [${songId}] 使用预加载缓存播放`);
        this.nextPrefetch = undefined;
        this.nextPrefetchKey = undefined;
        return cachedSource;
      } else {
        console.warn(`⚠️ [${songId}] 预加载缓存 URL 无效，重新获取`);
        this.nextPrefetch = undefined;
        this.nextPrefetchKey = undefined;
      }
    }

    // 在线获取
    try {
      // 是否可解锁（移除 isElectron 限制，允许 Web 端也使用解锁功能）
      const canUnlock = song.type !== "radio" && settingStore.useSongUnlock;

      // 官方链接（按来源平台分派：网易云 / QQ 音乐 / 酷狗音乐）
      const official = await this.getOnlineUrl(song, songId, !!song.pc);
      console.log(`🌐 [${songId}] 官方链接获取结果:`, {
        url: sanitizeUrl(official.url),
        isTrial: official.isTrial,
        quality: official.quality,
      });

      // 播放决策树：官方完整可播 → 解锁换源 → 官方试听 → 本地缓存
      const steps = planPlayback({
        hasOfficialUrl: Boolean(official.url),
        isTrial: Boolean(official.isTrial),
        canUnlock,
        playSongDemo: settingStore.playSongDemo,
      });

      for (const step of steps) {
        const source = await this.resolvePlaybackStep(step, song, songId, official, true);
        if (source) return source;
      }

      // 无可用源
      console.error(`❌ [${songId}] 所有音频源获取失败，无可用链接`);
      this.notifyPlaybackFailure();
      return {
        id: songId,
        url: undefined,
        quality: undefined,
        isUnlocked: false,
        unlockSource: null,
      };
    } catch (e) {
      console.error(`❌ [${songId}] 获取音频源异常:`, e);
      // 异常时的兜底：检查本地是否有缓存
      const fallbackUrl = await this.checkLocalCache(buildCacheKey(song));
      if (fallbackUrl) {
        console.log(`🚀 [${songId}] 获取异常，使用本地缓存兜底`);
        return { id: songId, url: fallbackUrl, isUnlocked: true, unlockSource: "cache" };
      }
      return {
        id: songId,
        url: undefined,
        quality: undefined,
        isUnlocked: false,
        unlockSource: null,
      };
    }
  };

  /**
   * 读取当前平台的推荐流曲目
   *
   * 网易云走 `/personal_fm`（私人 FM，一次 3 首）；
   * QQ 音乐没有等价端点，改由平台推荐流模块给出个性化推荐（一次一批，实测批次间几乎不重复）。
   * @returns 推荐流曲目
   */
  private fetchSongFMList = async (): Promise<SongType[]> => {
    if (usePlatformStore().currentPlatform === "qqmusic") {
      return qqSongFM(SONG_FM_BATCH_SIZE);
    }
    const res = await personalFm();
    return formatSongsList(res.data);
  };

  /**
   * 初始化/播放推荐流（网易云私人 FM / QQ 音乐刷歌）
   * @param playNext 是否播放下一首
   * @returns 是否成功
   */
  public async initPersonalFM(playNext: boolean = false) {
    const musicStore = useMusicStore();
    const statusStore = useStatusStore();

    try {
      const fetchFM = async () => {
        musicStore.personalFM.list = await this.fetchSongFMList();
        musicStore.personalFM.playIndex = 0;
      };

      // 若列表为空或已播放到最后，获取新列表
      if (musicStore.personalFM.list.length === 0) await fetchFM();
      // 如果需要播放下一首
      if (playNext) {
        statusStore.personalFmMode = true;
        // 如果当前列表还没播完
        if (musicStore.personalFM.playIndex < musicStore.personalFM.list.length - 1) {
          musicStore.personalFM.playIndex++;
        } else {
          // 列表播完了，获取新的
          await fetchFM();
        }
      }
    } catch (error) {
      console.error("❌ 推荐流初始化失败", error);
    }
  }

  /**
   * 推荐流垃圾桶（仅网易云支持，QQ 音乐无对应能力）
   */
  public async personalFMTrash(id: number) {
    if (!isLogin()) {
      openUserLogin(true);
      return;
    }
    const statusStore = useStatusStore();
    statusStore.personalFmMode = true;
    try {
      await personalFmToTrash(id);
      window.$message.success("已移至垃圾桶");
    } catch (error) {
      window.$message.error("移至垃圾桶失败，请重试");
      console.error("❌ 私人 FM 垃圾桶失败", error);
    }
  }

  /**
   * 刷新推荐流（网易云私人 FM / QQ 音乐刷歌）
   */
  public async refreshPersonalFM() {
    const musicStore = useMusicStore();
    if (!isLogin() && usePlatformStore().currentPlatform !== "qqmusic") {
      window.$message.error("请先登录");
      return;
    }
    try {
      const newList = await this.fetchSongFMList();
      if (!newList || newList.length === 0) {
        throw new Error("加载推荐流列表失败");
      }
      musicStore.personalFM.list = newList;
      musicStore.personalFM.playIndex = 0;
      window.$message.success("刷新成功");
    } catch (error) {
      console.error("❌ 刷新推荐流失败", error);
      window.$message.error("刷新失败，请重试");
    }
  }
}

let instance: SongManager | null = null;

/**
 * 获取 SongManager 实例
 * @returns SongManager
 */
export const useSongManager = (): SongManager => {
  if (!instance) instance = new SongManager();
  return instance;
};
