/**
 * 平台数据层共用工具
 *
 * QQ 音乐与酷狗的归一化逻辑里有几段结构完全一致的基础动作
 * （地址升级、歌手串拆分、歌手条目归一化、数字 id 稳定派生），
 * 统一收敛到这里，平台文件只保留各自的归一化差异。
 */

import type { ApiPlatform } from "@/types/shared";
import type { PlatformArtist } from "./types";

/**
 * 把 http / 协议相对地址升级为 https
 * @param url 原始地址
 * @returns 安全地址
 */
export const secureUrl = (url: unknown): string => {
  if (typeof url !== "string" || !url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url.replace(/^http:\/\//, "https://");
};

/**
 * 把平台的「A / B」歌手串拆成歌手数组
 *
 * 歌手串里没有平台主键，拆分后的条目 `id` 留空，
 * 由调用方按需派生稳定数字 id。
 * @param artist 歌手串
 * @returns 歌手数组
 */
export const splitArtists = (artist: unknown): PlatformArtist[] => {
  if (typeof artist !== "string" || !artist) return [];
  return artist
    .split(" / ")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: "", name }));
};

/**
 * 归一化歌手条目
 * @param singer 歌手条目
 * @param mid 歌手平台主键（QQ 音乐为 mid，酷狗无此概念）
 * @returns 归一化歌手
 */
export const normalizeArtistEntry = (
  singer: Record<string, any>,
  mid?: string,
): PlatformArtist => ({
  id: String(singer?.id ?? ""),
  name: String(singer?.name ?? ""),
  mid: mid || undefined,
});

/**
 * 取歌手条目的平台定位主键
 *
 * QQ 音乐以 mid 定位，缺 mid 时无法定位歌手，主键留空；
 * 酷狗以 author_id 定位，上游只给歌手名的曲目主键留空
 * （酷狗歌手接口支持按名反查，名字不是主键）。
 * @param platform 来源平台
 * @param artist 归一化歌手
 * @returns 平台内主键，取不到时为 undefined
 */
export const resolveArtistPlatformId = (
  platform: ApiPlatform,
  artist: PlatformArtist,
): string | undefined => {
  if (platform === "qqmusic") return artist.mid || undefined;
  const id = String(artist.id ?? "").trim();
  return /^\d+$/.test(id) ? id : undefined;
};

/** 派生数字 id 的保留区间下界（平台真实数字 id 均远小于该值） */
const DERIVED_ID_BASE = 2000000000;

/** 派生数字 id 的保留区间长度 */
const DERIVED_ID_RANGE = 1000000000;

/**
 * 由平台字符串主键派生稳定的数字 id
 *
 * 平台条目有时只给字符串主键（QQ 音乐 mid / 酷狗 hash），
 * 应用内歌曲模型要求数字 id，这里用 FNV-1a 32 位散列派生一个
 * 落在保留高位区间的正整数：同一主键恒得同一数字，
 * 且不会与平台真实数字 id 混淆。
 *
 * `platformId` 始终是权威主键，数字 id 只作列表内匹配用的稳定占位。
 * @param seed 派生种子（平台字符串主键，缺省时用名称）
 * @returns 稳定的正整数 id
 */
export const deriveStableId = (seed: string): number => {
  const text = String(seed ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const offset = (hash >>> 0) % DERIVED_ID_RANGE;
  return DERIVED_ID_BASE + offset;
};

/**
 * 取条目上第一个可用的数字 id
 *
 * 平台给的是数字字符串时直接用；给的是空串或非数字时按种子派生，
 * 保证结果非 0 且同一输入恒得同一值。
 * @param raw 平台给出的原始 id
 * @param seed 派生种子（平台字符串主键或名称）
 * @returns 数字 id
 */
export const toNumericId = (raw: unknown, seed: string): number => {
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return deriveStableId(seed);
};
