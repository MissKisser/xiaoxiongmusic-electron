/**
 * 第三方音源平台（QQ 音乐 / 酷狗）渲染端封装
 *
 * 与网易云的 `src/api/playlist.ts` 完全独立：不共用通道、不共用数据结构、
 * 不修改任何既有文件，便于并行验证与随时回退。
 */

import type { ApiCallResponse, ApiPlatform, PlatformProfile } from "@/types/shared";

/**
 * 调用平台接口
 * @param platform 音源平台
 * @param name 接口名
 * @param params 接口参数
 * @returns 业务数据，失败时抛出异常
 */
export const platformCall = async <T = unknown>(
  platform: ApiPlatform,
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.platformMusic.call(platform, name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

/** QQ 音乐平台标识 */
export const QQ_MUSIC: ApiPlatform = "qqmusic";
/** 酷狗平台标识 */
export const KUGOU: ApiPlatform = "kugou";

/** 歌单条目（QQ 音乐自建 / 收藏歌单） */
export interface QQMusicPlaylistItem {
  /** 歌单 tid（写操作的定位键） */
  tid: number;
  /** 歌单目录号（写操作的实际目标） */
  dirId: number;
  /** 歌单名 */
  dirName: string;
  /** 目录类型：0 自建，3 收藏 */
  dirType: number;
  /** 歌曲数 */
  songNum: number;
  /** 播放量 */
  listenNum: number;
  /** 封面 */
  cover: string;
  /** 创建时间 */
  createTime: number;
}

/** 我的歌单列表响应 */
export interface QQMusicPlaylistList {
  code: number;
  total: number;
  bFinish: boolean;
  /** 自建歌单 */
  owned: QQMusicPlaylistItem[];
  /** 收藏的歌单 */
  favorites: QQMusicPlaylistItem[];
}

/** 歌单详情响应 */
export interface QQMusicPlaylistDetail {
  code: number;
  id: string;
  name: string;
  creator: string;
  cover: string;
  description: string;
  total: number;
  hasmore: number;
  songs: Array<{
    id: number;
    mid: string;
    name: string;
    artist: string;
    album: string;
    duration: number;
  }>;
}

/** 写操作统一返回 */
export interface QQMusicWriteResult {
  code: number;
  message?: string;
  tid?: number;
  dirId?: number;
  name?: string;
  changed?: boolean;
  subscribed?: boolean;
  deleted?: boolean;
  verified?: boolean;
}

/**
 * 读取 QQ 音乐账号的自建 + 收藏歌单
 */
export const fetchQQMusicPlaylists = async (): Promise<QQMusicPlaylistList> => {
  return platformCall<QQMusicPlaylistList>(QQ_MUSIC, "user_playlist_list");
};

/**
 * 读取「我喜欢的音乐」
 */
export const fetchQQMusicLikedSongs = async (
  songBegin = 0,
  songNum = 100,
): Promise<QQMusicPlaylistDetail> => {
  return platformCall<QQMusicPlaylistDetail>(QQ_MUSIC, "user_liked_songs", {
    song_begin: songBegin,
    song_num: songNum,
  });
};

/**
 * 读取一张歌单的详情
 * @param id 歌单 tid
 * @param dirId 歌单目录号（自己的歌单需要）
 */
export const fetchQQMusicPlaylistDetail = async (
  id: number | string,
  dirId = 0,
): Promise<QQMusicPlaylistDetail> => {
  return platformCall<QQMusicPlaylistDetail>(QQ_MUSIC, "playlist_detail", { id, dirId });
};

/**
 * 创建歌单
 * @param name 歌单名（最多 20 字）
 */
export const createQQMusicPlaylist = async (name: string): Promise<QQMusicWriteResult> => {
  return platformCall<QQMusicWriteResult>(QQ_MUSIC, "playlist_create", { name });
};

/**
 * 改名歌单
 * @param tid 歌单 tid
 * @param name 新名字
 */
export const renameQQMusicPlaylist = async (
  tid: number,
  name: string,
): Promise<QQMusicWriteResult> => {
  return platformCall<QQMusicWriteResult>(QQ_MUSIC, "playlist_rename", { tid, name });
};

/**
 * 删除歌单
 * @param tid 歌单 tid
 */
export const deleteQQMusicPlaylist = async (tid: number): Promise<QQMusicWriteResult> => {
  return platformCall<QQMusicWriteResult>(QQ_MUSIC, "playlist_delete", { tid });
};

/**
 * 往歌单加歌 / 从歌单删歌
 * @param tid 歌单 tid（传 undefined 表示写入「我喜欢」）
 * @param op add | del
 * @param songs 歌曲列表，type 目前仅支持 0
 */
export const updateQQMusicPlaylistTracks = async (
  tid: number | undefined,
  op: "add" | "del",
  songs: Array<{ id: number; type?: number }>,
): Promise<QQMusicWriteResult> => {
  return platformCall<QQMusicWriteResult>(QQ_MUSIC, "playlist_tracks", {
    tid,
    op,
    songs,
    like: tid === undefined,
  });
};

/**
 * 收藏 / 取消收藏歌单
 * @param tid 歌单 tid
 * @param subscribed true 收藏 / false 取消
 */
export const subscribeQQMusicPlaylist = async (
  tid: number,
  subscribed: boolean,
): Promise<QQMusicWriteResult> => {
  return platformCall<QQMusicWriteResult>(QQ_MUSIC, "playlist_subscribe", { tid, subscribed });
};

/**
 * 查询收藏状态
 * @param type playlist | album | song
 * @param ids 逗号分隔的 ID
 */
export const fetchQQMusicSubscriptionStatus = async (
  type: "playlist" | "album" | "song",
  ids: string,
): Promise<{ code: number; items: Array<{ id: string; status: string }> }> => {
  return platformCall(QQ_MUSIC, "subscription_status", { type, ids });
};

/**
 * 读取平台账号资料
 * @param platform 音源平台
 */
export const fetchPlatformProfile = async (
  platform: ApiPlatform,
): Promise<PlatformProfile | null> => {
  return platformCall<PlatformProfile | null>(platform, "user_detail");
};
