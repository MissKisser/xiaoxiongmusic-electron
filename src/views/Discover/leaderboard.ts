/**
 * QQ 音乐榜单数据层（发现页）
 *
 * 主进程两个模块：
 * - `leaderboard_list` —— 榜单清单（按巅峰榜 / 特色榜 / 地区榜 / 全球榜 / 网络榜分组）；
 * - `leaderboard_detail` —— 单个榜单的详情（榜单元信息 + 曲目）。
 *
 * 网易云的榜单由 `src/api/playlist.ts` 的 `topPlaylist` 给出，形状是
 * 「封面卡片列表」；QQ 侧先给榜单清单，再按榜单号取详情，
 * 因此这里单独封装 QQ 的榜单结构，发现页按平台分流渲染。
 */

import { platformRequest } from "@/api/platform/http";
import { normalizeQqSong, QQ_MUSIC } from "@/api/platform/qqmusic";
import { toSongType } from "@/api/platform/types";
import type { SongType } from "@/types/main";

/** 榜单清单条目 */
export interface LeaderboardBoard {
  /** 榜单号 */
  topId: number;
  /** 榜单名 */
  title: string;
  /** 榜单副标题 */
  subTitle: string;
  /** 榜单简介 */
  intro: string;
  /** 榜单期数 */
  period: string;
  /** 更新时间 */
  updateTime: string;
  /** 榜单封面 */
  cover: string;
  /** 榜单曲目总数 */
  total: number;
  /** 所属分组名 */
  groupName: string;
}

/** 榜单清单分组 */
export interface LeaderboardGroup {
  /** 分组号 */
  groupId: number;
  /** 分组名 */
  groupName: string;
  /** 分组内榜单 */
  toplists: LeaderboardBoard[];
}

/** 主进程榜单清单模块的原生返回 */
interface LeaderboardListResponse {
  code?: number;
  total?: number;
  groups?: Array<{
    groupId?: number;
    groupName?: string;
    toplists?: Array<Record<string, any>>;
  }>;
  message?: string;
}

/** 主进程榜单详情模块的原生返回 */
interface LeaderboardDetailResponse {
  code?: number;
  topid?: number;
  title?: string;
  subTitle?: string;
  intro?: string;
  period?: string;
  updateTime?: string;
  cover?: string;
  total?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 归一化榜单条目
 * @param board - 主进程返回的榜单条目
 * @param groupName - 所属分组名
 * @returns 归一化榜单条目
 */
const normalizeBoard = (board: Record<string, any>, groupName: string): LeaderboardBoard => ({
  topId: Number(board?.topId ?? 0),
  title: String(board?.title ?? ""),
  subTitle: String(board?.subTitle ?? ""),
  intro: String(board?.intro ?? ""),
  period: String(board?.period ?? ""),
  updateTime: String(board?.updateTime ?? ""),
  cover: String(board?.cover ?? ""),
  total: Number(board?.total ?? 0),
  groupName,
});

/**
 * 读取 QQ 音乐榜单清单
 * @returns 按分组组织的榜单清单
 */
export const qqLeaderboardList = async (): Promise<LeaderboardGroup[]> => {
  const res = await platformRequest<LeaderboardListResponse>(QQ_MUSIC, "leaderboard_list");
  return (res?.groups ?? []).map((group) => ({
    groupId: Number(group?.groupId ?? 0),
    groupName: String(group?.groupName ?? ""),
    toplists: (group?.toplists ?? []).map((board) =>
      normalizeBoard(board, String(group?.groupName ?? "")),
    ),
  }));
};

/**
 * 读取 QQ 音乐单个榜单的详情
 * @param topId 榜单号
 * @param limit 取回的曲目数
 * @returns 榜单信息与曲目
 */
export const qqLeaderboardDetail = async (
  topId: number,
  limit = 100,
): Promise<{ title: string; subTitle: string; cover: string; total: number; songs: SongType[] }> => {
  const res = await platformRequest<LeaderboardDetailResponse>(QQ_MUSIC, "leaderboard_detail", {
    topid: topId,
    limit,
  });
  return {
    title: String(res?.title ?? ""),
    subTitle: String(res?.subTitle ?? ""),
    cover: String(res?.cover ?? ""),
    total: Number(res?.total ?? 0),
    songs: (res?.songs ?? []).map(normalizeQqSong).map(toSongType),
  };
};
