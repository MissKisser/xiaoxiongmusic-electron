/**
 * 酷狗播放地址
 *
 * 端点：
 * - 播放权限（VIP 授权）：POST /v2/get_res_privilege/lite（x-router `media.store.kugou.com`）
 * - 播放直链：GET /v5/url（x-router `trackercdn.kugou.com`）
 *
 * 返回体里的可播性判据直接取自官方响应，渲染端的播放决策树按它们分流：
 * - `status`：`1` 可播 / `2` 付费墙 / `3` 该账号完全无授权
 * - `hash_offset`：付费墙时给出试听边界，`end_ms` 即试听时长
 * - `privilege`：资源授权位
 * - `trial`：试听请求（`IsFreePart=1`）的结果，含试听直链
 *
 * 试听直链的时长陷阱：试听文件的时长由 `hash_offset.end_ms` 给出，
 * 响应里的 `timeLength` 报的是整首时长，不可直接当片段长度用。
 */

import { getSessionCookies } from "../../../database/PlatformSessionDB";
import { ensureKugouDfid } from "../core/device";
import { resolveSongUrl, type KgHashOffset, type SongUrlResult } from "../core/song_url";
import { coreLog } from "../../../logger";
import type { KGModule, KGParams } from "../core/types";

/**
 * 允许原样回传的响应字段之外，需要剔除的播放凭证
 *
 * 直链本身由 `url` / `urls` 单独给出，播放票据类字段不再重复外泄。
 */
const RAW_EXCLUDED_FIELDS = [
  "url",
  "backupUrl",
  "backup_url",
  "hash_token",
  "hash_token_query",
  "q",
];

/**
 * 收敛播放地址响应，只保留判据与元信息
 * @param response - 上游原始响应
 * @returns 收敛后的响应
 */
const sanitizeRaw = (response: unknown): Record<string, unknown> => {
  if (!response || typeof response !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response as Record<string, unknown>)) {
    if (RAW_EXCLUDED_FIELDS.includes(key)) continue;
    out[key] = value;
  }
  return out;
};

/** 试听请求的收敛结果 */
interface TrialOutcome {
  /** 是否发起了试听请求 */
  requested: boolean;
  /** 试听请求的 status */
  status: number;
  /** 试听请求给出的片段边界 */
  hash_offset: KgHashOffset | null;
  /** 资源授权位 */
  privilege: number | null;
  /** 试听请求是否拿到直链 */
  playable: boolean;
  /** 试听直链 */
  url: string;
  /** 试听直链列表 */
  urls: string[];
  /** 片段时长（毫秒），取自 `hash_offset.end_ms` */
  duration: number;
  /** 文件大小（字节） */
  size: number;
  /** 码率 */
  bitrate: number;
  /** 音频格式 */
  extName: string;
}

/**
 * 把一次解析结果整理成对外的播放信息
 * @param result - 解析结果
 * @returns 播放信息
 */
const toPlaybackInfo = (result: SongUrlResult) => {
  const raw = result.response as Record<string, unknown>;
  return {
    url: result.url,
    urls: result.urls,
    quality: result.quality,
    size: Number(raw.fileSize ?? raw.size ?? 0),
    bitrate: Number(raw.bitRate ?? raw.bitrate ?? 0),
    duration: Number(raw.timeLength ?? raw.timelength ?? 0),
    extName: String(raw.extName ?? ""),
  };
};

/**
 * 读取歌曲的播放地址
 *
 * @param params.hash - 歌曲 hash（也可用 `id` 传入）
 * @param params.albumId - 专辑 ID
 * @param params.albumAudioId - 专辑音频 ID
 * @param params.level - 首选音质，默认 hq
 * @param params.freePart - 是否只请求试听片段
 * @param params.privilege - 调用方已知的资源授权位，取不到官方授权位时作为兜底
 */
export const song_url: KGModule = async (params: KGParams) => {
  const hash = String(params.hash ?? params.id ?? "")
    .trim()
    .toLowerCase();
  if (!hash) return { code: 400, message: "hash required" };

  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) {
    return { code: 301, message: "需要登录" };
  }

  const albumId = Number(params.albumId ?? params.album_id ?? 0) || 0;
  const audioId =
    Number(
      params.albumAudioId ?? params.album_audio_id ?? params.audioId ?? params.audio_id ?? 0,
    ) || 0;
  const level = String(params.level ?? params.quality ?? "hq");
  const wantTrial = Boolean(params.freePart ?? params.free_part);
  const givenPrivilege =
    params.privilege === undefined || params.privilege === null
      ? null
      : Number(params.privilege) || 0;

  const userid = session.userid;
  if (!session.dfid) {
    try {
      await ensureKugouDfid();
    } catch (err) {
      coreLog.warn("[kg-song-url] 注册酷狗设备指纹失败，按匿名设备继续:", err);
    }
  }

  const request = {
    hash,
    albumId,
    audioId,
    level,
    userid,
  };

  try {
    const primary = await resolveSongUrl({ ...request, freePart: wantTrial });

    // 正式请求拿不到直链时再探一次试听：付费墙歌曲由官方下发试听片段
    let probe: SongUrlResult | null = null;
    if (!wantTrial && !primary.ok) {
      probe = await resolveSongUrl({ ...request, freePart: true });
    }

    // 显式要求试听时主请求就是试听请求；否则试听结果来自额外的探测请求
    const trialSource = wantTrial ? primary : probe;
    const trialPlayable = wantTrial ? primary.ok : Boolean(probe?.ok);

    const privilege = primary.privilege ?? givenPrivilege;
    const playback = toPlaybackInfo(primary);
    const trialPlayback = trialSource ? toPlaybackInfo(trialSource) : null;

    const trialOutcome: TrialOutcome = {
      requested: Boolean(trialSource),
      status: trialSource?.status ?? 0,
      hash_offset: trialSource?.hashOffset ?? null,
      privilege: trialSource ? (trialSource.privilege ?? privilege) : privilege,
      playable: trialPlayable,
      url: trialSource?.url ?? "",
      urls: trialSource?.urls ?? [],
      duration: Number(trialSource?.hashOffset?.end_ms ?? 0),
      size: trialPlayback?.size ?? 0,
      bitrate: trialPlayback?.bitrate ?? 0,
      extName: trialPlayback?.extName ?? "",
    };

    const playable = primary.ok || trialPlayable;
    // 直链来自试听请求：显式试听，或正式请求无直链时回落到试听直链
    const isTrial = wantTrial || (!primary.ok && trialPlayable);

    if (!playable) {
      const reason =
        primary.status === 3
          ? "该账号对该资源完全无授权"
          : "无可用播放地址（可能需要会员或该歌曲不可播放）";
      return {
        code: 403,
        message: reason,
        hash,
        requestMode: wantTrial ? "trial" : "normal",
        status: primary.status,
        hash_offset: primary.hashOffset,
        privilege,
        playable: false,
        isTrial: false,
        freePart: wantTrial,
        url: "",
        urls: [],
        quality: primary.quality,
        requestedQuality: primary.requestedQuality,
        downgraded: primary.quality !== primary.requestedQuality,
        size: playback.size,
        bitrate: playback.bitrate,
        duration: playback.duration,
        extName: playback.extName,
        usedPrivilege: primary.usedPrivilege,
        trial: trialOutcome,
        raw: sanitizeRaw(primary.response),
      };
    }

    return {
      code: 200,
      message: "",
      hash,
      requestMode: wantTrial ? "trial" : "normal",
      status: primary.status,
      hash_offset: primary.hashOffset,
      privilege,
      playable: true,
      isTrial,
      freePart: isTrial,
      url: primary.ok ? primary.url : (trialSource?.url ?? ""),
      urls: primary.ok ? primary.urls : (trialSource?.urls ?? []),
      quality: primary.ok ? primary.quality : (trialSource?.quality ?? primary.quality),
      requestedQuality: primary.requestedQuality,
      downgraded: primary.quality !== primary.requestedQuality,
      size: primary.ok ? playback.size : (trialPlayback?.size ?? 0),
      bitrate: primary.ok ? playback.bitrate : (trialPlayback?.bitrate ?? 0),
      duration: primary.ok ? playback.duration : (trialPlayback?.duration ?? 0),
      extName: primary.ok ? playback.extName : (trialPlayback?.extName ?? ""),
      usedPrivilege: primary.usedPrivilege,
      trial: trialOutcome,
      raw: sanitizeRaw(primary.response),
    };
  } catch (err) {
    coreLog.error("[kg-song-url] 解析酷狗播放地址异常:", err);
    return {
      code: 502,
      message: `解析酷狗播放地址失败: ${(err as Error)?.message ?? String(err)}`,
      hash,
    };
  }
};
