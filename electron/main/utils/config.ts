import { is } from "@electron-toolkit/utils";
import { app } from "electron";

/**
 * 是否为开发环境
 * @returns boolean
 */
export const isDev = is.dev;

/** 是否为 Windows 系统 */
export const isWin = process.platform === "win32";
/** 是否为 macOS 系统 */
export const isMac = process.platform === "darwin";
/** 是否为 Linux 系统 */
export const isLinux = process.platform === "linux";

/**
 * 软件版本
 * @returns string
 */
export const appVersion = app.getVersion();

/**
 * 程序名称
 * @returns string
 */
export const appName = app.getName() || "SPlayer";

/**
 * 服务器端口
 * @returns number
 */
export const port = Number(import.meta.env["VITE_SERVER_PORT"] || 25884);

/**
 * 默认 AMLL TTML DB Server
 * @returns string
 */
export const defaultAMLLDbServer = "https://amlldb.bikonoo.com/ncm-lyrics/%s.ttml";

/**
 * 默认渲染端地址
 *
 * 开发形态取开发服务器地址，生产形态取 API 服务地址（由其托管渲染端静态资源）。
 * 仅作为渲染端地址解析的兜底候选，不用于直接加载窗口。
 * @returns string
 */
export const defaultRendererUrl =
  isDev && process.env["ELECTRON_RENDERER_URL"]
    ? process.env["ELECTRON_RENDERER_URL"]
    : `http://localhost:${port}`;
