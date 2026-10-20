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
import { getSessionCookies } from "../../../database/PlatformSessionDB";
import { coreLog } from "../../../logger";
import type { KGModule, KGParams } from "../core/types";

/** cloudlist 路由头 */
const CLOUDLIST_ROUTER = "cloudlist.service.kugou.com";

interface KgPlaylistItem {
  listid?: number | string;
  name?: string;
  type?: number;
  count?: number;
  list_create_userid?: number | string;
  list_create_username?: string;
  pic?: string;
  intro?: string;
  create_time?: number;
  update_time?: number;
  is_def?: number;
  status?: number;
}

interface KgSongItem {
  hash?: string;
  audio_id?: number;
  filename?: string;
  songname?: string;
  singername?: string;
  singerinfo?: Array<{ name?: string; id?: number }>;
  album_id?: number | string;
  album_name?: string;
  duration?: number;
  media_pay_type?: number;
  language?: string;
  publish_date?: string;
  /** 各音质变体：不同 bitrate 对应不同 hash 与大小 */
  relate_goods?: Array<{ hash?: string; size?: number; bitrate?: number; privilege?: number; level?: number }>;
}

/**
 * 读取当前账号的云端歌单列表（自建 + 收藏）
 */
export const user_playlist_list: KGModule = async (_params: KGParams) => {
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
      cover: item.pic ?? "",
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
      cover: item.pic ?? "",
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
    songs: songs.map((song) => ({
      id: String(song.hash ?? ""),
      hash: song.hash ?? "",
      audioId: song.audio_id ?? 0,
      name: song.songname ?? song.filename ?? "",
      artist:
        song.singername ??
        (song.singerinfo ?? []).map((s) => s.name ?? "").filter(Boolean).join(" / "),
      artists: (song.singerinfo ?? []).map((s) => ({ id: String(s.id ?? ""), name: s.name ?? "" })),
      album: song.album_name ?? "",
      albumId: String(song.album_id ?? ""),
      duration: song.duration ?? 0,
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
    })),
  };
};

/**
 * 读取账号资料
 */
export const user_profile: KGModule = async (_params: KGParams) => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) {
    return { code: 401, message: "未登录" };
  }
  try {
    const response = await kgGatewayRequest<{ data?: Record<string, unknown> }>(
      "/v3/get_my_info",
      {
        method: "POST",
        headers: { "x-router": "usercenter.kugou.com" },
        params: { plat: 1 },
        data: {
          visit_time: Math.floor(Date.now() / 1000),
          usertype: 1,
          p: "",
          userid: Number(session.userid),
        },
      },
    );
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
