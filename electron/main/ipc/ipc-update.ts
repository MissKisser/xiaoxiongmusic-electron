import { BrowserWindow, app, ipcMain, shell } from "electron";
import { createWriteStream, existsSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import got from "got";
import { updateLog } from "../logger";
import { checkUpdate } from "../update";
import mainWindow from "../windows/main-window";

/** 允许下载的协议 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** 文件名非法字符，统一替换为中划线 */
const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|]/g;

/** 无法从地址解析出文件名时使用的默认名 */
const DEFAULT_INSTALLER_FILENAME = "xiaoxiongmusic-setup.exe";

/** 当前安装包下载任务的中止控制器 */
let downloadAbortController: AbortController | null = null;

/**
 * 从下载地址解析安装包文件名
 *
 * @param url 下载地址
 * @returns 清洗后的文件名；无法解析时返回默认名
 */
const resolveInstallerFileName = (url: string): string => {
  const withoutQuery = (url || "").split(/[?#]/)[0];
  const rawName = withoutQuery.substring(withoutQuery.lastIndexOf("/") + 1);
  let decoded = "";
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    decoded = rawName;
  }
  const cleaned = decoded.replace(ILLEGAL_FILENAME_CHARS, "-").trim();
  return cleaned || DEFAULT_INSTALLER_FILENAME;
};

/**
 * 为安装包生成不冲突的目标路径
 *
 * @param downloadDir 下载目录
 * @param fileName 文件名
 * @returns 最终落盘路径
 */
const resolveTargetPath = async (
  downloadDir: string,
  fileName: string
): Promise<string> => {
  const target = path.join(downloadDir, fileName);
  if (!existsSync(target)) return target;
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(downloadDir, `${base}-${stamp}${ext}`);
};

/**
 * 向渲染端推送下载进度
 *
 * @param win 发起请求的窗口
 * @param payload 进度载荷
 */
const sendProgress = (
  win: BrowserWindow | null,
  payload: {
    percent: number;
    transferredBytes: number;
    totalBytes: number;
    speed: number;
  }
): void => {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("installer-download-progress", payload);
};

/**
 * 处理安装包下载请求：流式下载到本地后直接拉起安装器
 *
 * @param event IPC 调用事件
 * @param url 安装包下载地址
 * @returns 下载结果状态
 */
const downloadInstaller = async (
  event: Electron.IpcMainInvokeEvent,
  url: string
): Promise<{
  status: "success" | "error" | "cancelled";
  filePath?: string;
  message?: string;
}> => {
  const win = BrowserWindow.fromWebContents(event.sender);
  let tempPath: string | null = null;

  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { status: "error", message: "下载地址无效" };
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return { status: "error", message: "不支持的下载地址协议" };
    }

    const downloadDir = app.getPath("downloads");
    const fileName = resolveInstallerFileName(parsed.pathname);
    const finalPath = await resolveTargetPath(downloadDir, fileName);
    tempPath = `${finalPath}.part`;

    const abortController = new AbortController();
    downloadAbortController = abortController;

    const downloadStream = got.stream(url, {
      followRedirect: true,
      retry: { limit: 0 },
      signal: abortController.signal,
    });

    let totalBytes = 0;
    let transferredBytes = 0;
    let lastSentAt = 0;
    let lastSentBytes = 0;

    downloadStream.on("response", (response) => {
      const length = Number(response.headers["content-length"] ?? 0);
      totalBytes = Number.isFinite(length) && length > 0 ? length : 0;
    });

    downloadStream.on("data", (chunk: Buffer) => {
      transferredBytes += chunk.length;
      const now = Date.now();
      const percent =
        totalBytes > 0 ? Math.min(transferredBytes / totalBytes, 1) : 0;
      const elapsed = now - lastSentAt;
      if (elapsed < 200 && percent < 1) return;
      const speed =
        elapsed > 0 ? ((transferredBytes - lastSentBytes) / elapsed) * 1000 : 0;
      lastSentAt = now;
      lastSentBytes = transferredBytes;
      sendProgress(win, {
        percent,
        transferredBytes,
        totalBytes,
        speed,
      });
    });

    const fileStream = createWriteStream(tempPath);
    await pipeline(downloadStream, fileStream);

    await rename(tempPath, finalPath);
    tempPath = null;

    sendProgress(win, {
      percent: 1,
      transferredBytes,
      totalBytes,
      speed: 0,
    });

    const openError = await shell.openPath(finalPath);
    if (openError) {
      return {
        status: "error",
        message: `安装包已下载，但无法启动：${openError}`,
      };
    }

    updateLog.info(`✅ Installer downloaded and launched: ${finalPath}`);
    setTimeout(() => app.quit(), 600);
    return { status: "success", filePath: finalPath };
  } catch (error: any) {
    if (tempPath) {
      await unlink(tempPath).catch(() => {});
    }
    if (error?.name === "AbortError" || error?.code === "ABORT_ERR") {
      return { status: "cancelled", message: "下载已取消" };
    }
    updateLog.error(`❌ Installer download failed: ${error?.message ?? error}`);
    return {
      status: "error",
      message: `下载失败：${error?.message ?? "未知错误"}`,
    };
  } finally {
    downloadAbortController = null;
  }
};

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

  // 下载安装包并在完成后直接拉起安装器
  ipcMain.handle("download-installer", downloadInstaller);

  // 取消进行中的安装包下载
  ipcMain.on("cancel-installer-download", () => {
    downloadAbortController?.abort();
  });
};

export default initUpdateIpc;
