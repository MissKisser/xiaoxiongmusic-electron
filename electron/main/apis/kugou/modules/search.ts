/**
 * 酷狗多分类搜索
 *
 * 支持的分类：
 * - 0 / "song"：单曲（主走 mobilecdn，含封面与音质分级；失败兜底 songsearch）
 * - 8 / "album"：专辑（网关 /v1/search/album，带 Android 签名与 complexsearch 路由）
 * - 9 / "artist" / "author"：歌手（网关 /v1/search/author）
 * - 2 / "playlist" / "special"：歌单（网关 /v1/search/special）
 *
 * 分页口径与 QQ 音乐搜索一致：每页返回上游分页窗口原样的一页，
 * 条数与请求的 limit 对齐，页与页之间既不重合也不跳页。
 *
 * 公开读接口，不依赖登录态，免登录即可调用；本机已登录时凭据随请求透传给网关。
 */

import { kgErrorCode, kgGatewayRequest, kgRequest } from "../core/request";
import {
  decodeName,
  fillCover,
  formatSingerName,
  KG_MOBILECDN_URL,
  KG_SEARCH_URL,
} from "../core/config";
import { coreLog } from "../../../logger";
import type { KGModule, KGParams } from "../core/types";

/** 搜索网关的路由头 */
const SEARCH_ROUTER = "complexsearch.kugou.com";

/** 搜索结果条目 */
type RawEntry = Record<string, any>;

/**
 * 把 mobilecdn 返回的歌手串拆成多歌手
 * @param name - 原始歌手串
 * @returns 格式化后的歌手名
 */
const formatMobileArtist = (name: unknown): string => {
  if (!name) return "";
  return decodeName(String(name))
    .split(/、|,|;|\//)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" / ");
};

/**
 * 把搜索分类归一成内部类型名
 * @param type - 分类
 * @returns 内部类型名，非法分类返回 null
 */
const resolveType = (type: unknown): string | null => {
  const key = String(type === undefined || type === null ? 0 : type).toLowerCase();
  if (key === "0" || key === "song") return "song";
  if (key === "8" || key === "album") return "album";
  if (key === "9" || key === "artist" || key === "author") return "artist";
  if (key === "2" || key === "playlist" || key === "special") return "playlist";
  return null;
};

/**
 * 把 mobilecdn 歌曲条目映射为对外结构
 * @param raw - 酷狗歌曲条目
 * @returns 对外歌曲对象
 */
const normalizeFromMobile = (raw: RawEntry) => {
  const sizes: Record<string, number> = {};
  const hashes: Record<string, string> = {};

  if (raw.filesize && raw.hash) {
    sizes["128k"] = raw.filesize;
    hashes["128k"] = raw.hash;
  }
  if (raw["320filesize"] && raw["320hash"]) {
    sizes["320k"] = raw["320filesize"];
    hashes["320k"] = raw["320hash"];
  }
  if (raw.sqfilesize && raw.sqhash) {
    sizes.flac = raw.sqfilesize;
    hashes.flac = raw.sqhash;
  }
  const hrSize = raw.hires_filesize ?? raw.resfilesize;
  const hrHash = raw.hires_hash ?? raw.reshash;
  if (hrSize && hrHash) {
    sizes.flac24bit = hrSize;
    hashes.flac24bit = hrHash;
  }

  const interval = raw.duration ?? 0;
  const coverTpl = raw.trans_param && raw.trans_param.union_cover;
  const artistName = formatMobileArtist(raw.singername);
  const artists = artistName ? artistName.split(" / ").map((name) => ({ id: name, name })) : [];

  return {
    id: String(raw.audio_id || raw.hash || ""),
    audioId: raw.audio_id ?? 0,
    albumAudioId: raw.album_audio_id,
    hash: raw.hash ?? "",
    name: decodeName(raw.songname || raw.filename || ""),
    artist: artistName,
    artists,
    album: decodeName(raw.album_name ?? ""),
    albumId: String(raw.album_id ?? ""),
    cover: fillCover(coverTpl, 300) ?? "",
    coverOriginal: fillCover(coverTpl, 480) ?? "",
    interval,
    duration: interval * 1000,
    qualities: Object.keys(hashes),
    hashes,
    sizes,
    pay: {
      payplay: raw.pay_type ?? 0,
      privilege: raw.privilege ?? 0,
      feetype: raw.feetype ?? 0,
      pkgPrice: raw.pkg_price ?? 0,
      price: raw.price ?? 0,
    },
  };
};

/**
 * 把兜底 songsearch 的歌曲条目映射为对外结构
 * @param raw - 酷狗歌曲条目
 * @returns 对外歌曲对象
 */
const normalizeFromLegacy = (raw: RawEntry) => {
  const sizes: Record<string, number> = {};
  const hashes: Record<string, string> = {};

  if (raw.FileSize && raw.FileHash) {
    sizes["128k"] = raw.FileSize;
    hashes["128k"] = raw.FileHash;
  }
  if (raw.HQFileSize && raw.HQFileHash) {
    sizes["320k"] = raw.HQFileSize;
    hashes["320k"] = raw.HQFileHash;
  }
  if (raw.SQFileSize && raw.SQFileHash) {
    sizes.flac = raw.SQFileSize;
    hashes.flac = raw.SQFileHash;
  }
  if (raw.ResFileSize && raw.ResFileHash) {
    sizes.flac24bit = raw.ResFileSize;
    hashes.flac24bit = raw.ResFileHash;
  }

  const singers = Array.isArray(raw.Singers) ? raw.Singers : [];
  const artistName = formatSingerName(singers);
  const artists = singers.length
    ? singers.map((s: RawEntry) => ({
        id: s.id !== undefined ? String(s.id) : s.name || undefined,
        name: decodeName(s.name || ""),
      }))
    : artistName
      ? [{ id: artistName, name: artistName }]
      : [];

  return {
    id: String(raw.Audioid || raw.FileHash || ""),
    audioId: raw.Audioid,
    albumAudioId: raw.MixSongID ?? raw.AlbumAudioId,
    hash: raw.FileHash || "",
    name: decodeName(raw.SongName || ""),
    artist: artistName,
    artists,
    album: decodeName(raw.AlbumName ?? ""),
    albumId: String(raw.AlbumID ?? ""),
    cover: "",
    coverOriginal: "",
    interval: raw.Duration ?? 0,
    duration: (raw.Duration ?? 0) * 1000,
    qualities: Object.keys(hashes),
    hashes,
    sizes,
    pay: {
      payplay: raw.PayType ?? 0,
      privilege: raw.Privilege ?? 0,
      pkgPrice: raw.PkgPrice ?? 0,
      price: raw.Price ?? 0,
    },
  };
};

/**
 * 走 mobilecdn 搜索歌曲
 *
 * 只取上游分页窗口本身：`data.info` 是上游按 `pagesize` 切好的一页，
 * 每条附带的 `group` 是同一首歌的关联版本，不属于分页窗口，
 * 展开它会让每页条数超过请求的 limit，也会让相邻两页出现重复条目。
 * @param keywords - 关键词
 * @param page - 页码
 * @param limit - 每页数量
 * @returns 歌曲、总数与上游原始响应
 */
const searchSongsMobile = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KG_MOBILECDN_URL}?keyword=${encodeURIComponent(keywords)}` +
    `&page=${page}&pagesize=${limit}&format=json&showtype=1`;

  const body = await kgRequest<{ data?: { info?: RawEntry[]; total?: number } }>(url, {
    allowBusinessError: true,
  });
  const raw = body?.data?.info || [];

  const songs: ReturnType<typeof normalizeFromMobile>[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const key = `${item.audio_id ?? ""}_${item.hash ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(normalizeFromMobile(item));
  }

  return { total: Number(body?.data?.total || songs.length), songs, raw: body };
};

/**
 * 走兜底 songsearch 搜索歌曲
 *
 * 与 mobilecdn 同口径：`data.lists` 是上游分页窗口本身，
 * 每条附带的 `Grp` 是关联版本，不计入分页窗口。
 * @param keywords - 关键词
 * @param page - 页码
 * @param limit - 每页数量
 * @returns 歌曲、总数与上游原始响应
 */
const searchSongsLegacy = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KG_SEARCH_URL}?keyword=${encodeURIComponent(keywords)}` +
    `&page=${page}&pagesize=${limit}` +
    `&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;

  const body = await kgRequest<{ data?: { lists?: RawEntry[]; total?: number } }>(url, {
    allowBusinessError: true,
  });
  const raw = body?.data?.lists || [];

  const songs: ReturnType<typeof normalizeFromLegacy>[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const key = `${item.Audioid}_${item.FileHash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(normalizeFromLegacy(item));
  }

  return { total: Number(body?.data?.total || songs.length), songs, raw: body };
};

/** 歌曲搜索单次尝试的结果 */
interface SongSearchAttempt {
  total: number;
  songs: Array<Record<string, unknown>>;
  raw: unknown;
}

/**
 * 搜索歌曲，mobilecdn 失败时回落到 songsearch
 *
 * 两条通道都空、而上游声称该页仍有数据时，判定为上游偶发空结果，
 * 再重试一次主通道；两条通道都空且上游也声称没有数据时，按真实空结果返回。
 * @param keywords - 关键词
 * @param page - 页码
 * @param limit - 每页数量
 * @returns 歌曲、总数与上游原始响应
 */
const searchSongs = async (keywords: string, page: number, limit: number) => {
  const attempt = async (): Promise<SongSearchAttempt> => {
    let mobile: SongSearchAttempt | null = null;
    try {
      mobile = await searchSongsMobile(keywords, page, limit);
    } catch {
      mobile = null;
    }
    if (mobile && mobile.songs.length > 0) return mobile;

    let legacy: SongSearchAttempt | null = null;
    try {
      legacy = await searchSongsLegacy(keywords, page, limit);
    } catch {
      legacy = null;
    }
    if (legacy && legacy.songs.length > 0) return legacy;

    return mobile ?? legacy ?? { total: 0, songs: [], raw: null };
  };

  const first = await attempt();
  if (first.songs.length > 0) return first;

  if (first.total > 0) {
    try {
      const retry = await searchSongsMobile(keywords, page, limit);
      if (retry.songs.length > 0) return retry;
    } catch {
      // 重试仍失败时按空结果返回
    }
  }

  return first;
};

/**
 * 从网关搜索响应里取出条目列表
 * @param res - 网关响应体
 * @returns 条目列表
 */
const pickList = (res: any): RawEntry[] => {
  const data = res?.data || {};
  if (Array.isArray(data.lists)) return data.lists;
  if (Array.isArray(data.info)) return data.info;
  return [];
};

/**
 * 调用网关搜索接口取一页条目
 *
 * 网关偶尔会返回「总数非零但本页列表为空」，判定为偶发空结果后重试一次。
 * @param path - 网关相对路径
 * @param keywords - 搜索关键词
 * @param page - 页码
 * @param limit - 每页数量
 * @param extraParams - 分类专属查询参数
 * @returns 网关响应体与本页条目
 */
const searchGatewayList = async (
  path: string,
  keywords: string,
  page: number,
  limit: number,
  extraParams: Record<string, unknown> = {},
): Promise<{ res: any; list: RawEntry[] }> => {
  const request = () =>
    kgGatewayRequest<{ data?: { total?: number; lists?: RawEntry[]; info?: RawEntry[] } }>(path, {
      method: "GET",
      params: {
        keyword: keywords,
        page,
        pagesize: limit,
        platform: "AndroidFilter",
        iscorrection: 1,
        ...extraParams,
      },
      headers: { "x-router": SEARCH_ROUTER },
      allowBusinessError: true,
    });

  let res = await request();
  let list = pickList(res);
  const total = Number(res?.data?.total ?? 0);
  if (list.length === 0 && total > 0) {
    res = await request();
    list = pickList(res);
  }
  return { res, list: list.slice(0, limit) };
};

/**
 * 搜索酷狗
 *
 * @param params.keywords - 搜索关键词
 * @param params.type - 搜索分类：0 单曲 / 8 专辑 / 9 歌手 / 2 歌单
 * @param params.page - 页码，从 1 开始
 * @param params.limit - 每页条数
 */
export const search: KGModule = async (params: KGParams) => {
  const keywords = String(params.keywords ?? params.keyword ?? "").trim();
  if (!keywords) return { code: 400, message: "keywords required" };

  const type = resolveType(params.type);
  if (!type) {
    return { code: 400, message: `不支持的酷狗搜索分类：${String(params.type)}` };
  }

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const limit = Math.max(1, Number(params.limit ?? 30) || 30);

  try {
    if (type === "song") {
      const result = await searchSongs(keywords, page, limit);
      const songs = result.songs.slice(0, limit);
      return {
        code: 200,
        type,
        page,
        limit,
        total: result.total,
        songs,
        items: songs,
        raw: result.raw,
      };
    }

    const path =
      type === "album"
        ? "/v1/search/album"
        : type === "artist"
          ? "/v1/search/author"
          : "/v1/search/special";

    const { res, list } = await searchGatewayList(
      path,
      keywords,
      page,
      limit,
      type === "album" ? { albumhide: 0, nocollect: 0 } : {},
    );

    const errCode = kgErrorCode(res);
    if (errCode !== 0) {
      return {
        code: 502,
        message: `酷狗${type === "album" ? "专辑" : type === "artist" ? "歌手" : "歌单"}搜索失败：error_code=${errCode}`,
        type,
        page,
        limit,
        raw: res,
      };
    }

    if (type === "album") {
      const albums = list.map((raw) => {
        const singerStr =
          raw.singer ||
          (raw.singers
            ? raw.singers
                .map((s: RawEntry) => s.name)
                .filter(Boolean)
                .join(" / ")
            : "");
        const artistId = raw.singerid || (raw.singerids && raw.singerids[0]);
        return {
          id: String(raw.albumid ?? ""),
          name: decodeName(raw.albumname),
          cover: fillCover(raw.img, 300) ?? "",
          artist: decodeName(singerStr),
          artistId: artistId !== undefined ? String(artistId) : undefined,
          trackCount: raw.songcount ?? 0,
          publishTime: raw.publish_time || undefined,
          intro: raw.intro || undefined,
        };
      });
      return {
        code: 200,
        type,
        page,
        limit,
        total: Number(res?.data?.total ?? albums.length),
        albums,
        items: albums,
        raw: res,
      };
    }

    if (type === "artist") {
      const artists = list.map((raw) => ({
        id: String(raw.AuthorId ?? ""),
        name: decodeName(raw.AuthorName),
        cover: fillCover(raw.Avatar || raw.FirstFrameImage, 300) ?? "",
        albumCount: raw.AlbumCount ?? 0,
        songCount: raw.AudioCount ?? 0,
        fansCount: raw.FansNum ?? 0,
      }));
      return {
        code: 200,
        type,
        page,
        limit,
        total: Number(res?.data?.total ?? artists.length),
        artists,
        items: artists,
        raw: res,
      };
    }

    const playlists = list.map((raw) => ({
      id: String(raw.specialid || raw.gid || ""),
      name: decodeName(raw.specialname),
      cover: fillCover(raw.img, 300) ?? "",
      creator: decodeName(raw.nickname),
      trackCount: raw.song_count ?? 0,
      playCount: Number(raw.play_count || raw.total_play_count || 0),
    }));
    return {
      code: 200,
      type,
      page,
      limit,
      total: Number(res?.data?.total ?? playlists.length),
      playlists,
      items: playlists,
      raw: res,
    };
  } catch (err) {
    coreLog.error("[kg-search] 酷狗搜索异常:", err);
    return {
      code: 502,
      message: `酷狗搜索失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
