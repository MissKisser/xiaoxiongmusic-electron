import { BrowserWindow } from "electron";
import { createWindow } from "./index";
import { resolveLoadingPageFile, resolveLoadingPageUrl } from "./renderer-url";
import { windowsLog } from "../logger";

/** 加载失败后的最大重试次数 */
const MAX_LOAD_RETRIES = 3;

/** 加载失败后的重试间隔（毫秒） */
const LOAD_RETRY_DELAY = 500;

class LoadWindow {
  private win: BrowserWindow | null = null;
  /** 已执行的重试次数 */
  private retryCount = 0;
  /** 是否改用本地构建产物加载 */
  private useLocalPage = false;
  /**
   * 加载页面
   *
   * 优先加载与主窗口同源的渲染端地址，
   * 渲染端源不可用时回落到本地构建产物，避免落到只提供接口的 API 服务上。
   */
  private load(): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.useLocalPage) {
      const localFile = resolveLoadingPageFile();
      if (localFile) {
        windowsLog.info(`加载窗地址: ${localFile}`);
        this.win.loadFile(localFile);
        return;
      }
      // 本地构建产物缺失，退回渲染端地址
      this.useLocalPage = false;
    }
    const pageUrl = resolveLoadingPageUrl();
    if (pageUrl) {
      windowsLog.info(`加载窗地址: ${pageUrl}`);
      this.win.loadURL(pageUrl);
      return;
    }
    const localFile = resolveLoadingPageFile();
    if (localFile) {
      windowsLog.info(`加载窗地址: ${localFile}`);
      this.win.loadFile(localFile);
      return;
    }
    windowsLog.error("加载窗缺少可用页面来源");
  }
  /**
   * 主窗口事件
   * @returns void
   */
  private event(): void {
    if (!this.win) return;
    // 准备好显示
    this.win.on("ready-to-show", () => {
      this.win?.show();
    });
    // 页面加载失败时重试：渲染端服务在启动瞬间可能尚未就绪，
    // 加载窗停在空白页会让用户看到一扇常驻置顶的空窗口
    this.win.webContents.on(
      "did-fail-load",
      (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        // -3 ABORTED 多为主动跳转，忽略
        if (errorCode === -3) return;
        if (this.retryCount >= MAX_LOAD_RETRIES) {
          windowsLog.error("加载窗加载失败，已达最大重试次数");
          return;
        }
        this.retryCount++;
        // 渲染端地址加载不通时改用本地构建产物，保证加载窗始终有内容
        this.useLocalPage = true;
        windowsLog.warn(`加载窗加载失败，${LOAD_RETRY_DELAY}ms 后第 ${this.retryCount} 次重试`);
        setTimeout(() => this.load(), LOAD_RETRY_DELAY);
      },
    );
  }
  /**
   * 创建窗口
   * @returns BrowserWindow | null
   */
  create(): BrowserWindow | null {
    this.win = createWindow({
      width: 800,
      height: 560,
      maxWidth: 800,
      maxHeight: 560,
      resizable: false,
      alwaysOnTop: true,
      // 不在任务栏显示
      skipTaskbar: true,
      // 窗口不能最小化
      minimizable: false,
      // 窗口不能最大化
      maximizable: false,
      // 窗口不能进入全屏状态
      fullscreenable: false,
      show: false,
    });
    if (!this.win) return null;
    // 加载地址
    this.load();
    // 窗口事件
    this.event();
    return this.win;
  }
  /**
   * 获取窗口
   * @returns BrowserWindow | null
   */
  getWin(): BrowserWindow | null {
    return this.win;
  }
}

export default new LoadWindow();
