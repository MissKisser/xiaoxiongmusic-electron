/**
 * 酷我音乐换源
 *
 * 修复点：
 * 1. 关键词切分统一走公共解析（trim 后再比对，不再出现尾随空格导致恒 404）；
 * 2. 候选列表取两套索引并集后按「歌名 + 歌手 + 时长」三重校验排序，不再盲取 rank0；
 * 3. 直链先按「声明时长 × 码率」校验文件体积，拦截与歌曲无关的固定占位文件。
 *
 * 健壮性：整条换源挂熔断器（检索层与取链层共用），
 * 连续出现上游侧故障达到阈值即熔断，熔断期内零上游请求、直接快速拒绝。
 * 酷我取链端点返回的是纯文本键值对，没有业务错误码载体：
 * 传输层故障（5xx / 超时 / 连接异常）计入熔断，
 * 请求侧错误（4xx）与「该曲在此源没有正版权质」属逐曲拒绝，不计入。
 */
import { encryptQuery } from "./kwDES";
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import axios from "axios";
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
import { searchKuwoCandidates } from "./kuwo-search";
import { probeContentLength } from "./audio-length";
import { sanitizeUrl } from "./sanitize";
import { CircuitBreaker, extractHttpStatus, isUpstreamFault } from "./resilience";

/** 酷我直链码率（kbps） */
const KUWO_BITRATE_KBPS = 128;

/** 单次解锁最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 3;

/** 整条换源连续失败多少次后熔断 */
const FAILURE_THRESHOLD = 3;

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const BREAK_DURATION_MS = 10 * 60 * 1000;

/** 酷我源熔断器：检索层与取链层共用 */
const sourceBreaker = new CircuitBreaker({
  name: "酷我",
  failureThreshold: FAILURE_THRESHOLD,
  openDurationMs: BREAK_DURATION_MS,
  onStateChange: (message) => serverLog.warn(`🔌 ${message}`),
});

/** 酷我客户端包名（决定可用音质档位） */
const PACKAGE_NAME = "kwplayer_ar_5.1.0.0_B_jiakong_vh.apk";

/** 酷我直链请求 UA */
const KUWO_UA = "okhttp/3.10.0";

/**
 * 判断传输层异常是否属于酷我的上游侧故障
 *
 * HTTP 5xx 计入上游故障，HTTP 4xx 属请求侧不计入；
 * 没有 HTTP 状态码时（连接异常 / 超时 / DNS 失败）回落到通用上游故障判定。
 * @param error 异常对象
 * @returns 是否为上游侧故障
 */
const isKuwoTransportFault = (error: unknown): boolean => {
  const status = extractHttpStatus(error);
  if (status > 0) return status >= 500;
  return isUpstreamFault(error);
};

/**
 * 获取酷我歌曲直链
 * @param rid 酷我歌曲 rid
 * @returns 直链与上游故障标记
 */
const getKuwoTrackUrl = async (
  rid: string,
): Promise<{ url: string | null; fault: boolean }> => {
  const url =
    "http://mobi.kuwo.cn/mobi.s?f=kuwo&q=" +
    encryptQuery(
      `corp=kuwo&source=${PACKAGE_NAME}&p2p=1&type=convert_url2&sig=0&format=mp3` + "&rid=" + rid,
    );
  try {
    const result = await axios.get(url, {
      headers: { "User-Agent": KUWO_UA },
      timeout: 10000,
    });
    if (typeof result.data !== "string") return { url: null, fault: false };
    const matched = result.data.match(/url=(http[^\s]+)/);
    return { url: matched ? matched[1] : null, fault: false };
  } catch (error) {
    return { url: null, fault: isKuwoTransportFault(error) };
  }
};

/**
 * 获取酷我音乐歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @param breaker 熔断器；缺省使用模块级实例（测试可注入短熔断窗口的实例）
 * @returns 歌曲直链结果
 */
const getKuwoSongUrl = async (
  target: MatchTarget,
  breaker: CircuitBreaker = sourceBreaker,
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON };
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON };
    if (!breaker.canRequest()) {
      serverLog.warn(
        `🔌 酷我处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          breaker.remainingOpenMs() / 1000,
        )} 秒）`,
      );
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
    }
    const search = await searchKuwoCandidates(target.title, target.artist, (message) =>
      serverLog.warn(`⚠️ ${message}`),
    );
    if (search.upstreamFailed) {
      breaker.recordFailure();
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
    }
    if (!search.candidates.length) {
      breaker.recordSuccess();
      return { code: 404, url: null, reason: NO_CANDIDATE_REASON };
    }
    const ranked = rankCandidates(search.candidates, target).filter((detail) => detail.passed);
    if (!ranked.length) {
      breaker.recordSuccess();
      return { code: 404, url: null, reason: MATCH_FAILED_REASON };
    }
    let upstreamFault = false;
    for (const detail of ranked.slice(0, MAX_CANDIDATE_TRY)) {
      const outcome = await getKuwoTrackUrl(detail.candidate.id);
      upstreamFault = upstreamFault || outcome.fault;
      if (!outcome.url) {
        // 传输层故障说明源整体不可达，继续试其它候选只会白等超时，直接放弃本源
        if (upstreamFault) break;
        continue;
      }
      const length = await probeContentLength(outcome.url, { "User-Agent": KUWO_UA });
      const check = isPlausibleAudioLength(length, detail.candidate.duration, KUWO_BITRATE_KBPS);
      if (!check.ok) {
        serverLog.warn(`⚠️ Kuwo candidate rejected (${detail.candidate.title}): ${check.reason}`);
        continue;
      }
      serverLog.log("🔗 KuwoSong URL:", sanitizeUrl(outcome.url));
      breaker.recordSuccess();
      return { code: 200, url: outcome.url };
    }
    if (upstreamFault) breaker.recordFailure();
    else breaker.recordSuccess();
    return { code: 404, url: null, reason: FETCH_FAILED_REASON };
  } catch (error) {
    serverLog.error("❌ Get KuwoSong URL Error:", error);
    if (isKuwoTransportFault(error)) breaker.recordFailure();
    else breaker.recordSuccess();
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
  }
};

export default getKuwoSongUrl;
