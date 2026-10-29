/**
 * 换源音源清单
 *
 * 唯一真源：可选的换源服务清单与各自的默认开关状态。
 * 读取持久化配置时按本表过滤未知键 —— 旧版本残留的已下线音源键
 * 既不参与渲染，也不进配置面板；同时按本表补齐缺失的音源 ——
 * 旧配置里没有新音源时，新增音源按默认开关状态补进来，
 * 其余音源的开关状态一律保持原样，不做重置。
 *
 * 本模块只放纯逻辑，不依赖 store 与浏览器 API，可被 Node 脚本直接调用验证。
 */
import { SongUnlockServer } from "../types/shared";

/** 换源音源条目 */
export type SongUnlockSourceItem = {
  /** 换源标识 */
  key: SongUnlockServer;
  /** 是否启用 */
  enabled: boolean;
};

/** 换源音源清单（顺序即配置面板的默认展示顺序） */
export const SONG_UNLOCK_SOURCE_DEFAULTS: ReadonlyArray<SongUnlockSourceItem> = [
  { key: SongUnlockServer.BODIAN, enabled: true },
  { key: SongUnlockServer.NETEASE, enabled: true },
  { key: SongUnlockServer.KUWO, enabled: false },
  { key: SongUnlockServer.MIGU, enabled: true },
  { key: SongUnlockServer.CHANGQING, enabled: true },
  { key: SongUnlockServer.LXMUSIC, enabled: true },
  { key: SongUnlockServer.XINGHAI, enabled: true },
  { key: SongUnlockServer.FISH, enabled: true },
  { key: SongUnlockServer.JIEXIANG, enabled: true },
  { key: SongUnlockServer.GEQUBAO, enabled: true },
];

/**
 * 生成默认的换源音源列表
 * @returns 全新一份默认列表（条目为独立对象，状态可安全改写）
 */
export const createDefaultSongUnlockSources = (): SongUnlockSourceItem[] =>
  SONG_UNLOCK_SOURCE_DEFAULTS.map((item) => ({ ...item }));

/**
 * 规整换源音源列表
 *
 * 过滤已下线的未知键，并按默认清单补齐缺失的音源（缺失项取默认开关状态）。
 * 已存在的条目保持原对象引用，配置面板的排序与开关改动能直接落回状态。
 * @param sources 持久化或内存中的音源列表
 * @returns 规整后的音源列表（按顺序排列）
 */
export const normalizeSongUnlockSources = (
  sources: ReadonlyArray<{ key: string; enabled?: boolean }> | undefined,
): SongUnlockSourceItem[] => {
  const defaults = new Map(
    SONG_UNLOCK_SOURCE_DEFAULTS.map((item) => [item.key as string, item]),
  );
  const kept: SongUnlockSourceItem[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(sources) ? sources : []) {
    const key = String(item?.key ?? "");
    const fallback = defaults.get(key);
    if (!fallback || seen.has(key)) continue;
    seen.add(key);
    const source = item as SongUnlockSourceItem;
    if (typeof source.enabled !== "boolean") source.enabled = fallback.enabled;
    kept.push(source);
  }
  const missing = SONG_UNLOCK_SOURCE_DEFAULTS.filter((item) => !seen.has(item.key)).map((item) => ({
    key: item.key,
    enabled: item.enabled,
  }));
  return [...kept, ...missing];
};
