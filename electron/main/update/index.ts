import { type BrowserWindow } from "electron";
import { updateLog } from "../logger";
import https from "https";
import http from "http";
import { app } from "electron";

// Server API 地址
const SERVER_URL = "https://music.viaxv.top";

// 获取当前平台
const getPlatform = (): string => {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    default:
      return process.platform;
  }
};

// 是否提示
let isShowTip: boolean = false;

// HTTP GET 请求
const httpGet = (url: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Failed to parse response"));
          }
        });
      })
      .on("error", reject);
  });
};

// 检查更新
export const checkUpdate = async (win: BrowserWindow, showTip: boolean = false) => {
  isShowTip = showTip;
  try {
    const currentVersion = app.getVersion();
    const platform = getPlatform();
    const url = `${SERVER_URL}/api/version/check?platform=${platform}&version=${currentVersion}`;

    updateLog.info(`🔍 Checking for updates: ${url}`);
    const result = await httpGet(url);

    if (!result.success) {
      throw new Error(result.message || "Server error");
    }

    if (result.hasUpdate && result.data) {
      // 有新版本
      win.webContents.send("update-available", result.data);
      updateLog.info(`🚀 New version available: ${result.data.version}`);
    } else {
      // 无更新
      if (isShowTip) {
        win.webContents.send("update-not-available", { version: currentVersion });
      }
      updateLog.info(`✅ No new version available, current: ${currentVersion}`);
    }
  } catch (err: any) {
    win.webContents.send("update-error", err);
    updateLog.error(`❌ Update check error: ${err.message}`);
  }
};
