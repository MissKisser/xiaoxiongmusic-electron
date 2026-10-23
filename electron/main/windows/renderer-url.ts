/**
 * 辅助窗口的渲染端地址解析
 *
 * 渲染端可能由开发服务器、静态代理或内嵌服务托管，
 * 辅助窗口必须与主窗口同源：按固定端口拼接会在渲染端未托管在该端口时
 * 落到 API 服务上，而 API 服务对渲染端路径只回 404，
 * 辅助窗口显示的是错误页而不是自己的界面。
 */
import { mainWinUrl, port } from "../utils/config";
import mainWindow from "./main-window";

/**
 * 读取渲染端源地址
 *
 * 以主窗口当前所在源为准（主窗口就是渲染端的宿主），
 * 主窗口不可用时回落到配置的渲染端地址。
 * @returns 渲染端源地址
 */
const resolveRendererOrigin = (): string => {
  const candidates: string[] = [];
  try {
    const currentUrl = mainWindow.getWin()?.webContents.getURL();
    if (currentUrl) candidates.push(currentUrl);
  } catch {
    // 主窗口渲染进程异常时忽略，沿用配置地址
  }
  candidates.push(mainWinUrl);
  for (const candidate of candidates) {
    try {
      const { origin } = new URL(candidate);
      // about:blank 一类地址没有可用源
      if (origin && origin !== "null") return origin;
    } catch {
      continue;
    }
  }
  return `http://localhost:${port}`;
};

/**
 * 拼装渲染端页面地址
 * @param path 渲染端页面路径
 * @returns 渲染端页面地址
 */
export const resolveRendererPageUrl = (path: string): string => `${resolveRendererOrigin()}${path}`;

/**
 * 拼装辅助窗口地址
 * @param route 辅助窗口路由
 * @param query 附加查询参数
 * @returns 辅助窗口地址
 */
export const resolveAuxWindowUrl = (route: string, query?: string): string =>
  `${resolveRendererOrigin()}/#/${route}${query ? `?${query}` : ""}`;
