import { isElectron } from "@/utils/env";
import { defaultAMLLDbServer, songLevelData } from "@/utils/meta";
import { SongUnlockServer } from "@/types/shared";
import { useSettingStore } from "@/stores";
import request from "@/utils/request";

// 获取歌曲详情
export const songDetail = (ids: number | number[]) => {
  return request({
    url: "/song/detail",
    method: "post",
    params: { timestamp: Date.now() },
    data: { ids: Array.isArray(ids) ? ids.join(",") : ids.toString() },
  });
};

/**
 * 歌曲音质详情
 * @param id 歌曲 id
 */
export const songQuality = (id: number) => {
  return request({
    url: "/song/music/detail",
    params: { id },
  });
};

// 获取歌曲 URL
export const songUrl = (
  id: number,
  level:
    | "standard"
    | "higher"
    | "exhigh"
    | "lossless"
    | "hires"
    | "jyeffect"
    | "sky"
    | "dolby"
    | "jymaster" = "exhigh",
) => {
  // 杜比全景声使用旧版接口，并传入特殊参数
  if (level === "dolby") {
    return request({
      url: "/song/url",
      params: {
        id,
        br: 999000,
        immerseType: "c51",
        timestamp: Date.now(),
      },
    });
  }

  return request({
    url: "/song/url/v1",
    params: {
      id,
      level,
      timestamp: Date.now(),
    },
  });
};

/**
 * 解锁请求的超时预算（毫秒）
 *
 * 解锁源在主进程内串行完成「检索 → 取链 → 体积校验」，单次耗时可达数十秒
 * （网易云关键词检索源实测单次检索即达 10.6 s），
 * 沿用网易云链路的 15 s 通用超时会直接把慢源掐断，表现为「所有音频源获取失败」。
 * 这里只给解锁请求单独设预算，网易云请求的超时行为保持不变。
 *
 * 本常量的计算属性键会在模块求值期立即解引用 `SongUnlockServer` 的成员，
 * 因此该枚举必须来自不参与任何循环依赖的叶子模块（`@/types/shared`）；
 * 调整 `SongUnlockServer` 的导入来源时，需确认不会与本模块形成循环引用。
 */
const UNLOCK_TIMEOUT: Record<SongUnlockServer, number> = {
  // 网易云关键词检索源最慢：检索 + 两级取链 + 体积校验串行
  [SongUnlockServer.NETEASE]: 60000,
  [SongUnlockServer.BODIAN]: 20000,
  [SongUnlockServer.KUWO]: 20000,
  // 咪咕：检索 + 音质遍历取链 + 时长与体积校验
  [SongUnlockServer.MIGU]: 30000,
  // 长青：可能先检索换 id 再取链，取链还要探测真实音频时长
  [SongUnlockServer.CHANGQING]: 40000,
};

/**
 * 获取解锁歌曲 URL
 *
 * 网易云解锁源按歌曲 ID 寻址，其余解锁源按「关键词 / 歌名 + 歌手」寻址；
 * 站外源额外支持可选的 `duration`（秒），参与服务端的三重校验（歌名 / 歌手 / 时长），
 * 避免匹配到同名不同版的曲目。
 *
 * 第三方平台（QQ 音乐 / 酷狗）的歌曲在网易云侧没有对应 ID，
 * 必须走「按关键词检索网易云」的分支（`useKeywordLookup`），
 * 否则会把第三方 ID 喂给网易云接口，静默返回另一首歌。
 *
 * 按平台内歌曲 id 寻址的解锁源（长青）额外接收歌曲的来源平台与平台原生 id，
 * 歌曲本身来自该平台时可直接按 id 取链，无需再检索换 id。
 *
 * 解锁请求走独立超时预算（解锁源比普通接口慢得多），
 * 且不在客户端层重试：解锁链按源逐个尝试，单个源失败即换下一个。
 * @param id 歌曲 ID
 * @param keyword 搜索关键词（`歌名-歌手`）
 * @param server 解锁源
 * @param songName 歌名
 * @param artist 歌手
 * @param duration 歌曲声明时长（秒）
 * @param useKeywordLookup 是否按关键词寻址（第三方平台歌曲必须为 true）
 * @param platform 歌曲来源平台（netease / qqmusic / kugou）
 * @param platformId 平台内歌曲原生 id（QQ mid / 酷狗 hash）
 */
export const unlockSongUrl = (
  id: number,
  keyword: string,
  server: SongUnlockServer,
  songName?: string,
  artist?: string,
  duration?: number,
  useKeywordLookup = false,
  platform?: string,
  platformId?: string,
) => {
  const params =
    server === SongUnlockServer.NETEASE && !useKeywordLookup
      ? { id }
      : { keyword, songName, artist, duration, platform, platformId };
  return request({
    baseURL: "/api/unblock",
    url: `/${server}`,
    params: { ...params, noCookie: true },
    timeout: UNLOCK_TIMEOUT[server],
    "axios-retry": { retries: 0 },
  });
};

// 获取歌曲歌词
export const songLyric = (id: number) => {
  return request({
    url: "/lyric/new",
    params: {
      id,
    },
  });
};

/**
 * 获取歌曲 TTML 歌词
 * @param id 音乐 id
 * @returns TTML 格式歌词
 */
export const songLyricTTML = async (id: number) => {
  if (isElectron) {
    return request({ url: "/lyric/ttml", params: { id, noCookie: true } });
  } else {
    const settingStore = useSettingStore();
    const server = settingStore.amllDbServer || defaultAMLLDbServer;
    const url = server.replace("%s", String(id));
    try {
      const response = await fetch(url);
      if (response === null || response.status !== 200) {
        return null;
      }
      const data = await response.text();
      return data;
    } catch {
      return null;
    }
  }
};

/**
 * 获取歌曲下载链接
 * @param id 音乐 id
 * @param level 播放音质等级, 分为 standard => 标准,higher => 较高, exhigh=>极高, lossless=>无损, hires=>Hi-Res, jyeffect => 高清环绕声, sky => 沉浸环绕声, `dolby` => `杜比全景声`, jymaster => 超清母带
 * @returns
 */
export const songDownloadUrl = (id: number, level: keyof typeof songLevelData = "h") => {
  // 获取对应音质
  const levelName = songLevelData[level].level;
  return request({
    url: "/song/download/url/v1",
    params: { id, level: levelName, timestamp: Date.now() },
  });
};

// 喜欢歌曲
export const likeSong = (id: number, like: boolean = true) => {
  return request({
    url: "/like",
    params: { id, like, timestamp: Date.now() },
  });
};

/**
 * 本地歌曲文件匹配
 * @param {string} title - 文件的标题信息，是文件属性里的标题属性，并非文件名
 * @param {string} album - 文件的专辑信息
 * @param {string} artist - 文件的艺术家信息
 * @param {number} duration - 文件的时长，单位为秒
 * @param {string} md5 - 文件的 md5
 */

export const matchSong = (
  title: string,
  artist: string,
  album: string,
  duration: number,
  md5: string,
) => {
  return request({
    url: "/search/match",
    params: { title, artist, album, duration, md5 },
  });
};

/**
 * 歌曲动态封面
 * @param {number} id - 歌曲 id
 */
export const songDynamicCover = (id: number) => {
  return request({
    url: "/song/dynamic/cover",
    params: { id },
  });
};

/**
 * 副歌时间
 * @param {number} id - 歌曲 id
 */
export const songChorus = (id: number) => {
  return request({
    url: "/song/chorus",
    params: { id },
  });
};

/**
 * 歌曲百科摘要
 * @param {number} id - 歌曲 id
 */
export const songWikiSummary = (id: number) => {
  return request({
    url: "/song/wiki/summary",
    params: { id },
  });
};

/**
 * 乐谱列表
 * @param {number} id - 歌曲 id
 */
export const songSheetList = (id: number) => {
  return request({
    url: "/sheet/list",
    params: { id },
  });
};

/**
 * 乐谱预览
 * @param {number} id - 乐谱 id
 */
export const songSheetPreview = (id: number) => {
  return request({
    url: "/sheet/preview",
    params: { id },
  });
};

/**
 * 歌曲首次收听信息
 * @param {number} id - 歌曲 id
 */
export const songFirstListenInfo = (id: number) => {
  return request({
    url: "/song/first/listen/info",
    params: { id },
  });
};
