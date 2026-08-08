import { isMac } from "../utils/config";
import initFileIpc from "./ipc-file";
import initLyricIpc from "./ipc-lyric";
import { initMacStatusBarIpc } from "./ipc-mac-statusbar";
import initShortcutIpc from "./ipc-shortcut";
import initStoreIpc from "./ipc-store";
import initSystemIpc from "./ipc-system";
import initTaskbarIpc from "./ipc-taskbar";
import initThumbarIpc from "./ipc-thumbar";
import initTrayIpc from "./ipc-tray";
import initUpdateIpc from "./ipc-update";
import initWindowsIpc from "./ipc-window";
import initProtocolIpc from "./ipc-protocol";
import initCacheIpc from "./ipc-cache";
import initSocketIpc from "./ipc-socket";
import initMediaIpc from "./ipc-media";
import initMpvIpc from "./ipc-mpv";
import initRendererLogIpc from "./ipc-renderer-log";
// Based on SPlayer-Next
import initEnvIpc from "./ipc-env";

/**
 * 初始化全部 IPC 通信
 * @returns void
 */
const initIpc = (): void => {
  initSystemIpc();
  initWindowsIpc();
  initUpdateIpc();
  initFileIpc();
  initTrayIpc();
  initLyricIpc();
  initStoreIpc();
  initThumbarIpc();
  initShortcutIpc();
  initProtocolIpc();
  initCacheIpc();
  initSocketIpc();
  initMediaIpc();
  initMpvIpc();
  initRendererLogIpc();
  initEnvIpc();
  if (isMac) {
    initMacStatusBarIpc();
  } else {
    initTaskbarIpc();
  }
};

export default initIpc;
