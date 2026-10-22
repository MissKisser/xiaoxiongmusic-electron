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

import { clearQQMusicCookies, mergeQQMusicCookies, replaceQQMusicCookies } from "./core/request";
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
import { leaderboard, leaderboard_detail, leaderboard_list } from "./modules/leaderboard";
import { song_info } from "./modules/song_info";
import { song_list } from "./modules/song_list";
import { songfm } from "./modules/songfm";
import { album } from "./modules/album";
import { artist } from "./modules/artist";
import type { QMParams } from "./core/types";
import {
  buildCacheKey,
  cacheGet,
  cacheSet,
  clearCache,
  resolveAccountId,
  syncAccountScope,
} from "./core/cache";
import { getQQMusicSession } from "./core/session";
import { coreLog } from "../../logger";

export { clearQQMusicCookies, mergeQQMusicCookies, replaceQQMusicCookies };

/** 2 分钟响应缓存 */
const DEFAULT_TTL = 2 * 60 * 1000;

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
  "leaderboard_list",
  "leaderboard_detail",
  "songfm",
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
  leaderboard_list,
  leaderboard_detail,
  song_info,
  song_list,
  songfm,
  album,
  artist,
};

export const clearQQMusicCache = (): void => {
  clearCache();
};

/**
 * 构造账号维度的缓存键
 *
 * 账号标识取当前登录账号的 uin（未登录为固定匿名标识）：
 * 换号后旧账号的条目自然失配，不会把上一个账号的数据返回给新账号；
 * 账号变化时顺带清空旧条目，避免旧数据在内存里长期驻留。
 * @param name 模块名
 * @param params 业务参数
 * @returns 缓存键
 */
const buildScopedCacheKey = (name: string, params: unknown): string => {
  const accountId = resolveAccountId(getQQMusicSession());
  const { changed } = syncAccountScope(accountId);
  if (changed) {
    coreLog.info(`[qm-cache] 账号已切换，当前账号维度：${accountId}，缓存已清空`);
  }
  return buildCacheKey(accountId, name, params);
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

  const key = buildScopedCacheKey(name, params);
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const value = await fn(params);
  cacheSet(key, value, DEFAULT_TTL);
  return value;
};

/** 可用模块名列表 */
export const listQQMusicModules = (): string[] => Object.keys(modules);
