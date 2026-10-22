/**
 * QM 响应缓存
 *
 * 只提供与账号无关的存取能力：账号标识由调用方注入到缓存键里，
 * 本模块不读取会话数据，因此可以在主进程之外单独验证缓存键的账号维度。
 *
 * 缓存键形如 `${账号标识}|${模块名}|${参数哈希}`：
 * 账号标识取当前登录账号的 uin（未登录为固定匿名标识），
 * 换号后旧账号的条目自然失配，不会把上一个账号的数据返回给新账号。
 */

import { createHash } from "node:crypto";

/** 未登录时的匿名账号标识 */
export const ANONYMOUS_ACCOUNT_ID = "anonymous";

/** 默认 TTL：2 分钟 */
const DEFAULT_TTL = 2 * 60 * 1000;

/** 容量上限：超过后淘汰最早写入的条目 */
const MAX_ENTRIES = 200;

interface CacheEntry {
  value: unknown;
  expireAt: number;
}

const cache = new Map<string, CacheEntry>();

/** 最近一次同步到的账号标识（null 表示尚未同步过） */
let syncedAccountId: string | null = null;

/** 账号维度同步结果 */
export interface AccountScope {
  /** 当前账号标识 */
  accountId: string;
  /** 本次同步是否发生了账号变化 */
  changed: boolean;
}

const hashParams = (params: unknown): string =>
  createHash("md5")
    .update(JSON.stringify(params ?? {}))
    .digest("hex")
    .slice(0, 8);

/**
 * 解析会话对应的账号标识
 *
 * 取音乐账号的 uin（互联域的 uin 可能带 "o" 前缀，需剥掉）；
 * 取不到时用固定匿名标识，匿名态的条目不会与任何登录账号混用。
 * @param session QM 会话字段
 * @returns 账号标识
 */
export const resolveAccountId = (session: Record<string, string>): string => {
  const raw = session.qm_str_musicid || session.uin || session.wxuin || session.p_uin || "";
  const id = raw.replace(/^o/, "").trim();
  return id || ANONYMOUS_ACCOUNT_ID;
};

/**
 * 构造账号维度的缓存键
 * @param accountId 账号标识
 * @param name 模块名
 * @param params 业务参数
 * @returns 缓存键
 */
export const buildCacheKey = (accountId: string, name: string, params: unknown): string =>
  `${accountId}|${name}|${hashParams(params)}`;

/**
 * 读取缓存
 * @param key 缓存键
 * @returns 缓存值；未命中返回 undefined
 */
export const cacheGet = (key: string): unknown => {
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

/**
 * 写入缓存
 * @param key 缓存键
 * @param value 缓存值
 * @param ttl 存活时长
 */
export const cacheSet = (key: string, value: unknown, ttl = DEFAULT_TTL): void => {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expireAt: Date.now() + ttl });
};

/**
 * 同步账号维度
 *
 * 账号发生变化时清空旧条目：账号标识已进缓存键，旧条目本就不会再命中，
 * 这里清空是为了不让旧账号的数据在内存里长期驻留。
 * @param accountId 当前账号标识
 * @returns 账号维度同步结果
 */
export const syncAccountScope = (accountId: string): AccountScope => {
  const changed = syncedAccountId !== null && syncedAccountId !== accountId;
  if (changed) cache.clear();
  syncedAccountId = accountId;
  return { accountId, changed };
};

/**
 * 清空缓存（含账号维度同步状态）
 */
export const clearCache = (): void => {
  cache.clear();
  syncedAccountId = null;
};

/**
 * 当前缓存条目数
 * @returns 条目数
 */
export const cacheSize = (): number => cache.size;
