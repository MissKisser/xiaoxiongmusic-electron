// 渲染进程日志 IPC 处理
import { ipcMain } from "electron";
import { rendererLog } from "../logger";

type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * 初始化渲染进程日志 IPC
 */
const initRendererLogIpc = (): void => {
  ipcMain.on("renderer-log", (_event, level: LogLevel, message: string, args: unknown[]) => {
    const logMethod = rendererLog[level];
    if (typeof logMethod === "function") {
      if (args && args.length > 0) {
        logMethod(message, ...args);
      } else {
        logMethod(message);
      }
    }
  });
};

export default initRendererLogIpc;
