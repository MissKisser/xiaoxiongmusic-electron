/**
 * QQ 音乐排行榜
 *
 * 走 `musicToplist.ToplistInfoServer`：
 * - `GetAll` 返回**榜单清单**（按巅峰榜 / 特色榜 / 地区榜 / 全球榜 / 网络榜分组）
 * - `GetDetail` 返回**单个榜单详情**：
 *   - `data.data` 是榜单元信息（标题、期数、封面、榜单简介）
 *   - `data.songInfoList` 是榜单歌曲明细
 *   - `data.data.song` 是带排名的精简列表
 *
 * 常用榜单号：26 热歌榜 / 62 飙升榜 / 427 新歌榜 / 58 说唱榜 / 65 国风热歌榜。
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
 * 归一化榜单清单条目
 * @param board - 接口返回的榜单条目
 * @returns 归一化后的榜单条目
 */
const normalizeBoard = (board: any): Record<string, unknown> => {
  const source = board || {};
  return {
    topId: Number(source.topId ?? source.topid ?? 0),
    title: stripHighlight(source.title ?? ""),
    subTitle: stripHighlight(source.titleDetail ?? source.titleSub ?? ""),
    intro: source.intro ?? "",
    period: source.period ?? "",
    updateTime: source.updateTime ?? "",
    cover: source.headPicUrl ?? source.frontPicUrl ?? "",
    listenCount: Number(source.listenNum ?? 0),
    total: Number(source.totalNum ?? 0),
  };
};

/**
 * 读取单个榜单的详情（榜单元信息 + 曲目）
 * @param topid - 榜单号
 * @param limit - 歌曲条数
 * @param offset - 歌曲偏移
 * @param period - 榜单期数
 * @returns 榜单详情
 */
const fetchLeaderboardDetail = async (
  topid: number,
  limit: number,
  offset: number,
  period: string,
): Promise<Record<string, unknown>> => {
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
    return await fetchLeaderboardDetail(topid, limit, offset, period);
  } catch (err) {
    coreLog.error("[qm-leaderboard] QQ 音乐排行榜获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐排行榜获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};

/**
 * 读取 QQ 音乐榜单清单
 *
 * 榜单体系由上游按分组下发（巅峰榜 / 特色榜 / 地区榜 / 全球榜 / 网络榜），
 * 每组内是若干榜单条目，条目自带榜单号、标题、封面、期数与曲目总数。
 */
export const leaderboard_list: QMModule = async (params: QMParams) => {
  const groupId = Number(params.groupId ?? params.group_id ?? 0);

  try {
    const data =
      (await qmRequest<any>("musicToplist.ToplistInfoServer", "GetAll", {
        ...(groupId ? { groupId } : {}),
      })) || {};

    const groups = (Array.isArray(data.group) ? data.group : [])
      .map((group: any) => ({
        groupId: Number(group?.groupId ?? 0),
        groupName: stripHighlight(group?.groupName ?? ""),
        type: Number(group?.type ?? 0),
        toplists: (Array.isArray(group?.toplist) ? group.toplist : []).map(normalizeBoard),
      }))
      .filter((group: any) => group.toplists.length > 0);

    const toplists = groups.flatMap((group: any) =>
      group.toplists.map((board: any) => ({ ...board, groupId: group.groupId, groupName: group.groupName })),
    );

    return {
      code: 200,
      total: toplists.length,
      groups,
      toplists,
    };
  } catch (err) {
    coreLog.error("[qm-leaderboard-list] QQ 音乐榜单清单获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐榜单清单获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};

/**
 * 读取单个 QQ 音乐榜单的详情（榜单元信息 + 曲目列表）
 * @param params.topid - 榜单号，默认 26（热歌榜）
 * @param params.period - 榜单期数
 * @param params.limit - 歌曲条数
 * @param params.offset - 歌曲偏移
 */
export const leaderboard_detail: QMModule = async (params: QMParams) => {
  const topid = Number(params.topid ?? params.id ?? DEFAULT_TOPID) || DEFAULT_TOPID;
  const period = String(params.period ?? "");
  const limit = Math.max(1, Number(params.limit) || 50);
  const offset = Math.max(0, Number(params.offset) || 0);

  try {
    return await fetchLeaderboardDetail(topid, limit, offset, period);
  } catch (err) {
    coreLog.error("[qm-leaderboard-detail] QQ 音乐榜单详情获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐榜单详情获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
