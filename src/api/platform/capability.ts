/**
 * 平台能力矩阵
 *
 * 页面层据此判断「当前平台是否支持某个功能」：
 * - 不支持的入口在侧边栏 / 标签页里隐藏；
 * - 不支持的路由由路由守卫拦截，直接输 URL 时给出提示并回到首页。
 *
 * 口径来自主进程已注册的平台模块：只有模块能真实取到数据的，
 * 才算该平台支持该能力。
 */

import type { ApiPlatform } from "@/types/shared";

/** 平台能力项 */
export type PlatformCapability =
  /** 排行榜 */
  | "leaderboard"
  /** 歌单广场 */
  | "playlistSquare"
  /** 歌手详情（详情头 + 单曲 + 专辑） */
  | "artistDetail"
  /** 专辑详情（专辑头 + 曲目） */
  | "albumDetail"
  /** 热搜榜 */
  | "hotSearch"
  /** 发现页歌手列表（由榜单歌曲衍生） */
  | "discoverArtist";

/** 各平台的能力清单 */
export const PLATFORM_CAPABILITIES: Record<ApiPlatform, PlatformCapability[]> = {
  netease: [
    "leaderboard",
    "playlistSquare",
    "artistDetail",
    "albumDetail",
    "hotSearch",
    "discoverArtist",
  ],
  qqmusic: [
    "leaderboard",
    "playlistSquare",
    "artistDetail",
    "albumDetail",
    "hotSearch",
    "discoverArtist",
  ],
  kugou: ["playlistSquare", "artistDetail", "albumDetail"],
};

/**
 * 判断平台是否支持某项能力
 * @param platform 音源平台
 * @param capability 能力项
 * @returns 是否支持
 */
export const hasCapability = (platform: ApiPlatform, capability: PlatformCapability): boolean =>
  (PLATFORM_CAPABILITIES[platform] ?? []).includes(capability);

/**
 * 网易云独有能力对应的路由
 *
 * 这些路由在第三方平台下既没有数据源，也无从降级，
 * 故隐藏入口并在路由守卫里拦截直达。
 */
export const NETEASE_ONLY_ROUTES: string[] = [
  // 播客电台
  "radio",
  "radio-hot",
  "radio-type",
  // 我的云盘
  "cloud",
  // 每日推荐
  "daily-songs",
  // MV
  "video",
  // 歌曲百科
  "song-wiki",
  // 收藏子页（专辑 / 歌手 / 视频 / 播客）
  "like-albums",
  "like-artists",
  "like-videos",
  "like-radios",
  // 搜索子页（视频 / 播客）
  "search-videos",
  "search-radios",
  // 歌手视频子页
  "artist-videos",
  // 发现页「最新音乐」（新碟 / 新歌，平台侧无对应数据源）
  "discover-new",
];

/**
 * 平台级路由限制
 *
 * 某些子页只在部分平台有数据源（如酷狗没有榜单、没有歌手列表），
 * 这些平台下对应入口已隐藏，路由守卫同样拦截直达。
 */
export const PLATFORM_UNSUPPORTED_ROUTES: Record<ApiPlatform, string[]> = {
  netease: [],
  qqmusic: [],
  kugou: ["discover-toplists", "discover-artists"],
};

/**
 * 判断路由在指定平台下是否可用
 * @param platform 音源平台
 * @param routeName 路由名
 * @returns 是否可用
 */
export const isRouteSupported = (platform: ApiPlatform, routeName: string): boolean => {
  if (platform === "netease") return true;
  if (NETEASE_ONLY_ROUTES.includes(routeName)) return false;
  return !(PLATFORM_UNSUPPORTED_ROUTES[platform] ?? []).includes(routeName);
};

/**
 * 平台标签页
 */
export interface PlatformTab {
  /** 路由名 */
  name: string;
  /** 标签文案 */
  label: string;
}

/**
 * 各平台在发现页的子页可见性
 *
 * 与 `PLATFORM_CAPABILITIES` 对齐，缺省隐藏不可用的子页。
 */
export const DISCOVER_TABS: Record<ApiPlatform, PlatformTab[]> = {
  netease: [
    { name: "discover-playlists", label: "歌单广场" },
    { name: "discover-toplists", label: "排行榜" },
    { name: "discover-artists", label: "歌手" },
    { name: "discover-new", label: "最新音乐" },
  ],
  qqmusic: [
    { name: "discover-playlists", label: "歌单广场" },
    { name: "discover-toplists", label: "排行榜" },
    { name: "discover-artists", label: "歌手" },
  ],
  kugou: [{ name: "discover-playlists", label: "歌单广场" }],
};

/**
 * 各平台在收藏页的子页可见性
 *
 * 第三方平台只有「收藏的歌单」有对应数据源。
 */
export const LIKE_TABS: Record<ApiPlatform, PlatformTab[]> = {
  netease: [
    { name: "like-playlists", label: "歌单" },
    { name: "like-albums", label: "专辑" },
    { name: "like-artists", label: "歌手" },
    { name: "like-videos", label: "视频" },
    { name: "like-radios", label: "播客" },
  ],
  qqmusic: [{ name: "like-playlists", label: "歌单" }],
  kugou: [{ name: "like-playlists", label: "歌单" }],
};
