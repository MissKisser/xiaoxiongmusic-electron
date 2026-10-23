import type { ColorScheme, RGB, SongLevelDataType } from "@/types/main";
import { QualityType, type SortField, type SortOrder } from "@/types/main";
import { RepeatModeType, ShuffleModeType, type ApiPlatform } from "@/types/shared";
import { isDevBuild } from "@/utils/env";
import { defineStore } from "pinia";

interface StatusState {
  /** 菜单折叠状态 */
  menuCollapsed: boolean;
  /** 移动端侧边栏显示状态 */
  showAside: boolean;
  /** 搜索框状态 */
  searchFocus: boolean;
  /** 搜索框输入值 */
  searchInputValue: string;
  /** 播放控制条 */
  showPlayBar: boolean;
  /** 全屏播放器 */
  showFullPlayer: boolean;
  /** 播放器功能显示 */
  playerMetaShow: boolean;
  /** 播放列表状态 */
  playListShow: boolean;
  /** 播放状态 */
  playStatus: boolean;
  /** 播放加载状态 */
  playLoading: boolean;
  /** 播放速度 */
  playRate: number;
  /** 播放音量 */
  playVolume: number;
  /** 静音前音量 */
  playVolumeMute: number;
  /**
   * 循环模式
   *
   * off: 关闭 | list: 列表循环 | one: 单曲循环
   */
  repeatMode: RepeatModeType;
  /**
   * 随机模式
   *
   * off: 关闭 | on: 随机播放 | heartbeat: 心动模式
   */
  shuffleMode: ShuffleModeType;
  /** 封面主题 */
  songCoverTheme: {
    /** 封面主题颜色 */
    main?: RGB;
    /** 封面主题颜色（亮色） */
    light?: ColorScheme;
    /** 封面主题颜色（暗色） */
    dark?: ColorScheme;
  };
  /** 纯净歌词模式 */
  pureLyricMode: boolean;
  /** 当前是否正使用 TTML 歌词 */
  usingTTMLLyric: boolean;
  /** 当前歌曲音质 */
  songQuality: QualityType | undefined;
  /** 当前播放索引 */
  playIndex: number;
  /** 歌词播放索引 */
  lyricIndex: number;
  /** 歌词加载状态 */
  lyricLoading: boolean;
  /** 当前播放时间 */
  currentTime: number;
  /** 歌曲总时长 */
  duration: number;
  /** 实时播放进度 */
  progress: number;
  /** 每首歌曲的进度偏移（按「平台-歌曲 id」记忆，跨平台同号歌曲互不串用） */
  currentTimeOffsetMap: Record<string, number>;
  /** 是否为解锁歌曲 */
  playUblock: boolean;
  /** 当前使用的解锁源名称（如：netease、kuwo、bodian、migu） */
  unlockSource: string | null;
  /** 主内容高度 */
  mainContentHeight: number;
  /** 列表排序字段 */
  listSortField: SortField;
  /** 列表排序顺序 */
  listSortOrder: SortOrder;
  /** 桌面歌词 */
  showDesktopLyric: boolean;
  /** 任务栏歌词 */
  showTaskbarLyric: boolean;
  /** 播放器评论 */
  showPlayerComment: boolean;
  /** AB 循环 */
  abLoop: {
    enable: boolean;
    pointA: number | null;
    pointB: number | null;
  };
  /** 当前可切换音质列表 */
  availableQualities: SongLevelDataType[];
  /** 自定义背景地址 */
  backgroundImageUrl: string | null;
  /** 背景模式 */
  themeBackgroundMode: "color" | "image" | "video";
  /** 自定义背景配置 */
  backgroundConfig: {
    scale: number;
    maskOpacity: number;
    blur: number;
    themeColor: string | null;
    useCustomColor: boolean;
    isSolid: boolean;
    customColor: string;
  };
  /** 自动混音动效状态 */
  automixFxActive: boolean;
  /** 私人FM模式 */
  personalFmMode: boolean;
  /** 更新检查 */
  updateCheck: boolean;
  /** 均衡器是否开启 */
  eqEnabled: boolean;
  /** 均衡器 10 段增益（dB） */
  eqBands: number[];
  /** 均衡器当前预设 key */
  eqPreset: string;
  /** 自动关闭 */
  autoClose: {
    /** 自动关闭 */
    enable: boolean;
    /** 自动关闭时间（分钟） */
    time: number;
    /** 剩余时长（秒） */
    remainTime: number;
    /** 目标结束时间戳（毫秒） */
    endTime: number;
    /** 等待歌曲结束 */
    waitSongEnd: boolean;
  };
  /** 开发者模式（假） */
  developerMode: boolean;
}

export const useStatusStore = defineStore("status", {
  state: (): StatusState => ({
    menuCollapsed: false,
    showAside: false,
    searchFocus: false,
    searchInputValue: "",
    showPlayBar: true,
    playStatus: false,
    playLoading: true,
    playUblock: false,
    unlockSource: null,
    playListShow: false,
    showFullPlayer: false,
    playerMetaShow: true,
    currentTime: 0,
    duration: 0,
    progress: 0,
    currentTimeOffsetMap: {},
    songCoverTheme: {},
    pureLyricMode: false,
    usingTTMLLyric: false,
    songQuality: undefined,
    playIndex: -1,
    lyricIndex: -1,
    lyricLoading: false,
    playRate: 1,
    playVolume: 0.7,
    playVolumeMute: 0,
    repeatMode: "off",
    shuffleMode: "off",
    personalFmMode: false,
    mainContentHeight: 0,
    listSortField: "default",
    listSortOrder: "default",
    showDesktopLyric: false,
    showTaskbarLyric: false,
    showPlayerComment: false,
    abLoop: {
      enable: false,
      pointA: null,
      pointB: null,
    },
    availableQualities: [],
    backgroundImageUrl: null,
    themeBackgroundMode: "color",
    backgroundConfig: {
      scale: 1,
      maskOpacity: 70,
      blur: 8,
      themeColor: null,
      useCustomColor: false,
      isSolid: false,
      customColor: "#fe7971",
    },
    automixFxActive: false,
    updateCheck: false,
    eqEnabled: false,
    eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    eqPreset: "acoustic",
    autoClose: {
      enable: false,
      time: 30,
      remainTime: 0,
      endTime: 0,
      waitSongEnd: true,
    },
    developerMode: false,
  }),
  getters: {
    // 播放音量图标
    playVolumeIcon(state) {
      const volume = state.playVolume;
      return volume === 0
        ? "VolumeOff"
        : volume < 0.4
          ? "VolumeMute"
          : volume < 0.7
            ? "VolumeDown"
            : "VolumeUp";
    },
    shuffleIcon(state) {
      if (state.shuffleMode === "heartbeat") {
        return "HeartBit";
      }
      return "Shuffle";
    },
    repeatIcon(state) {
      if (state.repeatMode === "one") {
        return "RepeatSong";
      }
      return "Repeat";
    },
    // 音量百分比
    playVolumePercent(state) {
      return Math.round(state.playVolume * 100);
    },
    // 播放器主色
    mainColor(state) {
      const mainColor = state.songCoverTheme?.main;
      if (!mainColor) return "239, 239, 239";
      return `${mainColor.r}, ${mainColor.g}, ${mainColor.b}`;
    },
    /** 是否为开发者模式 */
    isDeveloperMode(state) {
      return state.developerMode || isDevBuild;
    },
    /** 是否正在使用解锁音源 */
    isUnlocked(state) {
      return state.playUblock;
    },
    /** 是否为自定义背景模式 */
    isCustomBackground(state) {
      return state.themeBackgroundMode !== "color" && Boolean(state.backgroundImageUrl);
    },
  },
  actions: {
    triggerAutomixFx() {
      this.automixFxActive = true;
    },
    endAutomixFx() {
      this.automixFxActive = false;
    },
    /**
     * 生成歌曲偏移的存储键
     *
     * 偏移属于「某个平台上的某首歌」：同一串数字在网易云与 QQ 音乐上是两首
     * 不同的歌，偏移必须带平台维度才不会互相串用。
     * @param songId 歌曲 id
     * @param platform 音源平台，缺省按网易云处理
     * @returns 存储键
     */
    buildOffsetKey(songId?: number, platform?: ApiPlatform): string {
      if (!songId) return "";
      return `${platform ?? "netease"}:${songId}`;
    },
    /**
     * 获取指定歌曲的偏移
     * 单位：毫秒
     * @param songId 歌曲 id
     * @param platform 音源平台，缺省按网易云处理
     * @returns 偏移量（毫秒）
     */
    getSongOffset(songId?: number, platform?: ApiPlatform): number {
      const key = this.buildOffsetKey(songId, platform);
      if (!key) return 0;
      const offsetTime = this.currentTimeOffsetMap?.[key] ?? 0;
      return Math.floor(offsetTime * 1000);
    },
    /**
     * 设置指定歌曲的偏移
     * @param songId 歌曲 id
     * @param offset 偏移量（单位：毫秒）
     * @param platform 音源平台，缺省按网易云处理
     */
    setSongOffset(songId?: number, offset: number = 0, platform?: ApiPlatform) {
      const key = this.buildOffsetKey(songId, platform);
      if (!key) return;
      if (!this.currentTimeOffsetMap) this.currentTimeOffsetMap = {};
      // 将毫秒转换为秒存储（保留2位小数）
      const offsetSeconds = offset / 1000;
      const fixed = Number(offsetSeconds.toFixed(2));
      if (fixed === 0) {
        // 为 0 时移除记录，避免占用空间
        delete this.currentTimeOffsetMap[key];
      } else {
        this.currentTimeOffsetMap[key] = fixed;
      }
    },
    /**
     * 调整指定歌曲的偏移（增量）
     * @param songId 歌曲 id
     * @param delta 偏移增量（单位：毫秒，默认 500ms）
     * @param platform 音源平台，缺省按网易云处理
     */
    incSongOffset(songId?: number, delta: number = 500, platform?: ApiPlatform) {
      const key = this.buildOffsetKey(songId, platform);
      if (!key) return;
      const current = this.getSongOffset(songId, platform);
      const next = current + delta;
      if (next === 0) {
        delete this.currentTimeOffsetMap[key];
      } else {
        this.setSongOffset(songId, next, platform);
      }
    },
    /** 重置指定歌曲的偏移为 0 */
    resetSongOffset(songId?: number, platform?: ApiPlatform) {
      const key = this.buildOffsetKey(songId, platform);
      if (!key) return;
      // 直接删除该歌曲记录
      if (this.currentTimeOffsetMap && key in this.currentTimeOffsetMap) {
        delete this.currentTimeOffsetMap[key];
      }
    },
    /**
     * 迁移旧版按裸歌曲 id 记忆的进度偏移
     *
     * 旧数据没有平台维度，一律按网易云归属迁入。
     */
    migrateSongOffsets() {
      if (!this.currentTimeOffsetMap) return;
      const migrated: Record<string, number> = {};
      let changed = false;
      for (const [key, value] of Object.entries(this.currentTimeOffsetMap)) {
        if (key.includes(":")) {
          migrated[key] = value;
          continue;
        }
        migrated[`netease:${key}`] = value;
        changed = true;
      }
      if (changed) this.currentTimeOffsetMap = migrated;
    },
    /**
     * 切换循环模式
     * 顺序: List -> One -> Off -> List
     */
    toggleRepeat() {
      if (this.repeatMode === "list") {
        this.repeatMode = "one";
      } else if (this.repeatMode === "one") {
        this.repeatMode = "off";
      } else {
        this.repeatMode = "list";
      }
    },
    /**
     * 切换随机模式
     * 顺序: Off -> On -> Off
     * @deprecated 心跳模式只能通过菜单开启，不再通过此方法切换
     */
    toggleShuffle() {
      if (this.shuffleMode === "off") {
        this.shuffleMode = "on";
      } else {
        this.shuffleMode = "off";
      }
    },
    /**
     * 设置 EQ 开关
     * @param enabled 是否开启
     */
    setEqEnabled(enabled: boolean) {
      this.eqEnabled = enabled;
    },
    /**
     * 设置 EQ 10 段增益（dB）
     * @param bands 长度 10 的 dB 数组
     */
    setEqBands(bands: number[]) {
      if (Array.isArray(bands) && bands.length === 10) {
        this.eqBands = [...bands];
      }
    },
    /**
     * 设置 EQ 预设名
     */
    setEqPreset(preset: string) {
      this.eqPreset = preset;
    },
    /**
     * 重置播放状态
     */
    resetPlayStatus() {
      this.$patch({
        currentTime: 0,
        duration: 0,
        progress: 0,
        lyricIndex: -1,
        playStatus: false,
        playLoading: false,
        playListShow: false,
        showFullPlayer: false,
        personalFmMode: false,
        playIndex: -1,
        repeatMode: "off",
        shuffleMode: "off",
        listSortField: "default",
        listSortOrder: "default",
      });
    },
    /**
     * 重置平台维度的播放状态
     *
     * 切换平台时调用：正在播放的歌曲、播放进度与歌词位置都只属于旧平台，
     * 整体作废；音量、循环模式、排序方式等用户偏好不受影响。
     */
    resetPlatformPlayStatus() {
      this.$patch({
        currentTime: 0,
        duration: 0,
        progress: 0,
        lyricIndex: -1,
        lyricLoading: false,
        playStatus: false,
        playLoading: false,
        playListShow: false,
        showFullPlayer: false,
        personalFmMode: false,
        playIndex: -1,
      });
    },
  },
  // 持久化
  persist: {
    key: "status-store",
    storage: localStorage,
    pick: [
      "menuCollapsed",
      "currentTime",
      "duration",
      "progress",
      "currentTimeOffsetMap",
      "pureLyricMode",
      "playIndex",
      "playRate",
      "playVolume",
      "playVolumeMute",
      "playSongType",
      "repeatMode",
      "shuffleMode",
      "songCoverTheme",
      "listSortField",
      "listSortOrder",
      "showDesktopLyric",
      "showTaskbarLyric",
      "personalFmMode",
      "abLoop",
      "backgroundImageUrl",
      "themeBackgroundMode",
      "backgroundConfig",
      "autoClose",
      "eqEnabled",
      "eqBands",
      "eqPreset",
      "developerMode",
    ],
  },
});
