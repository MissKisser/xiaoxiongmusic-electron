/**
 * 酷狗公开歌单详情
 *
 * 与「我的歌单」（云歌单）是两套东西：这里读的是酷狗对外公开的精选歌单
 * （special），任何人都能访问，不需要登录。
 *
 * 端点：
 * - 歌单信息：GET http://mobilecdn.kugou.com/api/v3/special/info
 * - 歌单歌曲：GET http://mobilecdn.kugou.com/api/v3/special/song
 * - 专辑信息：POST /kmr/v2/albums（x-router `openapi.kugou.com`，kg-tid 255）
 * - 专辑信息兜底：GET http://mobilecdn.kugou.com/api/v3/album/info
 *
 * 歌单歌曲条目只带 `album_id`、不带专辑名，因此要按 album_id 反查专辑名：
 * 优先走网关的批量接口（单次上限 50 个 album_id），失败时回落 mobilecdn
 * 的单专辑接口。
 *
 * 歌名口径：歌名剥离规则由 `../core/song_title` 统一提供，与云歌单详情
 * 共用同一实现，同一首歌在任何页面显示的都是同一个名字。
 */

import { kgErrorCode, kgGatewayRequest, kgRequest } from "../core/request";
import { extractSongTitle } from "../core/song_title";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../../../logger";
import type { KGModule, KGParams } from "../core/types";

/** 单页最大歌曲数 */
const MAX_PAGE_SIZE = 300;

/** 网关单次批量解析的专辑数量上限，超过会返回 `error_code=20010` */
const ALBUM_BATCH_SIZE = 50;

/** 专辑信息批量请求的并发上限 */
const ALBUM_CONCURRENCY = 4;

/** 原始条目 */
type RawEntry = Record<string, any>;

/** 专辑信息表的值 */
interface AlbumInfo {
  name: string;
  cover: string;
}

/**
 * 把音质 hash 与体积整理成对外结构
 * @param raw - 原始歌曲条目
 * @returns 音质信息
 */
const collectQualities = (raw: RawEntry) => {
  const hashes: Record<string, string> = {};
  const sizes: Record<string, number> = {};

  const put = (quality: string, hash: unknown, size: unknown) => {
    if (!hash || !size) return;
    hashes[quality] = String(hash);
    sizes[quality] = Number(size);
  };

  put("128k", raw.hash, raw.filesize);
  put("320k", raw["320hash"], raw["320filesize"]);
  put("flac", raw.sqhash, raw.sqfilesize);
  put("flac24bit", raw.hires_hash ?? raw.reshash, raw.hires_filesize ?? raw.resfilesize);

  return { qualities: Object.keys(hashes), hashes, sizes };
};

/**
 * 拆分歌手串
 * @param singername - 原始歌手字段
 * @param filename - 原始文件名
 * @returns 归一化后的歌手名
 */
const formatArtist = (singername: unknown, filename: unknown): string => {
  if (singername) {
    return decodeName(String(singername))
      .split(/、|,|;|\//)
      .map((name) => name.trim())
      .filter(Boolean)
      .join(" / ");
  }
  const parts = String(filename || "").split(" - ");
  return parts.length > 1 ? decodeName(parts[0].trim()) : "";
};

/**
 * 从歌曲条目里取专辑名
 *
 * 各端点的专辑名字段并不统一：网关为 `album_info.album_name`，云歌单为
 * `albuminfo.name`，而公开歌单的歌曲条目完全不带专辑名（只有 `album_id`），
 * 此时要按 album_id 反查。
 * @param raw - 原始歌曲条目
 * @returns 专辑名，取不到时返回空串
 */
const pickAlbumName = (raw: RawEntry): string => {
  const info = raw.albuminfo || raw.album_info || {};
  const candidate = raw.album_name || raw.albumname || info.name || info.album_name || "";
  return decodeName(candidate);
};

/**
 * 把数组切成固定长度的分片
 * @param items - 原数组
 * @param size - 每片长度
 * @returns 分片结果
 */
const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

/**
 * 以受限并发执行任务
 * @param items - 任务输入
 * @param limit - 并发上限
 * @param worker - 单个任务的执行器
 * @returns 各任务结果，顺序与输入一致
 */
const mapWithLimit = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runner = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };

  const workers: Promise<void>[] = [];
  const count = Math.min(limit, items.length);
  for (let i = 0; i < count; i += 1) workers.push(runner());
  await Promise.all(workers);
  return results;
};

/**
 * 批量解析专辑信息
 *
 * 公开歌单的歌曲条目只有 `album_id`，专辑名要按 album_id 反查。优先走网关的
 * 批量接口（单次上限 50 个 album_id，超出会返回 `error_code=20010`），
 * 网关拿不到的再逐个回落 mobilecdn 的单专辑接口。
 * @param albumIds - 去重后的专辑 ID
 * @returns 专辑信息表
 */
const resolveAlbums = async (albumIds: string[]): Promise<Map<string, AlbumInfo>> => {
  const albums = new Map<string, AlbumInfo>();
  if (albumIds.length === 0) return albums;

  const pending = [...albumIds];

  await mapWithLimit(chunk(pending, ALBUM_BATCH_SIZE), ALBUM_CONCURRENCY, async (batch) => {
    try {
      const response = await kgGatewayRequest<{ data?: RawEntry[] }>("/kmr/v2/albums", {
        method: "POST",
        data: {
          data: batch.map((id) => ({ album_id: id })),
          fields: "album_id,album_name,sizable_cover",
        },
        headers: { "x-router": "openapi.kugou.com", "kg-tid": "255" },
        allowBusinessError: true,
      });
      if (kgErrorCode(response) !== 0) return;

      const list = Array.isArray(response.data) ? response.data : [];
      list.forEach((item) => {
        const id = String(item.album_id || "");
        if (!id || !item.album_name) return;
        albums.set(id, {
          name: decodeName(item.album_name),
          cover: fillCover(item.sizable_cover, 300) ?? "",
        });
      });
    } catch (err) {
      coreLog.warn("[kg-playlist] 批量解析专辑信息失败:", err);
    }
  });

  const rest = pending.filter((id) => !albums.has(id));
  if (rest.length === 0) return albums;

  await mapWithLimit(rest, ALBUM_CONCURRENCY, async (id) => {
    try {
      const response = await kgRequest<{ data?: RawEntry }>(
        `http://mobilecdn.kugou.com/api/v3/album/info?albumid=${encodeURIComponent(id)}&format=json`,
        { allowBusinessError: true },
      );
      const detail = response.data || {};
      if (!detail.albumname) return;
      albums.set(id, {
        name: decodeName(detail.albumname),
        cover: fillCover(detail.imgurl, 300) ?? "",
      });
    } catch (err) {
      coreLog.warn("[kg-playlist] 解析专辑信息失败:", err);
    }
  });

  return albums;
};

/**
 * 归一化歌单歌曲
 * @param raw - 原始歌曲条目
 * @param fallbackCover - 兜底封面模板
 * @param albums - 专辑信息表
 * @returns 对外歌曲对象
 */
const normalizeSpecialSong = (
  raw: RawEntry,
  fallbackCover: string,
  albums: Map<string, AlbumInfo>,
) => {
  const trans = raw.trans_param || {};
  const albumId = String(raw.album_id || "");
  const album = albums.get(albumId);
  const coverTemplate = trans.union_cover || album?.cover || fallbackCover;
  const interval = Number(raw.duration || 0);
  const qualities = collectQualities(raw);

  const artistName = formatArtist(raw.singername, raw.filename);
  // 公开歌单条目没有歌手字段，只有 `filename`（形态为「歌手 - 歌名」，无扩展名），
  // 剥离规则由 `../core/song_title` 统一提供：按「首段是歌手」的约定取歌名。
  const songName =
    decodeName(extractSongTitle(raw.filename, { artistPrefix: true })) ||
    decodeName(raw.songname || "");

  return {
    id: String(raw.audio_id || raw.hash || ""),
    audioId: Number(raw.audio_id || 0),
    albumAudioId: Number(raw.album_audio_id || 0),
    /** 歌曲主键（album_audio_id 口径），查评论、签播放地址都用它 */
    mixSongId: String(raw.album_audio_id || ""),
    hash: raw.hash || "",
    name: songName,
    artist: artistName,
    artists: artistName ? artistName.split(" / ").map((name) => ({ id: "", name })) : [],
    album: pickAlbumName(raw) || album?.name || "",
    albumId,
    cover: fillCover(coverTemplate, 300) ?? "",
    coverOriginal: fillCover(coverTemplate, 480) ?? "",
    duration: interval * 1000,
    interval,
    qualities: qualities.qualities,
    hashes: qualities.hashes,
    sizes: qualities.sizes,
    pay: {
      payplay: Number(raw.pay_type || 0),
      privilege: Number(raw.privilege || 0),
      feetype: Number(raw.feetype || 0),
      pkgPrice: Number(raw.pkg_price || 0),
      price: Number(raw.price || 0),
    },
  };
};

/**
 * 读取酷狗公开歌单
 *
 * @param params.id - 歌单 ID
 * @param params.page - 页码，从 1 开始
 * @param params.pageSize - 每页条数
 */
export const playlist: KGModule = async (params: KGParams) => {
  const specialId = String(params.id ?? params.specialid ?? params.special_id ?? "").trim();
  if (!specialId) return { code: 400, message: "id required" };

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = Math.max(
    1,
    Math.min(
      MAX_PAGE_SIZE,
      Number(params.pageSize ?? params.pagesize ?? MAX_PAGE_SIZE) || MAX_PAGE_SIZE,
    ),
  );

  try {
    const infoResponse = await kgRequest<{ data?: RawEntry }>(
      `http://mobilecdn.kugou.com/api/v3/special/info?specialid=${encodeURIComponent(specialId)}&format=json`,
      { allowBusinessError: true },
    );
    const info = infoResponse.data || {};

    const songsResponse = await kgRequest<{
      data?: { info?: RawEntry[]; total?: number };
    }>(
      `http://mobilecdn.kugou.com/api/v3/special/song?specialid=${encodeURIComponent(specialId)}&page=${page}&pagesize=${pageSize}&format=json`,
      { allowBusinessError: true },
    );
    const songs = songsResponse?.data?.info || [];
    const total = Number(songsResponse?.data?.total || songs.length);

    const coverTemplate = info.imgurl || "";

    // 歌曲条目不带专辑名，按 album_id 批量反查
    const albumIds = [...new Set(songs.map((song) => String(song.album_id || "")).filter(Boolean))];
    let albums = new Map<string, AlbumInfo>();
    try {
      albums = await resolveAlbums(albumIds);
    } catch (err) {
      coreLog.warn("[kg-playlist] 解析歌单专辑信息失败:", err);
    }

    return {
      code: 200,
      id: String(info.specialid || specialId),
      name: decodeName(info.specialname),
      description: decodeName(info.intro),
      creator: decodeName(info.nickname),
      creatorId: info.suid === undefined ? "" : String(info.suid),
      cover: fillCover(coverTemplate, 300) ?? "",
      coverOriginal: fillCover(coverTemplate, 480) ?? "",
      playCount: Number(info.playcount || 0),
      collectCount: Number(info.collectcount || 0),
      commentCount: Number(info.commentcount || 0),
      publishTime: info.publishtime || "",
      tags: (Array.isArray(info.tags) ? info.tags : []).map((tag: RawEntry) => ({
        id: String(tag.tagid || ""),
        name: tag.tagname || "",
      })),
      page,
      pageSize,
      total: Number(info.songcount || total || songs.length),
      /** 歌单涉及的专辑，按专辑 ID 索引 */
      albums: [...albums.entries()].map(([albumId, album]) => ({
        id: albumId,
        name: album.name,
        cover: album.cover,
      })),
      songs: songs.map((song) => normalizeSpecialSong(song, coverTemplate, albums)),
      raw: { info, songs },
    };
  } catch (err) {
    coreLog.error("[kg-playlist] 读取公开歌单失败:", err);
    return {
      code: 502,
      message: `读取公开歌单失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
