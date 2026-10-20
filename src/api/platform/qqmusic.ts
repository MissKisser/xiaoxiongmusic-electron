/**
 * QQ 音乐平台数据层（渲染端）
 *
 * 调用链与网易云完全同构：axios → `/api/qqmusic/<模块名>` → 主进程平台模块。
 * 每个函数负责把 QQ 原生字段归一成网易云字段形状，页面层无需区分平台。
 *
 * 字段对照见 `src/api/platform/types.ts` 顶部表格。
 */

import { platformRequest } from "./http";
import {
  buildCoverSize,
  type PlatformAlbum,
  type PlatformArtist,
  type PlatformComment,
  type PlatformCommentPage,
  type PlatformLyric,
  type PlatformPlaylist,
  type PlatformPlaylistDetail,
  type PlatformSong,
  type PlatformSongUrl,
} from "./types";

/** QQ 音乐平台标识 */
export const QQ_MUSIC = "qqmusic" as const;

/** QQ 音乐专辑封面直链模板（album.mid 取不到时回落到 album.pmid） */
const ALBUM_COVER_TEMPLATE = "https://y.gtimg.cn/music/photo_new/T002R300x300M000";

/** 主进程 QQ 搜索模块的原生返回 */
interface QqSearchResponse {
  code?: number;
  total?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 歌单列表模块的原生返回 */
interface QqPlaylistListResponse {
  code?: number;
  total?: number;
  owned?: Array<Record<string, any>>;
  favorites?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 歌单详情模块的原生返回 */
interface QqPlaylistDetailResponse {
  code?: number;
  id?: string;
  name?: string;
  creator?: string;
  cover?: string;
  description?: string;
  total?: number;
  hasmore?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 歌曲详情模块的原生返回 */
interface QqSongDetailResponse {
  code?: number;
  id?: number;
  mid?: string;
  name?: string;
  artist?: string;
  album?: string;
  duration?: number;
  message?: string;
}

/** 主进程 QQ 播放地址模块的原生返回 */
interface QqSongUrlResponse {
  code?: number;
  mid?: string;
  available?: boolean;
  url?: string;
  level?: string;
  label?: string;
  format?: string;
  isFallback?: boolean;
  isTrial?: boolean;
  payPlay?: number;
  reason?: string;
  message?: string;
}

/** 主进程 QQ 歌词模块的原生返回 */
interface QqLyricResponse {
  code?: number;
  id?: string;
  lrc?: string;
  qrc?: string;
  trans?: string;
  roma?: string;
  message?: string;
}

/** 主进程 QQ 评论模块的原生返回 */
interface QqCommentResponse {
  code?: number;
  id?: string;
  total?: number;
  hasMore?: boolean;
  nextCursor?: string;
  comments?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 把 http / 协议相对地址升级为 https
 * @param url 原始地址
 * @returns 安全地址
 */
const secureUrl = (url: unknown): string => {
  if (typeof url !== "string" || !url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url.replace(/^http:\/\//, "https://");
};

/**
 * 把 QQ 的「A / B」歌手串拆成歌手数组
 * @param artist 歌手串
 * @returns 歌手数组
 */
const splitArtists = (artist: unknown): PlatformArtist[] => {
  if (typeof artist !== "string" || !artist) return [];
  return artist
    .split(" / ")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: "", name }));
};

/**
 * 归一化 QQ 歌手条目
 * @param singer 歌手条目
 * @returns 归一化歌手
 */
const normalizeArtist = (singer: Record<string, any>): PlatformArtist => ({
  id: String(singer?.id ?? ""),
  name: String(singer?.name ?? ""),
  mid: String(singer?.mid ?? "") || undefined,
});

/**
 * 归一化 QQ 专辑
 *
 * QQ 的 `album` 有两种形态：
 * - 搜索模块给的是名称字符串，专辑 mid 单独放在 `albumMid`；
 * - 歌单详情模块给的是含 `id` / `mid` / `name` 的对象。
 * 两种形态统一成网易云的 `album` 形状，并按 album mid 拼出封面直链。
 * @param album 原始专辑字段
 * @param albumMid 单独给出的专辑 mid
 * @param albumId 单独给出的专辑 ID
 * @returns 归一化专辑
 */
const normalizeAlbum = (album: unknown, albumMid: string, albumId: string): PlatformAlbum => {
  if (album && typeof album === "object") {
    const source = album as Record<string, any>;
    const mid = String(source.mid ?? source.pmid ?? albumMid ?? "");
    return {
      id: String(source.id ?? albumId ?? ""),
      name: String(source.name ?? source.title ?? ""),
      picUrl: mid ? `${ALBUM_COVER_TEMPLATE}${mid}.jpg` : "",
    };
  }
  return {
    id: albumId,
    name: typeof album === "string" ? album : "",
    picUrl: albumMid ? `${ALBUM_COVER_TEMPLATE}${albumMid}.jpg` : "",
  };
};

/**
 * 归一化 QQ 歌曲
 *
 * 平台原生字段 → 网易云字段：
 * `id`（songid）→ `id`；`mid` → `platformId`；`artist` → `artists[].name`；
 * `album` → `album.name`；`cover` → `cover`；`duration` 已是毫秒。
 * @param song QQ 原生歌曲
 * @returns 归一化歌曲
 */
export const normalizeQqSong = (song: Record<string, any>): PlatformSong => {
  const cover = secureUrl(song?.cover ?? "");
  const album = normalizeAlbum(
    song?.album,
    String(song?.albumMid ?? ""),
    String(song?.albumId ?? ""),
  );
  const albumCover = cover || album.picUrl;
  const artists: PlatformArtist[] = Array.isArray(song?.artists)
    ? song.artists.map(normalizeArtist)
    : splitArtists(song?.artist);

  return {
    id: Number(song?.id) || 0,
    name: String(song?.name ?? ""),
    artists,
    album: {
      ...album,
      picUrl: albumCover,
    },
    duration: Number(song?.duration ?? 0),
    // QQ 付费标记：payalbum=1 表示需购买专辑，payplay=1 表示 VIP 歌曲
    fee: song?.pay?.payalbum === 1 ? 4 : song?.pay?.payplay === 1 ? 1 : 0,
    mv: null,
    cover: albumCover,
    coverSize: buildCoverSize(albumCover),
    size: Number(song?.size320 || song?.size128 || 0),
    platform: QQ_MUSIC,
    platformId: String(song?.mid ?? "") || undefined,
  };
};

/**
 * 归一化 QQ 歌单条目
 * @param playlist QQ 原生歌单条目
 * @returns 归一化歌单
 */
export const normalizeQqPlaylist = (playlist: Record<string, any>): PlatformPlaylist => {
  const cover = secureUrl(playlist?.cover ?? "");
  return {
    id: playlist?.tid ?? playlist?.id ?? "",
    name: String(playlist?.dirName ?? playlist?.name ?? ""),
    coverImgUrl: cover,
    coverSize: buildCoverSize(cover),
    trackCount: Number(playlist?.songNum ?? 0),
    playCount: Number(playlist?.listenNum ?? 0),
    creator: {
      id: "",
      name: String(playlist?.creator ?? ""),
    },
    createTime: Number(playlist?.createTime) || undefined,
    platform: QQ_MUSIC,
    platformId: String(playlist?.tid ?? playlist?.id ?? "") || undefined,
  };
};

/**
 * 归一化 QQ 歌单详情
 * @param detail QQ 原生歌单详情
 * @returns 归一化歌单详情
 */
export const normalizeQqPlaylistDetail = (
  detail: QqPlaylistDetailResponse,
): PlatformPlaylistDetail => {
  const cover = secureUrl(detail?.cover ?? "");
  return {
    id: detail?.id ?? "",
    name: String(detail?.name ?? ""),
    coverImgUrl: cover,
    coverSize: buildCoverSize(cover),
    trackCount: Number(detail?.total ?? 0),
    playCount: 0,
    description: String(detail?.description ?? ""),
    creator: {
      id: "",
      name: String(detail?.creator ?? ""),
    },
    platform: QQ_MUSIC,
    platformId: String(detail?.id ?? "") || undefined,
    tracks: (detail?.songs ?? []).map(normalizeQqSong),
    hasMore: Number(detail?.hasmore ?? 0) > 0,
  };
};

/**
 * 归一化 QQ 播放地址
 * @param raw QQ 原生播放地址
 * @returns 归一化播放地址
 */
export const normalizeQqSongUrl = (raw: QqSongUrlResponse): PlatformSongUrl => ({
  id: raw?.mid ?? "",
  available: raw?.available === true,
  url: raw?.url ?? "",
  level: raw?.level,
  label: raw?.label,
  format: raw?.format,
  isFallback: raw?.isFallback === true,
  isTrial: raw?.isTrial === true,
  payPlay: raw?.payPlay,
  reason: raw?.reason,
  message: raw?.message,
});

/**
 * 归一化 QQ 歌词
 * @param raw QQ 原生歌词
 * @returns 归一化歌词
 */
export const normalizeQqLyric = (raw: QqLyricResponse): PlatformLyric => ({
  lrc: { lyric: raw?.lrc ?? "" },
  tlyric: { lyric: raw?.trans ?? "" },
  romalrc: { lyric: raw?.roma ?? "" },
  yrc: { lyric: raw?.qrc ?? "" },
});

/**
 * 归一化 QQ 评论条目
 * @param raw QQ 原生评论
 * @returns 归一化评论
 */
export const normalizeQqComment = (raw: Record<string, any>): PlatformComment => ({
  id: raw?.id ?? "",
  content: String(raw?.content ?? ""),
  // QQ 的 publishTime 为秒，网易云评论区按毫秒消费
  time: Number(raw?.publishTime ?? 0) * 1000,
  likedCount: Number(raw?.praiseNum ?? 0),
  liked: false,
  user: {
    id: raw?.encryptedUin ?? "",
    name: String(raw?.nick ?? ""),
    avatarUrl: secureUrl(raw?.avatar ?? ""),
  },
});

/**
 * 归一化 QQ 评论分页
 * @param raw QQ 原生评论分页
 * @returns 归一化评论分页
 */
export const normalizeQqCommentPage = (raw: QqCommentResponse): PlatformCommentPage => ({
  comments: (raw?.comments ?? []).map(normalizeQqComment),
  total: Number(raw?.total ?? 0),
  more: raw?.hasMore === true,
  cursor: raw?.nextCursor,
});

/**
 * 搜索 QQ 音乐歌曲
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的歌曲列表与总数
 */
export const qqSearch = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; songs: PlatformSong[] }> => {
  const res = await platformRequest<QqSearchResponse>(QQ_MUSIC, "search", {
    keywords,
    page,
    limit,
    type: 0,
  });
  return {
    total: Number(res?.total ?? 0),
    songs: (res?.songs ?? []).map(normalizeQqSong),
  };
};

/**
 * 读取当前 QQ 音乐账号的歌单列表（自建 + 收藏）
 * @returns 归一化后的歌单列表
 */
export const qqUserPlaylists = async (): Promise<PlatformPlaylist[]> => {
  const res = await platformRequest<QqPlaylistListResponse>(QQ_MUSIC, "user_playlist_list");
  return [...(res?.owned ?? []), ...(res?.favorites ?? [])].map(normalizeQqPlaylist);
};

/**
 * 读取一张 QQ 音乐歌单的详情与曲目
 * @param id 歌单 tid
 * @param dirId 歌单目录号（自建歌单需要）
 * @returns 归一化后的歌单详情
 */
export const qqPlaylistDetail = async (
  id: string | number,
  dirId = 0,
): Promise<PlatformPlaylistDetail> => {
  const res = await platformRequest<QqPlaylistDetailResponse>(QQ_MUSIC, "playlist_detail", {
    id,
    dirId,
  });
  return normalizeQqPlaylistDetail(res);
};

/**
 * 读取 QQ 音乐歌曲详情
 * @param mid 歌曲 mid
 * @returns 归一化后的歌曲
 */
export const qqSongDetail = async (mid: string): Promise<PlatformSong> => {
  const res = await platformRequest<QqSongDetailResponse>(QQ_MUSIC, "song_detail", { mid });
  return normalizeQqSong({
    id: res?.id,
    mid: res?.mid ?? mid,
    name: res?.name,
    artist: res?.artist,
    album: res?.album,
    duration: res?.duration,
  });
};

/**
 * 解析 QQ 音乐歌曲的播放地址
 * @param song 归一化歌曲（或直接给歌曲 mid）
 * @param level 首选音质档位
 * @returns 归一化后的播放地址（含可播性与试听判据）
 */
export const qqSongUrl = async (
  song: PlatformSong | string,
  level = "hq",
): Promise<PlatformSongUrl> => {
  const mid = typeof song === "string" ? song : (song.platformId ?? String(song.id));
  const res = await platformRequest<QqSongUrlResponse>(QQ_MUSIC, "song_url", { mid, level });
  return normalizeQqSongUrl(res);
};

/**
 * 读取 QQ 音乐歌词
 * @param song 归一化歌曲（或直接给歌曲 ID）
 * @returns 归一化后的歌词
 */
export const qqLyric = async (song: PlatformSong | string): Promise<PlatformLyric> => {
  const isRaw = typeof song === "string";
  const res = await platformRequest<QqLyricResponse>(QQ_MUSIC, "lyric", {
    id: isRaw ? song : song.id,
    name: isRaw ? "" : song.name,
    artist: isRaw ? "" : song.artists.map((artist) => artist.name).join(" / "),
    album: isRaw ? "" : song.album.name,
    // QQ 歌词接口的 interval 单位为秒
    duration: isRaw ? 0 : Math.round(song.duration / 1000),
  });
  return normalizeQqLyric(res);
};

/**
 * 读取 QQ 音乐歌曲评论
 * @param song 归一化歌曲（或直接给歌曲 mid）
 * @param type 评论类型：hot 热门 / new 最新
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @param cursor 游标，取上一页返回的 nextCursor
 * @returns 归一化后的评论分页
 */
export const qqComment = async (
  song: PlatformSong | string,
  type: "hot" | "new" = "hot",
  page = 1,
  limit = 20,
  cursor = "",
): Promise<PlatformCommentPage> => {
  const mid = typeof song === "string" ? song : (song.platformId ?? String(song.id));
  const res = await platformRequest<QqCommentResponse>(QQ_MUSIC, "comment", {
    mid,
    type,
    page,
    limit,
    cursor,
  });
  return normalizeQqCommentPage(res);
};
