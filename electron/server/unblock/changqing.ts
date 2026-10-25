/**
 * 长青聚合站换源
 *
 * 长青是社区公益聚合站：把平台曲库统一成「按平台内歌曲 id 取链」的接口，站内没有检索能力。
 * 本模块只接 QQ 通道：入参是 QQ 歌曲 mid。
 *
 * id 的来源有两条：
 * 1. 歌曲本身来自 QQ 时，直接用歌曲自带的 QQ mid，无需检索；
 * 2. 歌曲来自其它平台（含酷狗）时，按「歌名 + 歌手」走项目自身的 QQ 检索网关换到 QQ mid，
 *    换到的候选先过站外源同一套三重校验（歌名 / 歌手 / 时长）再取链。
 *
 * 取链返回的是裸音频流（不是 JSON），因此直链就是取链地址本身。
 * 公益站返回的文件未必是请求的那一版（实测同一条 id 可返回时长明显不同的另一版），
 * 所以取链后按真实音频时长做闸门，偏差超容差即判为错版、拒绝交付。
 *
 * 公益站无 SLA：检索层挂熔断（连续失败到阈值即熔断，熔断期内零请求）；
 * 取链层按多主机故障转移逐个尝试，单次尝试有硬时限，超时即放弃该次尝试。
 */
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import { callQQMusic } from "../../main/apis/qqmusic";
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
  type MatchTarget,
} from "./match";
import { probeAudio, type AudioProbe } from "./audio-probe";
import { sanitizeUrl } from "./sanitize";
import {
  CircuitBreaker,
  isBusinessFault,
  isUpstreamFault,
  parseBusinessError,
} from "./resilience";

/** 长青取链的请求头 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/** 检索层连续失败多少次后熔断 */
const SEARCH_FAILURE_THRESHOLD = 3;

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const SEARCH_BREAK_DURATION_MS = 10 * 60 * 1000;

/** 单次换源最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 2;

/** 检索候选条数 */
const SEARCH_LIMIT = 20;

/** 单次取链尝试的硬时限（毫秒）：超时即放弃该次尝试并转下一主机 / 音质 */
const FETCH_ATTEMPT_TIMEOUT_MS = 8000;

/** 取链成功的最小响应体（字节）：裸音频流必然远大于此值 */
const MIN_AUDIO_BYTES = 4096;

/** 长青各通道的取链主机（按顺序故障转移） */
const CHANNEL_HOSTS: Record<string, string[]> = {
  // QQ 通道：另两台备援主机对请求统一 302 到退化地址（死链），只保留主域这一台
  qq: ["https://musicapi.haitangw.net/music/qq_kw.php"],
};

/** 长青各通道的音质档位（按顺序尝试） */
const CHANNEL_LEVELS: Record<string, string[]> = {
  qq: ["standard", "exhigh"],
};

/** 通道对应的平台（用于取歌曲自带的原生 id） */
const CHANNEL_PLATFORM: Record<string, string> = {
  qq: "qqmusic",
};

/** 长青通道的默认尝试顺序 */
const CHANNEL_SEQUENCE = ["qq"];

/**
 * 按歌曲来源平台排定通道顺序
 *
 * 歌曲自带平台原生 id（QQ mid）时，先走该平台对应的通道：
 * 直接按原生 id 取链，零检索；另一平台的通道需要按关键词换 id，放在后面兜底。
 * 歌曲不是 QQ 来源时没有直查通道，保持默认顺序。
 * @param platform 歌曲来源平台
 * @returns 通道尝试顺序
 */
const resolveChannelOrder = (platform?: string): string[] => {
  const nativeChannel = CHANNEL_SEQUENCE.find((channel) => CHANNEL_PLATFORM[channel] === platform);
  if (!nativeChannel) return [...CHANNEL_SEQUENCE];
  return [nativeChannel, ...CHANNEL_SEQUENCE.filter((channel) => channel !== nativeChannel)];
};

/** 长青检索层熔断器 */
const searchBreaker = new CircuitBreaker({
  name: "长青检索",
  failureThreshold: SEARCH_FAILURE_THRESHOLD,
  openDurationMs: SEARCH_BREAK_DURATION_MS,
  onStateChange: (message) => serverLog.warn(`🔌 ${message}`),
});

/** 同源同曲的失败日志节流窗口（毫秒） */
const FAIL_LOG_THROTTLE_MS = 10 * 1000;

/** 失败日志节流表的最大条目数：超出后清理过期条目，避免长期运行内存无界增长 */
const FAIL_LOG_THROTTLE_MAX_ENTRIES = 64;

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
  const key = `changqing|${target.title}|${target.artist}`;
  const now = Date.now();
  const last = failureLogAt.get(key) ?? 0;
  if (now - last < FAIL_LOG_THROTTLE_MS) return;
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey);
    }
  }
  failureLogAt.set(key, now);
  serverLog.warn(`⚠️ 长青 换源失败（${target.title} / ${target.artist}）：${reason}`);
};

/** 长青取链请求的附加信息 */
export type ChangqingOptions = {
  /** 歌曲所属平台；缺省视为非 QQ / 酷狗来源 */
  platform?: string;
  /** 平台内歌曲原生 id（QQ mid / 酷狗 hash） */
  platformId?: string;
};

/** 长青通道候选 */
type ChangqingCandidate = {
  /** 平台内歌曲 id */
  id: string;
  /** 歌名 */
  title: string;
  /** 歌手 */
  artist: string;
  /** 时长（秒） */
  duration?: number;
};

/**
 * 检索 QQ 音乐候选
 * @param keyword 检索词
 * @returns 归一化后的候选列表
 */
const searchQqCandidates = async (keyword: string): Promise<ChangqingCandidate[]> => {
  const response = await callQQMusic("search", {
    keywords: keyword,
    type: 0,
    page: 1,
    limit: SEARCH_LIMIT,
  });
  const songs = Array.isArray(response?.songs) ? response.songs : [];
  const candidates: ChangqingCandidate[] = [];
  for (const song of songs) {
    const id = String(song?.mid ?? "");
    const title = String(song?.name ?? "").trim();
    if (!id || !title) continue;
    const duration = Math.round(Number(song?.duration ?? 0) / 1000);
    candidates.push({
      id,
      title,
      artist: String(song?.artist ?? "").trim(),
      duration: duration > 0 ? duration : undefined,
    });
  }
  return candidates;
};

/**
 * 解析通道的候选列表
 *
 * 歌曲本身就是该平台来源时，用歌曲自带的原生 id（无需检索）；
 * 否则走项目自身的检索网关按关键词换 id，检索词两种分隔形式依次尝试。
 * @param channel 通道标识
 * @param target 目标歌曲信息
 * @param options 请求附带的平台信息
 * @returns 归一化后的候选列表
 */
const resolveCandidates = async (
  channel: string,
  target: MatchTarget,
  options: ChangqingOptions,
): Promise<ChangqingCandidate[]> => {
  const platform = CHANNEL_PLATFORM[channel];
  if (options.platform === platform && options.platformId) {
    serverLog.log(`🔗 长青 ${channel} 通道按平台原生 id 直查（零检索）`);
    return [
      {
        id: options.platformId,
        title: target.title,
        artist: target.artist,
        duration: target.duration,
      },
    ];
  }
  serverLog.log(`🔎 长青 ${channel} 通道按关键词检索换 id`);
  const keywords = target.artist
    ? [`${target.title}-${target.artist}`, `${target.title} ${target.artist}`]
    : [target.title];
  const merged: ChangqingCandidate[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const candidates = await searchQqCandidates(keyword);
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      merged.push(candidate);
    }
    // 首个检索词已能换到通过校验的候选就不再换检索词
    if (rankCandidates(merged, target).some((detail) => detail.passed)) break;
  }
  return merged;
};

/** 单次取链尝试的结论 */
type EndpointFetch = {
  /** 是否取到可交付的直链 */
  ok: boolean;
  /** 取到的直链与探测结论；失败时为 null */
  result: { url: string; probe: AudioProbe } | null;
  /** 本次失败是否属于上游故障（计入熔断计数） */
  fault: boolean;
  /** 失败原因描述 */
  reason: string;
};

/**
 * 从某个主机取链
 *
 * 每次尝试都有硬时限：公益站无 SLA，单台主机慢响应可达 7 秒以上，
 * 多主机 × 多音质累加会把整条换源拖到分钟级。
 *
 * 长青的成功响应是裸音频流，业务错误响应是一小段 JSON
 * （`{"code":201,"msg":"error"}` 之类，几十字节）。两者字节量差着几个数量级，
 * 因此「响应体过小」与「业务错误 JSON」都归入取链失败，并按错误码语义区分归因：
 * 上游侧错误（201 等）计入熔断故障，请求侧拒绝（401 等）不计入。
 * @param endpoint 取链地址
 * @param id 平台内歌曲 id
 * @param level 音质档位
 * @returns 取链结论
 */
const fetchFromEndpoint = async (
  endpoint: string,
  id: string,
  level: string,
): Promise<EndpointFetch> => {
  const url = `${endpoint}?type=mp3&id=${encodeURIComponent(id)}&level=${encodeURIComponent(level)}`;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_ATTEMPT_TIMEOUT_MS);
  try {
    const probe = await probeAudio(url, { "User-Agent": UA }, {
      signal: controller.signal,
      timeoutMs: FETCH_ATTEMPT_TIMEOUT_MS,
    });
    if (probe.bytes && probe.bytes >= MIN_AUDIO_BYTES) {
      return { ok: true, result: { url, probe }, fault: false, reason: "" };
    }
    const business = parseBusinessError(probe.bodyText);
    if (business) {
      return {
        ok: false,
        result: null,
        fault: isBusinessFault(business),
        reason: `业务错误 ${business.code}${business.msg ? `（${business.msg}）` : ""}`,
      };
    }
    return {
      ok: false,
      result: null,
      fault: true,
      reason: timedOut ? "超过单次取链时限" : `响应体过小（${probe.bytes ?? 0} 字节）`,
    };
  } catch (error) {
    return {
      ok: false,
      result: null,
      fault: timedOut || isUpstreamFault(error),
      reason: timedOut ? "超过单次取链时限" : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 在通道的各主机上取链（主机故障转移）
 * @param channel 通道标识
 * @param id 平台内歌曲 id
 * @returns 取链结论；全部主机失败时 result 为 null
 */
const fetchFromChannel = async (
  channel: string,
  id: string,
): Promise<{ result: { url: string; probe: AudioProbe } | null; fault: boolean }> => {
  const hosts = CHANNEL_HOSTS[channel] ?? [];
  const levels = CHANNEL_LEVELS[channel] ?? ["standard"];
  let fault = false;
  for (const host of hosts) {
    for (const level of levels) {
      const outcome = await fetchFromEndpoint(host, id, level);
      if (outcome.ok && outcome.result) {
        return { result: outcome.result, fault };
      }
      fault = fault || outcome.fault;
      serverLog.warn(`⚠️ 长青取链失败（${host} / ${level}）：${outcome.reason}`);
    }
  }
  return { result: null, fault };
};

/**
 * 获取长青歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @param options 请求附带的平台信息（平台与平台原生 id）
 * @returns 歌曲直链结果
 */
const getChangqingSongUrl = async (
  target: MatchTarget,
  options: ChangqingOptions = {},
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON };
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON };
    if (!searchBreaker.canRequest()) {
      serverLog.warn(
        `🔌 长青检索处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          searchBreaker.remainingOpenMs() / 1000,
        )} 秒）`,
      );
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
    }
    let upstreamFault = false;
    let hasCandidate = false;
    let hasPassedCandidate = false;
    for (const channel of resolveChannelOrder(options.platform)) {
      let candidates: ChangqingCandidate[] = [];
      try {
        candidates = await resolveCandidates(channel, target, options);
      } catch (error) {
        upstreamFault = upstreamFault || isUpstreamFault(error);
        serverLog.warn(`⚠️ 长青 ${channel} 通道检索失败：${String(error)}`);
        continue;
      }
      if (!candidates.length) continue;
      hasCandidate = true;
      const ranked = rankCandidates(candidates, target).filter((detail) => detail.passed);
      if (!ranked.length) continue;
      hasPassedCandidate = true;
      for (const detail of ranked.slice(0, MAX_CANDIDATE_TRY)) {
        const candidate = detail.candidate;
        let fetched: { url: string; probe: AudioProbe } | null = null;
        try {
          const outcome = await fetchFromChannel(channel, candidate.id);
          fetched = outcome.result;
          upstreamFault = upstreamFault || outcome.fault;
        } catch (error) {
          upstreamFault = upstreamFault || isUpstreamFault(error);
          serverLog.warn(`⚠️ 长青 ${channel} 通道取链失败：${String(error)}`);
        }
        if (!fetched) continue;
        const { probe } = fetched;
        // 真实音频时长闸门：公益站可能返回同一 id 的另一个版本，按字节数判断不出来。
        // 请求侧有时长时，读不出真实时长就不交付 —— 宁可换源失败也不播错版本。
        if (target.duration) {
          if (!probe.durationSec) {
            serverLog.warn(`⚠️ 长青 candidate rejected (${candidate.title}): 未能读出真实音频时长`);
            continue;
          }
          const delta = Math.abs(probe.durationSec - target.duration);
          if (delta > durationTolerance(target.duration)) {
            serverLog.warn(
              `⚠️ 长青 candidate rejected (${candidate.title}): 时长 ${probe.durationSec.toFixed(
                1,
              )}s 偏离请求 ${target.duration}s`,
            );
            continue;
          }
        }
        const check = isPlausibleAudioLength(
          probe.bytes,
          candidate.duration ?? target.duration,
          probe.bitrateKbps ?? 128,
          target.duration,
        );
        if (!check.ok) {
          serverLog.warn(`⚠️ 长青 candidate rejected (${candidate.title}): ${check.reason}`);
          continue;
        }
        serverLog.log("🔗 ChangqingSong URL:", sanitizeUrl(fetched.url));
        searchBreaker.recordSuccess();
        return { code: 200, url: fetched.url, lengthVerified: true };
      }
    }
    if (upstreamFault) searchBreaker.recordFailure();
    else searchBreaker.recordSuccess();
    if (!hasCandidate) {
      logUnlockFailure(target, NO_CANDIDATE_REASON);
      return { code: 404, url: null, reason: NO_CANDIDATE_REASON };
    }
    if (!hasPassedCandidate) {
      logUnlockFailure(target, MATCH_FAILED_REASON);
      return { code: 404, url: null, reason: MATCH_FAILED_REASON };
    }
    logUnlockFailure(target, FETCH_FAILED_REASON);
    return { code: 404, url: null, reason: FETCH_FAILED_REASON };
  } catch (error) {
    serverLog.error("❌ Get ChangqingSong URL Error:", error);
    logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON);
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
  }
};

export default getChangqingSongUrl;
