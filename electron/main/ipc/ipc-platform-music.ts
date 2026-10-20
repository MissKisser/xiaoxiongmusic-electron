/**
 * 第三方音源平台 IPC
 *
 * 与网易云的 ncm-api 体系完全隔离：独立通道前缀 `platformMusic:`，
 * 不注册到任何既有通道，不改动网易云相关的 IPC 与 preload 暴露。
 *
 * 通道：
 * - platformMusic:call(platform, name, params)  调用平台接口
 * - platformMusic:clearSession(platform)        清空登录态
 * - platformMusic:setCookie(platform, cookie)   手动写入 Cookie
 * - platformMusic:listModules(platform)         列出可用模块
 */

import { ipcMain } from "electron";
import { callQQMusic, clearQQMusicCookies, listQQMusicModules } from "../apis/qqmusic";
import { callKugou, clearKugouSession, listKugouModules } from "../apis/kugou";
import { coreLog } from "../logger";
import type { ApiPlatform } from "@shared";

/** 支持的平台（网易云走既有 ncm-api，不在本通道内） */
const SUPPORTED: ApiPlatform[] = ["qqmusic", "kugou"];

/**
 * 解析 cookie 字符串为键值对
 * @param raw 形如 `key=xxx; key2=yyy` 的 cookie 字符串
 * @returns cookie 键值对
 */
const cookieToJson = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of String(raw ?? "").split(";")) {
    const seg = part.trim();
    if (!seg) continue;
    const idx = seg.indexOf("=");
    if (idx <= 0) continue;
    const name = seg.slice(0, idx).trim();
    const value = seg.slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
};

/**
 * 初始化第三方音源平台 IPC
 */
export const initPlatformMusicIpc = (): void => {
  ipcMain.handle(
    "platformMusic:call",
    async (_evt, platform: ApiPlatform, name: string, params?: Record<string, unknown>) => {
      try {
        if (platform === "qqmusic") {
          const data = await callQQMusic(name, params ?? {});
          return { ok: true, data };
        }
        if (platform === "kugou") {
          const data = await callKugou(name, params ?? {});
          return { ok: true, data };
        }
        return { ok: false, error: `本通道暂不支持平台: ${platform}` };
      } catch (err) {
        coreLog.warn(`[platformMusic] ${platform}.${name} failed:`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("platformMusic:clearSession", (_evt, platform: ApiPlatform) => {
    if (platform === "qqmusic") clearQQMusicCookies();
    if (platform === "kugou") clearKugouSession();
  });

  ipcMain.handle("platformMusic:setCookie", (_evt, platform: ApiPlatform, raw: string) => {
    const parsed = cookieToJson(raw);
    if (platform === "qqmusic") {
      if (!parsed.uin && !parsed.wxuin && !parsed.p_uin && !parsed.qm_keyst && !parsed.qqmusic_key) {
        return { ok: false, error: "缺少 uin 或 key 字段" };
      }
      return { ok: true };
    }
    return { ok: false, error: `本通道暂不支持平台: ${platform}` };
  });

  ipcMain.handle("platformMusic:listModules", (_evt, platform: ApiPlatform) => {
    if (platform === "qqmusic") return { ok: true, modules: listQQMusicModules() };
    if (platform === "kugou") return { ok: true, modules: listKugouModules() };
    return { ok: true, modules: [] };
  });
};

export { SUPPORTED as PLATFORM_MUSIC_SUPPORTED };
export default initPlatformMusicIpc;
