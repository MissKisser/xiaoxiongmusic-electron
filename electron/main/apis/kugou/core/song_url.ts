/**
 * 酷狗播放地址解析
 *
 * `modules/song_url.ts` 的私有辅助：把「音质档位 → 授权 → 直链」这条链路
 * 拆成可复用的两步，由模块层组装成统一响应。
 *
 * 链路形态：
 * - 单次请求：免费歌曲（或该档位本账号本就可播）用原始 hash 直接请求
 *   `GET /v5/url` 取直链。
 * - 两段式：VIP 高音质先由 `POST /v2/get_res_privilege/lite` 取得该档位的
 *   变体 hash（授权），再用变体 hash 请求 `GET /v5/url` 取直链。
 *
 * 可播性判据来自 `GET /v5/url` 的响应：
 * - `status=1`：可播，响应带直链
 * - `status=2`：付费墙，响应带 `hash_offset`（试听边界，`end_ms` 即试听时长）
 * - `status=3`：该账号对该资源完全无授权，响应既无直链也无 `hash_offset`
 *
 * `privilege` 来自官方授权接口 `POST /v2/get_res_privilege/lite` 的资源条目，
 * 与搜索 / 歌单 / 专辑曲目上标注的是同一口径的授权位。
 */

import { kgGatewayRequest, type KGRawBody } from "./request";
import { getDeviceMid, signKey } from "./crypto";
import { getKgAppid, getKgClientver, isKugouConceptMode } from "./config";

/** 音质档位，由低到高 */
export const QUALITY_LEVELS = ["128", "320", "flac", "high"];

/** 外部音质名 → 酷狗音质档位 */
export const QUALITY_MAP: Record<string, string> = {
  "hi-res": "high",
  lossless: "flac",
  hq: "320",
  sq: "128",
  lq: "128",
};

/** 播放地址接口的协议版本 */
const TRACK_URL_VERSION = 11430;

/** 试听片段边界 */
export interface KgHashOffset {
  /** 片段起点（毫秒） */
  start_ms?: number;
  /** 片段终点（毫秒），即试听时长 */
  end_ms?: number;
  /** 片段终点（字节） */
  end_byte?: number;
  /** 片段起点（字节） */
  start_byte?: number;
  /** 片段文件类型 */
  file_type?: number;
  /** 片段偏移哈希 */
  offset_hash?: string;
  /** 片段音频哈希 */
  clip_hash?: string;
  [key: string]: unknown;
}

/** 官方授权接口返回的音质变体 */
export interface KgQualityVariant {
  /** 音质档位 */
  quality: string;
  /** 该档位的变体 hash */
  hash: string;
  /** 该档位的授权位 */
  privilege: number;
}

/** 官方授权接口的解析结果 */
export interface KgPrivilegeResult {
  /** 音质档位 → 变体 hash */
  options: Map<string, string>;
  /** 资源主档的授权位 */
  privilege: number | null;
  /** 各音质档位的授权位 */
  qualityPrivileges: Map<string, number>;
  /** 授权接口原始响应 */
  response: KGRawBody;
}

/** 播放地址解析的入参 */
export interface SongUrlOptions {
  /** 歌曲 hash */
  hash: string;
  /** 专辑 ID */
  albumId?: number;
  /** 专辑音频 ID */
  audioId?: number;
  /** 首选音质 */
  level?: string;
  /** 是否请求试听片段 */
  freePart?: boolean;
  /** 账号 ID，用于签出请求密钥 */
  userid?: string | number;
}

/** 播放地址解析结果 */
export interface SongUrlResult {
  /** 是否拿到可用直链 */
  ok: boolean;
  /** 播放直链 */
  url: string;
  /** 播放直链列表 */
  urls: string[];
  /** 命中的音质档位 */
  quality: string;
  /** 请求的首选音质档位 */
  requestedQuality: string;
  /** 是否用到了官方授权接口给出的变体 hash */
  usedPrivilege: boolean;
  /** 播放地址接口的 status：1 可播 / 2 付费墙 / 3 完全无授权 */
  status: number;
  /** 试听片段边界，付费墙时给出 */
  hashOffset: KgHashOffset | null;
  /** 资源授权位，未取到时为 null */
  privilege: number | null;
  /** 播放地址接口原始响应 */
  response: KGRawBody;
}

/**
 * 取出响应里的播放直链
 * @param response - 酷狗播放地址响应
 * @returns 直链列表，没有直链时返回空数组
 */
export const extractUrls = (response: unknown): string[] => {
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  return [record.url, record.backup_url, record.backupUrl]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
};

/**
 * 判断响应里是否带可播放的直链
 *
 * `extName=mp4` 是视频资源，不能当音频直链使用。
 * @param response - 酷狗播放地址响应
 * @returns 可用直链列表
 */
export const playableUrls = (response: unknown): string[] => {
  const urls = extractUrls(response);
  if (urls.length === 0) return [];
  const extName = (response as { extName?: unknown })?.extName;
  if (extName === "mp4") return [];
  return urls;
};

/**
 * 从播放地址响应里取试听片段边界
 * @param response - 酷狗播放地址响应
 * @returns 试听边界，没有时返回 null
 */
export const pickHashOffset = (response: unknown): KgHashOffset | null => {
  if (!response || typeof response !== "object") return null;
  const record = response as Record<string, unknown>;
  if (record.hash_offset && typeof record.hash_offset === "object") {
    return record.hash_offset as KgHashOffset;
  }
  const transParam = record.trans_param as { hash_offset?: unknown } | undefined;
  if (transParam && transParam.hash_offset && typeof transParam.hash_offset === "object") {
    return transParam.hash_offset as KgHashOffset;
  }
  return null;
};

/**
 * 从播放地址响应里取 status
 * @param response - 酷狗播放地址响应
 * @returns status 值，响应里没有时返回 0
 */
export const pickStatus = (response: unknown): number => {
  if (!response || typeof response !== "object") return 0;
  const status = (response as { status?: unknown }).status;
  return Number(status) || 0;
};

/**
 * 读取账号在各音质档位的授权与变体 hash
 *
 * 变体 hash 与歌曲原始 hash 不同，是酷狗用来区分音质档位的凭据。
 * @param options - 请求选项
 * @param options.hash - 歌曲 hash
 * @param options.albumId - 专辑 ID
 * @param options.userid - 账号 ID
 * @returns 授权位与变体 hash 的解析结果
 */
export const fetchLiteQualityOptions = async (options: {
  hash: string;
  albumId?: number;
  userid?: string | number;
}): Promise<KgPrivilegeResult> => {
  const response = await kgGatewayRequest("/v2/get_res_privilege/lite", {
    method: "POST",
    data: {
      appid: getKgAppid(),
      clientver: getKgClientver(),
      area_code: 1,
      behavior: "play",
      need_hash_offset: 1,
      relate: 1,
      support_verify: 1,
      resource: [
        {
          type: "audio",
          page_id: 0,
          hash: options.hash,
          album_id: options.albumId ?? 0,
        },
      ],
      qualities: QUALITY_LEVELS,
    },
    headers: { "x-router": "media.store.kugou.com" },
    allowBusinessError: true,
  });

  const options2 = new Map<string, string>();
  const qualityPrivileges = new Map<string, number>();
  const data = Array.isArray(response?.data) ? (response.data as KGRawBody[]) : [];

  for (const item of data) {
    const variants = [
      item,
      ...(Array.isArray(item.relate_goods) ? (item.relate_goods as KGRawBody[]) : []),
    ];
    for (const variant of variants) {
      const quality = String(variant.quality ?? "");
      if (!quality) continue;
      const privilege = Number(variant.privilege ?? 0) || 0;
      if (!qualityPrivileges.has(quality)) qualityPrivileges.set(quality, privilege);
      if (!variant.hash || Number(variant.level) === 0) continue;
      if (!QUALITY_LEVELS.includes(quality) || options2.has(quality)) continue;
      options2.set(quality, String(variant.hash));
    }
  }

  const privilege = data.length > 0 ? Number(data[0].privilege ?? 0) || 0 : null;

  return {
    options: options2,
    privilege,
    qualityPrivileges,
    response,
  };
};

/**
 * 请求单档音质的直链
 *
 * 概念版与标准版的页面来源标识不同，必须与当前客户端标识保持一致，
 * 否则网关会以「illegal key」拒绝。
 * @param options - 请求选项
 * @param options.hash - 歌曲 hash
 * @param options.quality - 音质档位
 * @param options.albumId - 专辑 ID
 * @param options.audioId - 专辑音频 ID
 * @param options.freePart - 是否请求试听片段
 * @param options.userid - 账号 ID
 * @returns 酷狗播放地址响应
 */
export const requestTrackUrl = async (options: {
  hash: string;
  quality: string;
  albumId?: number;
  audioId?: number;
  freePart?: boolean;
  userid?: string | number;
}): Promise<KGRawBody> => {
  const { hash, quality, albumId = 0, audioId = 0, freePart = false } = options;
  const concept = isKugouConceptMode();

  const params: Record<string, unknown> = {
    area_code: 1,
    hash,
    ssa_flag: "is_fromtrack",
    version: TRACK_URL_VERSION,
    page_id: concept ? 967177915 : 151369488,
    quality,
    behavior: "play",
    pid: concept ? 411 : 2,
    cmd: 26,
    pidversion: 3001,
    IsFreePart: freePart ? 1 : 0,
    ppage_id: concept ? "356753938,823673182,967485191" : "463467626,350369493,788954147",
    cdnBackup: 1,
    module: "",
    clientver: TRACK_URL_VERSION,
    key: signKey(hash, getDeviceMid(), Number(options.userid || 0)),
  };

  if (Number(albumId) > 0) params.album_id = Number(albumId);
  if (Number(audioId) > 0) params.album_audio_id = Number(audioId);

  return kgGatewayRequest("/v5/url", {
    method: "GET",
    params,
    headers: { "x-router": "trackercdn.kugou.com" },
    allowBusinessError: true,
  });
};

/**
 * 解析歌曲的播放地址
 *
 * 按「偏好音质 → 逐档降级」的顺序尝试；VIP 档位先用授权接口换取变体 hash。
 * @param options - 解析参数
 * @returns 解析结果
 */
export const resolveSongUrl = async (options: SongUrlOptions): Promise<SongUrlResult> => {
  const { hash, albumId = 0, audioId = 0, level = "hq", freePart = false, userid = 0 } = options;

  const requestedQuality = QUALITY_MAP[String(level).toLowerCase()] || "320";
  const chain = QUALITY_LEVELS.slice(0, QUALITY_LEVELS.indexOf(requestedQuality) + 1).reverse();

  let candidates = chain.map((quality) => ({ quality, hash }));
  let usedPrivilege = false;
  let privilege: number | null = null;

  if (isKugouConceptMode() && userid) {
    try {
      const lite = await fetchLiteQualityOptions({ hash, albumId, userid });
      privilege = lite.privilege;
      const privileged = chain
        .map((quality) => ({ quality, variantHash: lite.options.get(quality) }))
        .filter((item) => Boolean(item.variantHash))
        .map((item) => ({ quality: item.quality, hash: item.variantHash as string }));
      if (privileged.length > 0) {
        candidates = privileged;
        usedPrivilege = true;
      }
    } catch {
      // 授权探测失败时退回原始 hash，不影响免费歌曲直连
    }
  }

  let lastResponse: KGRawBody = {};
  for (const candidate of candidates) {
    const request = {
      hash: candidate.hash,
      quality: candidate.quality,
      albumId,
      audioId,
      freePart,
      userid,
    };

    let response = await requestTrackUrl(request);
    let urls = playableUrls(response);

    if (urls.length === 0 && Number(audioId) > 0) {
      // album_audio_id 不匹配时酷狗会返回「Hash not found」，去掉该字段重试
      const retry = await requestTrackUrl({ ...request, audioId: 0 });
      const retryUrls = playableUrls(retry);
      if (retryUrls.length > 0) {
        response = retry;
        urls = retryUrls;
      }
    }

    lastResponse = response;
    if (urls.length > 0) {
      return {
        ok: true,
        url: urls[0],
        urls,
        quality: candidate.quality,
        requestedQuality,
        usedPrivilege,
        status: pickStatus(response),
        hashOffset: pickHashOffset(response),
        privilege,
        response,
      };
    }
  }

  return {
    ok: false,
    url: "",
    urls: [],
    quality: requestedQuality,
    requestedQuality,
    usedPrivilege,
    status: pickStatus(lastResponse),
    hashOffset: pickHashOffset(lastResponse),
    privilege,
    response: lastResponse,
  };
};
