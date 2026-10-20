/**
 * 酷狗歌单写操作模块
 *
 * 覆盖：创建歌单、改名/改简介/改标签、删除歌单、加歌/删歌、收藏/取消收藏。
 *
 * 语义对齐 QQ 音乐：所有写入都遵循「写入 → 读回确认 → 才返回成功」，
 * 读回不符时返回失败且不自动重试，避免界面显示成功而平台没改。
 *
 * 协议分工：
 * - 协议 A（Android 签名 + 明文 JSON）：创建歌单、加歌、删歌、删除/取消收藏
 * - 协议 B（RSA 传参 + AES 加密 body）：修改歌单信息
 */

import { getSessionCookies } from "../../../database/PlatformSessionDB";
import { coreLog } from "../../../logger";
import {
  KG_CLOUD_APPID,
  KG_CLOUD_CLIENTVER,
  KG_CLOUD_SIGN_SALT,
  KG_CLOUDLIST_ROUTER,
  getCloudDeviceMid,
  sendCloudRequest,
  sendGatewayRequest,
  type KgRequestContext,
  type KgSendResult,
} from "../core/cloud";
import type { KGModule, KGParams } from "../core/types";

/** 公开歌单信息接口（取收藏所需的创建者与原始歌单号） */
const KG_SPECIAL_INFO_URL = "http://mobilecdn.kugou.com/api/v3/special/info";

/** 公开歌单信息接口的 UA */
const KG_ANDROID_UA = "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi";

/** 单次写入的最大歌曲数 */
const MAX_TRACKS = 200;

/** 「我的歌单」条目 */
interface KgListItem {
  listid?: number | string;
  name?: string;
  type?: number;
  count?: number;
  intro?: string;
  tags?: string;
  pic?: string;
  is_def?: number;
  list_create_userid?: number | string;
  list_create_listid?: number | string;
  list_create_gid?: string;
  list_create_username?: string;
}

/** 歌单内的歌曲条目 */
interface KgSongRow {
  hash?: string;
  fileid?: number | string;
  songname?: string;
  filename?: string;
  album_id?: number | string;
  mixsongid?: number | string;
}

/** 公开歌单信息 */
interface KgPublicPlaylist {
  /** 创建者 userid */
  suid: string;
  /** 原始歌单号 */
  specialid: string;
  /** 歌单名 */
  name: string;
}

/**
 * 从登录态构造协议请求上下文
 * @returns 请求上下文，未登录时返回 null
 */
const currentContext = (): KgRequestContext | null => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) return null;
  return {
    appid: KG_CLOUD_APPID,
    clientver: KG_CLOUD_CLIENTVER,
    signSalt: KG_CLOUD_SIGN_SALT,
    mid: getCloudDeviceMid(),
    dfid: session.dfid || "-",
    userid: session.userid,
    token: session.token,
    clienttime: Math.floor(Date.now() / 1000),
  };
};

/**
 * 校验网关响应是否成功
 * @param res - 网关响应
 * @returns 失败原因，成功时返回空串
 */
const responseError = (res: KgSendResult): string => {
  if (res.status !== 200) return `HTTP ${res.status}`;
  const body = res.body;
  if (!body || typeof body !== "object") return "响应格式异常";
  const code = Number(body.error_code ?? 0);
  if (code !== 0) return `error_code=${code}`;
  if (Number(body.status ?? 1) !== 1) return `status=${body.status}`;
  return "";
};

/**
 * 读取账号的云端歌单列表（自建 + 收藏）
 * @param ctx - 请求上下文
 * @returns 歌单条目与列表版本号
 */
const readMyLists = async (
  ctx: KgRequestContext,
): Promise<{ items: KgListItem[]; totalVer: number }> => {
  const res = await sendGatewayRequest(
    "/v7/get_all_list",
    {
      userid: Number(ctx.userid),
      token: ctx.token,
      total_ver: 0,
      type: 2,
      page: 1,
      pagesize: 100,
    },
    ctx,
    { params: { plat: 1 }, headers: { "x-router": KG_CLOUDLIST_ROUTER } },
  );
  const data = (res.body?.data ?? {}) as { info?: KgListItem[]; total_ver?: number };
  return {
    items: Array.isArray(data.info) ? data.info : [],
    totalVer: Number(data.total_ver ?? 0),
  };
};

/**
 * 读取一个云歌单里的歌曲
 * @param ctx - 请求上下文
 * @param listid - 歌单 listid
 * @returns 歌曲条目与歌曲总数
 */
const readListSongs = async (
  ctx: KgRequestContext,
  listid: string,
): Promise<{ items: KgSongRow[]; count: number }> => {
  const res = await sendGatewayRequest(
    "/v4/get_list_all_file",
    {
      listid,
      userid: Number(ctx.userid),
      area_code: 1,
      show_relate_goods: 1,
      pagesize: 300,
      allplatform: 1,
      show_cover: 1,
      type: 0,
      token: ctx.token,
      page: 1,
    },
    ctx,
    { params: { plat: 1 }, headers: { "x-router": KG_CLOUDLIST_ROUTER } },
  );
  const data = (res.body?.data ?? {}) as { info?: KgSongRow[]; count?: number };
  return {
    items: Array.isArray(data.info) ? data.info : [],
    count: Number(data.count ?? 0),
  };
};

/**
 * 读取公开歌单信息（收藏时取创建者与原始歌单号）
 * @param specialid - 公开歌单号
 * @returns 歌单信息，取不到时返回 null
 */
const readPublicPlaylist = async (specialid: string): Promise<KgPublicPlaylist | null> => {
  const url = `${KG_SPECIAL_INFO_URL}?specialid=${encodeURIComponent(specialid)}&format=json`;
  const res = await fetch(url, {
    headers: { "User-Agent": KG_ANDROID_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data?: { suid?: number | string; specialid?: number | string; specialname?: string };
  };
  const suid = String(body?.data?.suid ?? "");
  const id = String(body?.data?.specialid ?? "");
  if (!suid || !id) return null;
  return { suid, specialid: id, name: String(body?.data?.specialname ?? "") };
};

/**
 * 在歌单列表中定位条目
 * @param items - 歌单条目
 * @param listid - 歌单 listid
 * @returns 命中的条目，未命中时返回 undefined
 */
const findByListId = (items: KgListItem[], listid: string): KgListItem | undefined =>
  items.find((item) => String(item.listid ?? "") === listid);

/**
 * 创建歌单
 * @param params.name - 歌单名
 */
export const playlist_create: KGModule = async (params: KGParams) => {
  const name = String(params.name ?? "").trim();
  if (!name) return { code: 400, message: "name required" };

  const ctx = currentContext();
  if (!ctx) return { code: 401, message: "未登录" };

  const res = await sendGatewayRequest(
    "/cloudlist.service/v5/add_list",
    {
      userid: Number(ctx.userid),
      token: ctx.token,
      total_ver: 0,
      name,
      type: 0,
      source: 1,
      is_pri: 0,
      list_create_userid: Number(ctx.userid),
      list_create_listid: 0,
      list_create_gid: "",
      from_shupinmv: 0,
    },
    ctx,
    {
      params: {
        last_time: ctx.clienttime,
        last_area: "gztx",
        userid: ctx.userid,
        token: ctx.token,
      },
    },
  );

  const err = responseError(res);
  if (err) {
    coreLog.warn("[kg-playlist] 创建歌单失败:", err);
    return { code: 502, message: `创建歌单失败：${err}` };
  }

  const listid = String(res.body?.data?.info?.list_create_listid ?? "");
  if (!listid || listid === "0") {
    return { code: 502, message: "创建歌单返回缺少 listid" };
  }

  const snapshot = await readMyLists(ctx);
  const created = findByListId(snapshot.items, listid);
  if (!created) return { code: 502, message: "创建后读回校验失败：歌单列表中未找到新歌单" };
  if (created.name && created.name !== name) {
    return { code: 502, message: `创建后读回校验失败：歌单名为 ${created.name}` };
  }

  return { code: 200, id: listid, name: created.name ?? name, verified: true };
};

/**
 * 修改歌单信息（改名 / 改简介 / 改标签）
 * @param params.id - 歌单 listid
 * @param params.name - 新歌单名
 * @param params.intro - 新简介，缺省则不改动
 * @param params.tags - 新标签，缺省则不改动
 */
export const playlist_rename: KGModule = async (params: KGParams) => {
  const id = String(params.id ?? "").trim();
  const name = String(params.name ?? "").trim();
  if (!id) return { code: 400, message: "id required" };
  if (!name) return { code: 400, message: "name required" };
  const intro = params.intro === undefined ? undefined : String(params.intro);
  const tags = params.tags === undefined ? undefined : String(params.tags);

  const ctx = currentContext();
  if (!ctx) return { code: 401, message: "未登录" };

  const snapshot = await readMyLists(ctx);
  const target = findByListId(snapshot.items, id);
  if (!target) return { code: 404, message: "歌单不存在" };
  if (Number(target.type ?? 0) === 1) return { code: 400, message: "收藏的歌单不支持改名" };
  if (Number(target.is_def ?? 0) > 0) return { code: 400, message: "系统歌单不支持改名" };

  const body: Record<string, unknown> = {
    total_ver: snapshot.totalVer,
    listid: Number(id),
    type: Number(target.type ?? 0),
    sort: 0,
    name,
  };
  if (intro !== undefined) body.intro = intro;
  if (tags !== undefined) body.tags = tags;

  const res = await sendCloudRequest("/v1/modify_list", body, ctx);
  const err = responseError(res);
  if (err) {
    coreLog.warn("[kg-playlist] 修改歌单信息失败:", err);
    return { code: 502, message: `修改歌单信息失败：${err}` };
  }

  const after = await readMyLists(ctx);
  const updated = findByListId(after.items, id);
  if (!updated) return { code: 502, message: "修改后读回校验失败：歌单不存在" };
  if (updated.name !== name) {
    return { code: 502, message: `修改后读回校验失败：当前名称 ${updated.name}` };
  }
  if (intro !== undefined && updated.intro !== undefined && updated.intro !== intro) {
    return { code: 502, message: `修改后读回校验失败：当前简介 ${updated.intro}` };
  }

  return { code: 200, id, name: updated.name, verified: true };
};

/**
 * 删除自建歌单
 * @param params.id - 歌单 listid
 */
export const playlist_delete: KGModule = async (params: KGParams) => {
  const id = String(params.id ?? "").trim();
  if (!id) return { code: 400, message: "id required" };

  const ctx = currentContext();
  if (!ctx) return { code: 401, message: "未登录" };

  const snapshot = await readMyLists(ctx);
  const target = findByListId(snapshot.items, id);
  if (!target) return { code: 404, message: "歌单不存在" };
  if (Number(target.type ?? 0) !== 0) return { code: 400, message: "仅支持删除自建歌单" };
  if (Number(target.is_def ?? 0) > 0) return { code: 400, message: "系统歌单不允许删除" };

  const res = await sendGatewayRequest(
    "/v3/delete_list",
    {
      userid: Number(ctx.userid),
      token: ctx.token,
      total_ver: snapshot.totalVer,
      type: 0,
      listid: Number(id),
      name: target.name ?? "",
    },
    ctx,
    {
      params: {
        last_time: ctx.clienttime,
        last_area: "gztx",
        userid: ctx.userid,
        token: ctx.token,
        plat: 1,
      },
      headers: { "x-router": KG_CLOUDLIST_ROUTER },
    },
  );

  const err = responseError(res);
  if (err) {
    coreLog.warn("[kg-playlist] 删除歌单失败:", err);
    return { code: 502, message: `删除歌单失败：${err}` };
  }

  const after = await readMyLists(ctx);
  if (findByListId(after.items, id)) {
    return { code: 502, message: "删除后读回校验失败：歌单仍存在" };
  }

  return { code: 200, id, deleted: true, verified: true };
};

/**
 * 往歌单加歌 / 从歌单删歌
 * @param params.op - add | del
 * @param params.id - 歌单 listid，like 为 true 时可缺省
 * @param params.songs - 歌曲列表 [{ hash, name, album_id, mixsongid, fileid }]，hash 与 name 均必填
 * @param params.like - 为 true 时写入「我喜欢」歌单
 */
export const playlist_tracks: KGModule = async (params: KGParams) => {
  const op = String(params.op ?? "add");
  if (op !== "add" && op !== "del") return { code: 400, message: "op 必须是 add 或 del" };

  const songs = (Array.isArray(params.songs) ? params.songs : []) as Array<
    Record<string, unknown>
  >;
  if (songs.length < 1) return { code: 400, message: "songs required" };
  if (songs.length > MAX_TRACKS) return { code: 400, message: "songs 数量超出上限" };

  const hashes = songs.map((song) => String(song.hash ?? "").trim().toUpperCase());
  if (hashes.some((hash) => !hash)) {
    return { code: 400, message: "songs 中存在缺少 hash 的条目" };
  }
  // 酷狗加歌接口要求携带歌名，歌名为空会被服务端以 error_code=20010 拒绝
  const names = songs.map((song) => String(song.name ?? "").trim());
  if (names.some((name) => !name)) {
    return { code: 400, message: "songs 中存在缺少 name 的条目" };
  }

  const ctx = currentContext();
  if (!ctx) return { code: 401, message: "未登录" };

  // 红心目标歌单按 is_def 动态定位，不写死 listid
  let listid = String(params.id ?? "").trim();
  if (params.like === true) {
    const snapshot = await readMyLists(ctx);
    const liked = snapshot.items.find((item) => Number(item.is_def) === 2);
    if (!liked) return { code: 404, message: "未找到「我喜欢」歌单" };
    listid = String(liked.listid ?? "");
  }
  if (!listid) return { code: 400, message: "id required" };

  if (op === "add") {
    const data = songs.map((song, index) => ({
      number: index + 1,
      name: names[index],
      hash: hashes[index],
      size: 0,
      sort: 0,
      timelen: 0,
      bitrate: 128,
      album_id: Number(song.album_id ?? 0),
      mixsongid: Number(song.mixsongid ?? 0),
    }));

    const res = await sendGatewayRequest(
      "/cloudlist.service/v6/add_song",
      {
        userid: Number(ctx.userid),
        token: ctx.token,
        listid: Number(listid),
        list_ver: 0,
        type: 0,
        slow_upload: 1,
        scene: "false;null",
        data,
      },
      ctx,
      {
        params: {
          last_time: ctx.clienttime,
          last_area: "gztx",
          userid: ctx.userid,
          token: ctx.token,
        },
      },
    );

    const err = responseError(res);
    if (err) {
      coreLog.warn("[kg-playlist] 加歌失败:", err);
      return { code: 502, message: `加歌失败：${err}` };
    }

    const after = await readListSongs(ctx, listid);
    const missing = hashes.filter(
      (hash) => !after.items.some((row) => String(row.hash ?? "").toUpperCase() === hash),
    );
    if (missing.length > 0) {
      return { code: 502, message: `加歌后读回校验失败：缺少 ${missing.length} 首` };
    }

    return { code: 200, id: listid, changed: true, count: after.count, verified: true };
  }

  const before = await readListSongs(ctx, listid);
  const fileIds: number[] = [];
  for (const [index, song] of songs.entries()) {
    const fileid = Number(song.fileid ?? 0);
    if (fileid) {
      fileIds.push(fileid);
      continue;
    }
    const hit = before.items.find(
      (row) => String(row.hash ?? "").toUpperCase() === hashes[index],
    );
    if (!hit || !hit.fileid) {
      return { code: 400, message: `未在歌单中找到可删除的歌曲：${hashes[index]}` };
    }
    fileIds.push(Number(hit.fileid));
  }

  const res = await sendGatewayRequest(
    "/v4/delete_songs",
    {
      listid: Number(listid),
      userid: Number(ctx.userid),
      data: fileIds.map((fileid) => ({ fileid })),
      type: 0,
      token: ctx.token,
      list_ver: 0,
    },
    ctx,
    {
      params: {
        last_time: ctx.clienttime,
        last_area: "gztx",
        userid: ctx.userid,
        token: ctx.token,
      },
      headers: { "x-router": KG_CLOUDLIST_ROUTER },
    },
  );

  const err = responseError(res);
  if (err) {
    coreLog.warn("[kg-playlist] 删歌失败:", err);
    return { code: 502, message: `删歌失败：${err}` };
  }

  const after = await readListSongs(ctx, listid);
  const still = hashes.filter((hash) =>
    after.items.some((row) => String(row.hash ?? "").toUpperCase() === hash),
  );
  if (still.length > 0) {
    return { code: 502, message: `删歌后读回校验失败：仍有 ${still.length} 首` };
  }

  return { code: 200, id: listid, changed: true, count: after.count, verified: true };
};

/**
 * 收藏 / 取消收藏公开歌单
 * @param params.id - 原始歌单号（公开歌单 id）
 * @param params.subscribed - true 收藏 / false 取消收藏
 */
export const playlist_subscribe: KGModule = async (params: KGParams) => {
  const id = String(params.id ?? "").trim();
  const subscribed = params.subscribed;
  if (!id) return { code: 400, message: "id required" };
  if (typeof subscribed !== "boolean") return { code: 400, message: "subscribed 必须是布尔值" };

  const ctx = currentContext();
  if (!ctx) return { code: 401, message: "未登录" };

  const snapshot = await readMyLists(ctx);
  const collected = snapshot.items.find(
    (item) => Number(item.type ?? 0) === 1 && String(item.list_create_listid ?? "") === id,
  );

  if (subscribed) {
    if (collected) return { code: 200, id, subscribed: true, already: true, verified: true };

    const origin = await readPublicPlaylist(id);
    if (!origin) {
      return { code: 502, message: "无法获取该公开歌单的创建者信息（suid / specialid），未执行收藏" };
    }

    const res = await sendGatewayRequest(
      "/cloudlist.service/v5/add_list",
      {
        userid: Number(ctx.userid),
        token: ctx.token,
        total_ver: 0,
        name: origin.name,
        type: 1,
        source: 1,
        is_pri: 0,
        list_create_userid: Number(origin.suid),
        list_create_listid: Number(origin.specialid),
        list_create_gid: `collection_3_${origin.suid}_${origin.specialid}_0`,
        from_shupinmv: 0,
      },
      ctx,
    );

    const err = responseError(res);
    if (err) {
      coreLog.warn("[kg-playlist] 收藏歌单失败:", err);
      return { code: 502, message: `收藏歌单失败：${err}` };
    }

    // 服务端收藏成功后会重新分配本地 listid，只能按原始歌单号比对
    const after = await readMyLists(ctx);
    const hit = after.items.find(
      (item) =>
        Number(item.type ?? 0) === 1 &&
        String(item.list_create_listid ?? "") === String(origin.specialid),
    );
    if (!hit) return { code: 502, message: "收藏后读回校验失败：收藏列表中未找到该歌单" };

    return { code: 200, id: String(origin.specialid), subscribed: true, verified: true };
  }

  if (!collected) return { code: 400, message: "未收藏该歌单" };

  const res = await sendGatewayRequest(
    "/v3/delete_list",
    {
      userid: Number(ctx.userid),
      token: ctx.token,
      total_ver: snapshot.totalVer,
      type: 1,
      listid: Number(collected.listid),
      name: collected.name ?? "",
    },
    ctx,
    {
      params: {
        last_time: ctx.clienttime,
        last_area: "gztx",
        userid: ctx.userid,
        token: ctx.token,
        plat: 1,
      },
      headers: { "x-router": KG_CLOUDLIST_ROUTER },
    },
  );

  const err = responseError(res);
  if (err) {
    coreLog.warn("[kg-playlist] 取消收藏失败:", err);
    return { code: 502, message: `取消收藏失败：${err}` };
  }

  const after = await readMyLists(ctx);
  if (findByListId(after.items, String(collected.listid))) {
    return { code: 502, message: "取消收藏后读回校验失败：收藏仍在列表中" };
  }

  return { code: 200, id, subscribed: false, verified: true };
};
