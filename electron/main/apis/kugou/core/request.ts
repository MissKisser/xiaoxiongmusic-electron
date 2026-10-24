/**
 * KG 请求层
 *
 * 提供两种请求方式：
 * - kgRequest: 基础 HTTP GET 请求（用于 mobilecdn、songsearch、lyrics 等公开接口）
 * - kgGatewayRequest: KG网关鉴权请求（自动注入设备标识、时间戳、签名与网关路由头）
 */

import { KG_GATEWAY_URL, getKgAppid, getKgClientver } from "./config";
import { cleanKgResponse, getDeviceMid, signatureAndroidParams } from "./crypto";
import { KugouApiError } from "./auth";
import { getSessionCookies } from "../../../database/PlatformSessionDB";

interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /**
   * 业务错误码非 0 时不抛错
   *
   * 酷狗把「业务失败」与「传输失败」混在同一个响应里：付费墙、无授权、
   * 参数错误都走 HTTP 200 + 业务错误码。判据类接口需要自己读这些码，
   * 此时不能让请求层把响应吞掉。
   */
  allowBusinessError?: boolean;
}

export interface KGRawBody {
  status?: number;
  error_code?: number;
  errcode?: number;
  err_code?: number;
  data?: unknown;
  info?: unknown;
  [key: string]: unknown;
}

/**
 * 基础 GET 请求
 * @param url - 请求 URL
 * @param options - 请求配置
 * @returns 解析后的 JSON body
 */
export const kgRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const res = await fetch(url, {
    method: "GET",
    headers: options.headers,
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw new Error(`KG HTTP ${res.status}`);

  const rawText = await res.text();
  const cleaned = cleanKgResponse(rawText);
  const body = JSON.parse(cleaned) as KGRawBody;

  const code = body.error_code ?? body.errcode ?? body.err_code ?? 0;
  if (!options.allowBusinessError && code !== 0 && code !== 200) {
    throw new KugouApiError(code, String(body.msg ?? body.error ?? ""));
  }

  return body as T;
};

/**
 * 读取酷狗响应里的业务错误码
 * @param body - 响应体
 * @returns 业务错误码，没有错误码时返回 0
 */
export const kgErrorCode = (body: unknown): number => {
  if (!body || typeof body !== "object") return 0;
  const record = body as Record<string, unknown>;
  const code = record.error_code ?? record.errcode ?? record.err_code ?? 0;
  return Number(code) || 0;
};

export interface GatewayRequestOptions {
  method?: "GET" | "POST";
  baseURL?: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  notSignature?: boolean;
  timeoutMs?: number;
  /**
   * 业务错误码非 0 时不抛错
   *
   * 播放地址、评论、专辑等接口把「付费墙 / 无授权 / 参数错误」放在
   * 业务错误码里，调用方需要按错误码分流，只能自己读。
   */
  allowBusinessError?: boolean;
}

/**
 * 发送带 Android 签名的KG网关请求
 * @param path - 网关相对路径（如 /v1/search/album）
 * @param options - 请求配置项
 * @returns 解析后的 JSON body
 */
export const kgGatewayRequest = async <T = KGRawBody>(
  path: string,
  options: GatewayRequestOptions = {},
): Promise<T> => {
  const {
    method = "GET",
    baseURL = KG_GATEWAY_URL,
    params = {},
    data,
    headers = {},
    notSignature = false,
    timeoutMs = 8000,
    allowBusinessError = false,
  } = options;

  const clienttime = Math.floor(Date.now() / 1000);
  const mid = getDeviceMid();
  const session = getSessionCookies("kugou");
  const dfid = session.dfid || "-";
  const uuid = "-";

  const defaultParams: Record<string, unknown> = {
    dfid,
    mid,
    uuid,
    appid: getKgAppid(),
    clientver: getKgClientver(),
    clienttime,
    ...(session.token ? { token: session.token } : {}),
    ...(session.userid ? { userid: session.userid } : {}),
  };

  const mergedParams = { ...defaultParams, ...params };

  const serializedData =
    data !== undefined
      ? typeof data === "string" || Buffer.isBuffer(data)
        ? data
        : JSON.stringify(data)
      : "";

  if (!mergedParams.signature && !notSignature) {
    mergedParams.signature = signatureAndroidParams(mergedParams, serializedData);
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(mergedParams)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }

  const queryStr = searchParams.toString();
  const fullUrl = `${baseURL}${path}${queryStr ? `?${queryStr}` : ""}`;

  const defaultHeaders: Record<string, string> = {
    "User-Agent": "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi",
    dfid,
    clienttime: String(clienttime),
    mid,
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
  };

  if (method === "POST" && !headers["Content-Type"]) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  const res = await fetch(fullUrl, {
    method,
    headers: { ...defaultHeaders, ...headers },
    body: method === "POST" ? (serializedData as BodyInit) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`KG Gateway HTTP ${res.status}`);

  const rawText = await res.text();
  const cleaned = cleanKgResponse(rawText);
  const body = JSON.parse(cleaned) as KGRawBody;

  const code = body.error_code ?? body.errcode ?? body.err_code ?? 0;
  if (!allowBusinessError && code !== 0 && code !== 200) {
    throw new KugouApiError(code, String(body.msg ?? body.error ?? ""));
  }

  return body as T;
};
