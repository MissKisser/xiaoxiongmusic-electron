import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { serverLog } from "../../main/logger";
import { callQQMusic, listQQMusicModules } from "../../main/apis/qqmusic";

/**
 * 旧端点参数名 → 平台模块参数名
 *
 * 旧版 `/api/qqmusic/lyric|search|match` 三个端点用的是 `keyword` / `pageSize`，
 * 平台模块用的是 `keywords` / `limit`，这里做一层别名映射，
 * 渲染端 `src/api/qqmusic.ts` 无需改动即可继续消费。
 */
const LEGACY_PARAM_ALIAS: Record<string, Record<string, string>> = {
  search: { keyword: "keywords", pageSize: "limit" },
  match: { keyword: "keywords" },
};

/** 旧版搜索每页条数默认值 */
const LEGACY_SEARCH_LIMIT = 20;

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

/**
 * 合并请求参数
 * @param req - Fastify 请求
 * @returns 合并后的 query 与 body
 */
const collectParams = (req: FastifyRequest): Record<string, unknown> => {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const body =
    req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  return { ...query, ...body };
};

/**
 * 应用旧端点参数别名
 * @param moduleName - 模块名
 * @param params - 待改写的参数
 */
const applyLegacyParams = (moduleName: string, params: Record<string, unknown>): void => {
  const alias = LEGACY_PARAM_ALIAS[moduleName];
  if (alias) {
    for (const [legacyKey, moduleKey] of Object.entries(alias)) {
      if (params[legacyKey] !== undefined && params[moduleKey] === undefined) {
        params[moduleKey] = params[legacyKey];
      }
    }
  }
  if (moduleName === "search" && params.limit === undefined) {
    params.limit = LEGACY_SEARCH_LIMIT;
  }
};

/**
 * 初始化 QQ 音乐平台路由
 *
 * 路径段即模块名（下划线风格），如 `/api/qqmusic/song_url` → `song_url`。
 */
export const initQQMusicPlatformAPI = async (fastify: FastifyInstance) => {
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
  fastify.get("/qqmusic", (_, reply) => {
    reply.send({
      name: "QQMusic Platform API",
      description: "QQ 音乐数据面（主进程平台模块转发）",
      author: "@imsyy",
      modules: listQQMusicModules(),
    });
  });

  // 动态通配符路由
  const dynamicHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { "*": requestPath } = req.params as { "*": string };
    const moduleName = requestPath;

    if (!moduleName || !listQQMusicModules().includes(moduleName)) {
      return reply.status(404).send({ error: "API not found" });
    }

    const params = collectParams(req);
    applyLegacyParams(moduleName, params);
    serverLog.log("🌐 Request QQMusicAPI:", moduleName);

    try {
      const result = await callQQMusic(moduleName, params);
      const code = Number((result as { code?: unknown })?.code);
      const status = HTTP_STATUS_BY_CODE[code] ?? 200;
      return reply.status(status).send(result);
    } catch (error) {
      serverLog.error("❌ QQMusicAPI Error:", error);
      return reply.status(502).send({
        error: (error as Error)?.message || "Internal Server Error",
      });
    }
  };

  fastify.get("/qqmusic/*", dynamicHandler);
  fastify.post("/qqmusic/*", dynamicHandler);

  serverLog.info("🌐 Register QQMusic Platform API successfully");
};
