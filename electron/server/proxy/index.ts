import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { serverLog } from "../../main/logger";
import axios from "axios";

/**
 * 音频流代理接口
 * 用于 Web 端通过服务器转发音频流，解决 CORS 和证书问题
 * @param fastify Fastify 实例
 */
export const initProxyAPI = async (fastify: FastifyInstance) => {
  // 音频流代理
  fastify.get(
    "/proxy/audio",
    async (
      req: FastifyRequest<{ Querystring: { url: string } }>,
      reply: FastifyReply,
    ) => {
      const { url } = req.query;

      if (!url) {
        return reply.code(400).send({
          code: 400,
          message: "缺少 url 参数",
          url: null,
        });
      }

      try {
        // 验证 URL 格式
        let targetUrl: URL;
        try {
          targetUrl = new URL(url);
        } catch {
          return reply.code(400).send({
            code: 400,
            message: "无效的 URL 格式",
            url: null,
          });
        }

        // 只允许 HTTP/HTTPS 协议
        if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
          return reply.code(400).send({
            code: 400,
            message: "只支持 HTTP/HTTPS 协议",
            url: null,
          });
        }

        // 设置 CORS 头
        reply.header("Access-Control-Allow-Origin", "*");
        reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        reply.header("Access-Control-Allow-Headers", "Range");

        // 处理 Range 请求（支持断点续传）
        const range = req.headers.range;
        const requestHeaders: Record<string, string> = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: targetUrl.origin,
        };

        if (range) {
          requestHeaders.Range = range;
        }

        // 通过服务器转发音频流
        const response = await axios.get(url, {
          responseType: "stream",
          timeout: 30000,
          headers: requestHeaders,
          validateStatus: (status) => status >= 200 && status < 400, // 接受 206 Partial Content
        });

        // 设置响应头
        reply.code(response.status);
        reply.header("Content-Type", response.headers["content-type"] || "audio/mpeg");
        
        if (response.headers["content-length"]) {
          reply.header("Content-Length", response.headers["content-length"]);
        }
        
        if (response.headers["content-range"]) {
          reply.header("Content-Range", response.headers["content-range"]);
        }
        
        reply.header("Accept-Ranges", "bytes");

        // 转发音频流
        return reply.send(response.data);
      } catch (error) {
        serverLog.error("❌ 音频流代理失败:", error);
        return reply.code(500).send({
          code: 500,
          message: "音频流代理失败",
          url: null,
        });
      }
    },
  );

  serverLog.info("🌐 Register ProxyAPI successfully");
};
