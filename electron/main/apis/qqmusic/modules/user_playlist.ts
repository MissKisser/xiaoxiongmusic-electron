/**
 * QQ 音乐「我的歌单」读取模块
 *
 * 登录后读取：自建歌单、收藏歌单、我的喜欢、收藏状态。
 * 端点与参数取自社区实现（yakult-green-tea/qq-music-api），已用对照探测实证存在。
 *
 * 关键差异（相对网易云）：
 * - 自建与收藏是**两套目录语义**：自建 `dirType=0`，收藏 `dirType=3`
 * - 收藏目录（dirType=3）匿名接口读不到，必须带登录态走
 *   `music.srfDissInfo.aiDissInfo.uniform_get_Dissinfo` 重读
 */

import { qmRequest, getQQMusicUin, getQQMusicCookies } from "../core/request";
import { coreLog } from "../../../logger";
import type { QMModule, QMParams } from "../core/types";

/** 我喜欢目录的系统 dirId（红心写入也走这个目录） */
export const LIKED_DIR_ID = 201;

interface OwnedPlaylistEntry {
  tid?: number | string;
  dirId?: number | string;
  dirName?: string;
  dirType?: number;
  uin?: string | number;
  songnum?: number;
  songNum?: number;
  listenNum?: number;
  logo?: string;
  logoUrl?: string;
  /** 歌单封面直链 */
  picUrl?: string;
  /** 歌单封面直链（大图） */
  bigpicUrl?: string;
  /** 创建者昵称 */
  nick?: string;
  desc?: string;
  createTime?: number;
  updateTime?: number;
}

interface OwnedPlaylistResponse {
  total?: number;
  v_playlist?: OwnedPlaylistEntry[];
  v_delTid?: number[];
  bFinish?: boolean;
}

const positiveInt = (value: unknown): number | undefined => {
  const num = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof num === "number" && Number.isSafeInteger(num) && num > 0 ? num : undefined;
};

/**
 * 读取当前账号的自建 + 收藏歌单列表
 */
export const user_playlist_list: QMModule = async () => {
  const uin = getQQMusicUin();
  if (!uin || uin === "0") {
    return { code: 401, message: "未登录" };
  }

  const data = await qmRequest<OwnedPlaylistResponse>(
    "music.musicasset.PlaylistBaseRead",
    "GetPlaylistByUin",
    { uin },
    { session: false },
  );

  const list = data?.v_playlist ?? [];
  const owned = list.filter((item) => item.dirType === 0 || item.dirType === undefined);
  const favorites = list.filter((item) => item.dirType === 3);

  /**
   * 归一化歌单条目
   *
   * 封面直链优先取 `picUrl` / `bigpicUrl`，`logo` / `logoUrl` 作为旧字段兜底。
   * @param item - 上游歌单条目
   * @param dirType - 目录类型
   * @returns 归一化后的歌单条目
   */
  const toPlaylistEntry = (item: OwnedPlaylistEntry, dirType: number) => ({
    tid: positiveInt(item.tid) ?? 0,
    dirId: positiveInt(item.dirId) ?? 0,
    dirName: item.dirName ?? "",
    dirType,
    songNum: item.songnum ?? item.songNum ?? 0,
    listenNum: item.listenNum ?? 0,
    cover: item.picUrl ?? item.bigpicUrl ?? item.logo ?? item.logoUrl ?? "",
    creator: item.nick ?? "",
    description: item.desc ?? "",
    createTime: item.createTime ?? 0,
    updateTime: item.updateTime ?? 0,
  });

  return {
    code: 200,
    total: data?.total ?? list.length,
    bFinish: data?.bFinish ?? true,
    owned: owned.map((item) => toPlaylistEntry(item, item.dirType ?? 0)),
    favorites: favorites.map((item) => toPlaylistEntry(item, 3)),
  };
};

/**
 * 读取「我喜欢的音乐」中的歌曲
 *
 * 「我喜欢」是系统目录 dirId=201，读歌单要按它在自建列表里的 tid 取，
 * 目录号本身不能当 disstid 用。
 */
export const user_liked_songs: QMModule = async (params: QMParams) => {
  const uin = getQQMusicUin();
  if (!uin || uin === "0") {
    return { code: 401, message: "未登录" };
  }
  const cookies = getQQMusicCookies();

  // 先从自建列表定位「我喜欢」（系统目录 dirId=201）
  const listData = await qmRequest<{ v_playlist?: OwnedPlaylistEntry[] }>(
    "music.musicasset.PlaylistBaseRead",
    "GetPlaylistByUin",
    { uin },
    { session: false },
  );
  const likedEntry = (listData?.v_playlist ?? []).find(
    (item) => positiveInt(item.dirId) === LIKED_DIR_ID,
  );
  if (!likedEntry) {
    return { code: 404, message: "未找到「我喜欢」歌单" };
  }
  const likedTid = positiveInt(likedEntry.tid);
  if (!likedTid) {
    return { code: 404, message: "「我喜欢」缺少 tid" };
  }

  const data = await qmRequest<{
    songlist?: Array<{
      id?: number;
      mid?: string;
      name?: string;
      singer?: Array<{ name?: string }>;
      album?: string;
      interval?: number;
      pay?: Record<string, unknown>;
    }>;
    total_song_num?: number;
    hasmore?: number;
  }>(
    "music.srfDissInfo.DissInfo",
    "CgiGetDiss",
    {
      disstid: likedTid,
      dirid: LIKED_DIR_ID,
      tag: true,
      song_begin: Number(params.song_begin ?? 0),
      song_num: Number(params.song_num ?? 100),
      userinfo: true,
      orderlist: true,
      enc_host_uin: cookies.euin ?? "",
    },
    { session: false, webComm: true },
  );

  return {
    code: 200,
    tid: likedTid,
    dirId: LIKED_DIR_ID,
    total: data?.total_song_num ?? data?.songlist?.length ?? 0,
    hasmore: data?.hasmore ?? 0,
    songs: (data?.songlist ?? []).map((song) => ({
      id: song.id ?? 0,
      mid: song.mid ?? "",
      name: song.name ?? "",
      artist: (song.singer ?? [])
        .map((s) => s.name ?? "")
        .filter(Boolean)
        .join(" / "),
      album: song.album ?? "",
      duration: (song.interval ?? 0) * 1000,
      // 付费标记（pay_play / price_album），渲染端据此标记不可免费播放的曲目
      pay: song.pay ?? {},
    })),
  };
};

/**
 * 查询收藏状态
 * @param params.type playlist | album | song
 */
export const subscription_status: QMModule = async (params: QMParams) => {
  const uin = getQQMusicUin();
  if (!uin || uin === "0") {
    return { code: 401, message: "未登录" };
  }
  const type = String(params.type ?? "playlist");
  const ids = String(params.ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) return { code: 400, message: "ids required" };

  if (type === "playlist") {
    const data = await qmRequest<{ m_fan?: Record<string, boolean> }>(
      "music.musicasset.PlaylistFavRead",
      "IsPlaylistFan",
      { v_tid: ids.map(Number) },
      { session: false },
    );
    return {
      code: 200,
      type,
      items: ids.map((id) => ({ id, status: data?.m_fan?.[id] ? "subscribed" : "not-subscribed" })),
    };
  }

  if (type === "album") {
    const data = await qmRequest<{ m_fan?: Record<string, boolean> }>(
      "music.musicasset.AlbumFavRead",
      "IsAlbumFan",
      { uin, v_albumMid: ids },
      { session: false },
    );
    return {
      code: 200,
      type,
      items: ids.map((id) => ({ id, status: data?.m_fan?.[id] ? "subscribed" : "not-subscribed" })),
    };
  }

  if (type === "song") {
    const data = await qmRequest<{ m_fan?: Record<string, boolean> }>(
      "music.musicasset.SongFavRead",
      "IsSongFanByMid",
      { v_songMid: ids },
      { session: false },
    );
    return {
      code: 200,
      type,
      items: ids.map((id) => ({ id, status: data?.m_fan?.[id] ? "subscribed" : "not-subscribed" })),
    };
  }

  return { code: 400, message: `unsupported type: ${type}` };
};

/**
 * 取第一个非空字符串
 * @param values 候选值
 * @returns 第一个非空字符串；全为空时返回空串
 */
const firstNonEmpty = (...values: Array<string | undefined>): string =>
  values.find((value) => typeof value === "string" && value.trim() !== "") ?? "";

/**
 * 读取一张歌单的详情与歌曲
 * @param params.id 歌单 tid
 * @param params.dirId 歌单目录号（自己的歌单需要，普通歌单可省）
 */
export const playlist_detail: QMModule = async (params: QMParams) => {
  const id = String(params.id ?? "");
  if (!id) return { code: 400, message: "id required" };
  const cookies = getQQMusicCookies();

  const data = await qmRequest<{
    code?: number;
    songlist?: Array<{
      id?: number;
      mid?: string;
      name?: string;
      singer?: Array<{ name?: string }>;
      album?: string;
      interval?: number;
      pay?: Record<string, unknown>;
    }>;
    total_song_num?: number;
    hasmore?: number;
    cdlist?: Array<{ dissname?: string; logo?: string; nickname?: string; desc?: string }>;
    dirinfo?: {
      title?: string;
      picurl?: string;
      picurl2?: string;
      headurl?: string;
      desc?: string;
      host_nick?: string;
    };
  }>(
    "music.srfDissInfo.DissInfo",
    "CgiGetDiss",
    {
      disstid: Number(id),
      dirid: Number(params.dirId ?? 0),
      tag: true,
      song_begin: Number(params.song_begin ?? 0),
      song_num: Number(params.song_num ?? 100),
      userinfo: true,
      orderlist: true,
      enc_host_uin: cookies.euin ?? "",
    },
    { session: false, webComm: true },
  );

  // 自建歌单的响应没有 cdlist（普通歌单才有），标题与封面在 dirinfo 里
  const cd = data?.cdlist?.[0];
  const dirInfo = data?.dirinfo;
  return {
    code: 200,
    id,
    name: firstNonEmpty(cd?.dissname, dirInfo?.title),
    creator: firstNonEmpty(cd?.nickname, dirInfo?.host_nick),
    cover: firstNonEmpty(cd?.logo, dirInfo?.picurl, dirInfo?.picurl2, dirInfo?.headurl),
    description: firstNonEmpty(cd?.desc, dirInfo?.desc),
    total: data?.total_song_num ?? data?.songlist?.length ?? 0,
    hasmore: data?.hasmore ?? 0,
    songs: (data?.songlist ?? []).map((song) => ({
      id: song.id ?? 0,
      mid: song.mid ?? "",
      name: song.name ?? "",
      artist: (song.singer ?? [])
        .map((s) => s.name ?? "")
        .filter(Boolean)
        .join(" / "),
      album: song.album ?? "",
      duration: (song.interval ?? 0) * 1000,
      // 付费标记（pay_play / price_album），渲染端据此标记不可免费播放的曲目
      pay: song.pay ?? {},
    })),
  };
};

/**
 * 读取歌单的编辑信息（改名时保留描述/封面/标签要用）
 */
export const playlist_edit_info: QMModule = async (params: QMParams) => {
  const dirId = Number(params.dirId ?? 0);
  if (!dirId) return { code: 400, message: "dirId required" };

  const data = await qmRequest<{
    dirinfo?: {
      dirid?: number;
      title?: string;
      desc?: string;
      picurl?: string;
      picurl2?: string;
      dir_show?: number;
      tag?: Array<{ id: number; name: string }>;
    };
  }>(
    "music.srfDissInfo.aiDissInfo",
    "uniform_get_Dissinfo",
    { dirid: dirId, optype: 3, tag: 1, userinfo: 0, pic_dpi: 300 },
    { session: false, webComm: true },
  );

  const info = data?.dirinfo;
  if (!info) {
    coreLog.warn("[qm-playlist] 读取歌单编辑信息失败:", dirId);
    return { code: 404, message: "歌单编辑信息不可读" };
  }

  return {
    code: 200,
    dirId,
    title: info.title ?? "",
    desc: info.desc ?? "",
    picurl: info.picurl ?? "",
    picurl2: info.picurl2 ?? "",
    dirShow: info.dir_show === 2 ? 2 : 1,
    tag: info.tag ?? [],
  };
};

/**
 * 按 song mid 读歌曲详情（拿到写入歌单所需的数字 id）
 * @param params.mid 歌曲 mid
 */
export const song_detail: QMModule = async (params: QMParams) => {
  const mid = String(params.mid ?? "");
  if (!mid) return { code: 400, message: "mid required" };

  const data = await qmRequest<{
    track_info?: {
      id?: number;
      mid?: string;
      name?: string;
      title?: string;
      singer?: Array<{ name?: string }>;
      album?: { name?: string };
      interval?: number;
    };
  }>(
    "music.pf_song_detail_svr",
    "get_song_detail_yqq",
    { song_type: 0, song_mid: mid },
    { session: false },
  );

  const track = data?.track_info;
  if (!track?.id) {
    return { code: 404, message: "歌曲不存在" };
  }

  return {
    code: 200,
    id: track.id,
    mid: track.mid ?? mid,
    name: track.name ?? track.title ?? "",
    artist: (track.singer ?? [])
      .map((s) => s.name ?? "")
      .filter(Boolean)
      .join(" / "),
    album: track.album?.name ?? "",
    duration: (track.interval ?? 0) * 1000,
  };
};
