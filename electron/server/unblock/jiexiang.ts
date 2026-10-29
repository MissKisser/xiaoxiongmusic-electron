/**
 * 吉祥音源（海棠系解析网关）换源
 *
 * 吉祥音源对接海棠系音乐解析网关，提供酷狗音乐曲库的直链解析能力，
 * 与小熊音乐既有的长青音源同属海棠接口生态。
 *
 * 上游：海棠系音乐解析网关（社区公益接口）
 * - 解析接口：POST https://musicserver.haitangw.cc/v1/music/resolve-url
 * - 请求体：{"source":"kg","rid":"<酷狗hash>","level":"<档位>"}
 * - 支持四档音质：exhigh（320k）、standard（128k）、lossless、hires；当前挂载 320k 与 128k 两档。
 * - 响应体格式：{"code":0,"message":"ok","data":{"url":"<直链>"}}
 * - 直链为 bdycdn 代理 CDN，URL 路径中内嵌 qu320 / qu128 音质标识。
 *
 * 能力：专接酷狗音乐曲库。
 * - 酷狗歌曲在换源链上始终携带平台原生 hash（options.platformId）；
 * - 缺失 hash 时直接判定无候选失败，不走检索换 id 流程；
 * - 取链按 320k（exhigh）降级 128k（standard）的顺序逐档尝试。
 *
 * 交付直链前做三重把关：
 * 1. 响应与直链校验 —— 接口响应 code===0 且 data.url 非空；
 * 2. 音质标识核验 —— 直链 URL 必须包含请求档位对应的音质标识（exhigh 需含 qu320，standard 需含 qu128），拦截上游静默降档；
 * 3. 时长与体积闸门 —— probeAudio 探测真实音频时长并与目标时长比对，结合 isPlausibleAudioLength 核验文件体积。
 *
 * 直链交付说明：
 * 上游返回的直链为 http 协议的 bdycdn 代理 CDN，客户端播放器支持 http 播放，保持原样交付，不做协议升级。
 *
 * 健壮性：公益上游无 SLA，取链层挂熔断器 ——
 * 连续失败到阈值即熔断，熔断期内零网络请求；
 * 失败日志按「同源同曲」节流，避免高频刷屏。
 */
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import axios from "axios";
import {
  FETCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  NO_CANDIDATE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
  durationTolerance,
  isPlausibleAudioLength,
  type MatchTarget,
} from "./match";
import { probeAudio } from "./audio-probe";
import { sanitizeUrl } from "./sanitize";
import {
  CircuitBreaker,
  isBusinessFault,
  isUpstreamFault,
  parseBusinessError,
} from "./resilience";

/** 吉祥音源解析网关地址 */
const JIEXIANG_RESOLVE_URL = "https://musicserver.haitangw.cc/v1/music/resolve-url";

/** 单次取链请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 8000;

/** 直链探测超时（毫秒） */
const PROBE_TIMEOUT_MS = 10000;

/** 连续失败多少次后熔断 */
const FAILURE_THRESHOLD = 3;

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const BREAK_DURATION_MS = 10 * 60 * 1000;

/** 同源同曲的失败日志节流窗口（毫秒） */
const FAIL_LOG_THROTTLE_MS = 10 * 1000;

/** 失败日志节流表的最大条目数：超出后清理过期条目，避免长期运行内存无界增长 */
const FAIL_LOG_THROTTLE_MAX_ENTRIES = 64;

/** 请求 UA */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/** 吉祥音源熔断器：取链层熔断保护 */
const breaker = new CircuitBreaker({
  name: "吉祥音源",
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
  const key = `jiexiang|${target.title}|${target.artist}`;
  const now = Date.now();
  const last = failureLogAt.get(key) ?? 0;
  if (now - last < FAIL_LOG_THROTTLE_MS) return;
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey);
    }
  }
  failureLogAt.set(key, now);
  serverLog.warn(`⚠️ 吉祥音源 换源失败（${target.title} / ${target.artist}）：${reason}`);
};

/** 吉祥音源尝试的音质档位 */
type JiexiangTier = {
  /** 档位名称 */
  name: string;
  /** 上游请求 level 参数 */
  level: string;
  /** URL 必须包含的音质标识 */
  token: string;
  /** 标称码率（kbps） */
  bitrateKbps: number;
};

/** 音质档位列表：优先 320k，失败时降级 128k */
const JIEXIANG_TIERS: JiexiangTier[] = [
  { name: "320k", level: "exhigh", token: "qu320", bitrateKbps: 320 },
  { name: "128k", level: "standard", token: "qu128", bitrateKbps: 128 },
];

/** 吉祥音源换源附加选项 */
export type JiexiangOptions = {
  /** 歌曲所属平台 */
  platform?: string;
  /** 平台内歌曲原生 id（酷狗 hash） */
  platformId?: string;
};

/** 上游网关返回的响应结构 */
type JiexiangResponse = {
  /** 状态码：0 成功 */
  code?: number | string;
  /** 响应消息 */
  message?: string;
  /** 数据载荷 */
  data?: {
    /** 音频直链 */
    url?: string;
  } | null;
  /** 请求链路追踪标识 */
  traceId?: string;
};

/**
 * 单次向解析网关请求直链的结论
 */
type JiexiangFetchOutcome = {
  /** 取到的直链；失败时为 null */
  url: string | null;
  /** 失败原因描述 */
  reason: string;
  /** 本次失败是否属于上游故障（计入熔断计数） */
  fault: boolean;
};

/**
 * 向吉祥音源解析网关请求单档音频直链
 * @param hash 酷狗歌曲 hash（小写）
 * @param tier 音质档位配置
 * @returns 取链结论
 */
const requestJiexiangSongUrl = async (
  hash: string,
  tier: JiexiangTier,
): Promise<JiexiangFetchOutcome> => {
  try {
    const response = await axios.post(
      JIEXIANG_RESOLVE_URL,
      {
        source: "kg",
        rid: hash,
        level: tier.level,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": UA,
          Accept: "application/json",
        },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      },
    );

    const body = (response.data || {}) as JiexiangResponse;

    // 单曲无资源时不计入整源故障
    if (body.code === "UPSTREAM_NO_RESOURCE") {
      return { url: null, reason: body.message || "上游暂无该曲目资源", fault: false };
    }

    if (response.status >= 500) {
      return { url: null, reason: `上游 HTTP ${response.status}`, fault: true };
    }
    if (response.status >= 400) {
      return { url: null, reason: `上游 HTTP ${response.status}`, fault: false };
    }

    if ((body.code === 0 || body.code === "0") && body.data?.url) {
      const url = body.data.url.trim();
      return { url, reason: "", fault: false };
    }

    const businessReason = body.message || `上游业务码 ${body.code ?? response.status}`;
    const business = parseBusinessError(body);
    const fault = business ? isBusinessFault(business) : false;
    return { url: null, reason: businessReason, fault };
  } catch (error) {
    return { url: null, reason: String(error), fault: isUpstreamFault(error) };
  }
};

/**
 * 获取吉祥音源（酷狗曲库）歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @param options 平台信息（平台与平台原生 id）
 * @returns 歌曲直链结果
 */
const getJiexiangSongUrl = async (
  target: MatchTarget,
  options: JiexiangOptions = {},
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON };
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON };

    if (!breaker.canRequest()) {
      serverLog.warn(
        `🔌 吉祥音源处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          breaker.remainingOpenMs() / 1000,
        )} 秒）`,
      );
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
    }

    const rawHash = options.platformId?.trim();
    if (!rawHash) {
      breaker.recordSuccess();
      logUnlockFailure(target, NO_CANDIDATE_REASON);
      return { code: 404, url: null, reason: NO_CANDIDATE_REASON };
    }
    const hash = rawHash.toLowerCase();

    const expectedDuration = target.duration || 0;
    let upstreamFault = false;

    for (const tier of JIEXIANG_TIERS) {
      const outcome = await requestJiexiangSongUrl(hash, tier);
      if (!outcome.url) {
        upstreamFault = upstreamFault || outcome.fault;
        serverLog.log(`🔎 吉祥音源取链失败（${tier.name}）：${outcome.reason}`);
        continue;
      }

      const url = outcome.url;

      // 音质标识核验：URL 必须包含档位对应的标识，拦截上游静默降档
      if (!url.includes(tier.token)) {
        serverLog.warn(`⚠️ jiexiang candidate rejected: 直链不含 ${tier.token} 音质标识`);
        continue;
      }

      const probe = await probeAudio(url, { "User-Agent": UA }, { timeoutMs: PROBE_TIMEOUT_MS });
      if (!probe.durationSec) {
        serverLog.warn("⚠️ jiexiang candidate rejected: 未能读出真实音频时长");
        continue;
      }

      if (expectedDuration) {
        const delta = Math.abs(probe.durationSec - expectedDuration);
        if (delta > durationTolerance(expectedDuration)) {
          serverLog.warn(
            `⚠️ jiexiang candidate rejected: 真实时长 ${probe.durationSec.toFixed(1)}s 偏离目标 ${expectedDuration}s`,
          );
          continue;
        }
      }

      const check = isPlausibleAudioLength(
        probe.bytes,
        expectedDuration || undefined,
        probe.bitrateKbps ?? tier.bitrateKbps,
        target.duration,
      );
      if (!check.ok) {
        serverLog.warn(`⚠️ jiexiang candidate rejected: ${check.reason}`);
        continue;
      }

      serverLog.log("🔗 JiexiangSong URL:", sanitizeUrl(url));
      breaker.recordSuccess();
      return { code: 200, url, lengthVerified: check.verified };
    }

    if (upstreamFault) breaker.recordFailure();
    else breaker.recordSuccess();
    logUnlockFailure(target, FETCH_FAILED_REASON);
    return { code: 404, url: null, reason: FETCH_FAILED_REASON };
  } catch (error) {
    serverLog.error("❌ Get JiexiangSong URL Error:", error);
    if (isUpstreamFault(error)) breaker.recordFailure();
    else breaker.recordSuccess();
    logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON);
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
  }
};

export default getJiexiangSongUrl;
