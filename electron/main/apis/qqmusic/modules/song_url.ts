/**
 * QQ 音乐：单曲播放地址
 *
 * 走 vkey 协议解析直链，一次请求带上所有候选音质档位的文件名，
 * 按「首选档位 → 更低档位」的顺序取第一个命中的即为最高可用音质。
 *
 * 两个必须注意的点：
 * - vkey 的文件名形如 `{档位前缀}{base}{扩展名}`，base 取自候选列表：
 *   首选**媒体 mid 单个**（`file.media_mid`），兜底**歌曲 mid×2**。
 *   不能只用歌曲 mid 单个 —— 上游会回非空直链但实际下载 404。
 * - 付费 / VIP 歌曲对无权限账号返回空直链，此时按失败原因分级返回
 *   403 或 502，而不是笼统的「无法获取播放链接」。
 *
 * 返回体用 `available` 表达「有没有可播地址」，
 * `level` / `label` 表达音质档位，`isFallback` 表达是否降级，
 * `isTrial` 表达是否官方下发的试听片段，`payPlay` 表达歌曲付费标记，
 * `reason` 表达失败原因分级。
 */

import { qmRequest, getQQMusicUin } from "../core/request";
import { requestSongUrl } from "../core/song_url";
import { coreLog } from "../../../logger";
import type { QMModule, QMParams } from "../core/types";

/**
 * 失败原因到 HTTP 状态与文案的映射
 *
 * `need_pay` 与 `no_authorization` 都是「账号没权限」，区别在于歌曲本身是否付费，
 * 前者要提示用户换歌或开通会员，后者提示账号状态异常。
 */
const REASON_RESPONSES: Record<string, { status: number; message: string }> = {
  need_pay: {
    status: 403,
    message: "该歌曲为付费歌曲，当前账号无播放权限",
  },
  no_authorization: {
    status: 403,
    message: "当前账号没有该歌曲的播放权限",
  },
  filename_rejected: {
    status: 502,
    message: "上游未接受播放文件名",
  },
  vkey_error: {
    status: 502,
    message: "上游播放凭证接口返回异常",
  },
};

/** 未识别原因的兜底响应 */
const DEFAULT_FAILURE = {
  status: 502,
  message: "上游播放凭证接口返回异常",
};

/**
 * 从歌曲详情响应中取出歌曲主体
 * @param data - 接口返回的数据段
 * @returns 歌曲主体，取不到时返回 null
 */
const pickTrack = (data: any): any => {
  if (!data) return null;
  if (data.track_info) return data.track_info;
  if (data.song_info) return data.song_info;
  if (Array.isArray(data.songs) && data.songs[0]) return data.songs[0];
  if (data.songid || data.mid) return data;
  return null;
};

/**
 * 解析歌曲的 mid、媒体 mid 与付费标记
 *
 * 付费标记来自同一次详情响应，不额外增加网络请求；它决定了失败原因
 * 能否区分「歌曲需付费」与「免费歌却无授权」。
 * @param value - 歌曲 mid 或数字歌曲 ID
 * @returns 歌曲标识与付费标记
 */
const resolveSong = async (
  value: string,
): Promise<{ mid: string; mediaMid: string; payPlay?: number }> => {
  const isNumeric = /^\d+$/.test(value) && value.length <= 15;

  const detail = await qmRequest(
    "music.pf_song_detail_svr",
    "get_song_detail_yqq",
    isNumeric ? { song_num: 1, song_id: Number(value) } : { song_type: 0, song_mid: value },
  );

  const track = pickTrack(detail);
  if (!track) return { mid: value, mediaMid: "", payPlay: undefined };

  const pay = track.pay || {};
  const payPlay =
    pay.pay_play !== undefined
      ? Number(pay.pay_play)
      : pay.payplay !== undefined
        ? Number(pay.payplay)
        : undefined;

  return {
    mid: track.mid || value,
    mediaMid: (track.file && track.file.media_mid) || "",
    payPlay,
  };
};

/**
 * 解析单曲播放地址
 * @param params.mid - 歌曲 mid 或数字歌曲 ID
 * @param params.mediaMid - 媒体 mid，缺省时由歌曲详情推断
 * @param params.level - 首选音质档位，默认 hq
 */
export const song_url: QMModule = async (params: QMParams) => {
  const raw = String(params.mid ?? params.song_mid ?? params.id ?? "").trim();
  if (!raw) return { code: 400, message: "mid required" };

  const uin = getQQMusicUin();
  if (!uin || uin === "0") return { code: 301, message: "需要登录" };

  const level = String(params.level ?? params.quality ?? "hq");
  const givenMediaMid = String(params.mediaMid ?? params.media_mid ?? "").trim();

  try {
    // 详情请求同时提供 mid、媒体 mid 与付费标记，失败原因分级依赖付费标记
    const resolved = await resolveSong(raw);
    const songMid = resolved.mid || raw;
    const mediaMid = givenMediaMid || resolved.mediaMid;

    const result = await requestSongUrl({
      mid: songMid,
      mediaMid,
      level,
      payPlay: resolved.payPlay,
    });

    if (!result.ok) {
      const mapped = REASON_RESPONSES[result.reason!] || DEFAULT_FAILURE;
      return {
        code: mapped.status,
        message: mapped.message,
        mid: songMid,
        available: false,
        reason: result.reason,
        isTrial: false,
        payPlay: resolved.payPlay,
        triedLevels: result.triedLevels || [],
        vkeyResults: result.vkeyResults || [],
        raw: result.raw,
      };
    }

    return {
      code: 200,
      mid: songMid,
      available: true,
      url: result.url,
      level: result.level,
      label: result.label,
      format: result.format,
      isFallback: result.isFallback,
      isTrial: result.isTrial,
      payPlay: resolved.payPlay,
      triedLevels: result.triedLevels || [],
      raw: result.raw,
    };
  } catch (err) {
    coreLog.error("[qm-song-url] 解析播放地址异常:", err);
    return {
      code: 502,
      message: `解析播放地址失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
