/**
 * 波点音乐换源
 *
 * 修复点：
 * 1. 候选列表取两套酷我索引并集后按「歌名 + 歌手 + 时长」三重校验排序，不再盲取 rank0；
 * 2. 直链先按「声明时长 × 码率」校验文件体积，拦截残缺文件。
 * 波点自带的「免广告」请求属于该换源链路的一部分，保留。
 */
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import { createHash } from "crypto";
import axios from "axios";
import { isPlausibleAudioLength, rankCandidates, type MatchTarget } from "./match";
import { searchKuwoCandidates } from "./kuwo-search";
import { probeContentLength } from "./audio-length";
import { sanitizeUrl } from "./sanitize";

/** 波点直链码率（kbps） */
const BODIAN_BITRATE_KBPS = 320;

/** 单次解锁最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 3;

/**
 * 生成随机设备 ID
 * @returns 随机设备号
 */
const getRandomDeviceId = () => {
  const min = 0;
  const max = 100000000000;
  const randomNum = Math.floor(Math.random() * (max - min + 1)) + min;
  return randomNum.toString();
};

const deviceId = getRandomDeviceId();

/** 波点请求公共头 */
const buildHeaders = () => ({
  "user-agent": "Dart/2.19 (dart:io)",
  plat: "ar",
  channel: "aliopen",
  devid: deviceId,
  ver: "3.9.0",
  host: "bd-api.kuwo.cn",
  "X-Forwarded-For": "1.0.1.114",
});

/**
 * 直链体积探测专用请求头
 *
 * 直链落在酷我 CDN 上，必须用 CDN 自身的请求头去探测：
 * 带上 `host: bd-api.kuwo.cn` 会被 CDN 直接拒绝，探测结果恒为空，
 * 体积校验会被静默跳过，残缺文件因此得以放行。
 * @returns 只含 UA 与 Referer 的探测请求头
 */
const buildProbeHeaders = (): Record<string, string> => ({
  "user-agent": "Dart/2.19 (dart:io)",
  Referer: "https://bd-api.kuwo.cn/",
});

/**
 * 为请求地址追加签名
 * @param str 待签名地址
 * @returns 带 sign 参数的地址
 */
const generateSign = (str: string) => {
  const url = new URL(str);
  const currentTime = Date.now();
  str += `&timestamp=${currentTime}`;
  const filteredChars = str
    .substring(str.indexOf("?") + 1)
    .replace(/[^a-zA-Z0-9]/g, "")
    .split("")
    .sort();
  const dataToEncrypt = `kuwotest${filteredChars.join("")}${url.pathname}`;
  const md5 = createHash("md5").update(dataToEncrypt).digest("hex");
  return `${str}&sign=${md5}`;
};

/**
 * 发送免广告请求
 * @returns 请求结果，失败返回 null
 */
const sendAdFreeRequest = () => {
  try {
    const adurl =
      "http://bd-api.kuwo.cn/api/service/advert/watch?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da";
    const headers = {
      ...buildHeaders(),
      qimei36: "1e9970cbcdc20a031dee9f37100017e1840e",
      "content-type": "application/json; charset=utf-8",
    };
    const data = JSON.stringify({
      type: 5,
      subType: 5,
      musicId: 0,
      adToken: "",
    });
    return axios.post(adurl, data, { headers });
  } catch (error) {
    serverLog.error("❌ Get Bodian Ad Free Error:", error);
    return null;
  }
};

/**
 * 获取波点音乐歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @returns 歌曲直链结果
 */
const getBodianSongUrl = async (target: MatchTarget): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null };
    const candidates = await searchKuwoCandidates(target.title, target.artist);
    if (!candidates.length) return { code: 404, url: null };
    const ranked = rankCandidates(candidates, target).filter((detail) => detail.passed);
    if (!ranked.length) return { code: 404, url: null };
    const headers = buildHeaders();
    await sendAdFreeRequest();
    for (const detail of ranked.slice(0, MAX_CANDIDATE_TRY)) {
      let audioUrl = `http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=${"320kmp3"}&musicId=${detail.candidate.id}`;
      audioUrl = generateSign(audioUrl);
      const result = await axios.get(audioUrl, { headers, timeout: 10000 });
      if (typeof result.data !== "object" || !result.data?.data?.audioUrl) continue;
      const url = result.data.data.audioUrl as string;
      const length = await probeContentLength(url, buildProbeHeaders());
      const check = isPlausibleAudioLength(
        length,
        detail.candidate.duration,
        BODIAN_BITRATE_KBPS,
        target.duration,
      );
      if (!check.ok) {
        serverLog.warn(`⚠️ Bodian candidate rejected (${detail.candidate.title}): ${check.reason}`);
        continue;
      }
      if (!check.verified) {
        serverLog.warn(`⚠️ Bodian 直链体积未验证 (${detail.candidate.title}): ${check.reason}`);
      }
      serverLog.log("🔗 BodianSong URL:", sanitizeUrl(url));
      return { code: 200, url, lengthVerified: check.verified };
    }
    return { code: 404, url: null };
  } catch (error) {
    serverLog.error("❌ Get BodianSong URL Error:", error);
    return { code: 404, url: null };
  }
};

export default getBodianSongUrl;
