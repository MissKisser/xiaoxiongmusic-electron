/**
 * KG 鉴权状态判定
 *
 * 酷狗网关把「登录态失效」「付费墙」「参数错误」都放在同一个业务错误码里，
 * 没有可核对的公开错误码表，因此按「非零业务码即登录态不可用」处理。
 *
 * 该判定存在不确定性：付费墙等业务拒绝同样会命中，
 * 所以只在登录态探测（user_detail）这一处据此判定登录态，
 * 其余接口仍按业务错误原样上抛。
 */

/** 视为成功的业务码 */
const SUCCESS_CODES: ReadonlySet<number> = new Set([0, 200]);

/** KG 业务错误：携带业务错误码，便于区分登录态失效与其它业务拒绝 */
export class KugouApiError extends Error {
  /** 业务错误码 */
  readonly errorCode: number;
  /** 上游提示文案 */
  readonly upstreamMessage: string;

  /**
   * 构造 KG 业务错误
   * @param errorCode 业务错误码
   * @param upstreamMessage 上游提示文案
   */
  constructor(errorCode: number, upstreamMessage = "") {
    super(`KG API error_code=${errorCode}${upstreamMessage ? ` msg=${upstreamMessage}` : ""}`);
    this.name = "KugouApiError";
    this.errorCode = errorCode;
    this.upstreamMessage = upstreamMessage;
  }
}

/**
 * 判断业务码是否代表登录态失效
 * @param errorCode 业务错误码
 * @returns 是否为登录态失效
 */
export const isKugouAuthExpiredCode = (errorCode: number): boolean =>
  !SUCCESS_CODES.has(errorCode);

/**
 * 判断异常是否为登录态失效
 * @param error 异常对象
 * @returns 是否为登录态失效
 */
export const isKugouAuthExpired = (error: unknown): boolean =>
  error instanceof KugouApiError && isKugouAuthExpiredCode(error.errorCode);
