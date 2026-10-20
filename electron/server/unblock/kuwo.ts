/**
 * 酷我音乐换源
 *
 * 修复点：
 * 1. 关键词切分统一走公共解析（trim 后再比对，不再出现尾随空格导致恒 404）；
 * 2. 候选列表取两套索引并集后按「歌名 + 歌手 + 时长」三重校验排序，不再盲取 rank0；
 * 3. 直链先按「声明时长 × 码率」校验文件体积，拦截与歌曲无关的固定占位文件。
 */
import { encryptQuery } from "./kwDES";
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import axios from "axios";
import { isPlausibleAudioLength, rankCandidates, type MatchTarget } from "./match";
import { searchKuwoCandidates } from "./kuwo-search";
import { probeContentLength } from "./audio-length";

/** 酷我直链码率（kbps） */
const KUWO_BITRATE_KBPS = 128;

/** 单次解锁最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 3;

/** 酷我客户端包名（决定可用音质档位） */
const PACKAGE_NAME = "kwplayer_ar_5.1.0.0_B_jiakong_vh.apk";

/** 酷我直链请求 UA */
const KUWO_UA = "okhttp/3.10.0";

/**
 * 获取酷我歌曲直链
 * @param rid 酷我歌曲 rid
 * @returns 音频直链；失败返回 null
 */
const getKuwoTrackUrl = async (rid: string): Promise<string | null> => {
  const url =
    "http://mobi.kuwo.cn/mobi.s?f=kuwo&q=" +
    encryptQuery(
      `corp=kuwo&source=${PACKAGE_NAME}&p2p=1&type=convert_url2&sig=0&format=mp3` + "&rid=" + rid,
    );
  const result = await axios.get(url, {
    headers: { "User-Agent": KUWO_UA },
    timeout: 10000,
  });
  if (typeof result.data !== "string") return null;
  const matched = result.data.match(/url=(http[^\s]+)/);
  return matched ? matched[1] : null;
};

/**
 * 获取酷我音乐歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @returns 歌曲直链结果
 */
const getKuwoSongUrl = async (target: MatchTarget): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null };
    const candidates = await searchKuwoCandidates(target.title, target.artist);
    if (!candidates.length) return { code: 404, url: null };
    const ranked = rankCandidates(candidates, target).filter((detail) => detail.passed);
    for (const detail of ranked.slice(0, MAX_CANDIDATE_TRY)) {
      const url = await getKuwoTrackUrl(detail.candidate.id);
      if (!url) continue;
      const length = await probeContentLength(url, { "User-Agent": KUWO_UA });
      const check = isPlausibleAudioLength(length, detail.candidate.duration, KUWO_BITRATE_KBPS);
      if (!check.ok) {
        serverLog.warn(`⚠️ Kuwo candidate rejected (${detail.candidate.title}): ${check.reason}`);
        continue;
      }
      serverLog.log("🔗 KuwoSong URL:", url);
      return { code: 200, url };
    }
    return { code: 404, url: null };
  } catch (error) {
    serverLog.error("❌ Get KuwoSong URL Error:", error);
    return { code: 404, url: null };
  }
};

export default getKuwoSongUrl;
