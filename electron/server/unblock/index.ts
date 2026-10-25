import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { serverLog } from "../../main/logger";
import getKuwoSongUrl from "./kuwo";
import getBodianSongUrl from "./bodian";
import getMiguSongUrl from "./migu";
import getChangqingSongUrl, { type ChangqingOptions } from "./changqing";
import getNeteaseSongUrl from "./netease";
import { getNeteaseSearchSongUrl } from "./netease-search";
import getLxmusicSongUrl, { type LxmusicOptions } from "./lxmusic";
import { buildTarget, parseDurationParam, parseKeyword, type MatchTarget } from "./match";

/**
 * 构造匹配信息
 *
 * 站外源按「歌名 + 歌手 + 时长」寻址：请求显式带 `songName` / `artist` 时优先取显式值，
 * 否则按关键词拆分（按最后一个「-」切分并 trim，尾随空格不再导致恒 404）；
 * `duration` 为可选的歌曲声明时长（秒），参与三重校验，不传则跳过时长校验。
 *
 * 歌手只认显式传入的 `artist`：调用方给了 `songName` 却没给 `artist` 时，
 * 绝不从关键词里凭空合成歌手 —— 歌名自身带「-」时（如「夜曲-周杰伦」），
 * 关键词按最后一个「-」拆出的后半段并不是调用方声明的歌手，
 * 据此放行会匹配到同名不同版本的曲目，宁可不换源也不播错版本。
 * 只有当关键词整体就是「歌名-歌手」形式（拆出的歌名与 `songName` 完全一致）时，
 * 才沿用关键词里的歌手；否则歌手留空，由后续校验按「缺歌手」处理。
 * @param query 请求查询参数
 * @returns 目标歌曲信息
 */
const buildMatchInfo = (query: { [key: string]: string }): MatchTarget => {
  const keyword = (query.keyword || "").trim();
  const duration = parseDurationParam(query.duration);
  const songName = (query.songName || "").trim();
  const artist = (query.artist || "").trim();
  // 歌名与歌手都没给：按关键词整体拆分
  if (!songName && !artist) return buildTarget(keyword, duration);
  const parsed = parseKeyword(keyword);
  // 歌手显式给了：直接采用
  if (artist) return { title: songName || parsed.title, artist, duration };
  // 只给了歌名：仅当关键词拆出的歌名与 songName 完全一致时，才认为关键词是「歌名-歌手」形式；
  // 歌名自身含「-」时拆出来的那段并不是调用方声明的歌手，按缺歌手处理
  const keywordArtist = parsed.title === songName ? parsed.artist : "";
  return { title: songName, artist: keywordArtist, duration };
};

// 初始化 UnblockAPI
export const initUnblockAPI = async (fastify: FastifyInstance) => {
  // 主信息
  fastify.get("/unblock", (_, reply) => {
    reply.send({
      name: "UnblockAPI",
      description: "小熊音乐 UnblockAPI service",
      author: "@xiaoxiongmusic",
      content:
        "部分接口采用 @939163156 by GD音乐台(music.gdstudio.xyz)，仅供本人学习使用，不可传播下载内容，不可用于商业用途。",
    });
  });
  // netease
  // 两种寻址方式：
  // - 带 id：网易云自身的歌曲，按 id 直取直链；
  // - 带 keyword / songName：第三方平台（QQ 音乐 / 酷狗）的歌曲，
  //   按「歌名 + 歌手 + 时长」检索网易云曲库再取直链 —— 两套 id 编号空间不同，
  //   第三方 id 绝不能按 id 直查（会静默播错歌）。
  fastify.get(
    "/unblock/netease",
    async (
      req: FastifyRequest<{ Querystring: { [key: string]: string } }>,
      reply: FastifyReply,
    ) => {
      const { id, keyword, songName, artist } = req.query;
      const useSearch = !!(keyword || songName || artist);
      if (useSearch) {
        const result = await getNeteaseSearchSongUrl(
          buildMatchInfo(req.query),
          req.cookies as Record<string, string> | undefined,
        );
        return reply.send(result);
      }
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
  // migu
  // 咪咕是第一方官方曲库：免登录检索与取链，非免费曲干净拒绝，不给试听。
  fastify.get(
    "/unblock/migu",
    async (
      req: FastifyRequest<{ Querystring: { [key: string]: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await getMiguSongUrl(buildMatchInfo(req.query));
      return reply.send(result);
    },
  );
  // changqing
  // 长青是社区公益聚合站：通道按平台内歌曲 id 取链，
  // 歌曲自带平台原生 id 时直接用，否则按关键词走项目自身检索网关换 id。
  fastify.get(
    "/unblock/changqing",
    async (
      req: FastifyRequest<{ Querystring: { [key: string]: string } }>,
      reply: FastifyReply,
    ) => {
      const options: ChangqingOptions = {
        platform: req.query.platform,
        platformId: req.query.platformId,
      };
      const result = await getChangqingSongUrl(buildMatchInfo(req.query), options);
      return reply.send(result);
    },
  );
  // lxmusic
  // 落雪音乐自定义源协议：QQ 歌曲自带 mid 时按 mid 零检索直查，
  // 否则按「歌名 + 歌手」检索换 mid，取链后做身份 / 时长 / 体积三重校验。
  fastify.get(
    "/unblock/lxmusic",
    async (
      req: FastifyRequest<{ Querystring: { [key: string]: string } }>,
      reply: FastifyReply,
    ) => {
      const options: LxmusicOptions = {
        platform: req.query.platform,
        platformId: req.query.platformId,
      };
      const result = await getLxmusicSongUrl(buildMatchInfo(req.query), options);
      return reply.send(result);
    },
  );

  serverLog.info("🌐 Register UnblockAPI successfully");
};
