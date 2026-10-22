/**
 * 歌手详情跳转
 *
 * 各处「进入歌手详情」的入口都走这里，保证同一套平台定位口径：
 * 第三方平台（QQ 音乐 / 酷狗）的歌手以「平台 + 平台内主键」定位，
 * 网易云沿用平台数字 id、不带 platform 参数。
 */

import type { ApiPlatform } from "@/types/shared";
import type { MetaData } from "@/types/main";
import router from "@/router";
import { usePlatformStore } from "@/stores";
import { kgSearchArtists } from "@/api/platform/kugou";
import { qqSearchArtists } from "@/api/platform/qqmusic";

/** 歌手条目无法定位时的提示文案 */
const ARTIST_JUMP_UNAVAILABLE = "该歌手暂不支持跳转";

/** 歌手名 → 平台主键的解析缓存 */
const artistIdCache = new Map<string, string>();

/**
 * 按歌手名解析平台内主键
 *
 * QQ 音乐与酷狗的上游部分曲目只给歌手名，平台接口可按名反查
 * （QQ 音乐得 mid，酷狗得 author_id）；
 * 这里先在渲染端解析一次，URL 里留下的是稳定的平台主键。
 * @param platform 来源平台
 * @param name 歌手名
 * @returns 平台内主键，取不到时为空串
 */
const resolveArtistIdByName = async (platform: ApiPlatform, name: string): Promise<string> => {
  const cacheKey = `${platform}:${name}`;
  const cached = artistIdCache.get(cacheKey);
  if (cached) return cached;
  try {
    const res =
      platform === "qqmusic"
        ? await qqSearchArtists(name, 1, 5)
        : await kgSearchArtists(name, 1, 5);
    const hit = res.artists.find((artist) => artist.name === name) ?? res.artists[0];
    const id = hit ? String(hit.id ?? "") : "";
    if (id) artistIdCache.set(cacheKey, id);
    return id;
  } catch (error) {
    console.error(`解析${platform === "qqmusic" ? "QQ 音乐" : "酷狗"}歌手主键失败：`, error);
    return "";
  }
};

/**
 * 取歌手条目的来源平台
 *
 * 优先级：歌手条目自带平台 → 内容来源平台（歌曲 / 歌单 / 专辑所属平台）
 * → 旧数据兼容（带平台主键即第三方条目）→ 网易云。
 * @param artist 歌手条目
 * @param contentPlatform 内容来源平台
 * @param fallback 兜底平台（当前音源平台）
 * @returns 来源平台
 */
const resolveArtistPlatform = (
  artist: MetaData,
  contentPlatform: ApiPlatform | undefined,
  fallback: ApiPlatform,
): ApiPlatform => {
  if (artist.platform) return artist.platform;
  if (contentPlatform) return contentPlatform;
  if (artist.platformId && fallback !== "netease") return fallback;
  return "netease";
};

/**
 * 跳转歌手详情
 *
 * QQ 音乐用 mid 定位，酷狗用 author_id 定位；
 * 上游只给歌手名的曲目先按名解析出平台主键，
 * 酷狗解析不出时以歌手名定位（酷狗歌手接口支持按名反查）。
 * 平台内主键缺失且无法定位时不跳转，避免落到错误平台的同名歌手。
 * @param artist 歌手条目
 * @param contentPlatform 内容来源平台（歌曲 / 歌单 / 专辑所属平台）
 */
export const jumpToArtist = async (artist: MetaData, contentPlatform?: ApiPlatform) => {
  const platformStore = usePlatformStore();
  const platform = resolveArtistPlatform(artist, contentPlatform, platformStore.currentPlatform);
  // 网易云：按平台数字 id 定位
  if (platform === "netease") {
    router.push({ name: "artist", query: { id: artist.id } });
    return;
  }
  let platformId = artist.platformId;
  // 上游只给歌手名的曲目：先按名解析平台主键
  if (!platformId && artist.name) {
    platformId = await resolveArtistIdByName(platform, artist.name);
    // 酷狗解析不出时以歌手名定位，QQ 音乐必须有 mid
    if (!platformId && platform === "kugou") platformId = artist.name;
  }
  if (!platformId) {
    window.$message.warning(ARTIST_JUMP_UNAVAILABLE);
    return;
  }
  router.push({ name: "artist", query: { id: platformId, platform } });
};
