/**
 * 平台接口失败的归类
 *
 * 主进程异常跨进程只保留 message，结构化字段必须在这里显式提取，
 * 渲染端才能区分「凭据失效」与「业务拒绝 / 网络抖动」。
 */

import { QQMusicApiError } from "../apis/qqmusic/core/auth";
import { KugouApiError } from "../apis/kugou/core/auth";
import type { PlatformErrorCode } from "@shared";

/** 平台接口失败响应 */
export interface PlatformErrorResponse {
  ok: false;
  /** 失败说明 */
  error: string;
  /** 失败原因分类 */
  errorCode: PlatformErrorCode;
  /** 上游外层业务码 */
  outer?: number;
  /** 上游内层业务码 */
  inner?: number;
}

/**
 * 把主进程异常翻译成带失败原因分类的响应
 * @param err 异常对象
 * @returns 失败响应
 */
export const toPlatformErrorResponse = (err: unknown): PlatformErrorResponse => {
  if (err instanceof QQMusicApiError) {
    return {
      ok: false,
      error: err.message,
      errorCode: err.authExpired ? "AUTH_EXPIRED" : "BUSINESS_ERROR",
      outer: err.outer,
      inner: err.inner,
    };
  }
  if (err instanceof KugouApiError) {
    return {
      ok: false,
      error: err.message,
      errorCode: "AUTH_EXPIRED",
      inner: err.errorCode,
    };
  }
  return {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    errorCode: "UNKNOWN",
  };
};
