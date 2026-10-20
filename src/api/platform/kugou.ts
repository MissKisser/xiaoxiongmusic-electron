/**
 * 酷狗音乐平台数据层（渲染端）
 *
 * 调用链与网易云完全同构：axios → `/api/kugou/<模块名>` → 主进程平台模块。
 * 每个函数负责把酷狗原生字段归一成网易云字段形状，页面层无需区分平台。
 *
 * 字段对照见 `src/api/platform/types.ts` 顶部表格。
 *
 * 平台标识约定：
 * - `id`：酷狗的 `audio_id`（数字），与网易云同为数字，便于复用 `SongType.id`；
 * - `platformId`：酷狗的 `hash`（字符串主键），播放地址 / 歌词等接口以它为键。
 */

import { platformRequest } from "./http";
import {
  buildCoverSize,
  type PlatformArtist,
  type PlatformComment,
  type PlatformCommentPage,
  type PlatformLyric,
  type PlatformLyricTarget,
  type PlatformPlaylist,
  type PlatformPlaylistDetail,
  type PlatformSong,
  type PlatformSongUrl,
} from "./types";

/** 酷狗平台标识 */
export const KUGOU = "kugou" as const;

/** 主进程酷狗搜索模块的原生返回 */
interface KgSearchResponse {
  code?: number;
  total?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程酷狗歌单列表模块的原生返回 */
interface KgPlaylistListResponse {
  code?: number;
  total?: number;
  owned?: Array<Record<string, any>>;
  favorites?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程酷狗歌单详情模块的原生返回 */
interface KgPlaylistDetailResponse {
  code?: number;
  id?: string;
  name?: string;
  cover?: string;
  total?: number;
  hasMore?: boolean;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程酷狗播放地址模块的原生返回 */
interface KgSongUrlResponse {
  code?: number;
  url?: string;
  quality?: string;
  requestedQuality?: string;
  downgraded?: boolean;
  size?: number;
  bitrate?: number;
  status?: number;
  privilege?: number | null;
  isTrial?: boolean;
  trial?: { duration?: number };
  message?: string;
}

/** 主进程酷狗歌词模块的原生返回 */
interface KgLyricResponse {
  code?: number;
  hash?: string;
  fmt?: string;
  lrc?: string;
  krc?: string;
  trans?: string;
  roma?: string;
  message?: string;
}

/** 主进程酷狗评论模块的原生返回 */
interface KgCommentResponse {
  code?: number;
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
 * 填充酷狗图片模板里的尺寸占位符
 *
 * 酷狗的封面地址把尺寸写成 `{size}` 占位符，直接用会 404。
 * @param url 原始地址
 * @param size 实际尺寸
 * @returns 可直接访问的封面地址
 */
const fillCover = (url: unknown, size = 300): string =>
  secureUrl(String(url ?? "").replace(/\{size\}/g, String(size)));

/**
 * 归一化酷狗歌手条目
 * @param singer 歌手条目
 * @returns 归一化歌手
 */
const normalizeArtist = (singer: Record<string, any>): PlatformArtist => ({
  id: String(singer?.id ?? ""),
  name: String(singer?.name ?? ""),
});

/**
 * 把酷狗的「A / B」歌手串拆成歌手数组
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
 * 归一化酷狗歌曲
 *
 * 平台原生字段 → 网易云字段：
 * `audioId` → `id`；`hash` → `platformId`；`singername` → `artists[].name`；
 * `album_name` → `album.name`；`img` 模板 → `cover`；`duration` 已是毫秒。
 * @param song 酷狗原生歌曲
 * @returns 归一化歌曲
 */
export const normalizeKgSong = (song: Record<string, any>): PlatformSong => {
  const cover = fillCover(song?.cover ?? song?.img ?? "");
  const artists: PlatformArtist[] = Array.isArray(song?.artists)
    ? song.artists.map(normalizeArtist)
    : splitArtists(song?.artist);

  return {
    id: Number(song?.audioId ?? song?.audio_id ?? 0) || 0,
    name: String(song?.name ?? song?.songname ?? ""),
    artists,
    album: {
      id: String(song?.albumId ?? song?.album_id ?? ""),
      name: String(song?.album ?? song?.album_name ?? ""),
      picUrl: cover,
    },
    duration: Number(song?.duration ?? 0),
    // 酷狗 payType / payplay 非 0 表示 VIP 专享
    fee: Number(song?.payType ?? song?.pay?.payplay ?? 0) > 0 ? 1 : 0,
    mv: null,
    cover,
    coverSize: buildCoverSize(cover),
    size: Number(song?.sizes?.["320k"] ?? song?.sizes?.["128k"] ?? 0),
    platform: KUGOU,
    platformId: String(song?.hash ?? "") || undefined,
  };
};

/**
 * 归一化酷狗歌单条目
 * @param playlist 酷狗原生歌单条目
 * @returns 归一化歌单
 */
export const normalizeKgPlaylist = (playlist: Record<string, any>): PlatformPlaylist => {
  const cover = fillCover(playlist?.cover ?? playlist?.img ?? "");
  return {
    id: playlist?.listid ?? playlist?.id ?? "",
    name: String(playlist?.name ?? ""),
    coverImgUrl: cover,
    coverSize: buildCoverSize(cover),
    trackCount: Number(playlist?.count ?? 0),
    playCount: Number(playlist?.playCount ?? playlist?.listenNum ?? 0),
    description: String(playlist?.intro ?? playlist?.description ?? ""),
    creator: {
      id: "",
      name: String(playlist?.creator ?? ""),
    },
    createTime: Number(playlist?.createTime ?? playlist?.create_time ?? 0) || undefined,
    updateTime: Number(playlist?.updateTime ?? playlist?.update_time ?? 0) || undefined,
    platform: KUGOU,
    platformId: String(playlist?.listid ?? playlist?.id ?? "") || undefined,
  };
};

/**
 * 归一化酷狗歌单详情
 * @param detail 酷狗原生歌单详情
 * @returns 归一化歌单详情
 */
export const normalizeKgPlaylistDetail = (
  detail: KgPlaylistDetailResponse,
): PlatformPlaylistDetail => {
  const cover = fillCover(detail?.cover ?? "");
  return {
    id: detail?.id ?? "",
    name: "",
    coverImgUrl: cover,
    coverSize: buildCoverSize(cover),
    trackCount: Number(detail?.total ?? 0),
    playCount: 0,
    creator: { id: "", name: "" },
    platform: KUGOU,
    platformId: String(detail?.id ?? "") || undefined,
    tracks: (detail?.songs ?? []).map(normalizeKgSong),
    hasMore: detail?.hasMore === true,
  };
};

/**
 * 归一化酷狗播放地址
 * @param raw 酷狗原生播放地址
 * @returns 归一化播放地址
 */
export const normalizeKgSongUrl = (raw: KgSongUrlResponse): PlatformSongUrl => ({
  id: "",
  available: Boolean(raw?.url),
  url: raw?.url ?? "",
  level: raw?.quality,
  isFallback: raw?.downgraded === true,
  isTrial: raw?.isTrial === true,
  status: raw?.status,
  privilege: raw?.privilege ?? null,
  trialDuration: Number(raw?.trial?.duration ?? 0) || undefined,
  message: raw?.message,
});

/**
 * 归一化酷狗歌词
 * @param raw 酷狗原生歌词
 * @returns 归一化歌词
 */
export const normalizeKgLyric = (raw: KgLyricResponse): PlatformLyric => ({
  lrc: { lyric: raw?.lrc ?? "" },
  tlyric: { lyric: raw?.trans ?? "" },
  romalrc: { lyric: raw?.roma ?? "" },
  yrc: { lyric: raw?.krc ?? "" },
});

/**
 * 归一化酷狗评论条目
 * @param raw 酷狗原生评论
 * @returns 归一化评论
 */
export const normalizeKgComment = (raw: Record<string, any>): PlatformComment => ({
  id: raw?.id ?? "",
  content: String(raw?.content ?? ""),
  // 酷狗 addtime 为 `YYYY-MM-DD HH:mm:ss` 文本
  time: Date.parse(String(raw?.time ?? "").replace(/-/g, "/")) || 0,
  likedCount: Number(raw?.likedCount ?? 0),
  liked: false,
  user: {
    id: raw?.user?.id ?? "",
    name: String(raw?.user?.name ?? ""),
    avatarUrl: secureUrl(raw?.user?.avatar ?? ""),
  },
});

/**
 * 归一化酷狗评论分页
 * @param raw 酷狗原生评论分页
 * @returns 归一化评论分页
 */
export const normalizeKgCommentPage = (raw: KgCommentResponse): PlatformCommentPage => ({
  comments: (raw?.comments ?? []).map(normalizeKgComment),
  total: Number(raw?.total ?? 0),
  more: raw?.hasMore === true,
  cursor: raw?.nextCursor,
});

/**
 * 搜索酷狗歌曲
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的歌曲列表与总数
 */
export const kgSearch = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; songs: PlatformSong[] }> => {
  const res = await platformRequest<KgSearchResponse>(KUGOU, "search", {
    keywords,
    page,
    limit,
    type: 0,
  });
  return {
    total: Number(res?.total ?? 0),
    songs: (res?.songs ?? []).map(normalizeKgSong),
  };
};

/**
 * 读取当前酷狗账号的歌单列表（自建 + 收藏）
 * @returns 归一化后的歌单列表
 */
export const kgUserPlaylists = async (): Promise<PlatformPlaylist[]> => {
  const res = await platformRequest<KgPlaylistListResponse>(KUGOU, "user_playlist_list");
  return [...(res?.owned ?? []), ...(res?.favorites ?? [])].map(normalizeKgPlaylist);
};

/**
 * 读取一张酷狗歌单的详情与曲目
 * @param id 歌单 listid
 * @param page 页码（从 1 开始）
 * @param pageSize 每页数量
 * @returns 归一化后的歌单详情
 */
export const kgPlaylistDetail = async (
  id: string | number,
  page = 1,
  pageSize = 300,
): Promise<PlatformPlaylistDetail> => {
  const res = await platformRequest<KgPlaylistDetailResponse>(KUGOU, "playlist_detail", {
    id,
    page,
    pageSize,
  });
  return normalizeKgPlaylistDetail(res);
};

/**
 * 解析酷狗歌曲的播放地址
 * @param song 归一化歌曲（或直接给歌曲 hash）
 * @param quality 首选音质档位
 * @returns 归一化后的播放地址
 */
export const kgSongUrl = async (
  song: PlatformSong | string,
  quality = "hq",
): Promise<PlatformSongUrl> => {
  const hash = typeof song === "string" ? song : (song.platformId ?? String(song.id));
  const res = await platformRequest<KgSongUrlResponse>(KUGOU, "song_url", { hash, quality });
  return { ...normalizeKgSongUrl(res), id: hash };
};

/**
 * 读取酷狗歌词
 * @param song 归一化歌曲、应用内歌曲或直接给歌曲 hash
 * @returns 归一化后的歌词
 */
export const kgLyric = async (
  song: PlatformSong | PlatformLyricTarget | string,
): Promise<PlatformLyric> => {
  const isRaw = typeof song === "string";
  const res = await platformRequest<KgLyricResponse>(KUGOU, "lyric", {
    hash: isRaw ? song : (song.platformId ?? String(song.id)),
    name: isRaw ? "" : song.name,
    // 酷狗歌词接口的时长单位为秒
    duration: isRaw ? 0 : Math.round(song.duration / 1000),
  });
  return normalizeKgLyric(res);
};

/**
 * 读取酷狗歌曲评论
 * @param song 归一化歌曲（或直接给歌曲 hash）
 * @param type 评论类型：hot 热门 / new 最新
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @param cursor 游标，取上一页返回的 nextCursor
 * @returns 归一化后的评论分页
 */
export const kgComment = async (
  song: PlatformSong | string,
  type: "hot" | "new" = "hot",
  page = 1,
  limit = 20,
  cursor = "",
): Promise<PlatformCommentPage> => {
  const hash = typeof song === "string" ? song : (song.platformId ?? String(song.id));
  const res = await platformRequest<KgCommentResponse>(KUGOU, "comment", {
    hash,
    type,
    page,
    limit,
    cursor,
  });
  return normalizeKgCommentPage(res);
};
