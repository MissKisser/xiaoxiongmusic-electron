/**
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 */
import { app, ipcMain } from "electron";
import os from "os";
import { promises as fs } from "fs";
import { join } from "path";
import { ipcLog } from "../logger";
import { CacheService } from "../services/CacheService";
import type { EnvironmentInfo } from "@shared";

/**
 * 递归计算目录总大小（字节）
 * @param dirPath 目录路径
 * @returns 目录总大小（字节）
 */
const getDirSize = async (dirPath: string): Promise<number> => {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += await getDirSize(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          total += stat.size;
        }
      }),
    );
  } catch (error) {
    // 忽略无法访问的目录
    ipcLog.warn(`⚠️ Failed to read directory size: ${dirPath} - ${error}`);
  }
  return total;
};

/**
 * 初始化环境信息 IPC 通信
 * @returns void
 */
const initEnvIpc = (): void => {
  // 获取环境信息（应用版本、Electron/Chrome/Node 版本、磁盘占用、缓存大小等）
  ipcMain.handle("get-environment-info", async (): Promise<EnvironmentInfo> => {
    const cacheService = CacheService.getInstance();
    const userDataPath = app.getPath("userData");

    // 并行计算磁盘占用与缓存大小
    const [diskUsage, cacheSize] = await Promise.all([
      getDirSize(userDataPath),
      cacheService.getSize(),
    ]);

    ipcLog.info("📋 Environment info requested");

    return {
      appVersion: app.getVersion(),
      appName: app.getName(),
      platform: process.platform,
      arch: process.arch,
      osType: os.type(),
      osRelease: os.release(),
      electronVersion: process.versions.electron ?? "",
      chromeVersion: process.versions.chrome ?? "",
      nodeVersion: process.versions.node ?? "",
      v8Version: process.versions.v8 ?? "",
      diskUsage,
      cacheSize,
    };
  });
};

export default initEnvIpc;
