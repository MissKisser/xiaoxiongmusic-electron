/**
 * QQ 音乐：歌手详情、热门歌曲与专辑
 *
 * 歌手以 mid 定位。歌曲与专辑分两个接口取，并行发出；
 * 歌手名优先取专辑列表里的歌手名，取不到时回落到歌曲的歌手名。
 */

import { qmRequest } from "../core/request";
import { coreLog } from "../../../logger";
import type { QMModule, QMParams } from "../core/types";

/**
 * 拼接歌手名
 * @param singers - 歌手数组
 * @returns 拼接后的歌手名
 */
const formatSingerName = (singers: unknown): string => {
  if (!Array.isArray(singers) || singers.length === 0) return "";
  return singers
    .map((item) => (item as { name?: string })?.name || "")
    .filter(Boolean)
    .join(" / ");
};

/**
 * 归一化歌手条目
 * @param singer - 接口返回的歌手
 * @returns 归一化后的歌手
 */
const normalizeSinger = (singer: any): Record<string, unknown> => ({
  id: String(singer?.id ?? ""),
  mid: singer?.mid ?? "",
  name: singer?.name ?? "",
});

/**
 * 归一化歌曲条目
 *
 * 歌曲 ID 在部分账号下超出安全整数范围，一律以字符串透传
 * @param song - 接口返回的歌曲
 * @returns 归一化后的歌曲
 */
const normalizeSong = (song: any): Record<string, unknown> => {
  const file = song.file || {};
  const pay = song.pay || {};

  return {
    id: String(song.id ?? ""),
    mid: song.mid ?? "",
    name: song.title ?? song.name ?? "",
    artist: formatSingerName(song.singer),
    artists: (song.singer || []).map(normalizeSinger),
    album: (song.album && song.album.name) || "",
    albumMid: (song.album && song.album.mid) || "",
    duration: (song.interval ?? 0) * 1000,
    mediaMid: file.media_mid ?? "",
    pay: {
      payalbum: pay.pay_month === 0 && (pay.price_album ?? 0) > 0 ? 1 : 0,
      payplay: pay.pay_play ?? 0,
    },
    size128: file.size_128mp3 ?? 0,
    size320: file.size_320mp3 ?? 0,
    sizeApe: file.size_ape ?? 0,
    sizeFlac: file.size_flac ?? 0,
    sizeOgg: file.size_192ogg ?? 0,
    sizeHiRes: (file.size_new && file.size_new[0]) ?? 0,
    hiResSampleRate: file.hires_sample ?? 0,
    hiResBitDepth: file.hires_bitdepth ?? 0,
  };
};

/**
 * 归一化专辑条目
 * @param album - 接口返回的专辑
 * @returns 归一化后的专辑
 */
const normalizeAlbum = (album: any): Record<string, unknown> => ({
  mid: album?.album_mid ?? "",
  name: album?.album_name ?? "",
  artist: album?.singer_name ?? "",
  trackCount: (album?.latest_song && album.latest_song.song_count) ?? 0,
  publishTime: album?.pub_time ?? "",
});

/**
 * 读取歌手详情、热门歌曲与专辑
 * @param params.mid - 歌手 mid
 * @param params.offset - 歌曲偏移
 * @param params.limit - 歌曲条数
 * @param params.includeAlbums - 是否同时读取专辑，缺省为 true
 */
export const artist: QMModule = async (params: QMParams) => {
  const mid = String(params.mid ?? params.singerMid ?? "").trim();
  if (!mid) return { code: 400, message: "mid required" };

  const offset = Math.max(0, Number(params.offset ?? 0) || 0);
  const limit = Math.min(200, Math.max(1, Number(params.limit ?? 50) || 50));
  const includeAlbums = params.includeAlbums !== false;

  try {
    const songsPromise = qmRequest<any>("musichall.song_list_server", "GetSingerSongList", {
      singerMid: mid,
      order: 1,
      begin: offset,
      num: limit,
    });
    const albumsPromise = includeAlbums
      ? qmRequest<any>("music.web_singer_info_svr", "get_singer_album", {
          singermid: mid,
          order: "time",
          begin: 0,
          num: 200,
          exstatus: 1,
        })
      : Promise.resolve(null);

    const [songsData, albumsData] = await Promise.all([songsPromise, albumsPromise]);

    const songs = ((songsData && songsData.songList) || [])
      .map((entry: any) => (entry && entry.songInfo) || null)
      .filter((song: any) => song && song.mid)
      .map(normalizeSong);
    const albums = ((albumsData && albumsData.list) || []).map(normalizeAlbum);

    return {
      code: 200,
      artist: {
        mid: (songsData && songsData.singerMid) || mid,
        name:
          (songs.length > 0 ? (songs[0].artist as string) : "") ||
          (albums.length > 0 ? (albums[0].artist as string) : ""),
        songCount: (songsData && songsData.totalNum) ?? songs.length,
        albumCount: (albumsData && albumsData.total) ?? albums.length,
      },
      songs,
      albums,
      raw: { songs: songsData, albums: albumsData },
    };
  } catch (err) {
    coreLog.error("[qm-artist] 读取歌手异常:", err);
    return {
      code: 502,
      message: `读取歌手失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
