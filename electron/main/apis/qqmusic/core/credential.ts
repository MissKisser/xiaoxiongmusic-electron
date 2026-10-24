export interface QQMusicCredential {
  musickey?: string;
  musicid?: number | string;
  str_musicid?: string;
  refresh_key?: string;
  refresh_token?: string;
  access_token?: string;
  encryptUin?: string;
  openid?: string;
  unionid?: string;
  expired_at?: number;
  musickeyCreateTime?: number;
  keyExpiresIn?: number;
  loginType?: number;
  nick?: string;
  nickname?: string;
  logo?: string;
  avatarUrl?: string;
}

/**
 * 生成发送给 QM 的 Cookie 请求头
 * @param session - 本地保存的 QM 会话
 * @returns Cookie 请求头；没有可发送字段时返回 undefined
 */
export const sessionToCookieHeader = (session: Record<string, string>): string | undefined => {
  const entries = Object.entries(session).filter(([, value]) => !!value);
  return entries.length > 0
    ? entries.map(([key, value]) => `${key}=${value}`).join("; ")
    : undefined;
};

/**
 * 获取凭据对应的真实音乐账号 ID
 * @param credential - QM 登录凭据
 * @param fallback - 未返回账号 ID 时的回退值
 * @returns 音乐账号 ID
 */
export const getCredentialMusicId = (credential: QQMusicCredential, fallback = ""): string =>
  String(credential.str_musicid || credential.musicid || fallback).replace(/^o/, "");

/**
 * 将登录凭据转换为持久化会话字段
 * @param credential - QM 登录凭据
 * @param loginType - 登录类型
 * @param fallbackMusicId - 未返回账号 ID 时的回退值
 * @returns 可持久化的会话字段
 */
export const credentialToSession = (
  credential: QQMusicCredential,
  loginType: 1 | 2,
  fallbackMusicId = "",
): Record<string, string> => {
  const musicId = getCredentialMusicId(credential, fallbackMusicId);
  const session: Record<string, string> = {
    uin: musicId,
    qm_str_musicid: musicId,
    qm_keyst: credential.musickey || "",
    qqmusic_key: credential.musickey || "",
    tmeLoginType: String(credential.loginType || loginType),
  };

  if (loginType === 1) session.wxuin = musicId;
  if (credential.encryptUin) session.euin = credential.encryptUin;
  if (credential.openid)
    session[loginType === 1 ? "wxopenid" : "psrf_qqopenid"] = credential.openid;
  if (credential.unionid) session.psrf_qqunionid = credential.unionid;
  if (credential.refresh_token)
    session[loginType === 1 ? "wxrefresh_token" : "psrf_qqrefresh_token"] =
      credential.refresh_token;
  if (credential.access_token) session.psrf_qqaccess_token = credential.access_token;
  if (credential.refresh_key) session.qm_refresh_key = credential.refresh_key;
  if (credential.expired_at) session.psrf_access_token_expiresAt = String(credential.expired_at);
  if (credential.musickeyCreateTime)
    session.psrf_musickey_createtime = String(credential.musickeyCreateTime);
  if (credential.keyExpiresIn) session.qm_key_expires_in = String(credential.keyExpiresIn);

  return session;
};

/** 凭据有效期信息 */
export interface QQMusicCredentialTTL {
  /** 签发时刻（毫秒时间戳） */
  issuedAt: number;
  /** 有效期长度（毫秒） */
  expiresInMs: number;
  /** 到期时刻（毫秒时间戳） */
  expiresAt: number;
  /** 剩余有效期（毫秒） */
  remainingMs: number;
}

/**
 * 秒级时间戳的判定上限
 *
 * 1e11 毫秒约为 1973 年，1e11 秒约为公元 5138 年，
 * 因此小于该值的正数按秒处理，超过则按毫秒处理。
 */
const SECONDS_TIMESTAMP_LIMIT = 1e11;

/**
 * 秒级时长的判定上限
 *
 * 1e6 毫秒约 16 分钟，短于此值按秒处理，超过则按毫秒处理。
 */
const SECONDS_DURATION_LIMIT = 1e6;

/**
 * 续期触发阈值：剩余有效期低于总有效期的该比例即触发续期
 */
export const REFRESH_THRESHOLD_RATIO = 0.25;

/**
 * 把时间戳归一化为毫秒
 *
 * QM 下发的 `psrf_musickey_createtime` 是秒级时间戳，
 * 但历史数据里存在毫秒级写法，这里按量级自动区分。
 * @param value 原始时间戳
 * @returns 毫秒时间戳
 */
export const toTimestampMs = (value: number): number =>
  value > 0 && value < SECONDS_TIMESTAMP_LIMIT ? value * 1000 : value;

/**
 * 把时长归一化为毫秒
 *
 * QM 下发的 `qm_key_expires_in` 是秒级时长，
 * 但历史数据里存在毫秒级写法，这里按量级自动区分。
 * @param value 原始时长
 * @returns 毫秒时长
 */
export const toDurationMs = (value: number): number =>
  value > 0 && value < SECONDS_DURATION_LIMIT ? value * 1000 : value;

/**
 * 读取凭据的有效期信息
 *
 * 数据来源是登录/续期时落库的 `psrf_musickey_createtime` 与 `qm_key_expires_in`，
 * 此前只写不读，导致凭据过期后没有任何主动续期的机会。
 * @param cookies 会话字段
 * @param now 当前时刻（毫秒时间戳）
 * @returns 有效期信息；缺少签发时刻或有效期时为 null
 */
export const resolveCredentialTTL = (
  cookies: Record<string, string>,
  now: number = Date.now(),
): QQMusicCredentialTTL | null => {
  const issuedAt = toTimestampMs(Number(cookies.psrf_musickey_createtime ?? 0));
  const expiresInMs = toDurationMs(Number(cookies.qm_key_expires_in ?? 0));
  if (!issuedAt || !expiresInMs) return null;
  const expiresAt = issuedAt + expiresInMs;
  return { issuedAt, expiresInMs, expiresAt, remainingMs: expiresAt - now };
};

/**
 * 判断凭据是否到了续期时机
 *
 * 判据：`now >= 签发时刻 + 有效期 * 0.75`，即剩余有效期不足四分之一。
 * 提前续期是必须的：续期请求本身要携带 musickey，凭据彻底过期后再补救大概率被拒。
 * @param ttl 凭据有效期信息
 * @param now 当前时刻（毫秒时间戳）
 * @param thresholdRatio 触发阈值比例
 * @returns 是否需要续期
 */
export const shouldRefreshCredential = (
  ttl: QQMusicCredentialTTL | null,
  now: number = Date.now(),
  thresholdRatio: number = REFRESH_THRESHOLD_RATIO,
): boolean => {
  if (!ttl) return false;
  return now >= ttl.issuedAt + ttl.expiresInMs * thresholdRatio;
};
