import { type BrowserWindow } from "electron";
import { updateLog } from "../logger";
import https from "https";
import http from "http";
import { app } from "electron";

// Server API 地址（构建期由 .env 的 VITE_SERVER_URL 静态注入，不做硬编码兜底）
const SERVER_URL = String(process.env.VITE_SERVER_URL || "");

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

// HTTP GET 请求，超时后中止请求并视为失败
const httpGet = (url: string, timeout: number = 10000): Promise<any> => {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Failed to parse response"));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => {
      req.destroy(new Error("Request timeout"));
    });
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
    // 启动时的静默检查失败不打扰用户，仅在手动检查时提示
    if (isShowTip) {
      win.webContents.send("update-error", err);
    }
    updateLog.error(`❌ Update check error: ${err.message}`);
  }
};
