import { defineStore } from "pinia";
import type { ApiPlatform, PlatformProfile } from "@/types/shared";
import type { SongType } from "@/types/main";
import { platformCall } from "@/api/platform/music";
import {
  dispatchLikedSongIds,
  dispatchUserPlaylists,
  type DispatchPlaylist,
} from "@/api/platform/dispatch";

/** 支持的音源平台（网易云走既有 ncm-api 链路，不经平台 IPC 通道） */
export const SUPPORTED_PLATFORMS: ApiPlatform[] = ["netease", "qqmusic", "kugou"];

/** 第三方平台（走平台 IPC 通道的平台） */
export const THIRD_PARTY_PLATFORMS: ApiPlatform[] = ["qqmusic", "kugou"];

/** 平台展示信息 */
export const PLATFORM_META: Record<ApiPlatform, { name: string; short: string }> = {
  netease: { name: "网易云音乐", short: "云" },
  qqmusic: { name: "QQ 音乐", short: "Q" },
  kugou: { name: "酷狗音乐", short: "K" },
};

/** 各平台账号资料 */
export type PlatformProfileMap = Record<ApiPlatform, PlatformProfile | null>;

/** 平台切换事件载荷 */
export interface PlatformChangePayload {
  /** 切换到的平台 */
  platform: ApiPlatform;
  /** 切换前的平台 */
  previous: ApiPlatform;
}

/** 平台切换事件订阅者 */
export type PlatformChangeListener = (payload: PlatformChangePayload) => void;

/** 平台切换事件订阅集合 */
const changeListeners = new Set<PlatformChangeListener>();

/**
 * 进行中的喜欢歌曲装载请求（按平台去重）
 *
 * 同一平台的并发调用共享同一个 Promise，避免重复请求。
 */
interface LikedSongLoad {
  /** 本次装载的令牌，用于丢弃已失效（登出等）的结果 */
  token: object;
  /** 装载请求 */
  promise: Promise<Set<number>>;
}

const likedSongLoads = new Map<ApiPlatform, LikedSongLoad>();

/**
 * 订阅平台切换事件
 *
 * 页面层在「当前平台」变化后据此重新拉取歌单 / 歌曲 / 评论等数据。
 * @param listener 事件订阅者
 * @returns 取消订阅函数
 */
export const onPlatformChange = (listener: PlatformChangeListener): (() => void) => {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
};

/**
 * 广播平台切换事件
 * @param payload 事件载荷
 */
const emitPlatformChange = (payload: PlatformChangePayload): void => {
  for (const listener of changeListeners) {
    try {
      listener(payload);
    } catch (error) {
      console.error("平台切换事件处理失败：", error);
    }
  }
};

/** 主进程 `user_detail` 模块的返回 */
interface PlatformUserDetail {
  code?: number;
  loggedIn?: boolean;
  profile?: PlatformProfile;
  message?: string;
}

interface PlatformState {
  /** 当前平台 */
  currentPlatform: ApiPlatform;
  /** 各平台账号资料 */
  platformProfiles: PlatformProfileMap;
  /** 当前平台的歌单列表（第三方平台维护，网易云沿用既有本地缓存） */
  playlists: {
    /** 自建歌单 */
    owned: DispatchPlaylist[];
    /** 收藏（订阅）歌单 */
    favorites: DispatchPlaylist[];
  };
  /**
   * 各第三方平台的「我喜欢的音乐」曲目 id 集合
   *
   * 红心判据来源：平台「我喜欢的音乐」歌单的曲目集合——
   * 歌单内的曲目判定为已红心，歌单外的曲目判定为未红心。
   * 平台可用时即装载，任意页面都能判定红心状态。
   */
  likedSongIds: Record<string, Set<number>>;
}

/**
 * 音源平台 Store
 *
 * 负责：当前平台的选择与切换、各平台账号资料的读取与缓存、平台登出。
 * 账号凭据始终留在主进程，本 store 只持有非凭据的展示字段。
 */
export const usePlatformStore = defineStore("platform", {
  state: (): PlatformState => ({
    // 当前平台（缺省网易云）
    currentPlatform: "netease",
    // 各平台账号资料
    platformProfiles: {
      netease: null,
      qqmusic: null,
      kugou: null,
    },
    // 当前平台的歌单列表
    playlists: {
      owned: [],
      favorites: [],
    },
    // 各第三方平台的「我喜欢的音乐」曲目 id 集合
    likedSongIds: {},
  }),

  getters: {
    /**
     * 当前平台的账号资料
     */
    currentProfile: (state): PlatformProfile | null =>
      state.platformProfiles[state.currentPlatform],
    /**
     * 已登录的平台列表
     */
    loggedInPlatforms: (state): ApiPlatform[] =>
      THIRD_PARTY_PLATFORMS.filter((platform) => !!state.platformProfiles[platform]),
    /**
     * 判断某首歌在指定第三方平台是否已喜欢
     * @param platform 音源平台
     * @param songId 歌曲 id
     * @returns 是否已喜欢
     */
    isLikedSong:
      (state) =>
      (platform: ApiPlatform, songId: number): boolean => {
        if (platform === "netease") return false;
        const ids = state.likedSongIds[platform];
        return ids ? ids.has(Number(songId)) : false;
      },
  },

  actions: {
    /**
     * 切换当前平台
     *
     * 切换后广播事件，供页面层重新拉取平台数据。
     * @param platform 目标平台
     * @returns 是否发生了实际切换
     */
    switchPlatform(platform: ApiPlatform): boolean {
      if (!SUPPORTED_PLATFORMS.includes(platform)) return false;
      const previous = this.currentPlatform;
      if (previous === platform) return false;
      this.currentPlatform = platform;
      emitPlatformChange({ platform, previous });
      // 目标平台已登录时装载其「我喜欢的音乐」集合，使任意页面的红心状态可判定
      if (this.platformProfiles[platform]) void this.ensureLikedSongs(platform);
      return true;
    },

    /**
     * 确保某平台的「我喜欢的音乐」曲目 id 集合已装载
     *
     * 装载结果写入 store，界面可直接按平台判定红心；
     * 同一平台的并发调用共享同一次请求，不会产生重复请求风暴；
     * 装载失败静默降级（红心显示为未选中），不打断页面渲染。
     * @param platform 音源平台，缺省为当前平台
     * @returns 该平台的喜欢歌曲 id 集合
     */
    async ensureLikedSongs(platform?: ApiPlatform): Promise<Set<number>> {
      const target = platform ?? this.currentPlatform;
      if (target === "netease") return new Set<number>();
      const cached = this.likedSongIds[target];
      if (cached) return cached;
      const inflight = likedSongLoads.get(target);
      if (inflight) return inflight.promise;
      const token = {};
      const promise = dispatchLikedSongIds(target)
        .then((ids) => {
          // 装载期间集合被失效（登出等）时不再写回，避免复活已作废的集合
          if (likedSongLoads.get(target)?.token === token) this.likedSongIds[target] = ids;
          return ids;
        })
        .catch((error) => {
          console.error(`加载${PLATFORM_META[target].name}喜欢歌曲失败：`, error);
          return new Set<number>();
        })
        .finally(() => {
          if (likedSongLoads.get(target)?.token === token) likedSongLoads.delete(target);
        });
      likedSongLoads.set(target, { token, promise });
      return promise;
    },

    /**
     * 用已取回的曲目覆盖某平台的喜欢歌曲缓存
     *
     * 「我喜欢的音乐」页取回曲目后调用，保证缓存与页面数据同源。
     * @param platform 音源平台
     * @param tracks 平台「我喜欢的音乐」的曲目
     */
    setLikedSongs(platform: ApiPlatform, tracks: SongType[]): void {
      if (platform === "netease") return;
      const ids = new Set<number>();
      for (const track of tracks) {
        const id = Number(track.id);
        if (Number.isFinite(id) && id > 0) ids.add(id);
      }
      this.likedSongIds[platform] = ids;
    },

    /**
     * 在缓存里增删一首喜欢歌曲（写操作成功后调用）
     * @param platform 音源平台
     * @param songId 歌曲 id
     * @param liked 是否喜欢
     */
    patchLikedSong(platform: ApiPlatform, songId: number, liked: boolean): void {
      if (platform === "netease") return;
      const ids = this.likedSongIds[platform] ?? new Set<number>();
      if (liked) ids.add(Number(songId));
      else ids.delete(Number(songId));
      this.likedSongIds[platform] = ids;
    },

    /**
     * 失效某平台的喜欢歌曲缓存
     * @param platform 音源平台
     */
    invalidateLikedSongs(platform: ApiPlatform): void {
      if (platform === "netease") return;
      delete this.likedSongIds[platform];
      likedSongLoads.delete(platform);
    },

    /**
     * 刷新指定平台的歌单列表
     *
     * 走歌单数据源分派层；网易云的歌单列表由既有本地缓存维护，此处直接清空。
     * @param platform 音源平台
     * @returns 该平台的自建歌单与收藏歌单
     */
    async refreshPlaylists(
      platform?: ApiPlatform,
    ): Promise<{ owned: DispatchPlaylist[]; favorites: DispatchPlaylist[] }> {
      const target = platform ?? this.currentPlatform;
      if (target === "netease") {
        this.playlists = { owned: [], favorites: [] };
        return this.playlists;
      }
      try {
        this.playlists = await dispatchUserPlaylists(target);
      } catch (error) {
        console.error(`获取 ${PLATFORM_META[target].name}歌单列表失败：`, error);
        this.playlists = { owned: [], favorites: [] };
      }
      return this.playlists;
    },

    /**
     * 刷新指定平台的账号资料
     *
     * 走主进程平台模块 `user_detail`；未登录时把本地资料清空。
     * @param platform 音源平台
     * @returns 平台账号资料，未登录时为 null
     */
    async refreshProfile(platform: ApiPlatform): Promise<PlatformProfile | null> {
      // 网易云的登录态由既有 `/login/status` 链路维护，不经平台 IPC 通道
      if (platform === "netease") return null;
      try {
        const res = await platformCall<PlatformUserDetail>(platform, "user_detail");
        const profile = res?.loggedIn && res.profile ? res.profile : null;
        this.platformProfiles[platform] = profile;
        // 登录态就绪时装载其「我喜欢的音乐」集合，使任意页面的红心状态可判定
        if (profile) void this.ensureLikedSongs(platform);
        return profile;
      } catch (error) {
        console.error(`获取 ${PLATFORM_META[platform].name}账号资料失败：`, error);
        this.platformProfiles[platform] = null;
        return null;
      }
    },

    /**
     * 刷新所有第三方平台的账号资料
     */
    async refreshAllProfiles(): Promise<void> {
      await Promise.all(THIRD_PARTY_PLATFORMS.map((platform) => this.refreshProfile(platform)));
    },

    /**
     * 登出指定平台
     *
     * 清空主进程会话与本地资料；网易云由既有退出登录链路处理。
     * @param platform 音源平台
     */
    async logout(platform: ApiPlatform): Promise<void> {
      if (platform === "netease") return;
      await window.api.platformMusic.clearSession(platform);
      this.platformProfiles[platform] = null;
      // 登出后该平台的喜欢歌曲缓存作废，重新登录时再装载
      this.invalidateLikedSongs(platform);
      if (this.currentPlatform === platform) {
        this.playlists = { owned: [], favorites: [] };
      }
    },
  },

  // 持久化（只存非凭据字段）
  persist: {
    key: "platform-store",
    pick: ["currentPlatform", "platformProfiles"],
  },
});
