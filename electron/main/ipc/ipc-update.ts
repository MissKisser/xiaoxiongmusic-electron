import { app, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
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

  // 获取当前安装类型：安装版安装目录内含卸载程序，便携版解压运行目录内没有
  ipcMain.handle("get-install-type", (): "setup" | "portable" => {
    if (!app.isPackaged) return "portable";
    const isSetup = existsSync(path.join(path.dirname(process.execPath), "uninstall.exe"));
    return isSetup ? "setup" : "portable";
  });
};

export default initUpdateIpc;
