import { BrowserWindow, shell, app } from "electron";
import { createWindow } from "./index";
import { mainWinUrl } from "../utils/config";
import { useStore } from "../store";
import { isLinux, isWin } from "../utils/config";
import { processLog } from "../logger";
import { loadNativeModule } from "../utils/native-loader";

const tools = loadNativeModule("tools.node", "tools");

/** 渲染进程崩溃后允许连续自动恢复的最大次数 */
const MAX_RECOVER_ATTEMPTS = 3;
/** 距上次崩溃超过该时间窗（毫秒）后重置恢复计数 */
const RECOVER_RESET_WINDOW = 5 * 60 * 1000;
/** 渲染进程无响应持续超过该时长（毫秒）后触发恢复 */
const UNRESPONSIVE_TIMEOUT = 15 * 1000;
/** 页面加载成功后需稳定存活该时长（毫秒）才重置恢复计数 */
const STABLE_RESET_DELAY = 30 * 1000;

class MainWindow {
  private win: BrowserWindow | null = null;
  private winURL: string;
  private isQuitting: boolean = false;
  /** 本轮已执行的自动恢复次数 */
  private recoverAttempts = 0;
  /** 最近一次渲染进程异常时间戳 */
  private lastGoneAt = 0;
  /** 恢复重载定时器 */
  private recoverTimer: NodeJS.Timeout | null = null;
  /** 无响应检测定时器 */
  private unresponsiveTimer: NodeJS.Timeout | null = null;
  /** 稳定存活判定定时器 */
  private stableTimer: NodeJS.Timeout | null = null;
  constructor() {
    this.winURL = mainWinUrl;

    app.on("before-quit", () => {
      this.isQuitting = true;
    });
  }
  /**
   * 保存窗口大小和状态
   */
  private saveBounds() {
    if (this.win?.isFullScreen()) return;
    const store = useStore();
    const bounds = this.win?.getBounds();
    if (bounds) {
      const maximized = this.win?.isMaximized();
      const windowState = store.get("window");
      store.set("window", { ...windowState, ...bounds, maximized });
    }
  }
  /**
   * 渲染进程异常后重新载入页面
   * 采用限次 + 退避策略，避免持续崩溃时陷入重载循环
   */
  private recover(reason: string) {
    if (!this.win || this.win.isDestroyed() || this.isQuitting) return;

    const now = Date.now();
    // 超出时间窗视为新一轮故障，重置计数
    if (now - this.lastGoneAt > RECOVER_RESET_WINDOW) {
      this.recoverAttempts = 0;
    }
    this.lastGoneAt = now;
    this.recoverAttempts++;

    if (this.recoverAttempts > MAX_RECOVER_ATTEMPTS) {
      processLog.error(`渲染进程反复异常，已停止自动恢复: ${reason}`);
      return;
    }

    // 指数退避：500ms / 1000ms / 2000ms
    const delay = 500 * 2 ** (this.recoverAttempts - 1);
    processLog.warn(
      `渲染进程异常（${reason}），${delay}ms 后第 ${this.recoverAttempts} 次自动恢复`,
    );
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      if (!this.win || this.win.isDestroyed() || this.isQuitting) return;
      this.win.webContents.reloadIgnoringCache();
    }, delay);
  }
  /**
   * 清理恢复相关定时器
   */
  private clearRecoverTimers() {
    if (this.recoverTimer) {
      clearTimeout(this.recoverTimer);
      this.recoverTimer = null;
    }
    if (this.unresponsiveTimer) {
      clearTimeout(this.unresponsiveTimer);
      this.unresponsiveTimer = null;
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }
  /**
   * 渲染进程健康状态监听
   * 闲置期间渲染帧被销毁后，窗口仍存活但内容为空，需主动重建
   */
  private watchRendererHealth(): void {
    if (!this.win) return;
    const contents = this.win.webContents;

    // 渲染进程退出：崩溃 / OOM / 被系统回收
    contents.on("render-process-gone", (_event, details) => {
      processLog.error(`渲染进程退出: ${details.reason} (exitCode=${details.exitCode})`);
      // 正常关闭不处理
      if (details.reason === "clean-exit" || this.isQuitting) return;
      this.recover(`render-process-gone:${details.reason}`);
    });

    // 页面加载失败（本地服务未就绪、网络中断等）
    contents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // 仅主框架失败才需重载，子框架/资源失败不影响页面本体
        if (!isMainFrame) return;
        // -3 ABORTED 多为主动跳转，忽略
        if (errorCode === -3 || this.isQuitting) return;
        processLog.error(`页面加载失败: ${errorCode} ${errorDescription} ${validatedURL}`);
        this.recover(`did-fail-load:${errorCode}`);
      },
    );

    // 渲染进程无响应：持续超时后强制重载
    this.win.on("unresponsive", () => {
      processLog.warn("渲染进程无响应，等待超时判定");
      if (this.unresponsiveTimer) clearTimeout(this.unresponsiveTimer);
      this.unresponsiveTimer = setTimeout(() => {
        this.unresponsiveTimer = null;
        this.recover("unresponsive");
      }, UNRESPONSIVE_TIMEOUT);
    });
    this.win.on("responsive", () => {
      if (this.unresponsiveTimer) {
        clearTimeout(this.unresponsiveTimer);
        this.unresponsiveTimer = null;
      }
      // 恢复响应说明页面仍存活，重置计数
      this.recoverAttempts = 0;
    });

    // 加载成功后延迟重置计数：需稳定存活一段时间才算真正恢复，
    // 避免「加载完成即崩溃」绕过限次形成重载循环
    contents.on("did-finish-load", () => {
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.stableTimer = setTimeout(() => {
        this.stableTimer = null;
        this.recoverAttempts = 0;
      }, STABLE_RESET_DELAY);
    });

    // 窗口销毁时清理定时器
    this.win.on("closed", () => {
      this.clearRecoverTimers();
    });

    // 任何路径唤起（托盘点击、任务栏、IPC、activate）均校验渲染帧，
    // 空壳窗口需重建内容
    this.win.on("show", () => {
      if (contents.isDestroyed() || contents.isLoading()) return;
      void this.isRendererAlive().then((alive) => {
        if (!alive) {
          processLog.warn("主窗口唤起时检测到渲染帧不可用，触发恢复");
          this.recover("show-dead-frame");
        }
      });
    });
  }
  /**
   * 主窗口事件
   * @returns void
   */
  private event(): void {
    if (!this.win) return;
    const store = useStore();
    // 配置网络代理
    if (store.get("proxy")) {
      this.win.webContents.session.setProxy({ proxyRules: store.get("proxy") });
    }

    // 窗口打开处理程序
    this.win.webContents.setWindowOpenHandler((details) => {
      const { url } = details;
      if (url.startsWith("https://") || url.startsWith("http://")) {
        shell.openExternal(url);
      }
      return { action: "deny" };
    });

    // 拦截页面导航
    this.win.webContents.on("will-navigate", (event, url) => {
      // 检查是否为图片文件（通过扩展名简单判断）
      const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];
      const isImage = imageExtensions.some((ext) => url.toLowerCase().split("?")[0].endsWith(ext));

      // 如果是图片，阻止导航并下载
      if (isImage) {
        event.preventDefault();
        this.win?.webContents.downloadURL(url);
      }
    });
    // 窗口显示时
    this.win?.on("show", () => {
      this.win?.webContents.send("lyricsScroll");
    });
    // 窗口获得焦点时
    this.win?.on("focus", () => {
      this.saveBounds();
    });
    // 窗口大小改变时
    this.win?.on("resized", () => {
      // 若处于全屏则不保存
      if (this.win?.isFullScreen()) return;
      this.saveBounds();
    });
    // 窗口位置改变时
    this.win?.on("moved", () => {
      this.saveBounds();
    });
    // 窗口最大化时
    this.win?.on("maximize", () => {
      this.saveBounds();
      this.win?.webContents.send("win-state-change", true);
    });
    // 窗口取消最大化时
    this.win?.on("unmaximize", () => {
      this.saveBounds();
      this.win?.webContents.send("win-state-change", false);
    });
    // Linux 无法使用 resized 和 moved
    if (isLinux) {
      this.win?.on("resize", () => {
        // 若处于全屏则不保存
        if (this.win?.isFullScreen()) return;
        this.saveBounds();
      });
      this.win?.on("move", () => {
        this.saveBounds();
      });
    }
    // 窗口关闭
    this.win?.on("close", (event) => {
      if (this.isQuitting) {
        return;
      }
      event.preventDefault();
      this.win?.hide();
    });
  }
  /**
   * 创建窗口
   * @returns BrowserWindow | null
   */
  create(): BrowserWindow | null {
    const store = useStore();
    const { width, height, useBorderless = true } = store.get("window");
    this.win = createWindow({
      // 菜单栏
      titleBarStyle: useBorderless ? "customButtonsOnHover" : "default",
      frame: !useBorderless,
      width,
      height,
      minHeight: 600,
      minWidth: 800,
      show: false,
    });
    if (!this.win) return null;
    // 加载地址
    this.win.loadURL(this.winURL);
    // 移除 F12 快捷键处理

    // 窗口事件
    this.event();
    // 渲染进程健康监听
    this.watchRendererHealth();

    // 监听 Explorer 重启
    if (isWin && tools && this.win) {
      try {
        const msgId = tools.getTaskbarCreatedMessageId();
        if (msgId > 0) {
          this.win.hookWindowMessage(msgId, () => {
            // 监听到资源管理器重启
            app.emit("explorer-restarted");
          });
        }
      } catch (e) {
        // 监听资源管理器重启时失败
      }
    }

    return this.win;
  }
  /**
   * 获取窗口
   * @returns BrowserWindow | null
   */
  getWin(): BrowserWindow | null {
    if (this.win && !this.win.isDestroyed()) {
      return this.win;
    }
    return null;
  }
  /**
   * 探测渲染帧是否可用
   * 渲染进程存活但帧被销毁（如 GPU 进程崩溃）时不会触发 render-process-gone，
   * 需在唤起时主动探测
   * @returns 渲染帧是否可用
   */
  private async isRendererAlive(): Promise<boolean> {
    if (!this.win || this.win.isDestroyed()) return false;
    const contents = this.win.webContents;
    if (contents.isDestroyed()) return false;
    try {
      // 附加超时保护，避免渲染进程挂死时探测本身被无限阻塞
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("renderer ping timeout")), 2000),
      );
      const result = await Promise.race([
        contents.executeJavaScript("document.readyState"),
        timeout,
      ]);
      return result === "complete" || result === "interactive";
    } catch {
      return false;
    }
  }
  /**
   * 显示主窗口
   * 渲染帧健康校验统一在 show 事件中处理
   */
  showWindow() {
    if (!this.win) return;
    this.win.show();
    if (this.win.isMinimized()) this.win.restore();
    this.win.focus();
  }
}
export default new MainWindow();
