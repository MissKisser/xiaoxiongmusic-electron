/**
 * 酷狗专辑详情
 *
 * 端点：
 * - 专辑详情：POST /kmr/v2/albums（x-router `openapi.kugou.com`，kg-tid 255）
 * - 专辑歌曲：POST /v1/album_audio/lite（x-router `openapi.kugou.com`，kg-tid 255）
 * - 兜底详情：GET http://mobilecdn.kugou.com/api/v3/album/info
 * - 兜底歌曲：GET http://mobilecdn.kugou.com/api/v3/album/song
 * - 名称转 ID：GET /v1/search/album（x-router `complexsearch.kugou.com`）
 *
 * 网关的专辑歌曲接口对当前客户端会返回 `error_code=20010`，因此歌曲列表
 * 统一走 mobilecdn 兜底；专辑元信息优先取网关，失败时回落到 mobilecdn。
 *
 * 专辑名只由专辑详情接口提供：网关为 `album_name`，mobilecdn 为
 * `albumname`；歌曲条目本身不带专辑名（只有 `album_id`），因此歌曲的
 * 专辑名统一取所属专辑详情。
 */

import { kgErrorCode, kgGatewayRequest, kgRequest } from "../core/request";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../../../logger";
import type { KGModule, KGParams } from "../core/types";

/** 原始歌曲条目 */
type RawSong = Record<string, any>;

/**
 * 从歌曲条目里取专辑名
 *
 * 各端点的专辑名字段并不统一：网关为 `album_info.album_name`，云歌单为
 * `albuminfo.name`，而 mobilecdn 的专辑歌曲条目完全不带专辑名（只有
 * `album_id`），此时要回落到专辑详情给出的专辑名。
 * @param raw - 原始歌曲条目
 * @returns 专辑名，取不到时返回空串
 */
const pickAlbumName = (raw: RawSong): string => {
  const info = raw.albuminfo || raw.album_info || {};
  const candidate = raw.album_name || raw.albumname || info.name || info.album_name || "";
  return decodeName(candidate);
};

/**
 * 把音质 hash 与体积整理成对外结构
 * @param raw - 原始歌曲条目
 * @returns 音质信息
 */
const collectQualities = (raw: RawSong) => {
  const hashes: Record<string, string> = {};
  const sizes: Record<string, number> = {};

  const put = (quality: string, hash: unknown, size: unknown) => {
    if (!hash || !size) return;
    hashes[quality] = String(hash);
    sizes[quality] = Number(size);
  };

  put("128k", raw.hash_128 ?? raw.hash, raw.filesize_128 ?? raw.filesize);
  put("320k", raw.hash_320 ?? raw["320hash"], raw.filesize_320 ?? raw["320filesize"]);
  put("flac", raw.hash_flac ?? raw.sqhash, raw.filesize_flac ?? raw.sqfilesize);
  put(
    "flac24bit",
    raw.hash_high ?? raw.hires_hash ?? raw.reshash,
    raw.filesize_high ?? raw.hires_filesize ?? raw.resfilesize,
  );

  return { qualities: Object.keys(hashes), hashes, sizes };
};

/**
 * 归一化 mobilecdn 专辑歌曲
 * @param raw - 原始歌曲条目
 * @param fallbackCover - 兜底封面模板
 * @param fallbackAlbumName - 兜底专辑名
 * @returns 对外歌曲对象
 */
const normalizeMobileSong = (raw: RawSong, fallbackCover: string, fallbackAlbumName: string) => {
  const trans = raw.trans_param || {};
  const coverTemplate = trans.union_cover || fallbackCover;
  const interval = Number(raw.duration || 0);
  const qualities = collectQualities(raw);

  const filename = String(raw.filename || "");
  const artistName = decodeName(raw.singername || filename.split(" - ")[0] || "");
  const songName = decodeName(raw.songname || filename.split(" - ").slice(1).join(" - "));

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
    album: pickAlbumName(raw) || fallbackAlbumName,
    albumId: String(raw.album_id || ""),
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
 * 归一化网关专辑歌曲
 * @param raw - 原始歌曲条目
 * @param fallbackCover - 兜底封面模板
 * @param fallbackAlbumName - 兜底专辑名
 * @returns 对外歌曲对象
 */
const normalizeGatewaySong = (raw: RawSong, fallbackCover: string, fallbackAlbumName: string) => {
  const base = raw.base || {};
  const audio = raw.audio_info || {};
  const albumInfo = raw.album_info || {};
  const trans = raw.trans_param || {};
  const deprecated = raw.deprecated || {};
  const authors = Array.isArray(raw.authors) ? raw.authors : [];

  const coverTemplate = albumInfo.cover || trans.union_cover || fallbackCover;
  const duration = Number(
    audio.duration_320 || audio.duration_128 || audio.duration_flac || audio.duration || 0,
  );
  const qualities = collectQualities(audio);

  const artistName = decodeName(
    authors
      .map((author: RawSong) => author.author_name)
      .filter(Boolean)
      .join(" / ") || base.author_name,
  );

  return {
    id: String(base.audio_id || audio.hash || ""),
    audioId: Number(base.audio_id || 0),
    albumAudioId: Number(base.album_audio_id || 0),
    /** 歌曲主键（album_audio_id 口径），查评论、签播放地址都用它 */
    mixSongId: String(base.album_audio_id || ""),
    hash: audio.hash_128 || audio.hash || "",
    name: decodeName(base.audio_name),
    artist: artistName,
    artists: authors.length
      ? authors.map((author: RawSong) => ({
          id: author.author_id === undefined ? "" : String(author.author_id),
          name: decodeName(author.author_name),
        }))
      : [{ id: "", name: artistName }],
    album: pickAlbumName(raw) || fallbackAlbumName,
    albumId: String(base.album_id || ""),
    cover: fillCover(coverTemplate, 300) ?? "",
    coverOriginal: fillCover(coverTemplate, 480) ?? "",
    duration,
    interval: Math.round(duration / 1000),
    qualities: qualities.qualities,
    hashes: qualities.hashes,
    sizes: qualities.sizes,
    pay: {
      payplay: Number(deprecated.pay_type || 0),
      pkgPrice: Number(deprecated.pkg_price || 0),
      price: Number(deprecated.price || 0),
    },
  };
};

/**
 * 由专辑名反查专辑 ID
 * @param idOrName - 专辑 ID 或专辑名
 * @returns 专辑 ID
 */
const resolveAlbumId = async (idOrName: string): Promise<string> => {
  if (/^[1-9]\d*$/.test(idOrName)) return idOrName;

  try {
    const response = await kgGatewayRequest<{
      data?: { lists?: RawSong[]; info?: RawSong[] };
    }>("/v1/search/album", {
      method: "GET",
      params: {
        keyword: idOrName,
        page: 1,
        pagesize: 1,
        platform: "AndroidFilter",
        iscorrection: 1,
        nocollect: 0,
      },
      headers: { "x-router": "complexsearch.kugou.com" },
      allowBusinessError: true,
    });

    const list = response?.data?.lists || response?.data?.info || [];
    if (list[0] && list[0].albumid) return String(list[0].albumid);
  } catch (err) {
    coreLog.warn("[kg-album] 专辑名转 ID 失败:", err);
  }
  return idOrName;
};

/**
 * 读取专辑元信息
 * @param albumId - 专辑 ID
 * @returns 专辑元信息与来源
 */
const loadAlbumDetail = async (albumId: string): Promise<{ detail: RawSong; source: string }> => {
  try {
    const response = await kgGatewayRequest<{ data?: RawSong[] }>("/kmr/v2/albums", {
      method: "POST",
      data: {
        data: [{ album_id: albumId }],
        fields:
          "album_id,album_name,publish_date,sizable_cover,intro,language,authors,author_name,songcount",
      },
      headers: { "x-router": "openapi.kugou.com", "kg-tid": "255" },
      allowBusinessError: true,
    });

    const code = kgErrorCode(response);
    if (code !== 0) throw new Error(`error_code=${code}`);

    const detail = (response.data || [])[0] || {};
    if (detail.album_name) return { detail, source: "gateway" };
  } catch (err) {
    coreLog.warn("[kg-album] 读取专辑详情失败，回落 mobilecdn:", err);
  }

  const response = await kgRequest<{ data?: RawSong }>(
    `http://mobilecdn.kugou.com/api/v3/album/info?albumid=${encodeURIComponent(albumId)}&format=json`,
    { allowBusinessError: true },
  );
  return { detail: response.data || {}, source: "mobilecdn" };
};

/**
 * 读取专辑歌曲列表
 * @param albumId - 专辑 ID
 * @returns 歌曲条目与来源
 */
const loadAlbumSongs = async (
  albumId: string,
): Promise<{ songs: RawSong[]; total: number; source: string }> => {
  try {
    const response = await kgGatewayRequest<{
      data?: RawSong[] | { songs?: RawSong[]; total?: number };
      total?: number;
    }>("/v1/album_audio/lite", {
      method: "POST",
      data: { album_id: albumId, page: 1, pagesize: 300 },
      headers: { "x-router": "openapi.kugou.com", "kg-tid": "255" },
      allowBusinessError: true,
    });

    const code = kgErrorCode(response);
    if (code !== 0) throw new Error(`error_code=${code}`);

    const data = response.data;
    const raw = Array.isArray(data) ? data : data?.songs || [];
    if (raw.length > 0) {
      const dataTotal = Array.isArray(data) ? 0 : data?.total;
      return {
        songs: raw,
        total: Number(response.total || dataTotal || raw.length),
        source: "gateway",
      };
    }
  } catch (err) {
    coreLog.warn("[kg-album] 读取专辑歌曲失败，回落 mobilecdn:", err);
  }

  const response = await kgRequest<{ data?: { info?: RawSong[]; total?: number } }>(
    `http://mobilecdn.kugou.com/api/v3/album/song?albumid=${encodeURIComponent(albumId)}&page=1&pagesize=300&format=json`,
    { allowBusinessError: true },
  );
  const raw = response?.data?.info || [];
  return {
    songs: raw,
    total: Number(response?.data?.total || raw.length),
    source: "mobilecdn",
  };
};

/**
 * 读取酷狗专辑详情
 *
 * @param params.id - 专辑 ID 或专辑名
 */
export const album: KGModule = async (params: KGParams) => {
  const rawId = String(params.id ?? params.album_id ?? params.albumId ?? "").trim();
  if (!rawId) return { code: 400, message: "id required" };

  try {
    const albumId = await resolveAlbumId(rawId);

    const detailResult = await loadAlbumDetail(albumId);
    const songsResult = await loadAlbumSongs(albumId);

    // 详情与歌曲可能来自不同来源，各自按来源的结构归一化
    const detailIsGateway = detailResult.source === "gateway";
    const songsAreGateway = songsResult.source === "gateway";
    const detail = detailResult.detail;
    const coverTemplate = detailIsGateway ? detail.sizable_cover : detail.imgurl;
    const authors = Array.isArray(detail.authors) ? detail.authors : [];
    const artistName = detailIsGateway
      ? decodeName(
          detail.author_name ||
            authors
              .map((author: RawSong) => author.author_name)
              .filter(Boolean)
              .join(" / "),
        )
      : decodeName(detail.singername);

    // 专辑名只有详情接口提供（歌曲条目不带），网关为 `album_name`，
    // mobilecdn 为 `albumname`
    const albumName = detailIsGateway
      ? decodeName(detail.album_name)
      : decodeName(detail.albumname);

    const normalized = songsResult.songs.map((song) =>
      songsAreGateway
        ? normalizeGatewaySong(song, coverTemplate, albumName)
        : normalizeMobileSong(song, coverTemplate, albumName),
    );

    return {
      code: 200,
      id: String(detail.album_id || detail.albumid || albumId),
      name: albumName,
      cover: fillCover(coverTemplate, 300) ?? "",
      coverOriginal: fillCover(coverTemplate, 480) ?? "",
      artist: artistName,
      artists: detailIsGateway
        ? authors.map((author: RawSong) => ({
            id: author.author_id === undefined ? "" : String(author.author_id),
            name: decodeName(author.author_name),
          }))
        : detail.singername
          ? [
              {
                id:
                  detail.singerid === undefined
                    ? String(detail.singername)
                    : String(detail.singerid),
                name: decodeName(detail.singername),
              },
            ]
          : [],
      publishTime: detailIsGateway ? detail.publish_date : detail.publishtime,
      description: decodeName(detail.intro),
      language: decodeName(detail.language),
      total: Number(detail.songcount || songsResult.total || normalized.length),
      songs: normalized,
      raw: {
        detail,
        songs: songsResult.songs,
        source: { detail: detailResult.source, songs: songsResult.source },
      },
    };
  } catch (err) {
    coreLog.error("[kg-album] 读取专辑失败:", err);
    return {
      code: 502,
      message: `读取专辑失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
