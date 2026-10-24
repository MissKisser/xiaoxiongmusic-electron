/**
 * 平台数据面路由工厂
 *
 * QQ 音乐与酷狗的平台路由结构完全同构：
 * 路径段即模块名，参数合并 query 与 body，业务码映射 HTTP 状态码。
 * 这里收敛成一个工厂，各平台文件只留各自的参数别名与模块清单。
 *
 * 错误口径：模块抛异常时**不回吐原始错误信息**，
 * 只回固定文案；详情留在服务端日志里，且参数与文本中的凭据一律脱敏。
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { serverLog } from "../../main/logger";

/**
 * 业务错误码 → HTTP 状态码
 *
 * 未列出的业务码按 200 返回，模块的业务体原样透出。
 */
const HTTP_STATUS_BY_CODE: Record<number, number> = {
  301: 401,
  400: 400,
  401: 401,
  403: 403,
  404: 404,
  500: 500,
  502: 502,
};

/** 路由层统一对外文案（不暴露内部细节） */
const GENERIC_ERROR_TEXT = "平台服务暂时不可用，请稍后再试";

/** 凭据类参数名（日志里一律脱敏） */
const CREDENTIAL_KEY_PATTERN =
  /(cookie|token|keyst|vkey|sign|secret|password|passwd|session|ticket|authorization|uin|guid|dfid)/i;

/** URL 查询串（查询串里通常带播放凭证） */
const URL_QUERY_PATTERN = /(https?:\/\/[^\s"']+)\?[^\s"']*/gi;

/**
 * 合并请求参数
 * @param req Fastify 请求
 * @returns 合并后的 query 与 body
 */
const collectParams = (req: FastifyRequest): Record<string, unknown> => {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const body =
    req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  return { ...query, ...body };
};

/**
 * 把参数里的凭据脱敏
 * @param params 原始参数
 * @returns 脱敏后的参数
 */
const redactParams = (params: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (CREDENTIAL_KEY_PATTERN.test(key)) {
      out[key] = "***";
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = `[array:${value.length}]`;
      continue;
    }
    if (value && typeof value === "object") {
      out[key] = "[object]";
      continue;
    }
    out[key] = value;
  }
  return out;
};

/**
 * 把文本里的 URL 查询串裁掉
 *
 * 上游报错信息常带完整请求地址，查询串里是播放凭证。
 * @param text 原始文本
 * @returns 脱敏后的文本
 */
const redactText = (text: string): string =>
  text.replace(URL_QUERY_PATTERN, (_match, prefix: string) => `${prefix}?***`);

/**
 * 平台路由配置
 */
export interface PlatformRouteOptions {
  /** 平台标识（用于日志） */
  platform: string;
  /** 平台展示名（主信息接口用） */
  title: string;
  /** 主信息接口的平台说明 */
  description: string;
  /** 模块清单 */
  listModules: () => string[];
  /** 调用平台模块 */
  call: (moduleName: string, params: Record<string, unknown>) => Promise<unknown>;
  /** 旧端点参数名 → 平台模块参数名 */
  paramAlias?: Record<string, Record<string, string>>;
  /** 搜索每页条数默认值 */
  searchLimit?: number;
}

/**
 * 应用旧端点参数别名
 * @param moduleName 模块名
 * @param params 待改写的参数
 * @param paramAlias 旧端点参数别名表
 * @param searchLimit 搜索每页条数默认值
 */
const applyLegacyParams = (
  moduleName: string,
  params: Record<string, unknown>,
  paramAlias?: Record<string, Record<string, string>>,
  searchLimit?: number,
): void => {
  const alias = paramAlias?.[moduleName];
  if (alias) {
    for (const [legacyKey, moduleKey] of Object.entries(alias)) {
      if (params[legacyKey] !== undefined && params[moduleKey] === undefined) {
        params[moduleKey] = params[legacyKey];
      }
    }
  }
  if (moduleName === "search" && params.limit === undefined && searchLimit !== undefined) {
    params.limit = searchLimit;
  }
};

/**
 * 创建平台数据面路由
 *
 * @param options 平台路由配置
 * @returns 路由初始化函数
 */
export const createPlatformRoute =
  (options: PlatformRouteOptions) =>
  async (fastify: FastifyInstance): Promise<void> => {
    const { platform, title, description, listModules, call, paramAlias, searchLimit } = options;

    // 允许任意内容类型的请求体，避免 POST 场景被 415 拦截
    fastify.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
      const text = typeof body === "string" ? body.trim() : "";
      if (!text) return done(null, undefined);
      try {
        done(null, JSON.parse(text));
      } catch {
        done(null, text);
      }
    });

    // 主信息
    fastify.get(`/${platform}`, (_, reply) => {
      reply.send({
        name: `${title} Platform API`,
        description,
        author: "@xiaoxiongmusic",
        modules: listModules(),
      });
    });

    // 动态通配符路由
    const dynamicHandler = async (req: FastifyRequest, reply: FastifyReply) => {
      const { "*": requestPath } = req.params as { "*": string };
      const moduleName = requestPath;

      if (!moduleName || !listModules().includes(moduleName)) {
        return reply.status(404).send({ error: "API not found" });
      }

      const params = collectParams(req);
      applyLegacyParams(moduleName, params, paramAlias, searchLimit);
      serverLog.log(`🌐 Request ${title}API:`, moduleName);

      try {
        const result = await call(moduleName, params);
        const code = Number((result as { code?: unknown })?.code);
        const status = HTTP_STATUS_BY_CODE[code] ?? 200;
        return reply.status(status).send(result);
      } catch (error) {
        // 详情只落服务端日志，且凭据脱敏；对外只给固定文案
        const message = error instanceof Error ? error.message : String(error);
        serverLog.error(
          `❌ ${title}API Error:`,
          redactText(message),
          "module:",
          moduleName,
          "params:",
          redactParams(params),
        );
        return reply.status(502).send({ error: GENERIC_ERROR_TEXT, code: 502 });
      }
    };

    fastify.get(`/${platform}/*`, dynamicHandler);
    fastify.post(`/${platform}/*`, dynamicHandler);

    serverLog.info(`🌐 Register ${title} Platform API successfully`);
  };
