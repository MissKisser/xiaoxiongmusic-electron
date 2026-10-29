/**
 * 小鱼音源（糖果公开接口）换源
 *
 * 小鱼是社区公益源：对外只暴露一个公开的歌曲解析接口，
 * 按 QQ 歌曲 mid 一次性返回该曲的全部音质档位直链，以及各档的官方体积与官方码率。
 *
 * 上游：糖果公开接口（社区公益接口，无需鉴权与 Cookie）
 * - 入口：https://tang.api.s01s.cn/music_open_api.php（单 GET，参数 mid）
 * - 单次请求即返回全档直链，无需逐档请求；
 * - 上游暂无在线备域，主域故障时依赖熔断器跳过整源，不做域名故障转移。
 *
 * 能力：专接 QQ 音乐曲库。
 * - 歌曲自带 QQ mid 时零检索直查；
 * - 否则按「歌名 + 歌手」走项目自身的 QQ 检索网关换 mid，候选过站外源同一套三重校验后再取链。
 *
 * 交付直链前做三重把关：
 * 1. 身份校验 —— 响应回显的 song_mid 必须等于请求的 mid，防错版；
 * 2. 时长闸门 —— 上游声明时长与真实音频时长都必须落在目标曲目时长的容差内，拦截片段与另一版本；
 * 3. 体积校验 —— 实测体积与上游同档声明体积互校，并按「时长 × 码率」核对，拦截占位与残缺文件。
 *
 * 健壮性：公益上游无 SLA，取链层挂熔断器 ——
 * 上游 HTTP 5xx、连接失败、超时计入故障，参数缺失 / 校验失败等请求侧结论不计；
 * 连续失败到阈值即熔断，熔断期内零请求。失败日志按「同源同曲」节流，避免刷屏。
 */
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import { callQQMusic } from "../../main/apis/qqmusic";
import axios from "axios";
import {
  FETCH_FAILED_REASON,
  MATCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  NO_CANDIDATE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
  durationTolerance,
  isPlausibleAudioLength,
  rankCandidates,
  type MatchCandidate,
  type MatchTarget,
} from "./match";
import { probeAudio } from "./audio-probe";
import { probeContentLength } from "./audio-length";
import { sanitizeUrl } from "./sanitize";
import { CircuitBreaker, isUpstreamFault } from "./resilience";

/** 小鱼取链接口（唯一可用入口，上游暂无备域） */
const FISH_API_BASE = "https://tang.api.s01s.cn/music_open_api.php";

/** 单次取链请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 8000;

/** 直链探测超时（毫秒） */
const PROBE_TIMEOUT_MS = 10000;

/** 检索候选条数 */
const SEARCH_LIMIT = 20;

/** 连续失败多少次后熔断 */
const FAILURE_THRESHOLD = 3;

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const BREAK_DURATION_MS = 10 * 60 * 1000;

/** 同源同曲的失败日志节流窗口（毫秒） */
const FAIL_LOG_THROTTLE_MS = 10 * 1000;

/** 失败日志节流表的最大条目数：超出后清理过期条目，避免长期运行内存无界增长 */
const FAIL_LOG_THROTTLE_MAX_ENTRIES = 64;

/** 实测体积与上游同档声明体积的允许偏差比例 */
const SIZE_TOLERANCE_RATIO = 0.15;

/** 请求 UA */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/** 小鱼音源熔断器：取链层熔断保护 */
const breaker = new CircuitBreaker({
  name: "小鱼音源",
  failureThreshold: FAILURE_THRESHOLD,
  openDurationMs: BREAK_DURATION_MS,
  onStateChange: (message) => serverLog.warn(`🔌 ${message}`),
});

/** 同源同曲的失败日志节流表：记录上一次写日志的时刻 */
const failureLogAt = new Map<string, number>();

/**
 * 记录一次换源失败
 *
 * 同源同曲在节流窗口内只写一条日志：换源链按优先级逐源尝试，
 * 同一首歌被反复重试时不至于刷屏。
 * @param target 目标歌曲信息
 * @param reason 失败原因（用户可读文案）
 */
const logUnlockFailure = (target: MatchTarget, reason: string): void => {
  const key = `fish|${target.title}|${target.artist}`;
  const now = Date.now();
  const last = failureLogAt.get(key) ?? 0;
  if (now - last < FAIL_LOG_THROTTLE_MS) return;
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey);
    }
  }
  failureLogAt.set(key, now);
  serverLog.warn(`⚠️ 小鱼音源 换源失败（${target.title} / ${target.artist}）：${reason}`);
};

/** 小鱼的音质档位（一次请求全档返回，按顺序挑选直链字段） */
type FishTier = {
  /** 档位名 */
  name: string;
  /** 直链字段（按顺序取第一个非空值） */
  urlFields: string[];
  /** 同档官方体积字段（字节） */
  sizeField: string;
  /** 同档官方码率字段（kbps） */
  kbpsField: string;
  /** 码率下限（kbps）：低于此值视为降档或残缺 */
  minKbps: number;
};

/**
 * 小鱼的档位表
 *
 * 上游把 320k 档交付为 QQ 官方 C600（192k AAC），
 * 128k 档交付为 C400，因此各档的码率锚点取上游同档声明值。
 * 无损档（sq）上游有返回，暂不挂载。
 */
const FISH_TIERS: FishTier[] = [
  {
    name: "320k",
    urlFields: ["song_play_url_hq", "song_play_url"],
    sizeField: "song_size_hq_str",
    kbpsField: "kbps_hq",
    minKbps: 96,
  },
  {
    name: "128k",
    urlFields: ["song_play_url_standard"],
    sizeField: "song_size_standard_str",
    kbpsField: "kbps_standard",
    minKbps: 64,
  },
];

/** 小鱼返回的歌曲信息 */
type FishSongInfo = {
  /** 回显的歌曲 mid（身份锚点） */
  song_mid?: string | null;
  /** 歌名 */
  song_name?: string | null;
  /** 歌手 */
  singer_name?: string | null;
  /** 歌曲时长（秒） */
  song_play_time?: number | null;
  /** 320k 档官方体积（字节） */
  song_size_hq_str?: number | null;
  /** 128k 档官方体积（字节） */
  song_size_standard_str?: number | null;
  /** 320k 档直链 */
  song_play_url_hq?: string | null;
  /** 320k 档直链（备用字段） */
  song_play_url?: string | null;
  /** 128k 档直链 */
  song_play_url_standard?: string | null;
  /** 320k 档官方码率（kbps） */
  kbps_hq?: number | null;
  /** 128k 档官方码率（kbps） */
  kbps_standard?: number | null;
};

/** 小鱼换源附加信息 */
export type FishOptions = {
  /** 歌曲所属平台；只有 qqmusic 平台的 id 才能直接当 QQ mid 用 */
  platform?: string;
  /** 平台内歌曲原生 id（QQ mid） */
  platformId?: string;
};

/**
 * 把 QQ CDN 的 http 直链升级为 https
 *
 * 上游会给回 http 直链，渲染端在 https 页面上会被混合内容策略拦掉；
 * QQ CDN 本身支持 https，同一 vkey 换协议即可。
 * @param url 上游返回的直链
 * @returns 可直接播放的直链
 */
const normalizeUrl = (url: string): string => {
  if (!/^http:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)qq\.com$/i.test(parsed.hostname)) return url;
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return url;
  }
};

/**
 * 检索 QQ 音乐候选
 * @param title 歌名
 * @param artist 歌手
 * @returns 归一化后的候选列表
 */
const searchQqCandidates = async (title: string, artist: string): Promise<MatchCandidate[]> => {
  const response = await callQQMusic("search", {
    keywords: `${title}-${artist}`,
    type: 0,
    page: 1,
    limit: SEARCH_LIMIT,
  });
  const songs = Array.isArray(response?.songs) ? response.songs : [];
  const candidates: MatchCandidate[] = [];
  for (const song of songs) {
    const id = String(song?.mid ?? "");
    const songTitle = String(song?.name ?? "").trim();
    if (!id || !songTitle) continue;
    const duration = Math.round(Number(song?.duration ?? 0) / 1000);
    candidates.push({
      id,
      title: songTitle,
      artist: String(song?.artist ?? "").trim(),
      duration: duration > 0 ? duration : undefined,
    });
  }
  return candidates;
};

/**
 * 解析目标歌曲的 QQ mid
 *
 * 歌曲自带 QQ mid 时零检索直查；否则按「歌名 + 歌手」检索换 mid，
 * 候选必须过站外源同一套三重校验（歌名 / 歌手 / 时长）。
 * @param target 目标歌曲信息
 * @param options 平台信息
 * @returns mid；无法确定时返回 null 与原因
 */
const resolveSongMid = async (
  target: MatchTarget,
  options: FishOptions,
): Promise<{ mid: string | null; reason: string }> => {
  if (options.platform === "qqmusic" && options.platformId?.trim()) {
    return { mid: options.platformId.trim(), reason: "" };
  }
  const candidates = await searchQqCandidates(target.title, target.artist);
  if (!candidates.length) return { mid: null, reason: NO_CANDIDATE_REASON };
  const ranked = rankCandidates(candidates, target).filter((detail) => detail.passed);
  if (!ranked.length) return { mid: null, reason: MATCH_FAILED_REASON };
  return { mid: ranked[0].candidate.id, reason: "" };
};

/**
 * 向小鱼接口请求歌曲信息
 * @param mid QQ 歌曲 mid
 * @returns 上游响应体与失败结论
 */
const requestFishSong = async (
  mid: string,
): Promise<{ body: FishSongInfo | null; reason: string; fault: boolean }> => {
  const url = `${FISH_API_BASE}?mid=${encodeURIComponent(mid)}`;
  try {
    const response = await axios.get(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (response.status >= 500) {
      return { body: null, reason: `上游 HTTP ${response.status}`, fault: true };
    }
    if (response.status >= 400) {
      return { body: null, reason: `上游 HTTP ${response.status}`, fault: false };
    }
    const body = (response.data || {}) as FishSongInfo;
    if (!body || typeof body !== "object") {
      return { body: null, reason: "上游未返回歌曲信息", fault: false };
    }
    return { body, reason: "", fault: false };
  } catch (error) {
    return { body: null, reason: String(error), fault: isUpstreamFault(error) };
  }
};

/**
 * 从上游响应里取某个字段的数值
 * @param body 上游响应体
 * @param field 字段名
 * @returns 数值；字段缺失或非法时返回 0
 */
const readNumber = (body: FishSongInfo, field: string): number => {
  const raw = (body as unknown as Record<string, unknown>)[field];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/**
 * 从上游响应里取某个字段的文本
 * @param body 上游响应体
 * @param field 字段名
 * @returns 文本；字段缺失时返回空串
 */
const readText = (body: FishSongInfo, field: string): string => {
  const raw = (body as unknown as Record<string, unknown>)[field];
  return typeof raw === "string" ? raw.trim() : "";
};

/**
 * 获取小鱼音源（QQ 音乐）歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @param options 平台信息（平台与平台原生 id）
 * @returns 歌曲直链结果
 */
const getFishSongUrl = async (
  target: MatchTarget,
  options: FishOptions = {},
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON };
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON };

    if (!breaker.canRequest()) {
      serverLog.warn(
        `🔌 小鱼音源处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          breaker.remainingOpenMs() / 1000,
        )} 秒）`,
      );
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
    }

    const resolved = await resolveSongMid(target, options);
    if (!resolved.mid) {
      // 无候选 / 匹配失败是请求侧结论，不计入熔断
      breaker.recordSuccess();
      const reason = resolved.reason || NO_CANDIDATE_REASON;
      logUnlockFailure(target, reason);
      return { code: 404, url: null, reason };
    }
    const mid = resolved.mid;

    const outcome = await requestFishSong(mid);
    if (!outcome.body) {
      if (outcome.fault) breaker.recordFailure();
      else breaker.recordSuccess();
      const reason = outcome.reason || FETCH_FAILED_REASON;
      logUnlockFailure(target, reason);
      return { code: 404, url: null, reason: FETCH_FAILED_REASON };
    }
    const body = outcome.body;

    // 身份闸门：上游回显的 mid 必须与请求的 mid 一致，防错版
    if (!body.song_mid || body.song_mid !== mid) {
      breaker.recordSuccess();
      serverLog.warn(`⚠️ fish candidate rejected: 回显 mid ${body.song_mid ?? "空"} 与请求不符`);
      logUnlockFailure(target, FETCH_FAILED_REASON);
      return { code: 404, url: null, reason: FETCH_FAILED_REASON };
    }

    // 上游声明时长与请求时长的闸门：同一 mid 的声明时长对不上即判为另一版本
    const declaredDuration = readNumber(body, "song_play_time");
    if (target.duration && declaredDuration) {
      const delta = Math.abs(declaredDuration - target.duration);
      if (delta > durationTolerance(target.duration)) {
        breaker.recordSuccess();
        serverLog.warn(
          `⚠️ fish candidate rejected: 声明时长 ${declaredDuration}s 偏离目标 ${target.duration}s`,
        );
        logUnlockFailure(target, FETCH_FAILED_REASON);
        return { code: 404, url: null, reason: FETCH_FAILED_REASON };
      }
    }
    const expectedDuration = target.duration || declaredDuration;

    for (const tier of FISH_TIERS) {
      let rawUrl = "";
      for (const field of tier.urlFields) {
        const value = readText(body, field);
        if (value) {
          rawUrl = value;
          break;
        }
      }
      if (!rawUrl) {
        serverLog.log(`🔎 小鱼音源取链失败（${tier.name}）：上游未返回直链`);
        continue;
      }
      const url = normalizeUrl(rawUrl);
      const probe = await probeAudio(url, { "User-Agent": UA }, { timeoutMs: PROBE_TIMEOUT_MS });
      if (!probe.durationSec) {
        serverLog.warn("⚠️ fish candidate rejected: 未能读出真实音频时长");
        continue;
      }
      if (expectedDuration) {
        const delta = Math.abs(probe.durationSec - expectedDuration);
        if (delta > durationTolerance(expectedDuration)) {
          serverLog.warn(
            `⚠️ fish candidate rejected: 真实时长 ${probe.durationSec.toFixed(1)}s 偏离目标 ${expectedDuration}s`,
          );
          continue;
        }
      }
      const measured = await probeContentLength(url, { "User-Agent": UA });
      const declaredSize = readNumber(body, tier.sizeField);
      if (measured && declaredSize) {
        const deviation = Math.abs(measured - declaredSize) / declaredSize;
        if (deviation > SIZE_TOLERANCE_RATIO) {
          serverLog.warn(
            `⚠️ fish candidate rejected: 实测体积 ${measured}B 与上游声明 ${declaredSize}B 偏差过大`,
          );
          continue;
        }
      }
      const bitrateKbps = probe.bitrateKbps || readNumber(body, tier.kbpsField);
      if (!bitrateKbps || bitrateKbps < tier.minKbps) {
        serverLog.warn(
          `⚠️ fish candidate rejected: 码率 ${bitrateKbps}kbps 低于 ${tier.name} 档下限 ${tier.minKbps}kbps`,
        );
        continue;
      }
      const check = isPlausibleAudioLength(
        measured,
        expectedDuration || undefined,
        bitrateKbps,
        target.duration,
      );
      if (!check.ok) {
        serverLog.warn(`⚠️ fish candidate rejected: ${check.reason}`);
        continue;
      }
      serverLog.log("🔗 FishSong URL:", sanitizeUrl(url));
      breaker.recordSuccess();
      return { code: 200, url, lengthVerified: check.verified };
    }
    breaker.recordSuccess();
    logUnlockFailure(target, FETCH_FAILED_REASON);
    return { code: 404, url: null, reason: FETCH_FAILED_REASON };
  } catch (error) {
    serverLog.error("❌ Get FishSong URL Error:", error);
    if (isUpstreamFault(error)) breaker.recordFailure();
    else breaker.recordSuccess();
    logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON);
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
  }
};

export default getFishSongUrl;
