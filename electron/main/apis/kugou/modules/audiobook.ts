/**
 * 酷狗听书数据面
 *
 * 路由（路径段即模块名，与主进程模块注册表同名）：
 * - `audiobook/category`：听书频道列表
 * - `audiobook/list`：频道下的听书专辑列表
 * - `audiobook/detail`：听书专辑详情与章节列表
 *
 * 章节播放地址不在这里另起一套：章节音频就是普通歌曲音频，
 * 直接复用既有的 `song_url` 模块，取链时带 `albumId` 与 `albumAudioId` 即可。
 */

import { coreLog } from "../../../logger";
import {
  KG_AUDIOBOOK_CATEGORIES,
  KG_AUDIOBOOK_CATEGORY,
  findCategory,
  fetchAudiobookDetail,
  fetchAudiobookTracks,
  normalizeAlbum,
  normalizeAlbumId,
  normalizeTrack,
  searchAudiobookAlbums,
} from "../core/audiobook";
import type { KGModule, KGParams } from "../core/types";

/** 专辑列表每页最大条数 */
const MAX_LIST_LIMIT = 60;

/** 章节列表每页最大条数 */
const MAX_DETAIL_LIMIT = 100;

/**
 * 读取酷狗听书频道列表
 *
 * 酷狗没有下发听书分类的 JSON 接口，频道表在本地维护。
 */
export const audiobookCategory: KGModule = async () => {
  const categories = KG_AUDIOBOOK_CATEGORIES.map((item) => ({
    slug: item.slug,
    name: item.name,
    keyword: item.keyword,
    path: `/ts/${item.slug}/`,
  }));

  return {
    code: 200,
    total: categories.length,
    categories,
    items: categories,
  };
};

/**
 * 读取酷狗听书频道下的专辑列表
 *
 * 酷狗没有「按听书频道取专辑」的端点，因此按「频道取材关键字 +
 * `category=2` 专辑检索」取数：检索端点传 `category=2` 时只返回听书专辑。
 * @param params.category 频道标识（slug、中文名或取材关键字）
 * @param params.page 页码，从 1 开始
 * @param params.limit 每页条数
 */
export const audiobookList: KGModule = async (params: KGParams) => {
  const rawCategory = params.category ?? params.tag ?? params.slug ?? "xiaoshuo";
  const category = findCategory(rawCategory);
  if (!category) {
    return { code: 400, message: `不支持的酷狗听书频道：${String(rawCategory)}` };
  }

  const page = Math.max(1, Number(params.page || 1) || 1);
  const limit = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Number(params.limit || params.pagesize || 20) || 20),
  );

  try {
    const result = await searchAudiobookAlbums({
      keyword: category.keyword,
      category: KG_AUDIOBOOK_CATEGORY,
      page,
      pagesize: limit,
    });

    const albums = result.list.map(normalizeAlbum);

    return {
      code: 200,
      category: {
        slug: category.slug,
        name: category.name,
        keyword: category.keyword,
      },
      page,
      limit,
      total: result.total,
      hasMore: page * limit < result.total,
      albums,
      items: albums,
    };
  } catch (err) {
    coreLog.warn("[kg-audiobook] 读取听书专辑列表失败:", err);
    return {
      code: 502,
      message: `读取酷狗听书专辑列表失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};

/**
 * 读取酷狗听书专辑详情与章节
 *
 * 专辑标识支持数字专辑 ID 与官网 base36 别名两种写法。
 * 章节总数取章节列表的 `total`：专辑详情接口的 `songcount` 对听书恒为 0。
 * @param params.id 专辑 ID（数字专辑 ID 或官网 base36 别名）
 * @param params.page 章节页码，从 1 开始
 * @param params.limit 每页章节数
 */
export const audiobookDetail: KGModule = async (params: KGParams) => {
  const rawId = String(params.id ?? params.albumId ?? params.album_id ?? "").trim();
  if (!rawId) return { code: 400, message: "id required" };

  const albumId = normalizeAlbumId(rawId);
  if (!albumId) return { code: 400, message: `无法解析的酷狗听书专辑标识：${rawId}` };

  const page = Math.max(1, Number(params.page || 1) || 1);
  const limit = Math.min(
    MAX_DETAIL_LIMIT,
    Math.max(1, Number(params.limit || params.pagesize || 30) || 30),
  );

  try {
    const { detail } = await fetchAudiobookDetail(albumId);
    if (!detail.albumname) {
      return { code: 404, message: `酷狗听书专辑不存在：${albumId}` };
    }

    const tracks = await fetchAudiobookTracks(albumId, page, limit);
    const offset = (page - 1) * limit;
    const chapters = tracks.list.map((item, index) => normalizeTrack(item, offset + index + 1));

    const album = normalizeAlbum({
      ...detail,
      albumid: detail.albumid ?? albumId,
      category: detail.category ?? KG_AUDIOBOOK_CATEGORY,
    });

    return {
      code: 200,
      id: String(detail.albumid ?? albumId),
      albumId,
      name: album.name,
      cover: album.cover,
      coverOriginal: album.coverOriginal,
      speaker: album.speaker,
      speakers: album.speakers,
      intro: album.intro,
      publishTime: album.publishTime,
      playCount: Number(detail.play_count ?? 0),
      category: album.category,
      privilege: album.privilege,
      total: tracks.total,
      page,
      limit,
      hasMore: page * limit < tracks.total,
      chapters,
      items: chapters,
    };
  } catch (err) {
    coreLog.warn("[kg-audiobook] 读取听书专辑详情失败:", err);
    return {
      code: 502,
      message: `读取酷狗听书专辑详情失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
