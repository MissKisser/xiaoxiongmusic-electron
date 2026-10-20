/**
 * 歌单数据源分派层
 *
 * 页面层只认「当前平台」这一个维度：歌单列表、歌单详情、喜欢歌曲列表
 * 三组数据都从这里取，分派层内部按平台走各自的数据源：
 *
 * - 网易云：直调既有网易云封装（`src/api/user.ts` / `src/api/playlist.ts` / `src/api/song.ts`），
 *   返回结构与原链路完全一致，页面行为零变化；
 * - QQ 音乐 / 酷狗：走 `src/api/platform/{qqmusic,kugou}.ts` 的平台数据层，
 *   平台原生字段已在该层归一成网易云字段形状。
 *
 * 归一化口径（页面层只按网易云口径取字段）：
 * - 歌单头部 → `CoverType`（`id` / `name` / `cover` / `count` / `creator` …）；
 * - 曲目 → `SongType`（`id` / `name` / `artists` / `album` / `duration` / `free` / `platform` / `platformId`）。
 */

import { userPlaylist } from "@/api/user";
import { playlistAllSongs, playlistDetail } from "@/api/playlist";
import { songDetail } from "@/api/song";
import { formatCoverList, formatSongsList } from "@/utils/format";
import type { ApiPlatform } from "@/types/shared";
import type { CoverSize, CoverType, SongType } from "@/types/main";
import { kgFindLikedPlaylist, kgPlaylistDetail, kgUserPlaylistList } from "./kugou";
import { qqPlaylistDetailPage, qqUserLikedSongs, qqUserPlaylistList } from "./qqmusic";
import { toSongType, type PlatformPlaylist } from "./types";

/** 网易云歌单详情单页曲目数 */
const NETEASE_PAGE_SIZE = 500;

/** 第三方平台歌单详情默认每页曲目数 */
const DEFAULT_PAGE_SIZE = 300;

/** 分派层统一歌单条目（网易云字段形状 + 平台维度） */
export interface DispatchPlaylist {
  /** 歌单标识：网易云为数字 id，第三方平台为平台内主键 */
  id: number | string;
  /** 歌单名 */
  name: string;
  /** 封面直链 */
  cover: string;
  /** 封面尺寸 */
  coverSize?: CoverSize;
  /** 曲目数 */
  count: number;
  /** 播放量 */
  playCount?: number;
  /** 歌单描述 */
  description?: string;
  /** 创建者昵称 */
  creatorName?: string;
  /** 创建时间（毫秒） */
  createTime?: number;
  /** 更新时间（毫秒） */
  updateTime?: number;
  /** 来源平台 */
  platform: ApiPlatform;
  /** 平台内字符串主键 */
  platformId?: string;
  /** 歌单目录号（QQ 自建歌单读详情时需要） */
  dirId?: number;
  /** 是否为收藏（订阅）歌单 */
  subscribed: boolean;
  /** 是否为「我喜欢的音乐」歌单 */
  isLiked?: boolean;
}

/** 分派层歌单详情结果 */
export interface DispatchPlaylistDetail {
  /** 歌单头部（网易云形状） */
  detail: CoverType;
  /** 曲目列表（网易云形状） */
  tracks: SongType[];
  /** 曲目总数 */
  count: number;
  /** 是否还有更多曲目 */
  hasMore: boolean;
  /** 当前页码（从 1 开始） */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 网易云返回的曲目 id 列表（网易云链路用于批量取歌曲详情） */
  privileges?: number[];
}

/** 分派层用户歌单列表结果 */
export interface DispatchUserPlaylists {
  /** 自建歌单 */
  owned: DispatchPlaylist[];
  /** 收藏（订阅）歌单 */
  favorites: DispatchPlaylist[];
}

/** 歌单详情读取参数 */
export interface DispatchDetailOptions {
  /** 歌单标识：网易云为数字 id，第三方平台为平台内主键 */
  id: string | number;
  /** 是否取回曲目，缺省取回 */
  withTracks?: boolean;
  /** QQ 自建歌单的目录号 */
  dirId?: number;
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
}

/** 喜欢歌曲列表读取参数 */
export interface DispatchLikedOptions {
  /** 网易云「我喜欢的音乐」歌单 id（网易云链路必填，第三方平台由平台侧自行定位） */
  playlistId?: number;
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
}

/** 用户歌单列表读取参数 */
export interface DispatchUserPlaylistOptions {
  /** 网易云用户 id（网易云链路必填，第三方平台由平台侧自行定位） */
  uid?: number;
  /** 取回条数 */
  limit?: number;
}

/** 平台歌单列表缓存（详情页补齐歌单头时复用，避免重复拉取） */
const playlistListCache = new Map<ApiPlatform, { at: number; lists: DispatchUserPlaylists }>();

/** 歌单列表缓存有效期（毫秒） */
const PLAYLIST_LIST_TTL = 30_000;

/**
 * 读取平台歌单列表（带短时缓存）
 * @param platform 音源平台
 * @returns 自建歌单与收藏歌单
 */
const readUserPlaylists = async (platform: ApiPlatform): Promise<DispatchUserPlaylists> => {
  const cached = playlistListCache.get(platform);
  if (cached && Date.now() - cached.at < PLAYLIST_LIST_TTL) return cached.lists;
  const lists = await dispatchUserPlaylists(platform);
  playlistListCache.set(platform, { at: Date.now(), lists });
  return lists;
};

/**
 * 用歌单列表补齐歌单头
 *
 * QQ 音乐与酷狗的歌单详情接口不返回歌单名 / 封面 / 创建者，
 * 这些字段只在「我的歌单列表」里给出，详情页据此补齐。
 * @param platform 音源平台
 * @param id 歌单标识
 * @returns 命中的歌单条目，未命中时为 null
 */
const findPlaylistEntry = async (
  platform: ApiPlatform,
  id: string | number,
): Promise<DispatchPlaylist | null> => {
  try {
    const lists = await readUserPlaylists(platform);
    const all = [...lists.owned, ...lists.favorites];
    return (
      all.find((playlist) => String(playlist.platformId ?? playlist.id) === String(id)) ?? null
    );
  } catch (error) {
    console.error("获取平台歌单列表失败：", error);
    return null;
  }
};

/**
 * 把平台歌单条目转为分派层统一条目
 * @param playlist 平台归一化歌单
 * @returns 分派层统一歌单条目
 */
const fromPlatformPlaylist = (playlist: PlatformPlaylist): DispatchPlaylist => ({
  id: playlist.id,
  name: playlist.name,
  cover: playlist.coverImgUrl,
  coverSize: playlist.coverSize,
  count: playlist.trackCount,
  playCount: playlist.playCount,
  description: playlist.description,
  creatorName: playlist.creator?.name,
  createTime: playlist.createTime,
  updateTime: playlist.updateTime,
  platform: playlist.platform,
  platformId: playlist.platformId,
  dirId: playlist.dirId,
  subscribed: playlist.subscribed === true,
  isLiked: playlist.isLiked === true,
});

/**
 * 把分派层统一条目转为网易云形状的歌单头部
 * @param playlist 分派层统一歌单条目
 * @returns 网易云形状的歌单头部
 */
export const toCoverType = (playlist: DispatchPlaylist): CoverType => ({
  id: playlist.id,
  name: playlist.name,
  cover: playlist.cover,
  coverSize: playlist.coverSize,
  count: playlist.count,
  playCount: playlist.playCount,
  description: playlist.description,
  creator: {
    id: 0,
    name: playlist.creatorName ?? "",
    avatarUrl: "",
  },
  createTime: playlist.createTime,
  updateTime: playlist.updateTime,
});

/**
 * 读取网易云歌单详情
 *
 * 直调既有网易云封装：头部走 `playlistDetail`，曲目按网易云原链路的两种口径取
 * （`privileges` 齐平时批量取详情，否则按 500 一页翻页）。
 * @param id 歌单 id
 * @param withTracks 是否取回曲目
 * @returns 网易云形状的歌单详情
 */
const fetchNeteasePlaylistDetail = async (
  id: number,
  withTracks: boolean,
): Promise<DispatchPlaylistDetail> => {
  const res = await playlistDetail(id);
  const detail = formatCoverList(res.playlist)[0];
  const count = detail?.count ?? 0;
  const privileges: number[] = (res.privileges ?? [])
    .map((item: { id?: number }) => Number(item?.id))
    .filter((value: number) => !Number.isNaN(value));

  if (!withTracks || count === 0) {
    return { detail, tracks: [], count, hasMore: false, page: 1, pageSize: 0, privileges };
  }

  // 曲目数与权限列表一致且不多时，按网易云原链路批量取详情
  if (privileges.length === count && count < 800) {
    const songRes = await songDetail(privileges);
    return {
      detail,
      tracks: formatSongsList(songRes.songs),
      count,
      hasMore: false,
      page: 1,
      pageSize: count,
      privileges,
    };
  }

  // 其余情况按页翻取
  const tracks: SongType[] = [];
  let offset = 0;
  do {
    const pageRes = await playlistAllSongs(id, NETEASE_PAGE_SIZE, offset);
    tracks.push(...formatSongsList(pageRes.songs));
    offset += NETEASE_PAGE_SIZE;
  } while (offset < count);

  return {
    detail,
    tracks,
    count,
    hasMore: false,
    page: 1,
    pageSize: NETEASE_PAGE_SIZE,
    privileges,
  };
};

/**
 * 读取当前平台的用户歌单列表
 *
 * 网易云走既有 `userPlaylist` 封装并按「创建者是否为本人」拆成自建 / 收藏两组；
 * 第三方平台走平台数据层，平台侧本身即分两组返回。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 自建歌单与收藏歌单
 */
export const dispatchUserPlaylists = async (
  platform: ApiPlatform,
  options: DispatchUserPlaylistOptions = {},
): Promise<DispatchUserPlaylists> => {
  if (platform === "netease") {
    const uid = options.uid ?? 0;
    if (!uid) return { owned: [], favorites: [] };
    const limit = options.limit ?? 50;
    const res = await userPlaylist(limit, 0, uid);
    const list = formatCoverList(res.playlist);
    const owned: DispatchPlaylist[] = [];
    const favorites: DispatchPlaylist[] = [];
    for (const item of list) {
      const entry: DispatchPlaylist = {
        id: item.id,
        name: item.name,
        cover: item.cover,
        coverSize: item.coverSize,
        count: item.count ?? 0,
        playCount: item.playCount,
        description: item.description,
        creatorName: item.creator?.name,
        createTime: item.createTime,
        updateTime: item.updateTime,
        platform: "netease",
        subscribed: false,
      };
      // 网易云把「我喜欢的音乐」混在用户歌单列表首位，按创建者是否为本人拆分两组
      if (item.userId === uid || item.creator?.id === uid) owned.push(entry);
      else favorites.push({ ...entry, subscribed: true });
    }
    // 网易云用户歌单列表首项固定是「我喜欢的音乐」
    if (owned.length > 0) owned[0].isLiked = true;
    return { owned, favorites };
  }

  if (platform === "qqmusic") {
    const { owned, favorites } = await qqUserPlaylistList();
    return {
      owned: owned.map(fromPlatformPlaylist),
      favorites: favorites.map(fromPlatformPlaylist),
    };
  }

  const { owned, favorites } = await kgUserPlaylistList();
  const ownedList = owned.map(fromPlatformPlaylist);
  // 酷狗的「我喜欢的歌」是自建歌单里的一种，按平台语义定位后打标
  const liked = kgFindLikedPlaylist(owned);
  if (liked) {
    const target = ownedList.find(
      (item) => String(item.platformId ?? item.id) === String(liked.platformId ?? liked.id),
    );
    if (target) target.isLiked = true;
  }
  return {
    owned: ownedList,
    favorites: favorites.map(fromPlatformPlaylist),
  };
};

/**
 * 读取当前平台的一张歌单详情（含曲目）
 *
 * 网易云直调既有网易云封装；第三方平台走平台数据层，曲目按平台自身分页口径取。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 歌单头部与曲目
 */
export const dispatchPlaylistDetail = async (
  platform: ApiPlatform,
  options: DispatchDetailOptions,
): Promise<DispatchPlaylistDetail> => {
  const withTracks = options.withTracks !== false;

  if (platform === "netease") {
    return fetchNeteasePlaylistDetail(Number(options.id), withTracks);
  }

  if (platform === "qqmusic") {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const page = options.page ?? 1;
    const res = await qqPlaylistDetailPage(options.id, {
      dirId: options.dirId,
      songBegin: (page - 1) * pageSize,
      songNum: pageSize,
    });
    // 歌单名 / 封面 / 创建者在歌单列表里，详情接口不回，用列表补齐
    const entry = res.name ? null : await findPlaylistEntry(platform, options.id);
    const playlist: DispatchPlaylist = {
      id: res.id,
      name: res.name || entry?.name || "",
      cover: res.coverImgUrl || entry?.cover || "",
      coverSize: res.coverSize ?? entry?.coverSize,
      count: res.trackCount || entry?.count || 0,
      playCount: res.playCount || entry?.playCount,
      description: res.description || entry?.description,
      creatorName: res.creator?.name || entry?.creatorName,
      createTime: entry?.createTime,
      updateTime: entry?.updateTime,
      platform: res.platform,
      platformId: res.platformId,
      dirId: options.dirId,
      subscribed: false,
    };
    return {
      detail: toCoverType(playlist),
      tracks: withTracks ? res.tracks.map(toSongType) : [],
      count: playlist.count,
      hasMore: res.hasMore,
      page,
      pageSize,
    };
  }

  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = options.page ?? 1;
  const res = await kgPlaylistDetail(options.id, page, pageSize);
  const entry = await findPlaylistEntry(platform, options.id);
  const playlist: DispatchPlaylist = {
    id: res.id,
    name: res.name || entry?.name || "",
    cover: res.coverImgUrl || entry?.cover || "",
    coverSize: res.coverSize ?? entry?.coverSize,
    count: res.trackCount || entry?.count || 0,
    playCount: res.playCount || entry?.playCount,
    description: res.description || entry?.description,
    creatorName: res.creator?.name || entry?.creatorName,
    createTime: entry?.createTime,
    updateTime: entry?.updateTime,
    platform: res.platform,
    platformId: res.platformId,
    subscribed: false,
  };
  return {
    detail: toCoverType(playlist),
    tracks: withTracks ? res.tracks.map(toSongType) : [],
    count: playlist.count,
    hasMore: res.hasMore,
    page,
    pageSize,
  };
};

/**
 * 读取当前平台的「我喜欢的音乐」曲目
 *
 * 网易云以传入的歌单 id 读取（该 id 来自网易云用户歌单列表首项）；
 * QQ 音乐走「我喜欢」系统目录模块；酷狗的「喜欢」是一种歌单，按歌单号定位后读取。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 歌单头部与曲目
 */
export const dispatchLikedSongs = async (
  platform: ApiPlatform,
  options: DispatchLikedOptions = {},
): Promise<DispatchPlaylistDetail> => {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  if (platform === "netease") {
    const playlistId = options.playlistId ?? 0;
    if (!playlistId) {
      return {
        detail: toCoverType({
          id: 0,
          name: "我喜欢的音乐",
          cover: "",
          count: 0,
          platform: "netease",
          subscribed: false,
        }),
        tracks: [],
        count: 0,
        hasMore: false,
        page: 1,
        pageSize,
      };
    }
    return fetchNeteasePlaylistDetail(playlistId, true);
  }

  if (platform === "qqmusic") {
    const page = options.page ?? 1;
    const res = await qqUserLikedSongs((page - 1) * pageSize, pageSize);
    const playlist: DispatchPlaylist = {
      id: res.id,
      name: res.name,
      cover: res.coverImgUrl,
      coverSize: res.coverSize,
      count: res.trackCount,
      playCount: res.playCount,
      description: res.description,
      creatorName: res.creator?.name,
      platform: res.platform,
      platformId: res.platformId,
      subscribed: false,
    };
    return {
      detail: toCoverType(playlist),
      tracks: res.tracks.map(toSongType),
      count: res.trackCount,
      hasMore: res.hasMore,
      page,
      pageSize,
    };
  }

  // 酷狗：「喜欢」是歌单的一种，先在自建歌单里定位再读曲目
  const { owned } = await kgUserPlaylistList();
  const liked = kgFindLikedPlaylist(owned);
  if (!liked) {
    return {
      detail: toCoverType({
        id: 0,
        name: "我喜欢的音乐",
        cover: "",
        count: 0,
        platform: "kugou",
        subscribed: false,
      }),
      tracks: [],
      count: 0,
      hasMore: false,
      page: 1,
      pageSize,
    };
  }
  const listId = liked.platformId ?? liked.id;
  const page = options.page ?? 1;
  const res = await kgPlaylistDetail(listId, page, pageSize);
  const playlist: DispatchPlaylist = {
    id: res.id,
    name: liked.name || res.name,
    cover: liked.coverImgUrl || res.coverImgUrl,
    coverSize: liked.coverSize ?? res.coverSize,
    count: liked.trackCount || res.trackCount,
    playCount: liked.playCount || res.playCount,
    description: liked.description || res.description,
    creatorName: liked.creator?.name || res.creator?.name,
    platform: res.platform,
    platformId: res.platformId,
    subscribed: false,
  };
  return {
    detail: toCoverType(playlist),
    tracks: res.tracks.map(toSongType),
    count: playlist.count,
    hasMore: res.hasMore,
    page,
    pageSize,
  };
};
