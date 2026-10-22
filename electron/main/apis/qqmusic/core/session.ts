/**
 * QM 会话持有者
 *
 * 运行时会话以内存为准、落库为准：登录与登出都同时更新内存副本与数据库，
 * 账号标识也由此统一解析——缓存维度与请求维度共用同一份会话数据，
 * 不会出现「缓存按新账号、请求按旧账号」的错位。
 */

import {
  clearSessionCookies,
  getSessionCookies,
  saveSessionCookies,
} from "../../../database/PlatformSessionDB";

/** 内存会话副本（null 表示尚未从数据库载入） */
let session: Record<string, string> | null = null;

/**
 * 读取当前 QM 会话
 * @returns 会话字段；未登录时为空对象
 */
export const getQQMusicSession = (): Record<string, string> => {
  if (session !== null) return session;
  session = getSessionCookies("qqmusic");
  return session;
};

/**
 * 覆盖当前 QM 会话并落库
 * @param cookies 新的会话字段
 * @returns 落库后的会话字段
 */
export const setQQMusicSession = (cookies: Record<string, string>): Record<string, string> => {
  session = { ...cookies };
  saveSessionCookies("qqmusic", session);
  return session;
};

/**
 * 合并当前 QM 会话并落库
 * @param cookies 待合并的会话字段
 * @returns 合并后的会话字段
 */
export const mergeQQMusicSession = (cookies: Record<string, string>): Record<string, string> => {
  session = { ...getQQMusicSession(), ...cookies };
  saveSessionCookies("qqmusic", session);
  return session;
};

/**
 * 清空当前 QM 会话并落库
 */
export const resetQQMusicSession = (): void => {
  session = {};
  clearSessionCookies("qqmusic");
};
