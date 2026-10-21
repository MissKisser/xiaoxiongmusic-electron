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

/** GD 音乐台接口地址（网易云直链） */
const GDSTUDIO_URL = "https://music-api.gdstudio.xyz/api.php";

/** 网易云检索条数（原版常排在封面版本之后，取数偏大才够用） */
const SEARCH_LIMIT = 100;

/** 网易云官方直链默认码率（kbps），用于体积校验 */
const NETEASE_BITRATE_KBPS = 128;

/** 单次换源最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 3;

/** 网易云检索请求头 */
const SEARCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/**
 * 检索网易云候选歌曲
 *
 * 目标缺歌手时直接返回空列表：仅按歌名检索会命中同名不同版本的曲目
 * （实测《青花瓷》仅按歌名检索会命中 95 秒的街声版），宁可不换源也不播错歌。
 *
 * 检索词取「歌名 + 歌手」与「裸歌名」两组并集：站外源的曲目标题常把歌手写进歌名字段，
 * 只按「歌名 + 歌手」检索会漏掉这类候选。
 * @param title 歌名
 * @param artist 歌手；为空时不检索
 * @param cookie 网易云登录态，可为空
 * @returns 归一化后的候选列表
 */
const searchNeteaseCandidates = async (
  title: string,
  artist: string,
  cookie?: Record<string, string>,
): Promise<Array<{ id: string; title: string; artist: string; duration?: number }>> => {
  if (!artist.trim()) return [];
  const keywords = [`${title} ${artist}`, title];
  const candidates: Array<{ id: string; title: string; artist: string; duration?: number }> = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const response = await NeteaseCloudMusicApi.cloudsearch({
      keywords: keyword,
      type: 1,
      limit: SEARCH_LIMIT,
      ...(cookie && Object.keys(cookie).length ? { cookie } : {}),
    } as any);
    const songs = (response as any)?.body?.result?.songs || [];
    for (const song of songs) {
      const id = String(song?.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
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
 * @param id 网易云歌曲 id
 * @returns 直链与码率；取不到时返回 null
 */
const getGdstudioUrl = async (id: string): Promise<{ url: string; bitrate: number } | null> => {
  try {
    const response = await axios.get(GDSTUDIO_URL, {
      params: { types: "url", id },
      headers: { "User-Agent": SEARCH_UA },
      timeout: 10000,
      validateStatus: () => true,
    });
    const body = response.data;
    if (!body || typeof body !== "object") return null;
    const url = String(body.url ?? "");
    if (!url) return null;
    return { url, bitrate: Math.round(Number(body.br ?? 0) / 1000) || NETEASE_BITRATE_KBPS };
  } catch {
    return null;
  }
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
