/**
 * QQ 音乐播放地址解析辅助
 *
 * 播放地址走的是 vkey 协议，请求体是 `{ comm, req_0: { module, method, param } }`
 * 的旧式结构，与平台层其余接口使用的 `{ comm, request: { module, method, param } }`
 * 不同，因此这里单独实现一次直连请求。
 *
 * 音质策略：一次请求把所有候选档位的文件名都报上去，接口只会给有权限的档位
 * 返回有效直链，因此按「首选档位 → 更低档位」的顺序取第一个命中的即为最高可用音质。
 *
 * filename 口径：文件名形如 `{档位前缀}{base}{扩展名}`，base 取自候选列表。
 * - 首选 base 是**媒体 mid 单个**（`file.media_mid`），与上游实际下发的直链文件名一致
 * - 兜底 base 是**歌曲 mid×2**
 * - **不要用歌曲 mid 单个**：上游会回 result=0 与非空 purl，但直链下载会 404，
 *   属于「看起来成功、实际不可用」的陷阱
 *
 * 错误分级（由 `midurlinfo[].result` 与歌曲付费标记共同判定）：
 * - need_pay          整首付费歌，当前账号无播放权限
 * - no_authorization  免费歌也拿不到授权
 * - filename_rejected 上游未接受该文件名
 * - vkey_error        上游返回其它异常码，或没给出可用结果
 *
 * 无状态约束：
 * - 凭据只从本地会话存储取，不持有任何模块级状态
 * - 每次请求独立生成 guid，不做跨请求缓存
 */

import { randomUUID } from "node:crypto";
import { QM_API_URL, QM_HEADERS } from "./config";
import { sessionToCookieHeader } from "./credential";
import { getQQMusicCookies, getQQMusicUin } from "./request";
import { coreLog } from "../../../logger";

/** vkey 接口的 Referer */
const VKEY_REFERER = "https://y.qq.com/";

/** vkey 请求超时（毫秒） */
const VKEY_TIMEOUT_MS = 8000;

/** 试听直链的文件名前缀 */
const TRIAL_PREFIX = "RS02";

/** 试听直链的文件扩展名 */
const TRIAL_EXT = ".mp3";

/** 试听音质档位标识 */
const TRIAL_LEVEL = "trial";

/** 试听音质说明 */
const TRIAL_LABEL = "试听片段";

/**
 * 音质档位候选表，按音质从高到低排列
 */
const QUALITY_CANDIDATES = [
  { prefix: "AI00", ext: ".flac", level: "hi-res", label: "Hi-Res FLAC" },
  { prefix: "F000", ext: ".flac", level: "lossless", label: "无损 FLAC" },
  { prefix: "M800", ext: ".mp3", level: "hq", label: "320k MP3" },
  { prefix: "M500", ext: ".mp3", level: "sq", label: "128k MP3" },
  { prefix: "C400", ext: ".m4a", level: "lq", label: "标准 AAC" },
];

/**
 * 允许原样回传的 vkey 结果字段
 *
 * 其余字段（`purl` / `vkey` / `ekey` / 各类直链与 `auth_switch`）都带凭证或
 * 播放票据，一律不进 `raw`，避免播放凭证随日志、文档外泄。
 */
const RAW_ITEM_FIELDS = [
  "filename",
  "songmid",
  "mid",
  "result",
  "subcode",
  "isbuy",
  "onecan",
  "isonly",
  "pneed",
  "pneedbuy",
  "hisbuy",
  "hisdown",
  "errtype",
  "premain",
  "pdl",
];

/** 音质候选档位 */
export interface QualityCandidate {
  /** 文件名前缀 */
  prefix: string;
  /** 文件扩展名 */
  ext: string;
  /** 音质档位标识 */
  level: string;
  /** 音质中文说明 */
  label: string;
}

/** 单个候选文件的上游结果 */
export interface VkeyResult {
  /** 音质档位 */
  level: string;
  /** 上报的文件名 */
  filename: string;
  /** 上游结果码，无返回时为 null */
  result: number | null;
  /** 上游子错误码，无返回时为 null */
  subcode: number | null;
}

/** 收敛后的 vkey 业务响应 */
export interface SanitizedVkeyRaw {
  /** 外层业务码 */
  code: number;
  /** 内层业务段 */
  req_0: {
    /** 内层业务码 */
    code: number;
    /** 内层数据段 */
    data: {
      /** 各候选文件的上游结果 */
      midurlinfo: Array<Record<string, unknown>>;
    };
  };
}

/** 播放地址解析结果 */
export interface SongUrlResult {
  /** 是否拿到可用直链 */
  ok: boolean;
  /** 播放地址 */
  url?: string;
  /** 命中的音质档位，试听直链为 trial */
  level?: string;
  /** 命中音质的中文说明 */
  label?: string;
  /** 音频格式 */
  format?: string;
  /** 是否降级到低于首选档位的音质 */
  isFallback?: boolean;
  /** 是否为官方下发的试听片段直链 */
  isTrial?: boolean;
  /** 歌曲付费标记，1 表示该歌曲需付费 */
  payPlay?: number;
  /** 本次尝试的音质档位 */
  triedLevels?: string[];
  /** 失败原因 */
  reason?: string;
  /** 收敛后的 vkey 业务响应 */
  raw?: SanitizedVkeyRaw;
  /** 每个候选文件的上游结果码 */
  vkeyResults?: VkeyResult[];
}

/** 单个上报给 vkey 的候选文件 */
interface VkeyEntry {
  /** 上报的文件名 */
  filename: string;
  /** 对应的音质档位 */
  level: string;
}

/** 一次 vkey 请求的收敛结果 */
interface VkeyOutcome {
  /** 上游返回的候选结果列表 */
  infos: any[];
  /** 直链拼接前缀 */
  sip: string;
  /** 收敛后的业务响应 */
  raw: SanitizedVkeyRaw;
  /** 按文件名索引的上游结果 */
  byFilename: Map<string, any>;
  /** 逐候选的上游结果码 */
  vkeyResults: VkeyResult[];
}

/**
 * 发起一次 vkey 请求并收敛结果
 * @param mid - 歌曲 mid
 * @param entries - 上报的候选文件列表
 * @returns 收敛后的 vkey 结果
 */
const postVkey = async (mid: string, entries: VkeyEntry[]): Promise<VkeyOutcome> => {
  const filenames = entries.map((item) => item.filename);

  const cookies = getQQMusicCookies();
  const musickey = cookies.qm_keyst || cookies.qqmusic_key || "";
  const gtk = hash33(musickey, 5381);
  const guid = randomUUID().replace(/-/g, "");
  const account = getQQMusicUin();
  const cookieHeader = sessionToCookieHeader(cookies);

  const body = {
    comm: {
      ct: 11,
      cv: 14090008,
      v: 14090008,
      chid: "10003505",
      os_ver: "15",
      phonetype: "24122RKC7C",
      tmeAppID: "qqmusic",
      nettype: "NETWORK_WIFI",
      udid: "0",
      OpenUDID: "0",
      QIMEI36: "0",
      uin: account && account !== "0" ? account : "",
      format: "json",
      inCharset: "utf-8",
      outCharset: "utf-8",
      notice: 0,
      needNewCode: 1,
      g_tk: gtk,
      g_tk_new_20200303: gtk,
      guid,
    },
    req_0: {
      module: "music.vkey.GetVkey",
      method: "UrlGetVkey",
      param: {
        guid,
        songmid: filenames.map(() => mid),
        filename: filenames,
        songtype: filenames.map(() => 0),
        uin: account && account !== "0" ? account : "",
        ctx: 0,
        loginflag: 1,
        platform: "20",
      },
    },
  };

  const response = await fetch(QM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      Referer: VKEY_REFERER,
      Origin: "https://y.qq.com",
      "User-Agent": QM_HEADERS["User-Agent"],
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(VKEY_TIMEOUT_MS),
  });

  const json = (await response.json()) as any;
  const inner = json && json.req_0;
  const data = json && json.code === 0 && inner && inner.code === 0 ? inner.data : null;
  const infos = (data && data.midurlinfo) || [];
  const sip =
    ((data && data.sip) || []).find((item: unknown) => String(item).startsWith("http")) ||
    "https://isure.stream.qqmusic.qq.com/";

  const byFilename = new Map<string, any>();
  for (const info of infos) {
    if (info && info.filename && !byFilename.has(info.filename)) {
      byFilename.set(info.filename, info);
    }
  }

  const vkeyResults: VkeyResult[] = entries.map((item) => {
    const info = byFilename.get(item.filename);
    return {
      level: item.level,
      filename: item.filename,
      result: info && info.result !== undefined ? Number(info.result) : null,
      subcode: info && info.subcode !== undefined ? Number(info.subcode) : null,
    };
  });

  return { infos, sip, raw: sanitizeRaw(json, infos), byFilename, vkeyResults };
};

/**
 * 按首选音质生成顺位候选列表
 *
 * 首选档位不存在时返回完整列表，交给接口决定可用音质
 * @param preferredLevel - 首选音质档位
 * @returns 候选档位列表
 */
export const getQualityCandidates = (preferredLevel: string): QualityCandidate[] => {
  const target = String(preferredLevel || "hq").toLowerCase();
  const index = QUALITY_CANDIDATES.findIndex((item) => item.level === target);
  if (index >= 0) return QUALITY_CANDIDATES.slice(index);
  return QUALITY_CANDIDATES;
};

/**
 * 生成 filename 的 base 候选列表
 *
 * 首选是媒体 mid 单个，兜底是歌曲 mid×2。两者都实测可下载到真实音频
 * @param mid - 歌曲 mid
 * @param mediaMid - 媒体 mid，缺省时只保留歌曲 mid×2
 * @returns base 候选列表，顺序即优先级
 */
export const getBaseCandidates = (mid: string, mediaMid: string): string[] => {
  const bases: string[] = [];
  const push = (value: string) => {
    if (!value) return;
    if (bases.includes(value)) return;
    bases.push(value);
  };
  push(mediaMid);
  push(`${mid}${mid}`);
  if (mediaMid && mediaMid !== mid) push(`${mediaMid}${mediaMid}`);
  return bases;
};

/**
 * 计算 QQ 系 CSRF token
 * @param str - 参与计算的字符串
 * @param seed - 初始种子
 * @returns 32 位无符号整数
 */
export const hash33 = (str: string, seed = 0): number => {
  let h = seed;
  for (const ch of str) {
    h = (((h << 5) + h + ch.codePointAt(0)!) & 0xffffffff) >>> 0;
  }
  return h & 2147483647;
};

/**
 * 收敛 vkey 响应，只保留业务段
 *
 * 只保留 `code`、`req_0.code` 与脱敏后的 `midurlinfo[]`，剥离 `comm` 与所有带凭证的字段
 * @param json - vkey 接口原始响应
 * @param infos - 原始 `midurlinfo` 列表
 * @returns 收敛后的响应
 */
const sanitizeRaw = (json: any, infos: any[]): SanitizedVkeyRaw => {
  const inner = (json && json.req_0) || {};
  return {
    code: json && json.code !== undefined ? json.code : 0,
    req_0: {
      code: inner.code !== undefined ? inner.code : 0,
      data: {
        midurlinfo: (infos || []).map((info) => {
          const item: Record<string, unknown> = {};
          for (const field of RAW_ITEM_FIELDS) {
            if (info && info[field] !== undefined) item[field] = info[field];
          }
          return item;
        }),
      },
    },
  };
};

/**
 * 判定失败原因
 *
 * 优先级：上游拒绝文件名 > 付费/无授权 > 其它异常码
 * @param infos - 原始 `midurlinfo` 列表
 * @param payPlay - 歌曲付费标记，1 为付费
 * @returns 失败原因
 */
const pickReason = (infos: any[], payPlay?: number): string => {
  const codes = (infos || []).map((info) => Number(info && info.result));
  if (codes.some((code) => code === 101404)) return "filename_rejected";
  if (codes.some((code) => code === 104003 || code === 10400)) {
    return payPlay === 1 ? "need_pay" : "no_authorization";
  }
  return "vkey_error";
};

/**
 * 请求一次 vkey，取回播放地址
 * @param options - 请求选项
 * @param options.mid - 歌曲 mid
 * @param options.mediaMid - 媒体 mid，缺省时只用 `mid + mid` 作 base
 * @param options.level - 首选音质档位
 * @param options.payPlay - 歌曲付费标记，1 表示该歌曲需付费
 * @returns 播放地址解析结果
 */
export const requestSongUrl = async (options: {
  mid: string;
  mediaMid?: string;
  level?: string;
  payPlay?: number;
}): Promise<SongUrlResult> => {
  const { mid, mediaMid = "", level = "hq", payPlay } = options;

  const bases = getBaseCandidates(mid, mediaMid);
  const targetLevel = String(level || "hq");
  const candidates = getQualityCandidates(targetLevel);
  const triedLevels = candidates.map((item) => item.level);

  // 同一个请求里带上所有「档位 × base」组合，filename 与 songtype 长度必然一致。
  // 顺序按「档位在外、base 在内」展开：同一档位先试首选 base，再试兜底 base，
  // 这样只要任一 base 能给到该档位就命中，返回的始终是最高可用音质。
  const requests: VkeyEntry[] = [];
  for (const candidate of candidates) {
    for (const base of bases) {
      requests.push({
        filename: `${candidate.prefix}${base}${candidate.ext}`,
        level: candidate.level,
      });
    }
  }

  const outcome = await postVkey(mid, requests);

  for (const request of requests) {
    const found = outcome.byFilename.get(request.filename);
    if (!found || !found.purl) continue;

    const candidate = candidates.find((item) => item.level === request.level);
    if (!candidate) continue;

    const purl = String(found.purl);
    coreLog.info(`[qm-song-url] 播放地址命中: ${mid} -> ${candidate.label} (${candidate.level})`);
    return {
      ok: true,
      url: purl.startsWith("http") ? purl : `${outcome.sip}${purl}`,
      level: candidate.level,
      label: candidate.label,
      format: candidate.ext.replace(".", ""),
      isFallback: candidate.level !== targetLevel,
      isTrial: false,
      payPlay,
      triedLevels,
      raw: outcome.raw,
      vkeyResults: outcome.vkeyResults,
    };
  }

  // 正式音质拿不到时再探试听直链：付费歌由官方下发 60 秒试听片段
  const trialBase = mediaMid || mid;
  const trialOutcome = await postVkey(mid, [
    { filename: `${TRIAL_PREFIX}${trialBase}${TRIAL_EXT}`, level: TRIAL_LEVEL },
  ]);
  const trialInfo = trialOutcome.byFilename.get(`${TRIAL_PREFIX}${trialBase}${TRIAL_EXT}`);
  if (trialInfo && trialInfo.purl) {
    const purl = String(trialInfo.purl);
    coreLog.info(`[qm-song-url] 命中试听直链: ${mid}`);
    return {
      ok: true,
      url: purl.startsWith("http") ? purl : `${trialOutcome.sip}${purl}`,
      level: TRIAL_LEVEL,
      label: TRIAL_LABEL,
      format: TRIAL_EXT.replace(".", ""),
      isFallback: true,
      isTrial: true,
      payPlay,
      triedLevels,
      raw: trialOutcome.raw,
      vkeyResults: trialOutcome.vkeyResults,
    };
  }

  const reason = pickReason(outcome.infos, payPlay);
  coreLog.warn(`[qm-song-url] vkey 未返回可用播放地址: ${mid} 首选=${targetLevel} 原因=${reason}`);
  return {
    ok: false,
    reason,
    isTrial: false,
    payPlay,
    triedLevels,
    raw: outcome.raw,
    vkeyResults: outcome.vkeyResults,
  };
};
