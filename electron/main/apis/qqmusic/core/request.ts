/**
 * QM 请求层
 *
 * 设计：
 * - 统一走 u.y.qq.com/cgi-bin/musicu.fcg 的 `{ comm, request: {module, method, param} }` 协议
 * - 首次请求前先调 music.getSession.session 拿 uid/sid/userip，缓存 1 小时
 * - 没有加密：API 本身明文 JSON POST，靠 UA + QIMEI36 等 comm 字段伪装客户端
 * - Referer 设为 https://y.qq.com，部分接口会校验
 */

import { QM_API_URL, QM_HEADERS, SESSION_TTL, getCommonParams } from "./config";
import { coreLog } from "../../../logger";
import { resolveCredentialTTL, sessionToCookieHeader, shouldRefreshCredential } from "./credential";
import { QQMusicApiError, isAuthExpiredCode } from "./auth";
import { clearCache, resolveAccountId } from "./cache";
import {
  getQQMusicSession,
  mergeQQMusicSession,
  resetQQMusicSession,
  setQQMusicSession,
} from "./session";

/** Session 字段（可能缺失则下次请求会自动补拿） */
interface SessionCache {
  uid?: string;
  sid?: string;
  userip?: string;
  expireAt: number;
}

let session: SessionCache = { expireAt: 0 };
let initPromise: Promise<void> | null = null;
let sessionGeneration = 0;

/** 使当前客户端会话失效，避免账号变化后继续复用旧会话 */
const invalidateSession = (): void => {
  sessionGeneration++;
  session = { expireAt: 0 };
};

/** 读取内存或数据库中的 QM cookies */
export const getQQMusicCookies = (): Record<string, string> => getQQMusicSession();

/** 更新 QM cookies 并落库 */
export const mergeQQMusicCookies = (cookies: Record<string, string>): void => {
  const previousAccountId = resolveAccountId(getQQMusicCookies());
  const merged = mergeQQMusicSession(cookies);
  invalidateSession();
  // 换号（账号标识变化）时丢弃旧账号的缓存条目
  if (resolveAccountId(merged) !== previousAccountId) clearCache();
  coreLog.info(`[qm-cookie] 已保存 Cookie (${Object.keys(merged).length} 个字段)`);
};

/**
 * 用新凭据整体替换当前 QM 会话（换号登录）
 *
 * 旧账号的会话字段（互联 cookie、微信态凭据等）一并丢弃，
 * 避免出现「半旧半新」的会话态；替换后旧账号的缓存条目同时作废。
 * @param cookies 新账号的会话字段
 */
export const replaceQQMusicCookies = (cookies: Record<string, string>): void => {
  resetQQMusicSession();
  setQQMusicSession(cookies);
  invalidateSession();
  clearCache();
  // 换号后旧凭据的续期失败记录不再适用
  lastRefreshFailureAt = 0;
  coreLog.info(`[qm-cookie] 已切换为新账号会话 (${Object.keys(cookies).length} 个字段)`);
};

/** 清空 QM cookies 登录态 */
export const clearQQMusicCookies = (): void => {
  resetQQMusicSession();
  invalidateSession();
  clearCache();
  coreLog.info("[qm-cookie] 已从数据库中清空 QM Session");
};

/** 提取当前登录 uin（纯数字形式） */
export const getQQMusicUin = (): string => {
  const cookies = getQQMusicCookies();
  const raw = cookies.qm_str_musicid || cookies.uin || cookies.wxuin || cookies.p_uin || "";
  return raw ? raw.replace(/^o/, "") : "0";
};

/** 重试次数与退避 */
const MAX_RETRY = 2;
const RETRY_BACKOFF = 300;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface FcgResponse {
  code?: number;
  request?: { code?: number; data?: unknown };
  [key: string]: unknown;
}

interface QMRequestOptions {
  /** 是否在请求前初始化客户端会话 */
  session?: boolean;
  /** 追加到 comm 的字段（如 tmeLoginType） */
  comm?: Record<string, unknown>;
  /**
   * 使用网页端 comm 与网页端 Referer，而非移动端默认
   *
   * 歌单类接口（music.srfDissInfo.DissInfo / aiDissInfo）在移动端默认值下会返回
   * 「invalid referer」：移动端 Referer 为 `https://y.qq.com`（无尾斜杠），
   * 而该组接口要求带路径的 Referer（如 `https://y.qq.com/`）。
   */
  webComm?: boolean;
  /** 覆盖本次请求的 Referer */
  referer?: string;
}

/** 网页端 comm（ct=24 / cv=0），用于歌单类接口 */
const WEB_COMM: Record<string, unknown> = {
  ct: 24,
  cv: 0,
  format: "json",
  platform: "yqq.json",
};

/** 网页端 Referer（带尾斜杠），歌单类接口的 Referer 校验要求 */
const WEB_REFERER = "https://y.qq.com/";

/** 发起一次 fcg POST（自动注入 Cookie） */
const postRaw = async (
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<FcgResponse> => {
  const cookies = getQQMusicCookies();
  const cookieStr = sessionToCookieHeader(cookies);

  const res = await fetch(QM_API_URL, {
    method: "POST",
    headers: {
      ...QM_HEADERS,
      ...(cookieStr ? { Cookie: cookieStr } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return (await res.json()) as FcgResponse;
};

/**
 * 发送请求并按需重试
 *
 * 只重试网络故障与超时；业务码错误说明上游已给出明确结论，
 * 重试只是白打（凭据已死时尤其如此），因此直接抛出结构化错误。
 * @param body 请求体
 * @param extraHeaders 追加的请求头
 * @param module 业务 module
 * @param method 业务 method
 * @returns request.data 的业务数据段
 */
const postWithRetry = async <T>(
  body: unknown,
  extraHeaders: Record<string, string> | undefined,
  module: string,
  method: string,
): Promise<T> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const data = await postRaw(body, extraHeaders);
      const outerCode = data.code ?? 0;
      const innerCode = data.request?.code ?? 0;
      if (outerCode !== 0 || innerCode !== 0) {
        throw new QQMusicApiError({
          outer: outerCode,
          inner: innerCode,
          module,
          method,
          authExpired: isAuthExpiredCode(module, innerCode),
        });
      }
      return data.request?.data as T;
    } catch (err) {
      if (err instanceof QQMusicApiError) throw err;
      lastErr = err;
      if (attempt < MAX_RETRY) await delay(RETRY_BACKOFF);
    }
  }
  throw lastErr;
};

/** 初始化 / 刷新 session（1h 过期）；并发安全：同一时刻只发一次 */
const ensureSession = (): Promise<void> => {
  if (session.uid && session.expireAt > Date.now()) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const generation = sessionGeneration;
    try {
      const uin = getQQMusicUin();
      const body = {
        comm: {
          ...getCommonParams(),
          ...(uin && uin !== "0" ? { uin } : {}),
        },
        request: {
          module: "music.getSession.session",
          method: "GetSession",
          param: { caller: 0, uid: uin, vkey: 0 },
        },
      };
      const data = await postRaw(body);
      if (generation === sessionGeneration && data.code === 0 && data.request?.code === 0) {
        const info =
          ((data.request.data as { session?: Partial<SessionCache> }) ?? {}).session ?? {};
        session = {
          uid: info.uid,
          sid: info.sid,
          userip: info.userip,
          expireAt: Date.now() + SESSION_TTL,
        };
      }
    } catch {
      // session 失败不阻塞后续调用，大部分接口无 session 也能回结果
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

/**
 * 发送一次 musicu.fcg 请求
 * @param module 业务 module（如 music.search.SearchCgiService）
 * @param method 业务 method（如 DoSearchForQQMusicMobile）
 * @param param  业务 param
 * @param options 请求选项
 * @returns request.data 的业务数据段
 */
export const qmRequest = async <T = unknown>(
  module: string,
  method: string,
  param: Record<string, unknown>,
  options: QMRequestOptions = {},
): Promise<T> => {
  const useSession = options.session !== false;
  if (useSession) await ensureSession();

  const extraHeaders: Record<string, string> | undefined =
    options.referer || options.webComm ? { Referer: options.referer ?? WEB_REFERER } : undefined;

  /** 按当前凭据构造请求体（续期后需重建，以带上新的 musickey） */
  const buildBody = (): Record<string, unknown> => {
    const uin = getQQMusicUin();
    const cookies = getQQMusicCookies();
    const musickey = cookies.qm_keyst || cookies.qqmusic_key;
    const loginType =
      cookies.tmeLoginType !== undefined
        ? Number(cookies.tmeLoginType)
        : musickey?.startsWith("W_X")
          ? 1
          : 2;

    const comm = {
      ...(options.webComm ? WEB_COMM : getCommonParams()),
      ...(uin && uin !== "0" ? { uin, qq: uin } : {}),
      ...(musickey ? { authst: musickey, tmeLoginType: loginType } : {}),
      ...(useSession && session.uid ? { uid: session.uid } : {}),
      ...(useSession && session.sid ? { sid: session.sid } : {}),
      ...(useSession && session.userip ? { userip: session.userip } : {}),
      ...(options.comm ?? {}),
    };

    return { comm, request: { module, method, param } };
  };

  try {
    return await postWithRetry<T>(buildBody(), extraHeaders, module, method);
  } catch (err) {
    // 鉴权失效：先续期再重放一次；续期失败则把结构化错误上抛给调用方
    if (!(err instanceof QQMusicApiError) || !err.authExpired) throw err;
    const refreshed = await refreshQQMusicCredential();
    if (!refreshed) throw err;
    return await postWithRetry<T>(buildBody(), extraHeaders, module, method);
  }
};

/** 调试用：取当前 session 快照 */
export const getQMSession = (): Readonly<SessionCache> => session;

/** LoginServer.Login 刷新后的凭据字段 */
interface RefreshCredentialData {
  musickey?: string;
  openid?: string;
  unionid?: string;
  refresh_token?: string;
  access_token?: string;
  expired_at?: number;
  musicid?: number;
  str_musicid?: string;
  refresh_key?: string;
  musickeyCreateTime?: number;
  keyExpiresIn?: number;
  encryptUin?: string;
  loginType?: number;
}

/** 续期失败后的冷却时长（毫秒）：避免每个请求都去打一次续期 */
const REFRESH_COOLDOWN = 30_000;

/** 正在进行的续期请求（并发调用共享同一次，避免重复消耗一次性 refresh_key） */
let refreshPromise: Promise<boolean> | null = null;

/** 上次续期失败的时刻 */
let lastRefreshFailureAt = 0;

/**
 * 执行一次凭据续期
 * @returns 续期是否成功
 */
const doRefreshCredential = async (): Promise<boolean> => {
  const cookies = getQQMusicCookies();
  const uin = getQQMusicUin();
  const musickey = cookies.qm_keyst || cookies.qqmusic_key;
  if (!uin || uin === "0" || !musickey) return false;

  const loginType = Number(cookies.tmeLoginType) || (musickey.startsWith("W_X") ? 1 : 2);
  const refreshKey = cookies.qm_refresh_key || "";

  let param: Record<string, unknown>;
  if (loginType === 1) {
    // 微信型凭据刷新
    param = {
      openid: cookies.wxopenid || cookies.psrf_qqopenid || "",
      refresh_token: cookies.wxrefresh_token || cookies.psrf_qqrefresh_token || "",
      str_musicid: cookies.qm_str_musicid || uin,
      musickey,
      unionid: cookies.psrf_qqunionid || "",
      refresh_key: refreshKey,
      loginMode: 2,
    };
  } else {
    // QQ 型凭据刷新
    param = {
      openid: cookies.psrf_qqopenid || cookies.wxopenid || "",
      access_token: cookies.psrf_qqaccess_token || "",
      refresh_token: cookies.psrf_qqrefresh_token || cookies.wxrefresh_token || "",
      expired_in: Number(cookies.psrf_access_token_expiresAt) || 0,
      musicid: Number(uin) || 0,
      musickey,
      refresh_key: refreshKey,
      loginMode: 2,
    };
  }

  try {
    // 直连而不走 qmRequest：避免业务码非零时的无意义重试，且能拿到完整拒绝原因
    const resp = await postRaw({
      comm: {
        ...getCommonParams(),
        ...(uin !== "0" ? { uin, qq: uin } : {}),
        authst: musickey,
        tmeLoginType: loginType,
      },
      request: {
        module: "music.login.LoginServer",
        method: "Login",
        param,
      },
    });
    const inner = resp.request;
    if (resp.code !== 0 || inner?.code !== 0) {
      coreLog.warn("[qm-refresh] 刷新被拒绝:", JSON.stringify(inner ?? resp));
      return false;
    }
    const data = inner?.data as RefreshCredentialData | undefined;
    if (!data?.musickey) return false;

    const refreshed: Record<string, string> = {
      qm_keyst: data.musickey,
      qqmusic_key: data.musickey,
      tmeLoginType: String(data.loginType ?? loginType),
    };
    if (data.str_musicid || data.musicid) {
      const musicId = String(data.str_musicid || data.musicid).replace(/^o/, "");
      refreshed.qm_str_musicid = musicId;
      refreshed.uin = musicId;
      if (loginType === 1) refreshed.wxuin = musicId;
    }
    if (data.encryptUin) refreshed.euin = data.encryptUin;
    if (data.openid) refreshed[loginType === 1 ? "wxopenid" : "psrf_qqopenid"] = data.openid;
    if (data.unionid) refreshed.psrf_qqunionid = data.unionid;
    if (data.refresh_token)
      refreshed[loginType === 1 ? "wxrefresh_token" : "psrf_qqrefresh_token"] = data.refresh_token;
    if (data.access_token) refreshed.psrf_qqaccess_token = data.access_token;
    if (data.expired_at) refreshed.psrf_access_token_expiresAt = String(data.expired_at);
    if (data.musickeyCreateTime)
      refreshed.psrf_musickey_createtime = String(data.musickeyCreateTime);
    // 网页 cookie 无此字段，首次刷新后落库供后续刷新复用
    if (data.refresh_key) refreshed.qm_refresh_key = data.refresh_key;
    // 有效期随新凭据一起下发：不落库则续期后无法再算下一次续期时机
    if (data.keyExpiresIn) refreshed.qm_key_expires_in = String(data.keyExpiresIn);

    mergeQQMusicCookies(refreshed);
    coreLog.info("[qm-refresh] musickey 刷新成功", { uin });
    return true;
  } catch (err) {
    coreLog.warn("[qm-refresh] musickey 刷新失败:", err);
    return false;
  }
};

/**
 * 用存储的凭据调 LoginServer.Login（loginMode=2）刷新 musickey
 *
 * refresh_key 是一次性的：同一时刻只发一次续期请求，
 * 失败后进入短冷却，避免每个业务请求都去打一次续期。
 * @returns 刷新成功（新 key 已写回 cookie）返回 true；失败返回 false
 */
export const refreshQQMusicCredential = async (): Promise<boolean> => {
  if (refreshPromise) return refreshPromise;
  if (lastRefreshFailureAt && Date.now() - lastRefreshFailureAt < REFRESH_COOLDOWN) return false;

  refreshPromise = doRefreshCredential()
    .then((ok) => {
      if (ok) lastRefreshFailureAt = 0;
      else lastRefreshFailureAt = Date.now();
      return ok;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
};

/** 续期检查间隔（毫秒） */
const REFRESH_CHECK_INTERVAL = 30 * 60 * 1000;

/** 续期调度定时器 */
let refreshTimer: NodeJS.Timeout | null = null;

/**
 * 按凭据有效期判断是否需要续期，并在需要时立即续期
 *
 * 判据：剩余有效期不足四分之一即续期，
 * 保证续期请求在凭据真正过期前发出（续期请求本身要携带 musickey）。
 * @returns 是否执行了续期
 */
export const refreshQQMusicCredentialIfNeeded = async (): Promise<boolean> => {
  const cookies = getQQMusicCookies();
  if (!shouldRefreshCredential(resolveCredentialTTL(cookies))) return false;
  return refreshQQMusicCredential();
};

/**
 * 启动凭据续期调度
 *
 * 启动时先检查一次，随后按固定间隔复查；续期成功后由 mergeQQMusicCookies
 * 使客户端会话失效，下次请求会重新建立会话。
 */
export const startQQMusicCredentialScheduler = (): void => {
  if (refreshTimer) return;
  void refreshQQMusicCredentialIfNeeded();
  refreshTimer = setInterval(() => {
    void refreshQQMusicCredentialIfNeeded();
  }, REFRESH_CHECK_INTERVAL);
  refreshTimer.unref?.();
};

/**
 * 停止凭据续期调度
 */
export const stopQQMusicCredentialScheduler = (): void => {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
};
