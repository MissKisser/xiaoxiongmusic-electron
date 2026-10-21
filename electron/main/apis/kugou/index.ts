/**
 * KG 主进程服务
 *
 * 统一入口：callKugou(name, params)
 */

import { createHash } from "node:crypto";
import { modules } from "./modules";
import type { KGParams } from "./core/types";
import { getSessionCookies, saveSessionCookies } from "../../database/PlatformSessionDB";

export const getKugouSession = (): Record<string, string> => getSessionCookies("kugou");

export const mergeKugouSession = (values: Record<string, string>): void => {
  saveSessionCookies("kugou", { ...getKugouSession(), ...values });
};

export const clearKugouSession = (): void => {
  const session = getKugouSession();
  const device = {
    ...(session.guid ? { guid: session.guid } : {}),
    ...(session.dfid ? { dfid: session.dfid } : {}),
  };
  saveSessionCookies("kugou", device);
};

/** 2 分钟响应缓存 */
const DEFAULT_TTL = 2 * 60 * 1000;
const MAX_ENTRIES = 200;

/**
 * 不缓存的模块
 *
 * - 登录票据类：一次性凭据，缓存后即失效
 * - 账号态类：随登录态变化
 * - 播放地址：播放票据时效短
 * - 评论与搜索：实时性要求高
 * - 排行榜：榜单随期数滚动更新，与 QQ 榜单口径一致，按实时数据取
 * - 热门歌手：歌手热度榜实时变动（`heat` 排序、总数持续漂移），与榜单口径一致，按实时数据取
 * - 刷歌推荐流：实时推荐流，每次调用返回的曲目基本不同，缓存会毁掉「不重样」语义（与 QQ 刷歌一致）
 */
const NON_CACHEABLE = new Set([
  "login_qr_key",
  "login_qr_check",
  "user_detail",
  "user_profile",
  "song_url",
  "comment",
  "search",
  "leaderboard_list",
  "leaderboard_detail",
  "hot_artists",
  "songfm",
]);

interface CacheEntry {
  value: unknown;
  expireAt: number;
}

const cache = new Map<string, CacheEntry>();

const hashParams = (params: unknown): string =>
  createHash("md5")
    .update(JSON.stringify(params ?? {}))
    .digest("hex")
    .slice(0, 8);

const cacheGet = (key: string): unknown => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expireAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
};

const cacheSet = (key: string, value: unknown, ttl = DEFAULT_TTL): void => {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expireAt: Date.now() + ttl });
};

export const clearKugouCache = (): void => {
  cache.clear();
};

/** 可用模块名列表 */
export const listKugouModules = (): string[] => Object.keys(modules);

const isEmptyResult = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.songs) && v.songs.length === 0) return true;
  if (Array.isArray(v.albums) && v.albums.length === 0) return true;
  if (Array.isArray(v.artists) && v.artists.length === 0) return true;
  if (Array.isArray(v.playlists) && v.playlists.length === 0) return true;
  return false;
};

/**
 * 调用任意 KG API
 * @param name - 模块名称（search / lyric）
 * @param params - 业务参数
 * @returns 业务数据
 */
export const callKugou = async <T = unknown>(name: string, params: KGParams = {}): Promise<T> => {
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown kg api: ${name}`);

  if (NON_CACHEABLE.has(name)) return (await fn(params)) as T;

  const key = `${name}|${hashParams(params)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit as T;

  const value = (await fn(params)) as T;
  if (!isEmptyResult(value)) cacheSet(key, value);
  return value;
};
