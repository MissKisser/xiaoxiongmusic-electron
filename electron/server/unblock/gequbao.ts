/**
 * 歌曲宝换源
 *
 * 检索与取链走歌曲宝站点：先按「歌名 + 歌手」与「裸歌名」两组关键词检索候选，
 * 再进详情页取真实歌手与时长，按「歌名 + 歌手 + 时长」三重校验排序后取链，
 * 并对直链做体积校验。
 *
 * 详情页与播放地址请求共用同一会话 cookie —— 播放凭证与会话绑定，
 * 两侧 cookie 不一致会静默失败。
 */
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import axios from "axios";
import { randomBytes } from "crypto";
import {
  MATCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  NO_CANDIDATE_REASON,
  TITLE_SCORE_LIMIT,
  UPSTREAM_UNAVAILABLE_REASON,
  FETCH_FAILED_REASON,
  isPlausibleAudioLength,
  rankCandidates,
  type MatchTarget,
} from "./match";
import { probeContentLength } from "./audio-length";
import { sanitizeUrl } from "./sanitize";
import { CircuitBreaker, isUpstreamFault } from "./resilience";

/** 歌曲宝直链码率（kbps） */
const GEQUBAO_BITRATE_KBPS = 128;

/** 检索层连续失败多少次后熔断 */
const SEARCH_FAILURE_THRESHOLD = 3;

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const SEARCH_BREAK_DURATION_MS = 10 * 60 * 1000;

/**
 * 歌曲宝检索层熔断器
 *
 * 整站故障时逐首重试只会白等，这里用熔断把「反复打一个死源」换成「熔断期内零请求」，
 * 熔断期满放一次探测请求，成功即恢复、失败则继续熔断。
 * 状态只在内存中，重启即重置；不写用户配置、不产生界面提示，只进日志。
 */
const searchBreaker = new CircuitBreaker({
  name: "歌曲宝检索",
  failureThreshold: SEARCH_FAILURE_THRESHOLD,
  openDurationMs: SEARCH_BREAK_DURATION_MS,
  onStateChange: (message) => serverLog.warn(`🔌 ${message}`),
});

/** 单次解锁最多进入详情页的候选数（歌名与歌手都已命中的） */
const DETAIL_FETCH_LIMIT = 5;

/** 单次解锁最多进入详情页的「仅歌名命中」候选数 */
const TITLE_MATCH_FETCH_LIMIT = 5;

/** 单次解锁最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 3;

/** 站点地址 */
const SITE_URL = "https://www.gequbao.com";

/** 请求 UA */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/** 搜索结果条目（搜索页可取到的字段） */
type GequbaoCandidate = {
  /** 歌曲页 id */
  id: string;
  /** 歌名 */
  title: string;
  /** 歌手 */
  artist: string;
};

/** 歌曲详情（详情页可取到的字段） */
type GequbaoDetail = GequbaoCandidate & {
  /** 播放凭证 */
  playId: string;
  /** 时长（秒） */
  duration?: number;
};

/**
 * 构造一次解锁所用的会话 cookie
 *
 * 详情页与播放地址接口共用同一会话，取链失败时不会因为会话不一致而静默失败。
 * @returns 会话 cookie
 */
const createSessionCookie = (): string => `server_name_session=${randomBytes(16).toString("hex")}`;

/**
 * 解析「mm:ss」形式的时长
 * @param text 时长文本
 * @returns 时长（秒）；无法解析时返回 undefined
 */
const parseDurationText = (text: string): number | undefined => {
  const parts = String(text || "")
    .split(":")
    .map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

/**
 * 解析搜索页，取出候选列表
 * @param html 搜索页 HTML
 * @returns 候选列表
 */
const parseSearchPage = (html: string): GequbaoCandidate[] => {
  const candidates: GequbaoCandidate[] = [];
  const seen = new Set<string>();
  const anchor = /<a\s+([^>]*?href="\/music\/(\d+)"[^>]*)>([\s\S]*?)<\/a>/g;
  let matched: RegExpExecArray | null;
  while ((matched = anchor.exec(html))) {
    const attributes = matched[1];
    const id = matched[2];
    const block = matched[3];
    const className = attributes.match(/class="([^"]*)"/)?.[1] ?? "";
    if (className.includes("btn")) continue;
    if (seen.has(id)) continue;
    const titleAttribute = attributes.match(/title="([^"]*)"/)?.[1] ?? "";
    let title =
      block.match(/text-primary font-weight-bold[^>]*>\s*([\s\S]*?)\s*<\/span>/)?.[1]?.trim() ?? "";
    let artist =
      block.match(/text-jade font-weight-bold[^>]*>\s*([\s\S]*?)\s*<\/small>/)?.[1]?.trim() ?? "";
    if (!title || !artist) {
      const index = titleAttribute.lastIndexOf("-");
      if (index > 0) {
        title = title || titleAttribute.slice(0, index).trim();
        artist = artist || titleAttribute.slice(index + 1).trim();
      }
    }
    if (!title) continue;
    seen.add(id);
    candidates.push({ id, title, artist });
  }
  return candidates;
};

/**
 * 检索候选歌曲
 *
 * 「歌名 + 歌手」与「裸歌名」两组关键词分别检索后合并去重：
 * 站外源的曲目标题常把歌手写进歌名字段，只按「歌名 + 歌手」检索会漏掉这类候选。
 *
 * 检索层故障（5xx / 超时 / 连接失败）累计到阈值即熔断该源，
 * 熔断期内直接返回空候选，不发起任何请求。
 * @param title 歌名
 * @param artist 歌手，可为空
 * @returns 候选列表与「上游是否完全不可用」标记
 */
const searchCandidates = async (
  title: string,
  artist: string,
): Promise<{ candidates: GequbaoCandidate[]; upstreamFailed: boolean }> => {
  if (!searchBreaker.canRequest()) {
    serverLog.warn(
      `🔌 歌曲宝检索处于熔断状态，跳过本次检索（剩余 ${Math.ceil(
        searchBreaker.remainingOpenMs() / 1000,
      )} 秒）`,
    );
    return { candidates: [], upstreamFailed: true };
  }
  const keywords = artist ? [`${title} ${artist}`, title] : [title];
  const merged: GequbaoCandidate[] = [];
  const seen = new Set<string>();
  let failed = 0;
  let fault = false;
  for (const keyword of keywords) {
    try {
      const response = await axios.get(`${SITE_URL}/s/${encodeURIComponent(keyword)}`, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
        timeout: 10000,
      });
      if (typeof response.data !== "string") {
        failed += 1;
        continue;
      }
      for (const candidate of parseSearchPage(response.data)) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        merged.push(candidate);
      }
    } catch (error) {
      failed += 1;
      if (isUpstreamFault(error)) fault = true;
      serverLog.warn(`⚠️ Gequbao 检索失败（关键词：${keyword}）：${String(error)}`);
    }
  }
  const upstreamFailed = failed === keywords.length;
  // 整轮检索都因上游故障（5xx / 超时 / 连接失败）而失败时计入熔断计数；
  // 只要上游还有响应（拿到了候选，或响应内容不可解析）就认为源仍可达，清零失败计数。
  // 两条分支必须二选一执行：半开状态下未记账会让探测请求一直占位，源被永久挡住。
  if (upstreamFailed && fault) searchBreaker.recordFailure();
  else searchBreaker.recordSuccess();
  return { candidates: merged, upstreamFailed };
};

/**
 * 解析歌曲详情页，取出播放凭证与时长
 * @param id 歌曲页 id
 * @param sessionCookie 会话 cookie，与播放地址请求共用
 * @returns 详情；解析失败返回 null
 */
export const getSongDetail = async (
  id: string,
  sessionCookie?: string,
): Promise<GequbaoDetail | null> => {
  const response = await axios.get(`${SITE_URL}/music/${id}`, {
    headers: {
      "User-Agent": UA,
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
    },
    timeout: 10000,
  });
  if (typeof response.data !== "string") return null;
  const matched = response.data.match(/window\.appData\s*=\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
  if (!matched) return null;
  let appData: any;
  try {
    const quoted = `"${matched[1].replace(/\\'/g, "'").replace(/"/g, '\\"')}"`;
    appData = JSON.parse(JSON.parse(quoted));
  } catch {
    return null;
  }
  if (!appData?.play_id) return null;
  return {
    id,
    title: String(appData.mp3_title ?? "").trim(),
    artist: String(appData.mp3_author ?? "").trim(),
    playId: String(appData.play_id),
    duration: parseDurationText(appData.mp3_duration),
  };
};

/**
 * 获取播放直链
 * @param playId 播放凭证
 * @param referer 歌曲页地址
 * @param sessionCookie 会话 cookie，与详情页请求共用
 * @returns 音频直链；失败返回 null
 */
const getPlayUrl = async (
  playId: string,
  referer: string,
  sessionCookie: string,
): Promise<string | null> => {
  const headers = {
    accept: "application/json, text/javascript, */*; q=0.01",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    pragma: "no-cache",
    "user-agent": UA,
    "x-requested-with": "XMLHttpRequest",
    cookie: sessionCookie,
    Referer: referer,
  };
  const body = `id=${encodeURIComponent(playId)}&purpose=play`;
  const response = await axios.post(`${SITE_URL}/member/common-play-url`, body, {
    headers,
    timeout: 10000,
    validateStatus: () => true,
  });
  const data = response.data;
  if (data && data.code === 1 && data.data?.url) return String(data.data.url);
  return null;
};

/**
 * 获取歌曲宝歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @returns 歌曲直链结果
 */
const getGequbaoSongUrl = async (target: MatchTarget): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON };
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON };
    const { candidates, upstreamFailed } = await searchCandidates(target.title, target.artist);
    if (upstreamFailed) {
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
    }
    if (!candidates.length) return { code: 404, url: null, reason: NO_CANDIDATE_REASON };
    const ranked = rankCandidates(candidates, target);
    // 搜索页没有时长，第一轮校验里时长不参与判定；
    // 因此除「歌名 + 歌手都命中」的候选外，把「仅歌名命中」的候选也送进详情页，
    // 让详情页给出的真实歌手与时长在第二轮真正参与判定。
    const shortlist = [
      ...ranked.filter((detail) => detail.passed).slice(0, DETAIL_FETCH_LIMIT),
      ...ranked
        .filter((detail) => !detail.passed && detail.titleScore >= TITLE_SCORE_LIMIT)
        .slice(0, TITLE_MATCH_FETCH_LIMIT),
    ];
    if (!shortlist.length) return { code: 404, url: null, reason: MATCH_FAILED_REASON };
    const sessionCookie = createSessionCookie();
    const details = await Promise.all(
      shortlist.map((detail) =>
        getSongDetail(detail.candidate.id, sessionCookie).catch((error) => {
          serverLog.warn(
            `⚠️ Gequbao 详情页读取失败（${detail.candidate.title}）：${String(error)}`,
          );
          return null;
        }),
      ),
    );
    // 详情页字段为空时保留搜索页字段，不用空值覆盖
    const enriched = details
      .filter((detail): detail is GequbaoDetail => detail !== null)
      .map((detail) => {
        const searchPage = shortlist.find((item) => item.candidate.id === detail.id)?.candidate;
        return {
          ...detail,
          title: detail.title || searchPage?.title || "",
          artist: detail.artist || searchPage?.artist || "",
          duration: detail.duration ?? searchPage?.duration,
        };
      });
    if (!enriched.length) return { code: 404, url: null, reason: FETCH_FAILED_REASON };
    const rankedDetails = rankCandidates(enriched, target).filter((detail) => detail.passed);
    if (!rankedDetails.length) return { code: 404, url: null, reason: MATCH_FAILED_REASON };
    for (const detail of rankedDetails.slice(0, MAX_CANDIDATE_TRY)) {
      const url = await getPlayUrl(
        (detail.candidate as GequbaoDetail).playId,
        `${SITE_URL}/music/${detail.candidate.id}`,
        sessionCookie,
      );
      if (!url) {
        serverLog.warn(
          `⚠️ Gequbao 未取到播放地址（${detail.candidate.title} / ${detail.candidate.artist}）`,
        );
        continue;
      }
      const length = await probeContentLength(url, { "User-Agent": UA });
      const check = isPlausibleAudioLength(length, detail.candidate.duration, GEQUBAO_BITRATE_KBPS);
      if (!check.ok) {
        serverLog.warn(
          `⚠️ Gequbao candidate rejected (${detail.candidate.title}): ${check.reason}`,
        );
        continue;
      }
      serverLog.log("🔗 GequbaoSong URL:", sanitizeUrl(url));
      return { code: 200, url };
    }
    return { code: 404, url: null, reason: FETCH_FAILED_REASON };
  } catch (error) {
    serverLog.error("❌ Get GequbaoSong URL Error:", error);
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON };
  }
};

export default getGequbaoSongUrl;
