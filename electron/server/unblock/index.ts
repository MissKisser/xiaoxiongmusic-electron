import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import axios from "axios";
import getKuwoSongUrl from "./kuwo";
import getBodianSongUrl from "./bodian";
import getGequbaoSongUrl from "./gequbao";
import { buildTarget, parseDurationParam, parseKeyword, type MatchTarget } from "./match";

/**
 * 直接获取 网易云云盘 链接
 * Thank @939163156
 * Power by GD音乐台(music.gdstudio.xyz)
 * @param id 歌曲 ID
 * @returns 歌曲直链结果
 */
const getNeteaseSongUrl = async (id: number | string): Promise<SongUrlResult> => {
  try {
    if (!id) return { code: 404, url: null };
    const baseUrl = "https://music-api.gdstudio.xyz/api.php";
    const result = await axios.get(baseUrl, {
      params: { types: "url", id },
    });
    const songUrl = result.data.url;
    // 安全修复：解锁结果缺失时返回 404，避免返回 200 + 空 url 误导客户端
    if (!songUrl) {
      return { code: 404, url: null };
    }
    serverLog.log("🔗 NeteaseSongUrl URL:", songUrl);
    return { code: 200, url: songUrl };
  } catch (error) {
    serverLog.error("❌ Get NeteaseSongUrl Error:", error);
    return { code: 404, url: null };
  }
};

/**
 * 构造匹配信息
 *
 * 站外源按「歌名 + 歌手 + 时长」寻址：请求显式带 `songName` / `artist` 时优先取显式值，
 * 否则按关键词拆分（按最后一个「-」切分并 trim，尾随空格不再导致恒 404）；
 * `duration` 为可选的歌曲声明时长（秒），参与三重校验，不传则跳过时长校验。
 * @param query 请求查询参数
 * @returns 目标歌曲信息
 */
const buildMatchInfo = (query: { [key: string]: string }): MatchTarget => {
  const keyword = (query.keyword || "").trim();
  const duration = parseDurationParam(query.duration);
  const songName = (query.songName || "").trim();
  const artist = (query.artist || "").trim();
  if (!songName && !artist) return buildTarget(keyword, duration);
  const parsed = parseKeyword(keyword);
  return {
    title: songName || parsed.title,
    artist: artist || parsed.artist,
    duration,
  };
};

// 初始化 UnblockAPI
export const initUnblockAPI = async (fastify: FastifyInstance) => {
  // 主信息
  fastify.get("/unblock", (_, reply) => {
    reply.send({
      name: "UnblockAPI",
      description: "SPlayer UnblockAPI service",
      author: "@imsyy",
      content:
        "部分接口采用 @939163156 by GD音乐台(music.gdstudio.xyz)，仅供本人学习使用，不可传播下载内容，不可用于商业用途。",
    });
  });
  // netease
  fastify.get(
    "/unblock/netease",
    async (
      req: FastifyRequest<{ Querystring: { [key: string]: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = req.query;
      const result = await getNeteaseSongUrl(id);
      return reply.send(result);
    },
  );
  // kuwo
  fastify.get(
    "/unblock/kuwo",
    async (
      req: FastifyRequest<{ Querystring: { [key: string]: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await getKuwoSongUrl(buildMatchInfo(req.query));
      return reply.send(result);
    },
  );
  // bodian
  fastify.get(
    "/unblock/bodian",
    async (
      req: FastifyRequest<{ Querystring: { [key: string]: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await getBodianSongUrl(buildMatchInfo(req.query));
      return reply.send(result);
    },
  );
  // gequbao
  fastify.get(
    "/unblock/gequbao",
    async (
      req: FastifyRequest<{ Querystring: { [key: string]: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await getGequbaoSongUrl(buildMatchInfo(req.query));
      return reply.send(result);
    },
  );

  serverLog.info("🌐 Register UnblockAPI successfully");
};
