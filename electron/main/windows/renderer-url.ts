/**
 * 渲染端地址解析
 *
 * 渲染端可能由开发服务器、静态代理或内嵌服务托管，
 * 所有窗口必须与渲染端同源：按固定端口拼接会在渲染端未托管在该端口时
 * 落到 API 服务上，而 API 服务对渲染端路径只回 404，
 * 窗口显示的是错误页而不是自己的界面。
 */
import { existsSync } from "fs";
import { join } from "path";
import { app } from "electron";
import { defaultRendererUrl, isDev, port } from "../utils/config";
import mainWindow from "./main-window";

/** API 服务地址 */
const apiOrigin = `http://localhost:${port}`;

/**
 * API 服务是否同时托管渲染端静态资源
 *
 * 仅生产构建注册静态文件服务，开发形态下 API 只提供接口，
 * 渲染端页面路径在 API 上必定返回 404。
 */
const apiServesRenderer = !isDev;

/** 加载窗页面路径 */
const loadingPagePath = "/web/loading/index.html";

/**
 * 收集渲染端源地址候选
 *
 * 优先级：主窗口当前所在源 > 渲染端地址（开发服务器或静态代理）> API 服务源。
 * @returns 渲染端源地址候选
 */
const collectRendererOrigins = (): string[] => {
  const origins: string[] = [];
  const collect = (url?: string): void => {
    if (!url) return;
    try {
      const { origin } = new URL(url);
      // about:blank 一类地址没有可用源
      if (!origin || origin === "null") return;
      // 开发形态下 API 服务不托管渲染端资源，不能作为渲染端源
      if (!apiServesRenderer && origin === apiOrigin) return;
      if (!origins.includes(origin)) origins.push(origin);
    } catch {
      // 地址非法，忽略该候选
    }
  };
  try {
    collect(mainWindow.getWin()?.webContents.getURL());
  } catch {
    // 主窗口渲染进程异常时忽略，沿用配置地址
  }
  collect(process.env["ELECTRON_RENDERER_URL"]);
  collect(defaultRendererUrl);
  return origins;
};

/**
 * 解析渲染端源地址
 *
 * @returns 渲染端源地址；无可用渲染端源时返回 null
 */
const resolveRendererOrigin = (): string | null => collectRendererOrigins()[0] ?? null;

/**
 * 拼装渲染端页面地址
 * @param path 渲染端页面路径
 * @param origin 渲染端源地址；缺省时按当前渲染端源解析
 * @returns 渲染端页面地址
 */
export const resolveRendererPageUrl = (path: string, origin?: string): string =>
  `${origin ?? resolveRendererOrigin() ?? apiOrigin}${path}`;

/**
 * 拼装辅助窗口地址
 * @param route 辅助窗口路由
 * @param query 附加查询参数
 * @returns 辅助窗口地址
 */
export const resolveAuxWindowUrl = (route: string, query?: string): string =>
  resolveRendererPageUrl(`/#/${route}${query ? `?${query}` : ""}`);

/**
 * 拼装加载窗页面地址
 *
 * 加载窗先于主窗口创建，取不到主窗口当前源，
 * 因此单独按渲染端源解析；渲染端源不可用时返回 null，交由本地构建产物兜底。
 * @returns 加载窗页面地址；无可用渲染端源时返回 null
 */
export const resolveLoadingPageUrl = (): string | null => {
  const origin = resolveRendererOrigin();
  return origin ? resolveRendererPageUrl(loadingPagePath, origin) : null;
};

/**
 * 解析加载窗本地页面文件
 *
 * 渲染端源不可用时直接加载构建产物，
 * 避免加载窗落到只提供接口的 API 服务上，被 404 响应渲染成白屏。
 * @returns 加载窗本地文件路径；文件不存在时返回 null
 */
export const resolveLoadingPageFile = (): string | null => {
  const appRoot = app.getAppPath();
  const candidates = [
    join(appRoot, "out/renderer/web/loading/index.html"),
    join(appRoot, "web/loading/index.html"),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
};
