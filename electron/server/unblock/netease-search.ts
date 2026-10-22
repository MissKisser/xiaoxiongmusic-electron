/**
 * 网易云检索换源
 *
 * 面向「非网易云平台的歌曲」（QQ 音乐 / 酷狗）在外站解锁源候选池里**没有原版**时的兜底：
 * 按「歌名 + 歌手」检索网易云曲库，命中后按站外源同一套三重校验（歌名 / 歌手 / 时长）排序，
 * 再取整曲直链。
 *
 * 直链取法有两级：
 * 1. 网易云官方地址（`song_url_v1`）—— 免费歌在有登录态时可直接给整曲；
 * 2. GD 音乐台的网易云直链 —— 官方给不出（需付费 / 无授权）时走这一级。
 *
 * 与其它站外源的关键差别：网易云的歌曲 id 与第三方平台的 id **不在同一编号空间**，
 * 因此这里只能按关键词检索，绝不能拿第三方平台的 id 去查网易云（会静默播错歌）。
 *
 * 限流与自愈：
 * 1. 检索接口限流时以 405「操作频繁」拒绝，这里按退避阶梯重试，重试耗尽则快速失败让位下一源；
 * 2. 成功的关键词检索结果按 60 秒短缓存复用，避免连续切歌对同一首歌连环打检索；
 * 3. GD 音乐台取链偶发 503，按有界退避重试救回。
 *
 * 缓存与重试状态都是纯内存态：进程重启即重置，不落盘、不产生界面提示。
 */
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import axios from "axios";
import NeteaseCloudMusicApi from "@neteasecloudmusicapienhanced/api";
import {
  FETCH_FAILED_REASON,
  MATCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  NO_CANDIDATE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
  isPlausibleAudioLength,
  rankCandidates,
  type MatchTarget,
} from "./match";
import { probeContentLength } from "./audio-length";
import { sanitizeUrl } from "./sanitize";
import { TTLCache, sleep } from "./resilience";

/** GD 音乐台接口地址（网易云直链） */
const GDSTUDIO_URL = "https://music-api.gdstudio.xyz/api.php";

/** 网易云检索条数（原版常排在封面版本之后，取数偏大才够用） */
const SEARCH_LIMIT = 100;

/** 网易云官方直链默认码率（kbps），用于体积校验 */
const NETEASE_BITRATE_KBPS = 128;

/** 单次换源最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 3;

/** 检索请求头 */
const SEARCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/** 检索被限流时的退避阶梯（毫秒），单次退避封顶 8 秒 */
const RATE_LIMIT_BACKOFF_MS = [2000, 4000, 8000];

/** 限流后最多重试次数：最多额外等待 2s + 4s = 6s，仍在网易云源的请求预算内 */
const RATE_LIMIT_MAX_RETRY = 2;

/** 关键词检索结果缓存时长（毫秒）：连续切歌命中同一关键词时直接复用，不再重复打检索 */
const SEARCH_CACHE_TTL_MS = 60000;

/** 关键词检索结果缓存条目上限 */
const SEARCH_CACHE_MAX_ENTRIES = 64;

/** 取链阶段（GD 音乐台）瞬时故障的重试次数 */
const FETCH_RETRY_LIMIT = 2;

/** 取链阶段重试的退避阶梯（毫秒） */
const FETCH_BACKOFF_MS = [300, 600];

/** 取链阶段总预算（毫秒）：限制重试把整链首响拖长的程度 */
const FETCH_STAGE_BUDGET_MS = 20000;

/** 单次取链请求的超时预算（毫秒） */
const FETCH_REQUEST_TIMEOUT_MS = 10000;

/** 检索候选的归一化结构 */
type NeteaseCandidate = {
  /** 网易云歌曲 id */
  id: string;
  /** 歌名 */
  title: string;
  /** 歌手 */
  artist: string;
  /** 时长（秒） */
  duration?: number;
};

/** 关键词检索结果缓存：同一关键词在窗口内复用，避免连环打检索触发限流 */
const searchCache = new TTLCache<NeteaseCandidate[]>(SEARCH_CACHE_TTL_MS, SEARCH_CACHE_MAX_ENTRIES);

/**
 * 判断异常是否为上游限流
 *
 * 网易云检索接口限流时以 HTTP 405 + 「操作频繁，请稍候再试」回应。
 * @param error 异常对象
 * @returns 是否为限流
 */
const isRateLimited = (error: unknown): boolean => {
  const payload = error as {
    status?: number;
    response?: { status?: number; data?: { code?: number } };
    body?: { code?: number; message?: string; msg?: string };
    message?: string;
  };
  const status = Number(payload?.status ?? payload?.response?.status ?? 0);
  const code = Number(payload?.body?.code ?? payload?.response?.data?.code ?? 0);
  if (status === 405 || code === 405) return true;
  const message = String(payload?.body?.message ?? payload?.body?.msg ?? payload?.message ?? "");
  return message.includes("操作频繁") || message.includes("频繁，请稍候");
};

/**
 * 构造检索缓存键
 *
 * 登录态会影响返回结果，登录与未登录分别缓存，避免切换账号后复用旧结果。
 * @param keyword 检索词
 * @param cookie 网易云登录态，可为空
 * @returns 缓存键
 */
const buildSearchCacheKey = (keyword: string, cookie?: Record<string, string>): string => {
  const scope = cookie && Object.keys(cookie).length ? "auth" : "anon";
  return `${scope}::${keyword}`;
};

/**
 * 执行一次网易云检索
 *
 * 命中限流时按退避阶梯重试（2s / 4s，单次封顶 8s），
 * 重试次数用尽仍被限流则抛出，交由上层快速失败让位下一个源。
 * @param keyword 检索词
 * @param cookie 网易云登录态，可为空
 * @returns 归一化后的候选列表
 */
const searchWithBackoff = async (
  keyword: string,
  cookie?: Record<string, string>,
): Promise<NeteaseCandidate[]> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await NeteaseCloudMusicApi.cloudsearch({
        keywords: keyword,
        type: 1,
        limit: SEARCH_LIMIT,
        ...(cookie && Object.keys(cookie).length ? { cookie } : {}),
      } as any);
      const songs = (response as any)?.body?.result?.songs || [];
      const candidates: NeteaseCandidate[] = [];
      for (const song of songs) {
        const id = String(song?.id ?? "");
        if (!id) continue;
        const duration = Math.round(Number(song?.dt ?? song?.duration ?? 0) / 1000);
        candidates.push({
          id,
          title: String(song?.name ?? ""),
          artist: (song?.ar || song?.artists || [])
            .map((item: any) => String(item?.name ?? ""))
            .join(" / "),
          duration: duration > 0 ? duration : undefined,
        });
      }
      return candidates;
    } catch (error) {
      if (!isRateLimited(error) || attempt >= RATE_LIMIT_MAX_RETRY) throw error;
      const delay = RATE_LIMIT_BACKOFF_MS[Math.min(attempt, RATE_LIMIT_BACKOFF_MS.length - 1)];
      serverLog.warn(
        `⚠️ Netease 检索被限流（关键词：${keyword}），${delay}ms 后重试（第 ${attempt + 1} 次）`,
      );
      await sleep(delay);
    }
  }
};

/**
 * 检索网易云候选歌曲
 *
 * 目标缺歌手时直接返回空列表：仅按歌名检索会命中同名不同版本的曲目
 * （实测《青花瓷》仅按歌名检索会命中 95 秒的街声版），宁可不换源也不播错歌。
 *
 * 检索词取「歌名 + 歌手」与「裸歌名」两组并集：站外源的曲目标题常把歌手写进歌名字段，
 * 只按「歌名 + 歌手」检索会漏掉这类候选。
 *
 * 成功的关键词检索结果按 60 秒短缓存复用：连续切歌回到同一首歌时不再重复打检索，
 * 既省一次往返，也避开网易云检索接口的频率限制。
 * @param title 歌名
 * @param artist 歌手；为空时不检索
 * @param cookie 网易云登录态，可为空
 * @returns 归一化后的候选列表
 */
const searchNeteaseCandidates = async (
  title: string,
  artist: string,
  cookie?: Record<string, string>,
): Promise<NeteaseCandidate[]> => {
  if (!artist.trim()) return [];
  const keywords = [`${title} ${artist}`, title];
  const candidates: NeteaseCandidate[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const cacheKey = buildSearchCacheKey(keyword, cookie);
    const cached = searchCache.get(cacheKey);
    if (cached) {
      serverLog.log(`♻️ Netease 检索结果命中缓存（关键词：${keyword}）`);
    }
    const songs = cached ?? (await searchWithBackoff(keyword, cookie));
    if (!cached && songs.length) searchCache.set(cacheKey, songs);
    for (const song of songs) {
      if (seen.has(song.id)) continue;
      seen.add(song.id);
      candidates.push(song);
    }
  }
  return candidates;
};

/**
 * 取网易云官方播放地址
 * @param id 网易云歌曲 id
 * @param cookie 网易云登录态，可为空
 * @returns 直链与码率；取不到时返回 null
 */
const getNeteaseOfficialUrl = async (
  id: string,
  cookie?: Record<string, string>,
): Promise<{ url: string; bitrate: number } | null> => {
  try {
    const response = await NeteaseCloudMusicApi.song_url_v1({
      id,
      level: "exhigh",
      ...(cookie && Object.keys(cookie).length ? { cookie } : {}),
    } as any);
    const item = (response as any)?.body?.data?.[0];
    const url = String(item?.url ?? "");
    // freeTrialInfo 非空表示这是 60 秒试听片段，不能当整曲用
    if (!url || item?.freeTrialInfo) return null;
    return { url, bitrate: Math.round(Number(item?.br ?? 0) / 1000) || NETEASE_BITRATE_KBPS };
  } catch {
    return null;
  }
};

/**
 * 取 GD 音乐台的网易云直链
 *
 * GD 通道偶发 503（同一曲目多次探测中约有一次 503），属瞬时故障，
 * 这里做最多 2 次退避重试；取链阶段总预算受限，重试不会把整链首响拖长。
 * @param id 网易云歌曲 id
 * @returns 直链与码率；取不到时返回 null
 */
const getGdstudioUrl = async (id: string): Promise<{ url: string; bitrate: number } | null> => {
  const deadline = Date.now() + FETCH_STAGE_BUDGET_MS;
  for (let attempt = 0; attempt <= FETCH_RETRY_LIMIT; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await axios.get(GDSTUDIO_URL, {
        params: { types: "url", id },
        headers: { "User-Agent": SEARCH_UA },
        timeout: Math.min(FETCH_REQUEST_TIMEOUT_MS, remaining),
        validateStatus: () => true,
      });
      // 5xx（503 为主）是瞬时故障，退避后重试；其余状态按既有语义处理
      if (response.status >= 500) {
        if (attempt < FETCH_RETRY_LIMIT) {
          serverLog.warn(
            `⚠️ GD 音乐台取链返回 ${response.status}（${attempt + 1}/${FETCH_RETRY_LIMIT}），退避后重试`,
          );
          await sleep(FETCH_BACKOFF_MS[attempt]);
          continue;
        }
        return null;
      }
      const body = response.data;
      if (!body || typeof body !== "object") return null;
      const url = String(body.url ?? "");
      if (!url) return null;
      return { url, bitrate: Math.round(Number(body.br ?? 0) / 1000) || NETEASE_BITRATE_KBPS };
    } catch {
      if (attempt < FETCH_RETRY_LIMIT) {
        await sleep(FETCH_BACKOFF_MS[attempt]);
        continue;
      }
      return null;
    }
  }
  return null;
};

/**
 * 通过网易云检索取整曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长）
 * @param cookie 网易云登录态，可为空
 * @returns 歌曲直链结果
 */
export const getNeteaseSearchSongUrl = async (
  target: MatchTarget,
  cookie?: Record<string, string>,
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON };
    if (!target.artist.trim()) {
      return { code: 404, url: null, reason: MISSING_ARTIST_REASON };
    }
    const candidates = await searchNeteaseCandidates(target.title, target.artist, cookie);
    if (!candidates.length) return { code: 404, url: null, reason: NO_CANDIDATE_REASON };
    const ranked = rankCandidates(candidates, target).filter((detail) => detail.passed);
    if (!ranked.length) return { code: 404, url: null, reason: MATCH_FAILED_REASON };

    for (const detail of ranked.slice(0, MAX_CANDIDATE_TRY)) {
      const id = detail.candidate.id;
      const sources = [await getNeteaseOfficialUrl(id, cookie), await getGdstudioUrl(id)];
      for (const source of sources) {
        if (!source) continue;
        const length = await probeContentLength(source.url, { "User-Agent": SEARCH_UA });
        const check = isPlausibleAudioLength(
          length,
          detail.candidate.duration,
          source.bitrate,
          target.duration,
        );
        if (!check.ok) {
          serverLog.warn(
            `⚠️ Netease candidate rejected (${detail.candidate.title}): ${check.reason}`,
          );
          continue;
        }
        if (!check.verified) {
          serverLog.warn(`⚠️ Netease 直链体积未验证 (${detail.candidate.title}): ${check.reason}`);
        }
        serverLog.log("🔗 NeteaseSearchSong URL:", sanitizeUrl(source.url));
        return { code: 200, url: source.url, lengthVerified: check.verified };
      }
    }
    serverLog.warn(`⚠️ Netease 候选通过校验但取不到直链（${target.title} / ${target.artist}）`);
    return { code: 404, url: null, reason: FETCH_FAILED_REASON };
  } catch (error) {
    serverLog.error("❌ Get NeteaseSearchSong URL Error:", error);
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
  }
};
