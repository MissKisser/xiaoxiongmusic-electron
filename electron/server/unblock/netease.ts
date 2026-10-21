/**
 * 网易云直链换源（按歌曲 id 寻址）
 *
 * 只用于**网易云自身的歌曲**：第三方平台（QQ 音乐 / 酷狗）的歌曲 id
 * 与网易云不在同一编号空间，喂进去会静默返回另一首歌，
 * 因此第三方歌曲走「按关键词检索网易云」的分支（见 netease-search.ts）。
 */
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import axios from "axios";

/**
 * 直接获取网易云歌曲直链
 * @param id 歌曲 ID
 * @returns 歌曲直链结果
 */
const getNeteaseSongUrl = async (id: number | string): Promise<SongUrlResult> => {
  try {
    if (!id) return { code: 404, url: null };
    const baseUrl = "https://music-api.gdstudio.xyz/api.php";
    const result = await axios.get(baseUrl, {
      params: { types: "url", id },
    });
    const songUrl = result.data.url;
    // 安全修复：解锁结果缺失时返回 404，避免返回 200 + 空 url 误导客户端
    if (!songUrl) {
      return { code: 404, url: null };
    }
    serverLog.log("🔗 NeteaseSongUrl URL:", songUrl);
    return { code: 200, url: songUrl };
  } catch (error) {
    serverLog.error("❌ Get NeteaseSongUrl Error:", error);
    return { code: 404, url: null };
  }
};

export default getNeteaseSongUrl;
