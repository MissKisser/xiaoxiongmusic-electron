/**
 * QM 鉴权状态判定
 *
 * QM 后端把「凭据失效」「授权失败」「参数错误」都塞进同一个 inner 业务码，
 * 其中 1000 尤其多义：
 * - 登录态读取类接口（资料、歌单、推荐、电台）的 1000 表示凭据已过期；
 * - 写类 musicasset.* 接口的 1000 只表示缺少 p_skey 一类互联 cookie 的授权失败，
 *   仍在线的用户也会命中。
 *
 * 两者不分开就会把在线用户误判为登录过期并踢下线，因此按 module 名单分类。
 */

/** 明确表示「未登录 / 登录态失效」的 inner 业务码（与 module 无关） */
export const LOGIN_REQUIRED_INNER_CODES: ReadonlySet<number> = new Set([104400, 104401]);

/** 读取类接口上表示「凭据已过期」的 inner 业务码 */
export const AUTH_EXPIRED_INNER_CODE = 1000;

/** 写类授权接口的 module 命名规律（music.musicasset.*Write） */
const WRITE_ASSET_MODULE_PATTERN = /^music\.musicasset\..*Write$/;

/** 写类授权接口的 module 白名单 */
const WRITE_ASSET_MODULES: ReadonlySet<string> = new Set(["music.asset.MusicAsset"]);

/**
 * 判断某个 module 是否属于写类授权接口
 *
 * 写类接口的 1000 表示「缺少互联 cookie 的授权失败」，不代表凭据过期。
 * @param module 业务 module 名
 * @returns 是否为写类授权接口
 */
export const isWriteAssetModule = (module: string): boolean =>
  WRITE_ASSET_MODULE_PATTERN.test(module) || WRITE_ASSET_MODULES.has(module);

/**
 * 判定业务码是否代表凭据失效
 *
 * 104400 / 104401 明确表示未登录，任何 module 都按凭据失效处理；
 * 1000 只在读取类接口上表示凭据过期，写类接口上表示授权失败。
 * @param module 业务 module 名
 * @param innerCode 内层业务码
 * @returns 是否为凭据失效
 */
export const isAuthExpiredCode = (module: string, innerCode: number): boolean => {
  if (LOGIN_REQUIRED_INNER_CODES.has(innerCode)) return true;
  if (innerCode !== AUTH_EXPIRED_INNER_CODE) return false;
  return !isWriteAssetModule(module);
};

/** QM 业务错误信息 */
export interface QQMusicErrorInfo {
  /** 外层业务码 */
  outer: number;
  /** 内层业务码 */
  inner: number;
  /** 业务 module */
  module: string;
  /** 业务 method */
  method: string;
  /** 是否判定为凭据失效 */
  authExpired: boolean;
}

/**
 * QM 业务错误
 *
 * 取代纯字符串异常：调用方据此区分「凭据失效」（需要续期或重新登录）
 * 与「网络故障 / 业务拒绝」（不应动登录态）。
 */
export class QQMusicApiError extends Error {
  /** 外层业务码 */
  readonly outer: number;
  /** 内层业务码 */
  readonly inner: number;
  /** 业务 module */
  readonly module: string;
  /** 业务 method */
  readonly method: string;
  /** 是否判定为凭据失效 */
  readonly authExpired: boolean;

  /**
   * 构造 QM 业务错误
   * @param info 错误信息
   */
  constructor(info: QQMusicErrorInfo) {
    super(
      `QM API 错误: outer=${info.outer} inner=${info.inner} module=${info.module} method=${info.method}`,
    );
    this.name = "QQMusicApiError";
    this.outer = info.outer;
    this.inner = info.inner;
    this.module = info.module;
    this.method = info.method;
    this.authExpired = info.authExpired;
  }
}

/**
 * 判断异常是否为「凭据失效」的 QM 业务错误
 * @param error 异常对象
 * @returns 是否为凭据失效
 */
export const isQQMusicAuthExpired = (error: unknown): boolean =>
  error instanceof QQMusicApiError && error.authExpired;
