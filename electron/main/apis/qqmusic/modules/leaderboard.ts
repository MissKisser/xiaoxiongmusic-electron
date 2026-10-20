/**
 * QQ 音乐排行榜
 *
 * 走 `musicToplist.ToplistInfoServer` / `GetDetail`：
 * - `data.data` 是榜单元信息（标题、期数、封面、榜单简介）
 * - `data.songInfoList` 是榜单歌曲明细
 * - `data.data.song` 是带排名的精简列表
 *
 * 常用榜单号：26 热歌榜 / 62 飙升榜 / 27 新歌榜 / 4 原创榜。
 */

import { qmRequest } from "../core/request";
import { coreLog } from "../../../logger";
import type { QMModule, QMParams } from "../core/types";

/** 默认榜单号 */
const DEFAULT_TOPID = 26;

/**
 * 去掉搜索结果的命中高亮标签
 * @param text - 原始文本
 * @returns 处理后的文本
 */
const stripHighlight = (text: unknown): string =>
  typeof text === "string" ? text.replace(/<\/?em>/g, "") : "";

/**
 * 拼接歌手名
 * @param singers - 歌手数组
 * @returns 形如 `A / B` 的歌手名
 */
const formatSingerName = (singers: unknown): string => {
  if (!Array.isArray(singers)) return "";
  return singers
    .map((item) => stripHighlight((item as { name?: string })?.name))
    .filter(Boolean)
    .join(" / ");
};

/**
 * 归一化榜单歌曲
 * @param song - 接口返回的歌曲
 * @returns 归一化后的歌曲
 */
const normalizeSong = (song: any): Record<string, unknown> => {
  const source = song || {};
  const album = source.album || {};
  return {
    id: String(source.id ?? ""),
    mid: source.mid ?? "",
    name: stripHighlight(source.title || source.name || ""),
    artist: formatSingerName(source.singer),
    artists: (Array.isArray(source.singer) ? source.singer : []).map((item) => ({
      id: String(item?.id ?? ""),
      mid: item?.mid ?? "",
      name: stripHighlight(item?.name ?? ""),
    })),
    album: stripHighlight(album.name ?? ""),
    albumMid: album.mid ?? "",
    duration: (source.interval ?? 0) * 1000,
    file: source.file ?? {},
    pay: source.pay ?? {},
  };
};

/**
 * 归一化榜单排名条目
 * @param item - 接口返回的排名条目
 * @returns 归一化后的排名条目
 */
const normalizeRank = (item: any): Record<string, unknown> => {
  const source = item || {};
  return {
    rank: source.rank ?? 0,
    songId: String(source.songId ?? ""),
    title: stripHighlight(source.title ?? ""),
    singer: stripHighlight(source.singerName ?? ""),
    singerMid: source.singerMid ?? "",
    albumMid: source.albumMid ?? "",
    cover: source.cover ?? "",
  };
};

/**
 * 读取 QQ 音乐排行榜
 * @param params.topid - 榜单号，默认 26（热歌榜）
 * @param params.period - 榜单期数
 * @param params.limit - 歌曲条数
 * @param params.offset - 歌曲偏移
 */
export const leaderboard: QMModule = async (params: QMParams) => {
  const topid = Number(params.topid ?? params.id ?? DEFAULT_TOPID) || DEFAULT_TOPID;
  const period = String(params.period ?? "");
  const limit = Math.max(1, Number(params.limit) || 50);
  const offset = Math.max(0, Number(params.offset) || 0);

  try {
    const data =
      (await qmRequest<any>("musicToplist.ToplistInfoServer", "GetDetail", {
        topid,
        num: limit,
        offset,
        period,
      })) || {};

    const meta = data.data || {};
    const songs = (data.songInfoList || [])
      .map((item: any) => item && (item.songInfo || item))
      .filter(Boolean)
      .map(normalizeSong);
    const ranks = (meta.song || []).map(normalizeRank);

    return {
      code: 200,
      topid,
      title: meta.title ?? data.title ?? "",
      subTitle: meta.titleDetail ?? data.titleDetail ?? "",
      updateTime: meta.updateTime ?? data.updateTime ?? "",
      period: meta.period ?? "",
      intro: meta.intro ?? "",
      cover: meta.headPicUrl ?? data.headPicUrl ?? "",
      listenCount: meta.listenNum ?? 0,
      total: meta.totalNum ?? songs.length,
      songs,
      ranks,
      raw: data,
    };
  } catch (err) {
    coreLog.error("[qm-leaderboard] QQ 音乐排行榜获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐排行榜获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
