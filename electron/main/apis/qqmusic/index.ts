/**
 * QM 主进程服务
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 统一入口：callQQMusic(name, params)
 * 与网易云的 ncm-api 体系完全独立，不共用任何调用链。
 */

import { createHash } from "node:crypto";
import { clearQQMusicCookies, mergeQQMusicCookies } from "./core/request";
import { login_qr_check, login_qr_key } from "./modules/login_qr";
import user_detail from "./modules/user_detail";
import {
  playlist_detail,
  playlist_edit_info,
  song_detail,
  subscription_status,
  user_liked_songs,
  user_playlist_list,
} from "./modules/user_playlist";
import {
  playlist_create,
  playlist_delete,
  playlist_rename,
  playlist_subscribe,
  playlist_tracks,
} from "./modules/playlist_write";
import { song_url } from "./modules/song_url";
import { lyric } from "./modules/lyric";
import { comment } from "./modules/comment";
import { search } from "./modules/search";
import { match } from "./modules/match";
import { hot_search } from "./modules/hot_search";
import { leaderboard } from "./modules/leaderboard";
import { song_info } from "./modules/song_info";
import { song_list } from "./modules/song_list";
import { album } from "./modules/album";
import { artist } from "./modules/artist";
import type { QMParams } from "./core/types";

export { clearQQMusicCookies, mergeQQMusicCookies };

/** 2 分钟响应缓存 */
const DEFAULT_TTL = 2 * 60 * 1000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  value: unknown;
  expireAt: number;
}

const cache = new Map<string, CacheEntry>();

/** 不缓存的实时接口（含全部登录态与写操作接口） */
const NON_CACHEABLE: ReadonlySet<string> = new Set([
  "user_detail",
  "song_url",
  "comment",
  "search",
  "hot_search",
  "login_qr_key",
  "login_qr_check",
  "user_playlist_list",
  "user_liked_songs",
  "subscription_status",
  "playlist_detail",
  "playlist_edit_info",
  "playlist_create",
  "playlist_rename",
  "playlist_delete",
  "playlist_tracks",
  "playlist_subscribe",
]);

const modules: Record<string, (params: QMParams) => Promise<unknown>> = {
  login_qr_key,
  login_qr_check,
  user_detail,
  user_playlist_list,
  user_liked_songs,
  song_detail,
  subscription_status,
  playlist_detail,
  playlist_edit_info,
  playlist_create,
  playlist_rename,
  playlist_delete,
  playlist_tracks,
  playlist_subscribe,
  song_url,
  lyric,
  comment,
  search,
  match,
  hot_search,
  leaderboard,
  song_info,
  song_list,
  album,
  artist,
};

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

export const clearQQMusicCache = (): void => {
  cache.clear();
};

/**
 * 调用任意 QM API
 * @param name 模块名，见 modules 注册表
 * @param params 业务参数
 * @returns 业务数据
 */
export const callQQMusic = async (name: string, params: QMParams = {}): Promise<any> => {
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown qm api: ${name}`);

  if (NON_CACHEABLE.has(name)) return fn(params);

  const key = `${name}|${hashParams(params)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const value = await fn(params);
  cacheSet(key, value);
  return value;
};

/** 可用模块名列表 */
export const listQQMusicModules = (): string[] => Object.keys(modules);
