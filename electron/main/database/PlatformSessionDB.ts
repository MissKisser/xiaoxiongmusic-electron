import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { store } from "../store/settings-accessor";

/**
 * 第三方音源平台账号会话存储
 *
 * 表：platform_sessions(platform PK, cookies JSON, updated_at)
 * - cookies 字段以 JSON 字符串存 Record<string, string>
 * - 表结构与语义对齐上游 SPlayer-Next 的 database/sessions.ts
 *
 * 本表只服务于 QQ 音乐 / 酷狗等第三方平台，与网易云的本地登录体系完全独立。
 */

interface SessionRow {
  platform: string;
  cookies: string;
  updated_at: number;
}

/** 数据库单例，首次访问时惰性创建 */
let db: Database.Database | null = null;

/**
 * 获取数据库连接并确保表存在
 * @returns better-sqlite3 连接
 */
const getDb = (): Database.Database => {
  if (db) return db;

  const base = store.get<string>("cachePath");
  if (!base) throw new Error("cachePath 未配置");
  const dbPath = `${base}/platform-sessions.db`;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_sessions (
      platform TEXT PRIMARY KEY,
      cookies TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
};

/**
 * 读取某平台的 cookies；未登录返回空对象
 * @param platform 音源平台
 * @returns cookie 键值对，未登录时为空对象
 */
export const getSessionCookies = (platform: string): Record<string, string> => {
  const row = getDb()
    .prepare("SELECT cookies FROM platform_sessions WHERE platform = ?")
    .get(platform) as Pick<SessionRow, "cookies"> | undefined;
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.cookies) as Record<string, string>;
    return parsed ?? {};
  } catch {
    return {};
  }
};

/**
 * 整体替换某平台的 cookies（登出传 {} 即可）
 * @param platform 音源平台
 * @param cookies cookie 键值对
 */
export const saveSessionCookies = (
  platform: string,
  cookies: Record<string, string>,
): void => {
  getDb()
    .prepare(
      `INSERT INTO platform_sessions (platform, cookies, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(platform) DO UPDATE SET
         cookies = excluded.cookies,
         updated_at = excluded.updated_at`,
    )
    .run(platform, JSON.stringify(cookies), Date.now());
};

/**
 * 清除某平台的 cookies（登出）
 * @param platform 音源平台
 */
export const clearSessionCookies = (platform: string): void => {
  saveSessionCookies(platform, {});
};
