import { ipcMain, shell } from "electron";
import { checkUpdate } from "../update";
import mainWindow from "../windows/main-window";

const initUpdateIpc = () => {
  // 检查更新
  ipcMain.on("check-update", (_event, showTip) => {
    const mainWin = mainWindow.getWin();
    if (!mainWin) return;
    checkUpdate(mainWin, showTip);
  });

  // 打开下载链接（在系统浏览器中）
  ipcMain.on("open-download-url", (_event, url: string) => {
    if (url) shell.openExternal(url);
  });
};

export default initUpdateIpc;
