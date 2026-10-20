/**
 * 直链体积探测：用于拦截「非空 URL ≠ 可播」的占位文件
 *
 * 酷我的 128k 通道对无权播放的曲目会返回同一个固定文件
 * （实测 185,336 B、md5 86e42315600b9137e26ad17d54f3d622），与请求歌曲无关。
 * 因此拿到直链后先只读一次响应头，用「声明时长 × 码率」估算的体积做比对，
 * 不做全量预下载。
 */
import axios from "axios";

/** 探测请求超时（毫秒） */
const PROBE_TIMEOUT = 8000;

/** Range 兜底请求允许读取的最大字节数，避免服务端忽略 Range 时全量下载 */
const RANGE_MAX_BYTES = 4096;

/**
 * 读取直链声明的文件长度
 * @param url 音频直链
 * @param headers 请求头
 * @param timeout 超时（毫秒）
 * @returns 字节数；无法确定时返回 null
 */
export const probeContentLength = async (
  url: string,
  headers: Record<string, string> = {},
  timeout: number = PROBE_TIMEOUT,
): Promise<number | null> => {
  try {
    const response = await axios.head(url, {
      headers,
      timeout,
      validateStatus: () => true,
    });
    const length = Number(response.headers["content-length"]);
    if (response.status >= 200 && response.status < 300 && Number.isFinite(length) && length > 0) {
      return length;
    }
  } catch {
    // HEAD 不可用时退化为 Range 请求
  }
  try {
    const response = await axios.get(url, {
      headers: { ...headers, Range: "bytes=0-0" },
      responseType: "arraybuffer",
      timeout,
      maxContentLength: RANGE_MAX_BYTES,
      validateStatus: () => true,
    });
    const range = response.headers["content-range"];
    if (typeof range === "string") {
      const total = Number(range.split("/")[1]);
      if (Number.isFinite(total) && total > 0) return total;
    }
  } catch {
    return null;
  }
  return null;
};
