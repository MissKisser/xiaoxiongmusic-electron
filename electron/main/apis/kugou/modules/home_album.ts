/**
 * 酷狗音乐首页「新碟上架」
 *
 * 端点：`GET http://mobilecdn.kugou.com/api/v3/album/list`
 * （`mobilecdn.kugou.com` 的 https 证书不受信，握手会失败，只能走 `http://`）：
 * - 条目在 `data.info[]`，专辑号是 `albumid`（专辑详情按它定位），
 *   专辑名是 `albumname`，歌手名是 `singername`，发行时间是 `publishtime`，
 *   封面是 `imgurl` 模板（尺寸写成 `{size}` 占位符）；
 * - `data.total` 是上游总数（实测 1500），条目按发布时间倒序。
 *
 * 上游不给曲目数：`album/info` 的 `songcount` 恒为 0，
 * 卡片上的「N 首」按专辑号回查 `album/song` 的 `total` 补齐
 * （与 QQ 音乐新碟区块回查专辑曲目数的口径一致）。
 *
 * 该端点是公开的新碟列表，推荐区块每次取最新一档，按实时数据取，不做缓存。
 */

import { kgRequest } from "../core/request";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../../../logger";
import type { KGModule, KGParams } from "../core/types";

/** 新碟列表端点 */
const KG_ALBUM_LIST_URL = "http://mobilecdn.kugou.com/api/v3/album/list";

/** 专辑曲目数回查端点 */
const KG_ALBUM_SONG_URL = "http://mobilecdn.kugou.com/api/v3/album/song";

/** 新碟默认条数 */
const DEFAULT_LIMIT = 12;

/** 新碟条数上限 */
const MAX_LIMIT = 50;

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 归一化新碟条目
 *
 * 封面口径：模块层就把 `{size}` 换成实际尺寸（`cover` 用 300），
 * 与本平台其他模块（搜索 / 歌手 / 歌单 / 榜单）保持一致，渲染端拿到即可直接用。
 * @param item 上游新碟条目
 * @returns 归一化后的新碟条目
 */
const normalizeAlbum = (item: RawEntry) => {
  const source = item || {};
  const albumId = String(source.albumid ?? source.album_id ?? "");
  return {
    id: albumId,
    name: decodeName(source.albumname ?? source.album_name ?? ""),
    artist: decodeName(source.singername ?? ""),
    publishTime: String(source.publishtime ?? source.publish_date ?? ""),
    cover: fillCover(source.imgurl, 300) ?? "",
  };
};

/**
 * 回查专辑的曲目数
 *
 * 新碟列表接口不回曲目数，卡片上的「N 首」要按专辑号回查一次；
 * 单次只取一首，响应里的 `total` 仍是完整曲目数。
 * @param albumId 专辑号
 * @returns 曲目数，取不到时为 0
 */
const fetchAlbumTrackCount = async (albumId: string): Promise<number> => {
  if (!albumId) return 0;
  try {
    const body = await kgRequest<{ data?: { total?: number } }>(
      `${KG_ALBUM_SONG_URL}?albumid=${encodeURIComponent(albumId)}&page=1&pagesize=1&format=json`,
    );
    return Number(body?.data?.total ?? 0);
  } catch (err) {
    coreLog.warn("[kg-home-album] 专辑曲目数回查失败:", albumId, (err as Error)?.message ?? String(err));
    return 0;
  }
};

/**
 * 读取酷狗音乐新碟上架列表
 *
 * @param params.page 页码，从 1 开始
 * @param params.limit 取回的条数
 */
export const homeAlbum: KGModule = async (params: KGParams) => {
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );

  try {
    const body = await kgRequest<{ data?: { info?: RawEntry[]; total?: number } }>(
      `${KG_ALBUM_LIST_URL}?page=${page}&pagesize=${limit}&format=json`,
    );

    const data = body?.data || {};
    const info = Array.isArray(data.info) ? data.info : [];
    const picked = info.slice(0, limit);
    const counts = await Promise.all(
      picked.map((item: RawEntry) =>
        fetchAlbumTrackCount(String(item?.albumid ?? item?.album_id ?? "")),
      ),
    );
    const list = picked
      .map((item: RawEntry, index: number) => ({
        ...normalizeAlbum(item),
        trackCount: counts[index],
      }))
      .filter((item: { id: string }) => !!item.id);

    return {
      code: 200,
      total: Number(data.total ?? info.length),
      page,
      list,
    };
  } catch (err) {
    coreLog.error("[kg-home-album] 酷狗新碟上架获取异常:", err);
    return {
      code: 502,
      message: `酷狗新碟上架获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
