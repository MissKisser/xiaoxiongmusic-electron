/**
 * 星海音源（网易云）换源
 *
 * 星海音乐后端提供 lx 协议（落雪音源协议）的统一 HTTP 接口，其 wy 通道专供网易云音乐曲库，
 * 直接按网易云歌曲 ID 寻址取链，响应官方 CDN 直链（*.music.126.net）。
 *
 * 上游：星海音源的 lx/api 后端（社区公益接口，无第三方密钥，token 为本地生成的设备与出口 IP 标识）
 * - 主域：https://yy.zddyr.top/lx/api/（唯一可用入口，上游暂无其他在线备域；
 *   主域故障时依赖熔断器跳过整源，不做域名故障转移）
 * - 出口 IP 探测：https://yy.zddyr.top/ip.php（缓存 10 分钟）
 *
 * 能力：专接网易云音乐（lx 协议里的 wy 通道）。
 * - 按歌曲自带的网易云歌曲 ID（options.platformId）直查取链；
 * - 音质先尝试 320k，失败时降级尝试 128k。
 *
 * 交付直链前做两重把关：
 * 1. 时长闸门 —— 真实音频时长必须与目标曲目时长在容差内，拦截片段与另一版本；
 * 2. 体积校验 —— 按「时长 × 码率」核对文件体积，拦截占位与残缺文件。
 * （网易云官方直链无 QQ 音频文件 id 特征，故不做文件 id 模式匹配）
 *
 * 健壮性：公益上游无 SLA，取链层挂熔断器 ——
 * 上游 HTTP 5xx、连接失败、超时与非 4xx 语义的业务码计入故障，
 * 参数缺失 / 校验失败等请求侧结论不计；
 * 连续失败到阈值即熔断，熔断期内零请求。失败日志按「同源同曲」节流，避免刷屏。
 */
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import { randomBytes } from "crypto";
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

/** lx 后端使用的平台名（网易云通道） */
const XINGHAI_PLATFORM = "wy";

/** lx 后端主机（上游暂无可用备域，仅主域；主域故障由熔断器兜底） */
const XINGHAI_API_BASES = ["https://yy.zddyr.top/lx/api/"];

/** 访问者 IP 的探测地址：token 里需要带上调用方 IP */
const XINGHAI_IP_ENDPOINT = "https://yy.zddyr.top/ip.php";

/** 取链时尝试的音质档位（按顺序尝试，320k 失败降 128k） */
const XINGHAI_QUALITIES = ["320k", "128k"];

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

/** 客户端标识请求头 */
const CLIENT_HEADER = "XingHaiMusicSource/v3.2.15 (Windows)";

/** 设备标识：随进程生成，用于上游识别调用方 */
let deviceId = "";

/** 上游看到的访问者 IP（缓存复用，避免每次取链都多打一次探测） */
let cachedIp = "";

/** 访问者 IP 的缓存时刻 */
let cachedIpAt = 0;

/** 访问者 IP 的缓存时长（毫秒） */
const IP_CACHE_TTL = 10 * 60 * 1000;

/** 缓存的鉴权 token */
let cachedToken = "";

/** 鉴权 token 的缓存时刻 */
let cachedTokenAt = 0;

/** 鉴权 token 的复用时长（毫秒） */
const TOKEN_CACHE_TTL = 5 * 60 * 1000;

/** 星海音源熔断器：取链层熔断保护 */
const breaker = new CircuitBreaker({
  name: "星海音源",
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
  const key = `xinghai|${target.title}|${target.artist}`;
  const now = Date.now();
  const last = failureLogAt.get(key) ?? 0;
  if (now - last < FAIL_LOG_THROTTLE_MS) return;
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey);
    }
  }
  failureLogAt.set(key, now);
  serverLog.warn(`⚠️ 星海音源 换源失败（${target.title} / ${target.artist}）：${reason}`);
};

/** lx 协议里的歌曲信息（musicInfo） */
type XinghaiMusicInfo = {
  /** 歌曲 id（网易云歌曲 id） */
  songmid: string;
  /** 歌名 */
  name: string;
  /** 歌手 */
  singer: string;
  /** 时长（mm:ss） */
  interval: string;
  /** 专辑名 */
  albumName: string;
};

/** lx 后端返回的业务体 */
type XinghaiResponse = {
  /** 业务码：200 成功 */
  code?: number;
  /** 音频直链 */
  url?: string;
  /** 失败描述 */
  msg?: string;
};

/** xinghai 换源附加信息 */
export type XinghaiOptions = {
  /** 歌曲所属平台 */
  platform?: string;
  /** 平台内歌曲原生 id（网易云歌曲 id） */
  platformId?: string;
};

/**
 * 生成设备标识
 * @returns 设备标识
 */
const getDeviceId = (): string => {
  if (!deviceId) deviceId = randomBytes(16).toString("hex");
  return deviceId;
};

/**
 * 读取上游看到的访问者 IP
 *
 * token 里需要带上调用方 IP；探测失败时退化为 0.0.0.0，不阻断取链。
 * @returns 访问者 IP
 */
const fetchClientIp = async (): Promise<string> => {
  if (cachedIp && Date.now() - cachedIpAt < IP_CACHE_TTL) return cachedIp;
  try {
    const response = await axios.get(XINGHAI_IP_ENDPOINT, {
      headers: { "User-Agent": UA },
      timeout: 4000,
      validateStatus: () => true,
    });
    const ip = String(response.data?.ip || "").trim();
    if (ip) {
      cachedIp = ip;
      cachedIpAt = Date.now();
      return ip;
    }
  } catch {
    // 探测失败不阻断取链
  }
  return "0.0.0.0";
};

/**
 * 生成上游鉴权 token
 *
 * 5 分钟内复用缓存的 token，减少重复哈希与开销。
 * @param ip 访问者 IP
 * @returns token
 */
const buildToken = (ip: string): string => {
  const now = Date.now();
  if (cachedToken && now - cachedTokenAt < TOKEN_CACHE_TTL) {
    return cachedToken;
  }
  const token = Buffer.from(
    JSON.stringify({
      device_id: getDeviceId(),
      ip: ip || "0.0.0.0",
      timestamp: Math.floor(now / 1000),
      random: randomBytes(6).toString("hex").slice(0, 10),
    }),
    "utf8",
  ).toString("base64");
  cachedToken = token;
  cachedTokenAt = now;
  return token;
};

/**
 * 把秒数格式化成 lx 协议里的 mm:ss
 * @param seconds 秒数
 * @returns mm:ss 字符串
 */
const formatInterval = (seconds?: number): string => {
  if (!seconds || seconds <= 0) return "";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};

/**
 * 拼装 lx 后端的取链地址
 *
 * 参数与 lx 音源脚本发出的完全一致：平台、歌名、歌手、歌曲 id、时长、专辑、音质。
 * @param base 后端主机
 * @param info lx 协议里的歌曲信息
 * @param quality 音质档位
 * @returns 取链地址
 */
const buildApiUrl = (base: string, info: XinghaiMusicInfo, quality: string): string => {
  const params = new URLSearchParams({
    source: XINGHAI_PLATFORM,
    name: info.name,
    singer: info.singer,
    songmid: info.songmid,
    interval: info.interval,
    albumName: info.albumName,
    quality,
  });
  return `${base}?${params.toString()}`;
};

/**
 * 单次取链的结论
 */
type XinghaiFetchOutcome = {
  /** 取到的直链；失败时为 null */
  url: string | null;
  /** 失败原因描述 */
  reason: string;
  /** 本次失败是否属于上游故障（计入熔断计数） */
  fault: boolean;
};

/**
 * 向 lx 后端请求音频直链
 *
 * 主域失败时按备域重试；两域都失败时返回失败原因。
 * 故障口径与 resilience.ts 一致：HTTP 5xx、连接失败、超时与非 4xx 语义的业务码
 * 计入上游故障；4xx 属请求侧拒绝，不计入。
 * @param info lx 协议里的歌曲信息
 * @param quality 音质档位
 * @returns 取链结论
 */
const requestXinghaiSongUrl = async (
  info: XinghaiMusicInfo,
  quality: string,
): Promise<XinghaiFetchOutcome> => {
  const ip = await fetchClientIp();
  const headers = {
    "User-Agent": UA,
    "X-Token": buildToken(ip),
    "X-Client": CLIENT_HEADER,
    Accept: "application/json",
  };
  let lastReason = "上游未返回直链";
  let fault = false;
  for (const base of XINGHAI_API_BASES) {
    const url = buildApiUrl(base, info, quality);
    try {
      const response = await axios.get(url, {
        headers,
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      });
      const body = (response.data || {}) as XinghaiResponse;
      if (response.status >= 500) {
        lastReason = `上游 HTTP ${response.status}`;
        fault = true;
        continue;
      }
      if (response.status >= 400) {
        lastReason = `上游 HTTP ${response.status}`;
        continue;
      }
      if (body.code === 200 && body.url) {
        return { url: body.url, reason: "", fault: false };
      }
      lastReason = body.msg || `上游业务码 ${body.code ?? response.status}`;
      const business = parseBusinessError(body);
      if (business && isBusinessFault(business)) fault = true;
    } catch (error) {
      lastReason = String(error);
      fault = fault || isUpstreamFault(error);
    }
  }
  return { url: null, reason: lastReason, fault };
};

/**
 * 把网易云 CDN 的 http 直链升级为 https
 *
 * 上游返回的直链可能带 http 协议，在 https 渲染端下会被混合内容策略拦截。
 * 网易云 CDN 本身支持 https，升级协议后直链可安全播放。
 * @param url 上游返回的直链
 * @returns 可直接播放的直链
 */
const normalizeUrl = (url: string): string => {
  if (!/^http:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)(126\.net|music\.126\.net)$/i.test(parsed.hostname)) return url;
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return url;
  }
};

/**
 * 获取星海音源（网易云）歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @param options 平台信息（平台与平台原生 id）
 * @returns 歌曲直链结果
 */
const getXinghaiSongUrl = async (
  target: MatchTarget,
  options: XinghaiOptions = {},
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON };
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON };

    if (!breaker.canRequest()) {
      serverLog.warn(
        `🔌 星海音源处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          breaker.remainingOpenMs() / 1000,
        )} 秒）`,
      );
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
    }

    const songmid = options.platformId?.trim();
    if (!songmid) {
      breaker.recordSuccess();
      logUnlockFailure(target, NO_CANDIDATE_REASON);
      return { code: 404, url: null, reason: NO_CANDIDATE_REASON };
    }

    const expectedDuration = target.duration || 0;
    const info: XinghaiMusicInfo = {
      songmid,
      name: target.title,
      singer: target.artist,
      interval: formatInterval(expectedDuration),
      albumName: "",
    };

    let upstreamFault = false;
    for (const quality of XINGHAI_QUALITIES) {
      const outcome = await requestXinghaiSongUrl(info, quality);
      if (!outcome.url) {
        upstreamFault = upstreamFault || outcome.fault;
        serverLog.log(`🔎 星海音源取链失败（${quality}）：${outcome.reason}`);
        continue;
      }
      const url = normalizeUrl(outcome.url);
      const probe = await probeAudio(url, { "User-Agent": UA }, { timeoutMs: PROBE_TIMEOUT_MS });
      if (!probe.durationSec) {
        serverLog.warn("⚠️ xinghai candidate rejected: 未能读出真实音频时长");
        continue;
      }
      if (expectedDuration) {
        const delta = Math.abs(probe.durationSec - expectedDuration);
        if (delta > durationTolerance(expectedDuration)) {
          serverLog.warn(
            `⚠️ xinghai candidate rejected: 时长 ${probe.durationSec.toFixed(1)}s 偏离目标 ${expectedDuration}s`,
          );
          continue;
        }
      }
      const check = isPlausibleAudioLength(
        probe.bytes,
        expectedDuration || undefined,
        probe.bitrateKbps ?? 128,
        target.duration,
      );
      if (!check.ok) {
        serverLog.warn(`⚠️ xinghai candidate rejected: ${check.reason}`);
        continue;
      }
      serverLog.log("🔗 XinghaiSong URL:", sanitizeUrl(url));
      breaker.recordSuccess();
      return { code: 200, url, lengthVerified: check.verified };
    }
    if (upstreamFault) breaker.recordFailure();
    else breaker.recordSuccess();
    logUnlockFailure(target, FETCH_FAILED_REASON);
    return { code: 404, url: null, reason: FETCH_FAILED_REASON };
  } catch (error) {
    serverLog.error("❌ Get XinghaiSong URL Error:", error);
    if (isUpstreamFault(error)) breaker.recordFailure();
    else breaker.recordSuccess();
    logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON);
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
  }
};

export default getXinghaiSongUrl;
