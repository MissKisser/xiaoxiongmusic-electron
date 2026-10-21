/**
 * 酷狗「我的歌单」读取模块
 *
 * 走概念版（lite）网关的 cloudlist 路由：
 * - 我的歌单列表：/v7/get_all_list
 * - 云端歌单里的歌：/v4/get_list_all_file
 *
 * 已实测：这两条路径在正式版标识下取不到（20017 / 502），必须用概念版。
 * 目录语义：type=0 自建，type=1 收藏（与网易云的 subtype 含义一致）。
 * listid=1「默认收藏」、listid=3「我喜欢」、listid=4 概念版「我喜欢的歌」。
 */

import { kgGatewayRequest } from "../core/request";
import { fillCover } from "../core/config";
import { extractEntryTitle } from "../core/song_title";
import { rsaEncryptKugou } from "../core/crypto";
import { getSessionCookies } from "../../../database/PlatformSessionDB";
import { coreLog } from "../../../logger";
import type { KGModule, KGParams } from "../core/types";

/** cloudlist 路由头 */
const CLOUDLIST_ROUTER = "cloudlist.service.kugou.com";

/** 封面模板的尺寸占位取值 */
const COVER_SIZE = 300;

interface KgPlaylistItem {
  listid?: number | string;
  name?: string;
  type?: number;
  count?: number;
  list_create_userid?: number | string;
  list_create_username?: string;
  /** 封面模板，尺寸以 `{size}` 占位 */
  pic?: string;
  intro?: string;
  create_time?: number;
  update_time?: number;
  is_def?: number;
  status?: number;
}

/**
 * 云歌单歌曲条目（上游 `/v4/get_list_all_file`）
 *
 * 该端点的歌名、专辑、时长字段与酷狗其它端点都不同：歌名混在 `name` 里、
 * 专辑名在 `albuminfo.name`、时长是 `timelen`（毫秒），且没有 `songname` /
 * `album_name` / `duration` 这些字段。
 */
interface KgSongItem {
  /** 内容哈希，播放地址与歌词接口以它为键 */
  hash?: string;
  /** 文件 ID */
  fileid?: number | string;
  /** 歌曲主键（album_audio_id 口径），查评论、签播放地址都用它 */
  mixsongid?: number | string;
  /** 音频 ID，云歌单里该字段常为 0 */
  audio_id?: number;
  /** 歌名，形态为「歌手们 - 歌名.mp3」 */
  name?: string;
  singername?: string;
  singerinfo?: Array<{ name?: string; id?: number }>;
  album_id?: number | string;
  /** 专辑信息对象，专辑名在 `name` 上 */
  albuminfo?: { id?: number | string; name?: string };
  /** 旧形态的专辑名字段 */
  album_name?: string;
  /** 时长（毫秒） */
  timelen?: number;
  /** 封面模板，尺寸以 `{size}` 占位 */
  cover?: string;
  media_pay_type?: number;
  language?: string;
  publish_date?: string;
  /** 各音质变体：不同 bitrate 对应不同 hash 与大小 */
  relate_goods?: Array<{
    hash?: string;
    size?: number;
    bitrate?: number;
    privilege?: number;
    level?: number;
  }>;
}

/**
 * 从云歌单歌曲条目里取专辑名
 *
 * 云歌单端点把专辑信息放在 `albuminfo` 对象里，兼容旧形态的 `album_name`。
 * @param song - 上游歌曲条目
 * @returns 专辑名，取不到时返回空串
 */
const pickAlbumName = (song: KgSongItem): string => {
  const info = song.albuminfo;
  if (info && typeof info === "object" && info.name) return String(info.name);
  return String(song.album_name ?? "");
};

/**
 * 把云歌单歌曲条目映射为对外结构
 *
 * 字段口径：
 * - `id` / `hash` 是内容哈希，是本模块对外的字符串主键；`mixSongId` 是歌曲
 *   主键（album_audio_id 口径），查评论、签播放地址都用它。
 * - 歌名混在 `name` 里（形态为「歌手们 - 歌名.mp3」），剥离规则由
 *   `../core/song_title` 统一提供，与公开歌单共用同一实现。
 * - 专辑名取 `albuminfo.name`，时长取 `timelen`（毫秒）。
 * @param song - 上游歌曲条目
 * @returns 对外歌曲对象
 */
const mapCloudSong = (song: KgSongItem) => {
  const singerinfo = Array.isArray(song.singerinfo) ? song.singerinfo : [];
  const duration = Number(song.timelen || 0);

  return {
    id: String(song.hash ?? ""),
    hash: song.hash ?? "",
    fileid: String(song.fileid ?? ""),
    audioId: Number(song.audio_id || 0),
    /** 歌曲主键（album_audio_id 口径），查评论、签播放地址都用它 */
    mixSongId: String(song.mixsongid ?? ""),
    albumAudioId: Number(song.mixsongid || 0),
    name: extractEntryTitle(song, { nameFields: ["name"] }),
    artist:
      song.singername ||
      singerinfo
        .map((singer) => singer.name ?? "")
        .filter(Boolean)
        .join(" / "),
    artists: singerinfo.map((singer) => ({
      id: String(singer.id ?? ""),
      name: singer.name ?? "",
    })),
    album: pickAlbumName(song),
    albumId: String(song.album_id ?? ""),
    cover: fillCover(song.cover, COVER_SIZE) ?? "",
    coverOriginal: fillCover(song.cover, 480) ?? "",
    duration,
    interval: Math.round(duration / 1000),
    /** 付费类型：非 0 表示 VIP 专享 */
    payType: song.media_pay_type ?? 0,
    language: song.language ?? "",
    publishDate: song.publish_date ?? "",
    /** 各音质变体（概念版提供） */
    qualities: (song.relate_goods ?? []).map((good) => ({
      bitrate: good.bitrate ?? 0,
      size: good.size ?? 0,
      hash: good.hash ?? "",
      privilege: good.privilege ?? 0,
      level: good.level ?? 0,
    })),
  };
};

/**
 * 读取当前账号的云端歌单列表（自建 + 收藏）
 */
export const user_playlist_list: KGModule = async () => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) {
    return { code: 401, message: "未登录" };
  }

  const response = await kgGatewayRequest<{
    data?: {
      info?: KgPlaylistItem[];
      list_count?: number;
      collect_count?: number;
      album_count?: number;
    };
  }>("/v7/get_all_list", {
    method: "POST",
    headers: { "x-router": CLOUDLIST_ROUTER },
    params: { plat: 1 },
    data: {
      userid: session.userid,
      token: session.token,
      total_ver: 979,
      type: 2,
      page: 1,
      pagesize: 100,
    },
  });

  const data = response?.data ?? {};
  const info = data.info ?? [];
  const owned = info.filter((item) => item.type !== 1);
  const favorites = info.filter((item) => item.type === 1);

  return {
    code: 200,
    total: info.length,
    listCount: data.list_count ?? owned.length,
    collectCount: data.collect_count ?? favorites.length,
    albumCount: data.album_count ?? 0,
    owned: owned.map((item) => ({
      listid: String(item.listid ?? ""),
      name: item.name ?? "",
      type: item.type ?? 0,
      count: item.count ?? 0,
      creator: item.list_create_username ?? "",
      cover: fillCover(item.pic, COVER_SIZE) ?? "",
      intro: item.intro ?? "",
      createTime: item.create_time ?? 0,
      updateTime: item.update_time ?? 0,
      isDefault: item.is_def === 1,
    })),
    favorites: favorites.map((item) => ({
      listid: String(item.listid ?? ""),
      name: item.name ?? "",
      type: item.type ?? 1,
      count: item.count ?? 0,
      creator: item.list_create_username ?? "",
      cover: fillCover(item.pic, COVER_SIZE) ?? "",
      intro: item.intro ?? "",
      createTime: item.create_time ?? 0,
      updateTime: item.update_time ?? 0,
      isDefault: item.is_def === 1,
    })),
  };
};

/**
 * 读取一个云端歌单里的歌曲
 * @param params.id 歌单 listid
 * @param params.page 页码，从 1 开始
 * @param params.pageSize 每页数量
 */
export const playlist_detail: KGModule = async (params: KGParams) => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) {
    return { code: 401, message: "未登录" };
  }
  const listid = String(params.id ?? "");
  if (!listid) return { code: 400, message: "id required" };

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = Math.max(1, Number(params.pageSize ?? 300) || 300);

  const response = await kgGatewayRequest<{
    data?: {
      info?: KgSongItem[];
      count?: number;
      page?: number;
      pagesize?: number;
      listid?: string | number;
    };
  }>("/v4/get_list_all_file", {
    method: "POST",
    headers: { "x-router": CLOUDLIST_ROUTER },
    params: { plat: 1 },
    data: {
      listid,
      userid: session.userid,
      area_code: 1,
      show_relate_goods: 1,
      pagesize: pageSize,
      allplatform: 1,
      show_cover: 1,
      type: 0,
      token: session.token,
      page,
    },
  });

  const data = response?.data ?? {};
  const songs = data.info ?? [];
  return {
    code: 200,
    id: String(data.listid ?? listid),
    page,
    pageSize,
    total: data.count ?? songs.length,
    songs: songs.map(mapCloudSong),
  };
};

/**
 * 读取账号资料
 */
export const user_profile: KGModule = async () => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) {
    return { code: 401, message: "未登录" };
  }
  try {
    const clienttime = Math.floor(Date.now() / 1000);
    const response = await kgGatewayRequest<{ data?: Record<string, unknown> }>("/v3/get_my_info", {
      method: "POST",
      headers: { "x-router": "usercenter.kugou.com" },
      params: { plat: 1 },
      data: {
        visit_time: clienttime,
        usertype: 1,
        // p 必须是 RSA 加密的票据，置空会被网关判为 20006（参数错误）
        p: rsaEncryptKugou({ token: session.token, clienttime }).toUpperCase(),
        userid: Number(session.userid),
      },
    });
    const info = response?.data ?? {};
    coreLog.info("[kg-user] 读取账号资料成功");
    return {
      code: 200,
      userId: String(session.userid),
      nickname: String(info.nickname ?? info.username ?? session.nickname ?? ""),
      avatar: String(info.pic ?? info.userpic ?? session.avatar ?? ""),
      vipType: Number(info.vip_type ?? session.vip_type ?? 0),
    };
  } catch (err) {
    coreLog.warn("[kg-user] 读取账号资料失败:", err);
    return { code: 502, message: "读取账号资料失败" };
  }
};
