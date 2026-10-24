/**
 * 酷狗云歌单协议层
 *
 * 只依赖 node:crypto 与全局 fetch，不引用 electron / @main 任何模块，
 * 因此可以在普通 Node 进程里直接用真凭据做端到端验证。
 *
 * 覆盖两套协议：
 * - 协议 A（buildGatewayRequest）：Android 客户端签名 + 明文 JSON body
 * - 协议 B（buildCloudRequest）：RSA 传参 + AES-128-CBC 加密 body
 *
 * 协议 A 用于 cloudlist 的创建、加歌、删歌、删除歌单；
 * 协议 B 用于修改歌单信息。
 */

import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  publicEncrypt,
  randomInt,
} from "node:crypto";

/** 酷狗网关地址 */
const KG_GATEWAY_URL = "https://gateway.kugou.com";

/** 云歌单服务路由头 */
export const KG_CLOUDLIST_ROUTER = "cloudlist.service.kugou.com";

/** Android 客户端 UA */
const KG_ANDROID_UA = "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi";

/** 概念版 RSA 公钥 */
const KG_CLOUD_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB
-----END PUBLIC KEY-----`;

/** 云歌单 AES 会话串字符表 */
const KG_AES_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 设备 MID 的固定种子 */
const KG_MID_SEED = "xiaoxiongmusic-kugou-device-mid";

/** 协议请求上下文 */
export interface KgRequestContext {
  /** 客户端标识 */
  appid: number;
  /** 客户端版本号 */
  clientver: number;
  /** 签名盐值 */
  signSalt: string;
  /** RSA 公钥（协议 B 传参用，缺省时用概念版公钥） */
  publicKey?: string;
  /** 设备 MID（十进制字符串） */
  mid: string;
  /** 设备指纹 */
  dfid: string;
  /** 账号 userid */
  userid: string;
  /** 登录 token */
  token: string;
  /** 秒级时间戳 */
  clienttime: number;
}

/** 构造好的请求 */
export interface BuiltRequest {
  /** 完整请求地址 */
  url: string;
  /** 请求头 */
  headers: Record<string, string>;
  /** 请求体（协议 A 为 JSON 字符串，协议 B 为密文字节） */
  body: string | Buffer;
  /** 协议 B 的 AES 会话串，用于解密响应 */
  aes?: string;
}

/** 请求发送结果 */
export interface KgSendResult {
  /** HTTP 状态码 */
  status: number;
  /** 解析后的业务响应体 */
  body: any;
}

/**
 * 计算 MD5 哈希
 * @param data - 待计算的数据
 * @returns 32 位小写 hex 哈希
 */
const md5 = (data: string): string => createHash("md5").update(data, "utf8").digest("hex");

/**
 * 把参数序列化为参与签名的字符串：key 按字母序排列，拼成无分隔符的 k=v 串
 * @param params - 参数表
 * @returns 签名用的参数字符串
 */
const stringifyParams = (params: Record<string, unknown>): string =>
  Object.keys(params)
    .sort()
    .map((key) => {
      const value = params[key];
      const text = typeof value === "object" && value !== null ? JSON.stringify(value) : value;
      return `${key}=${text ?? ""}`;
    })
    .join("");

/**
 * 由 AES 会话串派生 16 字节密钥与 16 字节初始向量
 * @param aes - 6 位会话串
 * @returns 密钥与初始向量（均为 ASCII 串，按 UTF-8 字节使用）
 */
const deriveAesKey = (aes: string): { key: string; iv: string } => {
  const digest = md5(aes);
  return { key: digest.slice(0, 16), iv: digest.slice(16, 32) };
};

/**
 * 随机生成 AES 会话串
 * @returns 6 位会话串
 */
const randomAes = (): string => {
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += KG_AES_ALPHABET[randomInt(KG_AES_ALPHABET.length)];
  }
  return out;
};

/**
 * 去除响应文本中的标签包裹
 * @param text - 原始响应文本
 * @returns 纯 JSON 文本
 */
const stripTag = (text: string): string =>
  text
    .trim()
    .replace(/^<!--KG_TAG_RES_START-->/, "")
    .replace(/<!--KG_TAG_RES_END-->$/, "");

/**
 * 解析 JSON 文本
 * @param text - 待解析文本
 * @returns 解析结果，失败时返回 undefined
 */
const parseJson = (text: string): any => {
  try {
    return JSON.parse(stripTag(text));
  } catch {
    return undefined;
  }
};

/**
 * 计算本应用使用的设备 MID
 * @returns MID 十进制字符串
 */
export const getCloudDeviceMid = (): string => BigInt(`0x${md5(KG_MID_SEED)}`).toString(10);

/**
 * 构造协议 A 请求：Android 客户端签名 + 明文 JSON body
 * @param path - 网关相对路径
 * @param body - 业务请求体
 * @param ctx - 请求上下文
 * @param options - 附加查询参数与请求头
 * @returns 构造好的请求
 */
export const buildGatewayRequest = (
  path: string,
  body: Record<string, unknown>,
  ctx: KgRequestContext,
  options?: { params?: Record<string, unknown>; headers?: Record<string, string> },
): BuiltRequest => {
  const params: Record<string, unknown> = {
    dfid: ctx.dfid || "-",
    mid: ctx.mid,
    uuid: "-",
    appid: ctx.appid,
    clientver: ctx.clientver,
    clienttime: ctx.clienttime,
    ...(ctx.token ? { token: ctx.token } : {}),
    ...(ctx.userid ? { userid: ctx.userid } : {}),
    ...(options?.params ?? {}),
  };

  const bodyStr = JSON.stringify(body ?? {});
  const signature = md5(`${ctx.signSalt}${stringifyParams(params)}${bodyStr}${ctx.signSalt}`);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  query.append("signature", signature);

  const headers: Record<string, string> = {
    "User-Agent": KG_ANDROID_UA,
    "Content-Type": "application/json",
    dfid: ctx.dfid || "-",
    clienttime: String(ctx.clienttime),
    mid: ctx.mid,
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
    ...(options?.headers ?? {}),
  };

  return { url: `${KG_GATEWAY_URL}${path}?${query.toString()}`, headers, body: bodyStr };
};

/**
 * 构造协议 B 请求：RSA 传参 + AES-128-CBC 加密 body
 *
 * 客户端标识、签名盐值与 RSA 公钥都取自请求上下文，与协议 A 及读模块保持
 * 同一套（概念版 / 标准版）标识；公钥不匹配时网关无法解出 `p`。
 * @param path - 网关相对路径
 * @param body - 业务请求体
 * @param ctx - 请求上下文
 * @returns 构造好的请求，aes 字段用于解密响应
 */
export const buildCloudRequest = (
  path: string,
  body: Record<string, unknown>,
  ctx: KgRequestContext,
): BuiltRequest => {
  const aes = randomAes();
  const { key, iv } = deriveAesKey(aes);
  const keyParam = md5(
    `${ctx.appid}${ctx.signSalt}${ctx.clientver}${ctx.clienttime}`,
  ).toLowerCase();
  const p = publicEncrypt(
    { key: ctx.publicKey ?? KG_CLOUD_PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(JSON.stringify({ aes, uid: ctx.userid, token: ctx.token }), "utf8"),
  )
    .toString("hex")
    .toUpperCase();

  const query = new URLSearchParams();
  query.append("appid", String(ctx.appid));
  query.append("clientver", String(ctx.clientver));
  query.append("mid", ctx.mid);
  query.append("clienttime", String(ctx.clienttime));
  query.append("key", keyParam);
  query.append("dfid", ctx.dfid || "-");
  query.append("p", p);

  const headers: Record<string, string> = {
    "x-router": KG_CLOUDLIST_ROUTER,
    "Content-Type": "application/json;charset=utf-8",
    dfid: ctx.dfid || "-",
    clienttime: String(ctx.clienttime),
    mid: ctx.mid,
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
  };

  const cipher = createCipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  const cipherText = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(body ?? {}), "utf8")),
    cipher.final(),
  ]);

  return { url: `${KG_GATEWAY_URL}${path}?${query.toString()}`, headers, body: cipherText, aes };
};

/**
 * 解密协议 B 的响应
 * @param raw - 响应原始字节
 * @param _ctx - 请求上下文（解密只依赖 aes，保留该参数以便与请求构造接口对齐）
 * @param aes - 请求时使用的 AES 会话串
 * @returns 解密后的文本，解密失败时退回原始字节的 UTF-8 文本
 */
export const decryptCloudResponse = (raw: Buffer, _ctx: KgRequestContext, aes: string): string => {
  try {
    const { key, iv } = deriveAesKey(aes);
    const decipher = createDecipheriv(
      "aes-128-cbc",
      Buffer.from(key, "utf8"),
      Buffer.from(iv, "utf8"),
    );
    return Buffer.concat([decipher.update(raw), decipher.final()]).toString("utf8");
  } catch {
    return raw.toString("utf8");
  }
};

/**
 * 发送协议 A 请求
 * @param path - 网关相对路径
 * @param body - 业务请求体
 * @param ctx - 请求上下文
 * @param options - 附加查询参数、请求头与超时
 * @returns HTTP 状态码与业务响应体
 */
export const sendGatewayRequest = async (
  path: string,
  body: Record<string, unknown>,
  ctx: KgRequestContext,
  options?: {
    params?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<KgSendResult> => {
  const built = buildGatewayRequest(path, body, ctx, options);
  const res = await fetch(built.url, {
    method: "POST",
    headers: built.headers,
    body: built.body as BodyInit,
    signal: AbortSignal.timeout(options?.timeoutMs ?? 10000),
  });
  const text = await res.text();
  return { status: res.status, body: parseJson(text) ?? text };
};

/**
 * 发送协议 B 请求
 * @param path - 网关相对路径
 * @param body - 业务请求体
 * @param ctx - 请求上下文
 * @returns HTTP 状态码与业务响应体
 */
export const sendCloudRequest = async (
  path: string,
  body: Record<string, unknown>,
  ctx: KgRequestContext,
): Promise<KgSendResult> => {
  const built = buildCloudRequest(path, body, ctx);
  const res = await fetch(built.url, {
    method: "POST",
    headers: built.headers,
    body: built.body as BodyInit,
    signal: AbortSignal.timeout(10000),
  });
  const raw = Buffer.from(await res.arrayBuffer());
  const text = decryptCloudResponse(raw, ctx, built.aes ?? "");
  return { status: res.status, body: parseJson(text) ?? text };
};
