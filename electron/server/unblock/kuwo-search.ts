/**
 * 酷我系（酷我 / 波点）共用的候选检索
 *
 * search.kuwo.cn 同时服务两套索引：
 * - 移动索引（带 mobi=1）：命中热门与翻唱版本，VIP 原版常被挤掉；
 * - 版权库索引（不带 mobi）：能命中 VIP 原版，但英文曲库几乎为空。
 * 两套索引都不支持翻页（固定返回 7~20 条），因此这里把「曲名+歌手 / 曲名」
 * ×「两套索引」四种组合的结果合并去重，交由三重校验排序。
 */
import axios from "axios";
import type { MatchCandidate } from "./match";

/** 候选歌曲（酷我 rid 为其唯一标识） */
export type KuwoCandidate = MatchCandidate & {
  /** 酷我歌曲 rid */
  rid: string;
};

/** 检索接口地址 */
const SEARCH_URL = "http://search.kuwo.cn/r.s";

/** 检索请求 UA */
const SEARCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/**
 * 拼装检索地址
 * @param keyword 检索词
 * @param mobile 是否使用移动索引
 * @returns 检索地址
 */
const buildSearchUrl = (keyword: string, mobile: boolean): string => {
  const params = [
    "correct=1",
    "stype=comprehensive",
    "encoding=utf8",
    "rformat=json",
    mobile ? "mobi=1" : "",
    "show_copyright_off=1",
    "searchapi=6",
    `all=${encodeURIComponent(keyword)}`,
  ].filter(Boolean);
  return `${SEARCH_URL}?${params.join("&")}`;
};

/**
 * 从检索响应中取出候选列表（两套索引的响应层级不同）
 * @param data 检索响应体
 * @returns 候选原始数组
 */
const parseSearchResponse = (data: any): any[] => {
  const page = data?.content?.[1]?.musicpage ?? data?.content?.[1] ?? data;
  const list = page?.abslist;
  return Array.isArray(list) ? list : [];
};

/**
 * 检索候选歌曲
 * @param title 歌名
 * @param artist 歌手，可为空
 * @returns 去重合并后的候选列表
 */
export const searchKuwoCandidates = async (
  title: string,
  artist: string,
): Promise<KuwoCandidate[]> => {
  const keywords = [artist ? `${title} ${artist}` : "", title].filter(Boolean);
  const urls = keywords.flatMap((keyword) => [
    buildSearchUrl(keyword, true),
    buildSearchUrl(keyword, false),
  ]);
  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await axios.get(url, {
        headers: { "User-Agent": SEARCH_UA },
        timeout: 10000,
      });
      return parseSearchResponse(response.data);
    }),
  );
  const merged: KuwoCandidate[] = [];
  const seen = new Set<string>();
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    for (const raw of item.value) {
      const rid = String(raw?.MUSICRID ?? "").replace(/^MUSIC_/, "");
      if (!rid || seen.has(rid)) continue;
      seen.add(rid);
      const duration = Number(raw?.DURATION);
      merged.push({
        id: rid,
        rid,
        title: String(raw?.SONGNAME ?? "").trim(),
        artist: String(raw?.ARTIST ?? "").trim(),
        duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      });
    }
  }
  return merged;
};
