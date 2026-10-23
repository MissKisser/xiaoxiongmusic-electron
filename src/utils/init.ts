import { useDataStore, useSettingStore, useShortcutStore, useStatusStore } from "@/stores";
import { initPlatformScope } from "@/stores/platformScope";
import { useEventListener } from "@vueuse/core";
import { watch } from "vue";
import { openUserAgreement } from "@/utils/modal";
import { debounce } from "lodash-es";
import { isElectron } from "./env";
import { usePlayerController } from "@/core/player/PlayerController";
import { mediaSessionManager } from "@/core/player/MediaSessionManager";
import { useDownloadManager } from "@/core/resource/DownloadManager";
import packageJson from "@/../package.json";
import log from "./log";

// 应用初始化时需要执行的操作
const init = async () => {
  // init pinia-data
  const dataStore = useDataStore();
  const statusStore = useStatusStore();
  const settingStore = useSettingStore();
  const shortcutStore = useShortcutStore();

  const player = usePlayerController();
  const downloadManager = useDownloadManager();

  // 检查并执行设置迁移
  settingStore.checkAndMigrate();

  printVersion();

  // 事件监听
  initEventListener();

  // 加载数据
  await dataStore.loadData();

  // 校验平台作用域：丢弃不属于当前平台的持久化队列与播放状态
  await initPlatformScope();

  // 迁移旧版按裸歌曲 id 记忆的进度偏移
  statusStore.migrateSongOffsets();

  // 初始化 MediaSession
  mediaSessionManager.init();

  // 初始化播放器
  player.playSong({
    autoPlay: settingStore.autoPlay,
    seek: settingStore.memoryLastSeek ? statusStore.currentTime : 0,
  });
  // 同步播放模式
  player.playModeSyncIpc();
  // 初始化自动关闭定时器
  if (statusStore.autoClose.enable) {
    const { endTime, time } = statusStore.autoClose;
    const now = Date.now();

    if (endTime > now) {
      // 计算真实剩余时间
      const realRemainTime = Math.ceil((endTime - now) / 1000);
      player.startAutoCloseTimer(time, realRemainTime);
    } else {
      // 定时器已过期，重置状态
      statusStore.autoClose.enable = false;
      statusStore.autoClose.remainTime = time * 60;
      statusStore.autoClose.endTime = 0;
    }
  }

  if (isElectron) {
    // 注册全局快捷键
    shortcutStore.registerAllShortcuts();
    // 初始化下载管理器
    downloadManager.init();
    // 显示窗口
    window.electron.ipcRenderer.send("win-loaded");
    // 显示桌面歌词
    window.electron.ipcRenderer.send("toggle-desktop-lyric", statusStore.showDesktopLyric);

    // Electron 环境：等授权通过后再弹出用户协议和检查更新
    // 避免多个 modal 同时显示导致 focus-trap 冲突
    const { useAuthStore } = await import("@/stores/auth");
    const authStore = useAuthStore();

    const openPostAuthModals = () => {
      // 用户协议
      openUserAgreement();
      // 检查更新
      if (settingStore.checkUpdateOnStart) window.electron.ipcRenderer.send("check-update");
    };

    if (authStore.isAuthorized) {
      // 已授权，直接打开
      openPostAuthModals();
    } else {
      // 未授权，监听授权状态变化
      const unwatch = watch(
        () => authStore.isAuthorized,
        (authorized) => {
          if (authorized) {
            openPostAuthModals();
            unwatch();
          }
        },
      );
    }
  } else {
    // 非 Electron 环境：直接打开用户协议
    openUserAgreement();
  }
};

// 事件监听
const initEventListener = () => {
  // 键盘事件
  useEventListener(window, "keydown", keyDownEvent);
};

// 键盘事件
const keyDownEvent = debounce((event: KeyboardEvent) => {
  const player = usePlayerController();
  const shortcutStore = useShortcutStore();
  const statusStore = useStatusStore();
  const target = event.target as HTMLElement;
  // 排除元素
  const extendsDom = ["input", "textarea"];
  if (extendsDom.includes(target.tagName.toLowerCase())) return;
  event.preventDefault();
  event.stopPropagation();
  // 获取按键信息
  const key = event.code;
  const isCtrl = event.ctrlKey || event.metaKey;
  const isShift = event.shiftKey;
  const isAlt = event.altKey;
  // 循环注册快捷键
  for (const shortcutKey in shortcutStore.shortcutList) {
    const shortcut = shortcutStore.shortcutList[shortcutKey];
    const shortcutParts = shortcut.shortcut.split("+");
    // 标志位
    let match = true;
    // 检查是否包含修饰键
    const hasCmdOrCtrl = shortcutParts.includes("CmdOrCtrl");
    const hasShift = shortcutParts.includes("Shift");
    const hasAlt = shortcutParts.includes("Alt");
    // 检查修饰键匹配
    if (hasCmdOrCtrl && !isCtrl) match = false;
    if (hasShift && !isShift) match = false;
    if (hasAlt && !isAlt) match = false;
    // 如果快捷键定义中没有修饰键，确保没有按下任何修饰键
    if (!hasCmdOrCtrl && !hasShift && !hasAlt) {
      if (isCtrl || isShift || isAlt) match = false;
    }
    // 检查实际按键
    const mainKey = shortcutParts.find(
      (part: string) => part !== "CmdOrCtrl" && part !== "Shift" && part !== "Alt",
    );
    if (mainKey !== key) match = false;
    if (match && shortcutKey) {
      console.log(shortcutKey, `快捷键触发: ${shortcut.name}`);
      switch (shortcutKey) {
        case "playOrPause":
          player.playOrPause();
          break;
        case "playPrev":
          player.nextOrPrev("prev");
          break;
        case "playNext":
          player.nextOrPrev("next");
          break;
        case "volumeUp":
          player.setVolume("up");
          break;
        case "volumeDown":
          player.setVolume("down");
          break;
        case "toggle-desktop-lyric":
          player.toggleDesktopLyric();
          break;
        case "openPlayer":
          // 打开播放界面（任意界面）
          statusStore.showFullPlayer = true;
          break;
        case "closePlayer":
          // 关闭播放界面（仅在播放界面时）
          if (statusStore.showFullPlayer) {
            statusStore.showFullPlayer = false;
          }
          break;
        case "openPlayList":
          // 打开播放列表（任意界面）
          statusStore.playListShow = !statusStore.playListShow;
          break;
        case "searchInPage": {
          // 页内搜索（参考 SPlayer-Next PR #129）：聚焦当前页内首个 data-search-input 标记的输入框
          const el = document.querySelector<HTMLInputElement>("[data-search-input] input");
          if (!el || el.disabled) break;
          el.focus();
          if (document.activeElement !== el) break;
          el.select();
          break;
        }
        default:
          break;
      }
    }
  }
}, 100);

// 版本输出
const printVersion = async () => {
  log.success(`🚀 ${packageJson.version}`, packageJson.productName);
  log.info(`👤 ${packageJson.author}`, packageJson.github);
};

export default init;
