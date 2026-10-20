/**
 * 酷狗音乐平台数据层（渲染端）
 *
 * 调用链与网易云完全同构：axios → `/api/kugou/<模块名>` → 主进程平台模块。
 * 每个函数负责把酷狗原生字段归一成网易云字段形状，页面层无需区分平台。
 *
 * 字段对照见 `src/api/platform/types.ts` 顶部表格。
 *
 * 平台标识约定：
 * - `id`：酷狗的 `mixSongId`（`album_audio_id` 口径，数字），与网易云同为数字，便于复用 `SongType.id`；
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
  /** 当前页码 */
  page?: number;
  /** 总页数 */
  maxPage?: number;
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

/** 酷狗授权位：完全免费可播 */
const KG_PRIVILEGE_FREE = 0;

/** 酷狗授权位：非会员可免费播放（低码率） */
const KG_PRIVILEGE_FREE_FOR_AD = 8;

/**
 * 取酷狗曲目的基档授权位
 *
 * 授权位按音质档位逐档下发，基档（最低码率）决定这首曲子能不能免费播：
 * 基档为 `0` / `8` 时账号可播，高档被锁只是会员权益差异。
 * @param qualities 各音质档位
 * @returns 基档授权位，取不到时为 null
 */
const pickBasePrivilege = (qualities: unknown): number | null => {
  if (!Array.isArray(qualities) || qualities.length === 0) return null;
  const tiers = qualities
    .map((item: Record<string, any>) => ({
      bitrate: Number(item?.bitrate ?? 0),
      privilege: Number(item?.privilege ?? 0),
    }))
    .sort((left, right) => left.bitrate - right.bitrate);
  // 优先取声明了码率的最低档，码率全缺时退回第一档
  const base = tiers.find((tier) => tier.bitrate > 0) ?? tiers[0];
  return base?.privilege ?? null;
};

/**
 * 归一化酷狗歌曲
 *
 * 平台原生字段 → 网易云字段：
 * `mixSongId`（歌曲主键，album_audio_id 口径）→ `id`；`hash` → `platformId`；
 * `singername` → `artists[].name`；`album_name` → `album.name`；
 * `img` 模板 → `cover`；`duration` 已是毫秒。
 *
 * 歌曲主键说明：云歌单条目的 `audio_id` 恒为 0，不能作主键；
 * 真实主键是 `mixSongId`（`album_audio_id` 口径），播放地址 / 歌词 / 评论均以它为键。
 *
 * 可播性判据：取基档授权位 `privilege`（`0` / `8` 可免费播，其余为会员墙或无授权）。
 * `pay_type`（`media_pay_type`）描述的是单个音频文件的版权形态，与可播性无单调关系，不作判据。
 * @param song 酷狗原生歌曲
 * @returns 归一化歌曲
 */
export const normalizeKgSong = (song: Record<string, any>): PlatformSong => {
  const cover = fillCover(song?.cover ?? song?.img ?? "");
  const artists: PlatformArtist[] = Array.isArray(song?.artists)
    ? song.artists.map(normalizeArtist)
    : splitArtists(song?.artist);
  // 付费判据：基档授权位（各音质档位取最低码率那一档）
  const basePrivilege = pickBasePrivilege(song?.qualities);
  const privilege = basePrivilege ?? Number(song?.privilege ?? song?.pay?.privilege ?? Number.NaN);
  const fee =
    Number.isNaN(privilege) ||
    privilege === KG_PRIVILEGE_FREE ||
    privilege === KG_PRIVILEGE_FREE_FOR_AD
      ? 0
      : 1;

  return {
    id: Number(song?.mixSongId ?? song?.albumAudioId ?? song?.audioId ?? song?.audio_id ?? 0) || 0,
    name: String(song?.name ?? song?.songname ?? ""),
    artists,
    album: {
      id: String(song?.albumId ?? song?.album_id ?? ""),
      name: String(song?.album ?? song?.album_name ?? ""),
      picUrl: cover,
    },
    duration: Number(song?.duration ?? 0),
    // 酷狗：基档授权位非免费口径即视为不可免费播放
    fee,
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
 *
 * `type` 区分目录语义：0 为自建歌单，1 为收藏歌单；
 * `isDefault` 标记系统默认歌单（「默认收藏」「我喜欢的歌」）。
 * @param playlist 酷狗原生歌单条目
 * @returns 归一化歌单
 */
export const normalizeKgPlaylist = (playlist: Record<string, any>): PlatformPlaylist => {
  const cover = fillCover(playlist?.cover ?? playlist?.img ?? "");
  const subscribed = Number(playlist?.type ?? 0) === 1;
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
    owned: !subscribed,
    subscribed,
    isDefault: playlist?.isDefault === true,
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
 *
 * 可播性判据全部透出：播放状态 `status`（1 可播 / 2 付费墙 / 3 无授权）、
 * 资源授权位 `privilege`、是否官方试听片段 `isTrial` 与试听时长 `trialDuration`。
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
 *
 * 酷狗评论接口不给 `hasMore`，改用「当前页 < 总页数」判定是否还有更多。
 * @param raw 酷狗原生评论分页
 * @returns 归一化评论分页
 */
export const normalizeKgCommentPage = (raw: KgCommentResponse): PlatformCommentPage => {
  const page = Number(raw?.page ?? 1);
  const maxPage = Number(raw?.maxPage ?? 0);
  return {
    comments: (raw?.comments ?? []).map(normalizeKgComment),
    total: Number(raw?.total ?? 0),
    more: raw?.hasMore === true || (maxPage > 0 && page < maxPage),
    cursor: raw?.nextCursor,
  };
};

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
 * 读取当前酷狗账号的歌单列表（自建与收藏分开返回）
 *
 * 酷狗侧自建（type=0）与收藏（type=1）是两套目录语义，
 * 页面层需要区分「创建的歌单」与「收藏的歌单」两组，故分开返回。
 * @returns 自建歌单与收藏歌单
 */
export const kgUserPlaylistList = async (): Promise<{
  owned: PlatformPlaylist[];
  favorites: PlatformPlaylist[];
}> => {
  const res = await platformRequest<KgPlaylistListResponse>(KUGOU, "user_playlist_list");
  return {
    owned: (res?.owned ?? []).map(normalizeKgPlaylist),
    favorites: (res?.favorites ?? []).map(normalizeKgPlaylist),
  };
};

/**
 * 酷狗「我喜欢的歌」歌单号候选（按优先级排列）
 *
 * 概念版把「我喜欢的歌」放在 listid=4，正式语义下是 listid=3「我喜欢」，
 * 再退到系统默认歌单（isDef=1，即 listid=1「默认收藏」）。
 */
const LIKED_PLAYLIST_IDS = ["4", "3", "1"];

/**
 * 从自建歌单里定位「我喜欢的歌」
 *
 * 酷狗没有独立的红心接口族，「喜欢」本身就是一种歌单。
 * @param owned 自建歌单列表
 * @returns 命中的歌单，未命中时为 null
 */
export const kgFindLikedPlaylist = (owned: PlatformPlaylist[]): PlatformPlaylist | null => {
  for (const listid of LIKED_PLAYLIST_IDS) {
    const hit = owned.find((playlist) => String(playlist.platformId ?? playlist.id) === listid);
    if (hit) return hit;
  }
  return owned.find((playlist) => playlist.isDefault) ?? null;
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
 *
 * 酷狗评论接口的业务主键是 **album_audio_id** 口径的歌曲主键（即 `mixSongId`），
 * 与播放地址 / 歌词使用的 hash 不是同一个键：传 hash 会直接 HTTP 400。
 *
 * 酷狗评论只有一套列表端点，没有独立的「热门评论」通道，
 * 热门与最新共用同一端点（热门取第一页）。
 * @param song 归一化歌曲（或直接给歌曲 mixSongId）
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的评论分页
 */
export const kgComment = async (
  song: PlatformSong | string,
  page = 1,
  limit = 20,
): Promise<PlatformCommentPage> => {
  const mixSongId = typeof song === "string" ? song : String(song.id ?? "");
  const res = await platformRequest<KgCommentResponse>(KUGOU, "comment", {
    mixsongid: mixSongId,
    // 酷狗侧按评论对象类型选评论池，歌曲评论固定走歌曲池
    type: "song",
    page,
    limit,
  });
  return normalizeKgCommentPage(res);
};

/** 酷狗音乐搜索分类（与主进程搜索模块的 type 口径一致） */
const KG_SEARCH_TYPE = {
  /** 单曲 */
  song: 0,
  /** 专辑 */
  album: 8,
  /** 歌手 */
  artist: 9,
  /** 歌单 */
  playlist: 2,
} as const;

/**
 * 酷狗搜索结果条目（网易云形状）
 *
 * 平台原生字段按网易云 `/cloudsearch` 的条目形状重排，
 * 渲染端再交给既有格式化函数（`formatCoverList` / `formatArtistsList`）归一。
 */
export interface KgSearchCoverEntry {
  /** 条目 id */
  id: number | string;
  /** 名称 */
  name: string;
  /** 封面直链 */
  cover: string;
  /** 曲目数 */
  trackCount: number;
  /** 播放量 */
  playCount?: number;
  /** 创建者昵称 */
  creator?: { nickname: string };
  /** 简介 */
  description?: string;
  /** 发行时间（毫秒） */
  publishTime?: number;
}

/** 酷狗搜索歌手条目（网易云形状） */
export interface KgSearchArtistEntry {
  /** 歌手 id */
  id: number | string;
  /** 歌手名 */
  name: string;
  /** 头像直链 */
  cover: string;
  /** 专辑数 */
  albumSize: number;
  /** 单曲数 */
  musicSize: number;
  /** 粉丝数 */
  fans?: number;
}

/** 主进程酷狗搜索模块的分类返回 */
interface KgSearchCategoryResponse {
  code?: number;
  total?: number;
  albums?: Array<Record<string, any>>;
  artists?: Array<Record<string, any>>;
  playlists?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 把酷狗的秒级时间戳换算为毫秒
 * @param value 时间戳
 * @returns 毫秒时间戳，取不到时为 undefined
 */
const toPublishTime = (value: unknown): number | undefined => {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return undefined;
  // 上游给的是秒级时间戳，毫秒口径的数值远大于该量级
  return time < 1e11 ? time * 1000 : time;
};

/**
 * 归一化酷狗搜索到的专辑
 * @param album 酷狗原生专辑条目
 * @returns 网易云形状的专辑条目
 */
const normalizeKgSearchAlbum = (album: Record<string, any>): KgSearchCoverEntry => ({
  id: album?.id ?? "",
  name: String(album?.name ?? ""),
  cover: fillCover(album?.cover ?? ""),
  trackCount: Number(album?.trackCount ?? 0),
  creator: { nickname: String(album?.artist ?? "") },
  description: album?.intro ? String(album.intro) : undefined,
  publishTime: toPublishTime(album?.publishTime),
});

/**
 * 归一化酷狗搜索到的歌单
 * @param playlist 酷狗原生歌单条目
 * @returns 网易云形状的歌单条目
 */
const normalizeKgSearchPlaylist = (playlist: Record<string, any>): KgSearchCoverEntry => ({
  id: playlist?.id ?? "",
  name: String(playlist?.name ?? ""),
  cover: fillCover(playlist?.cover ?? ""),
  trackCount: Number(playlist?.trackCount ?? 0),
  playCount: Number(playlist?.playCount ?? 0),
  creator: { nickname: String(playlist?.creator ?? "") },
});

/**
 * 归一化酷狗搜索到的歌手
 * @param artist 酷狗原生歌手条目
 * @returns 网易云形状的歌手条目
 */
const normalizeKgSearchArtist = (artist: Record<string, any>): KgSearchArtistEntry => ({
  id: artist?.id ?? "",
  name: String(artist?.name ?? ""),
  cover: fillCover(artist?.cover ?? ""),
  albumSize: Number(artist?.albumCount ?? 0),
  musicSize: Number(artist?.songCount ?? 0),
  fans: Number(artist?.fansCount ?? 0),
});

/**
 * 搜索酷狗音乐专辑
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的专辑列表与总数
 */
export const kgSearchAlbums = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; albums: KgSearchCoverEntry[] }> => {
  const res = await platformRequest<KgSearchCategoryResponse>(KUGOU, "search", {
    keywords,
    page,
    limit,
    type: KG_SEARCH_TYPE.album,
  });
  return {
    total: Number(res?.total ?? 0),
    albums: (res?.albums ?? []).map(normalizeKgSearchAlbum),
  };
};

/**
 * 搜索酷狗音乐歌手
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的歌手列表与总数
 */
export const kgSearchArtists = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; artists: KgSearchArtistEntry[] }> => {
  const res = await platformRequest<KgSearchCategoryResponse>(KUGOU, "search", {
    keywords,
    page,
    limit,
    type: KG_SEARCH_TYPE.artist,
  });
  return {
    total: Number(res?.total ?? 0),
    artists: (res?.artists ?? []).map(normalizeKgSearchArtist),
  };
};

/**
 * 搜索酷狗音乐歌单
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的歌单列表与总数
 */
export const kgSearchPlaylists = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; playlists: KgSearchCoverEntry[] }> => {
  const res = await platformRequest<KgSearchCategoryResponse>(KUGOU, "search", {
    keywords,
    page,
    limit,
    type: KG_SEARCH_TYPE.playlist,
  });
  return {
    total: Number(res?.total ?? 0),
    playlists: (res?.playlists ?? []).map(normalizeKgSearchPlaylist),
  };
};
