/**
 * 长青聚合站换源
 *
 * 长青是社区公益聚合站：把各平台曲库统一成「按平台内歌曲 id 取链」的接口，站内没有检索能力。
 * 本模块接两个通道：
 * - QQ 通道：入参是 QQ 歌曲 mid；
 * - 酷狗通道：入参是酷狗歌曲 hash。
 *
 * 通道是 id 型的，id 的来源有两条：
 * 1. 歌曲本身来自该平台时，直接用歌曲自带的平台原生 id（QQ mid / 酷狗 hash），无需检索；
 * 2. 歌曲来自其它平台时，按「歌名 + 歌手」走项目自身的 QQ / 酷狗检索网关换到该平台的 id，
 *    换到的候选先过站外源同一套三重校验（歌名 / 歌手 / 时长）再取链。
 *
 * 取链返回的是裸音频流（不是 JSON），因此直链就是取链地址本身。
 * 公益站返回的文件未必是请求的那一版（实测同一条 id 可返回时长明显不同的另一版），
 * 所以取链后按真实音频时长做闸门，偏差超容差即判为错版、拒绝交付。
 *
 * 公益站无 SLA：检索层挂熔断（连续失败到阈值即熔断，熔断期内零请求）；
 * 取链层按多主机故障转移逐个尝试。
 */
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import { callQQMusic } from "../../main/apis/qqmusic";
import { callKugou } from "../../main/apis/kugou";
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
import { probeAudio } from "./audio-probe";
import { sanitizeUrl } from "./sanitize";
import { CircuitBreaker, isUpstreamFault } from "./resilience";

/** 长青取链的请求头 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/** 检索层连续失败多少次后熔断 */
const SEARCH_FAILURE_THRESHOLD = 3;

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const SEARCH_BREAK_DURATION_MS = 10 * 60 * 1000;

/** 单次换源最多尝试的候选数（每个通道） */
const MAX_CANDIDATE_TRY = 2;

/** 检索候选条数 */
const SEARCH_LIMIT = 20;

/** 长青各通道的取链主机（按顺序故障转移） */
const CHANNEL_HOSTS: Record<string, string[]> = {
  // QQ 通道：实测只有 musicapi 主域能出整曲，另两个主机对会员曲直接 403
  qq: [
    "https://musicapi.haitangw.net/music/qq_kw.php",
    "https://music.haitangw.cc/kgqq/qq.php",
    "http://175.27.166.236/kgqq/qq.php",
  ],
  // 酷狗通道：musicapi 域已 404，实际存活的是 kgqq 子域
  kg: ["https://music.haitangw.cc/kgqq/kg.php", "http://175.27.166.236/kgqq/kg.php"],
};

/** 长青各通道的音质档位（按顺序尝试） */
const CHANNEL_LEVELS: Record<string, string[]> = {
  qq: ["standard", "exhigh"],
  kg: ["standard", "exhigh"],
};

/** 通道对应的平台（用于取歌曲自带的原生 id） */
const CHANNEL_PLATFORM: Record<string, string> = {
  qq: "qqmusic",
  kg: "kugou",
};

/** 长青检索层熔断器 */
const searchBreaker = new CircuitBreaker({
  name: "长青检索",
  failureThreshold: SEARCH_FAILURE_THRESHOLD,
  openDurationMs: SEARCH_BREAK_DURATION_MS,
  onStateChange: (message) => serverLog.warn(`🔌 ${message}`),
});

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
 * 检索酷狗候选
 * @param keyword 检索词
 * @returns 归一化后的候选列表
 */
const searchKugouCandidates = async (keyword: string): Promise<ChangqingCandidate[]> => {
  const response = (await callKugou("search", {
    keywords: keyword,
    type: "song",
    page: 1,
    limit: SEARCH_LIMIT,
  })) as { songs?: unknown[] };
  const songs = Array.isArray(response?.songs) ? (response.songs as unknown[]) : [];
  const candidates: ChangqingCandidate[] = [];
  for (const raw of songs) {
    const song = raw as Record<string, any>;
    const id = String(song?.hash ?? "");
    const title = String(song?.name ?? "").trim();
    if (!id || !title) continue;
    const duration = Math.round(Number(song?.interval ?? 0));
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
 * @param channel 通道标识（qq / kg）
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
    return [
      {
        id: options.platformId,
        title: target.title,
        artist: target.artist,
        duration: target.duration,
      },
    ];
  }
  const search = channel === "qq" ? searchQqCandidates : searchKugouCandidates;
  const keywords = target.artist
    ? [`${target.title}-${target.artist}`, `${target.title} ${target.artist}`]
    : [target.title];
  const merged: ChangqingCandidate[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const candidates = await search(keyword);
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

/**
 * 从某个主机取链
 * @param endpoint 取链地址
 * @param id 平台内歌曲 id
 * @param level 音质档位
 * @returns 直链与探测结论；失败返回 null
 */
const fetchFromEndpoint = async (
  endpoint: string,
  id: string,
  level: string,
): Promise<{ url: string; probe: Awaited<ReturnType<typeof probeAudio>> } | null> => {
  const url = `${endpoint}?type=mp3&id=${encodeURIComponent(id)}&level=${encodeURIComponent(level)}`;
  const probe = await probeAudio(url, { "User-Agent": UA });
  if (!probe.bytes || probe.bytes < 4096) return null;
  return { url, probe };
};

/**
 * 在通道的各主机上取链（主机故障转移）
 * @param channel 通道标识
 * @param id 平台内歌曲 id
 * @returns 直链与探测结论；全部主机失败返回 null
 */
const fetchFromChannel = async (
  channel: string,
  id: string,
): Promise<{ url: string; probe: Awaited<ReturnType<typeof probeAudio>> } | null> => {
  const hosts = CHANNEL_HOSTS[channel] ?? [];
  const levels = CHANNEL_LEVELS[channel] ?? ["standard"];
  for (const host of hosts) {
    for (const level of levels) {
      try {
        const result = await fetchFromEndpoint(host, id, level);
        if (result) return result;
      } catch (error) {
        if (isUpstreamFault(error)) {
          serverLog.warn(`⚠️ 长青取链失败（${host}）：${String(error)}`);
        }
      }
    }
  }
  return null;
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
    for (const channel of ["qq", "kg"]) {
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
        let fetched: Awaited<ReturnType<typeof fetchFromChannel>> = null;
        try {
          fetched = await fetchFromChannel(channel, candidate.id);
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
    if (!hasCandidate) return { code: 404, url: null, reason: NO_CANDIDATE_REASON };
    if (!hasPassedCandidate) return { code: 404, url: null, reason: MATCH_FAILED_REASON };
    return { code: 404, url: null, reason: FETCH_FAILED_REASON };
  } catch (error) {
    serverLog.error("❌ Get ChangqingSong URL Error:", error);
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
  }
};

export default getChangqingSongUrl;
