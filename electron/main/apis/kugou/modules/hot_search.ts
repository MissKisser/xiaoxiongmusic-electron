/**
 * 酷狗音乐热搜榜
 *
 * 主通道走 KG 网关的原生热搜榜接口：
 * - `GET /api/v3/search/hot_tab`（`navid` 只能取 `0` / `1`，取 `1` 才是搜索页热搜）
 * - 返回 `data.list[]` 为榜单 tab 列表，每个 tab 带 `name` 与 `keywords[]`
 * - `keywords[]` 条目形如 `{ keyword, reason, type, icon, jumpurl, json_url }`
 *
 * 兜底通道走 mobile service 的公开热搜列表：
 * - `GET https://mobileservice.kugou.com/api/v5/search/hot/list`
 * - 返回 `data.info[]`，条目形如 `{ keyword, sort, jumpurl }`
 *
 * 上游两个通道都不返回任何真实热度值，热搜条目只有「关键词」与「榜位」，
 * 因此归一化结果不带热度分字段，渲染层据此隐藏热度展示。
 *
 * 上游 `reason` 与 `keyword` 恒等，为避免 UI 重复展示，
 * `description` 统一留空，待上游给出真实描述后再启用。
 */

import { kgGatewayRequest, kgRequest } from "../core/request";
import { coreLog } from "../../../logger";
import type { KGModule, KGParams } from "../core/types";

/** 原生热搜榜端点 */
const KG_HOT_TAB_PATH = "/api/v3/search/hot_tab";

/** 兜底热搜列表端点 */
const KG_HOT_LIST_URL = "https://mobileservice.kugou.com/api/v5/search/hot/list";

/** 默认榜单 tab 名 */
const DEFAULT_TAB_NAME = "热搜榜";

/** 默认条数 */
const DEFAULT_LIMIT = 20;

/** 条数上限 */
const MAX_LIMIT = 50;

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 归一化热搜条目
 * @param item - 上游热搜条目
 * @param index - 条目序号（榜位）
 * @returns 归一化后的热搜条目
 */
const normalizeHotItem = (item: RawEntry, index: number): Record<string, unknown> => {
  const source = item || {};
  return {
    rank: index + 1,
    keyword: String(source.keyword ?? "").trim(),
    // 上游 `reason` 与 `keyword` 恒等，统一留空避免 UI 重复展示
    description: "",
  };
};

/**
 * 归一化热搜条目数组（丢弃空关键词并重排榜位）
 * @param items - 上游热搜条目数组
 * @returns 归一化后的热搜条目数组
 */
const normalizeHotList = (items: RawEntry[]): Record<string, unknown>[] => {
  const list: Record<string, unknown>[] = [];
  for (const item of items) {
    const normalized = normalizeHotItem(item, list.length);
    if (!normalized.keyword) continue;
    list.push(normalized);
  }
  return list;
};

/**
 * 读取原生热搜榜 tab 的关键词
 * @param tabName - 目标榜单 tab 名
 * @returns 归一化后的热搜条目
 */
const fetchHotTab = async (tabName: string): Promise<Record<string, unknown>[]> => {
  const body = await kgGatewayRequest<{
    data?: { list?: RawEntry[] };
  }>(KG_HOT_TAB_PATH, {
    params: { navid: 1, plat: 2 },
    headers: { "x-router": "msearch.kugou.com" },
  });

  const tabs = Array.isArray(body?.data?.list) ? body.data.list : [];
  const target = tabs.find((tab) => String(tab?.name ?? "") === tabName) ?? tabs[0] ?? undefined;
  const keywords = Array.isArray(target?.keywords) ? target.keywords : [];

  return normalizeHotList(keywords);
};

/**
 * 读取兜底热搜列表
 * @returns 归一化后的热搜条目
 */
const fetchHotList = async (): Promise<Record<string, unknown>[]> => {
  const body = await kgRequest<{ data?: { info?: RawEntry[] } }>(KG_HOT_LIST_URL, {
    headers: {
      "User-Agent": "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi",
    },
  });

  const info = Array.isArray(body?.data?.info) ? body.data.info : [];

  return normalizeHotList(info);
};

/**
 * 读取酷狗音乐热搜榜
 * @param params.tab - 榜单 tab 名，默认取「热搜榜」
 * @param params.limit - 取回的条数，默认 20，上限 50
 */
export const hot_search: KGModule = async (params: KGParams) => {
  const tabName = String(params.tab ?? DEFAULT_TAB_NAME).trim() || DEFAULT_TAB_NAME;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );

  try {
    let list: Record<string, unknown>[] = [];
    try {
      list = await fetchHotTab(tabName);
    } catch (err) {
      // 主通道失败属可预期波动，降级到兜底通道继续取数，记录警告日志
      coreLog.warn("[kg-hot-search] 酷狗原生热搜榜获取失败，降级到兜底通道:", err);
    }

    if (!list.length) list = await fetchHotList();

    const limited = list.slice(0, limit);

    return {
      code: 200,
      total: limited.length,
      list: limited,
    };
  } catch (err) {
    coreLog.error("[kg-hot-search] 酷狗热搜获取异常:", err);
    return {
      code: 502,
      message: `酷狗热搜获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
