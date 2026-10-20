import { defineStore } from "pinia";
import type { ApiPlatform, PlatformProfile } from "@/types/shared";
import { platformCall } from "@/api/platform/music";

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
      return true;
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
    },
  },

  // 持久化（只存非凭据字段）
  persist: {
    key: "platform-store",
    pick: ["currentPlatform", "platformProfiles"],
  },
});
