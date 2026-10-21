import { callQQMusic, listQQMusicModules } from "../../main/apis/qqmusic";
import { createPlatformRoute } from "./factory";

/**
 * 旧端点参数名 → 平台模块参数名
 *
 * 旧版 `/api/qqmusic/lyric|search|match` 三个端点用的是 `keyword` / `pageSize`，
 * 平台模块用的是 `keywords` / `limit`，这里做一层别名映射，
 * 渲染端 `src/api/qqmusic.ts` 无需改动即可继续消费。
 */
const LEGACY_PARAM_ALIAS: Record<string, Record<string, string>> = {
  search: { keyword: "keywords", pageSize: "limit" },
  match: { keyword: "keywords" },
};

/** 旧版搜索每页条数默认值 */
const LEGACY_SEARCH_LIMIT = 20;

/**
 * 初始化 QQ 音乐平台路由
 *
 * 路径段即模块名（下划线风格），如 `/api/qqmusic/song_url` → `song_url`。
 */
export const initQQMusicPlatformAPI = createPlatformRoute({
  platform: "qqmusic",
  title: "QQMusic",
  description: "QQ 音乐数据面（主进程平台模块转发）",
  listModules: listQQMusicModules,
  call: callQQMusic,
  paramAlias: LEGACY_PARAM_ALIAS,
  searchLimit: LEGACY_SEARCH_LIMIT,
});
