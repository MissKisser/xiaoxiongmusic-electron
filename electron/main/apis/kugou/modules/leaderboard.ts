/**
 * 酷狗音乐排行榜
 *
 * 走 mobilecdn 公开读接口（端点只能走 `http://`：`mobilecdn.kugou.com` 的 https 证书不受信）：
 * - `GET /api/v3/rank/list`：榜单清单，一次下发全部榜单（实测 56 榜）
 * - `GET /api/v3/rank/song?rankid=<id>&page=<n>&pagesize=<n>`：单个榜单的曲目
 * - `GET /api/v3/rank/info?rankid=<id>`：单个榜单的元信息（榜单名、简介、封面）
 *
 * 清单条目带榜单号 `rankid`、榜单名 `rankname`、分组号 `classify`、期数 `issue`、
 * 更新频率 `update_frequency`、播放量 `play_times` 与封面模板
 * （`imgurl` 方图、`img_9` 9:16 竖图，尺寸写成 `{size}` 占位符）。
 *
 * 曲目条目带歌名、歌手（`authors` 数组）、`hash`、`album_audio_id`、`audio_id`、
 * `duration`（**单位是秒**）、`sort`（榜内排名）与 `privilege` / `pay_type`。
 *
 * 分组名由本地定义——上游 `theme.classify_list` 为空，不下发分组名：
 * - 1 巅峰榜：全站头部与热门维度榜（TOP500、网络热歌榜、飙升榜、新歌榜、百万收藏榜），
 *   另含短视频、DJ、粤语金曲、伤感等特色榜与昆明城市榜，实测 13 榜
 * - 2 地区榜：内地、欧美、韩国、日本、香港、台湾及 JOOX、KKBOX 合作榜，实测 8 榜
 * - 3 特色榜：年代（80/90/00 后）、会员、儿歌、闽南语、综艺、原创、识曲，实测 11 榜
 * - 4 全球榜：美国 Billboard、Beatport、英国单曲、韩国 Melon、日本公信等，实测 9 榜
 * - 5 曲风榜：国潮、民谣、电音、摇滚、R&B、说唱、古典、戏曲等，实测 15 榜
 *
 * 曲目主键是 `hash` 与 `album_audio_id` 的组合，签播放地址时两者都要，模块原样保留。
 */

import { kgRequest } from "../core/request";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../../../logger";
import type { KGModule, KGParams } from "../core/types";

/** 榜单清单端点 */
const KG_RANK_LIST_URL = "http://mobilecdn.kugou.com/api/v3/rank/list";

/** 榜单曲目端点 */
const KG_RANK_SONG_URL = "http://mobilecdn.kugou.com/api/v3/rank/song";

/** 榜单元信息端点 */
const KG_RANK_INFO_URL = "http://mobilecdn.kugou.com/api/v3/rank/info";

/** 默认榜单号（TOP500） */
const DEFAULT_RANKID = 8888;

/** 默认每页条数 */
const DEFAULT_LIMIT = 50;

/**
 * 榜单分组名
 *
 * 上游只给分组号 `classify`、不给分组名，命名依据见文件头说明。
 */
const GROUP_NAMES: Record<number, string> = {
  1: "巅峰榜",
  2: "地区榜",
  3: "特色榜",
  4: "全球榜",
  5: "曲风榜",
};

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 归一化榜单条目
 *
 * 封面口径：模块层就把 `{size}` 换成实际尺寸（`cover` 用 300、`coverOriginal` 用 480），
 * 与本平台其他模块（搜索 / 专辑 / 歌单）保持一致，渲染端拿到即可直接用。
 * @param board - 上游榜单条目
 * @returns 归一化后的榜单条目
 */
const normalizeBoard = (board: RawEntry) => {
  const source = board || {};
  const extra = (source.extra && source.extra.resp) || {};
  return {
    topId: Number(source.rankid ?? 0),
    rankId: Number(source.rankid ?? 0),
    rankCid: Number(source.rank_cid ?? 0),
    title: decodeName(source.rankname ?? ""),
    subTitle: "",
    intro: decodeName(source.intro ?? ""),
    period: String(source.issue ?? ""),
    updateTime: source.rank_id_publish_date ?? "",
    updateFrequency: source.update_frequency ?? "",
    cover: fillCover(source.imgurl, 300) ?? "",
    coverOriginal: fillCover(source.imgurl, 480) ?? "",
    poster: fillCover(source.img_9, 480) ?? "",
    listenCount: Number(source.play_times ?? 0),
    total: Number(extra.all_total ?? 0),
    isvol: Number(source.isvol ?? 0),
    classify: Number(source.classify ?? 0),
  };
};

/**
 * 归一化榜单曲目
 *
 * 时长口径：上游 `duration` 是秒，对外 `duration` 换算成毫秒、`interval` 保留秒。
 * 付费判据取基档授权位 `privilege`（`0` / `8` 可免费播，其余为会员墙）。
 * 试听判据取 `trans_param.hash_offset.end_ms`：有值即存在试听片段。
 * @param raw - 上游曲目条目
 * @returns 归一化后的曲目
 */
const normalizeSong = (raw: RawEntry) => {
  const source = raw || {};
  const trans = source.trans_param || {};
  const authors = Array.isArray(source.authors) ? source.authors : [];

  const artistName = authors.length
    ? decodeName(
        authors
          .map((author: RawEntry) => author && author.author_name)
          .filter(Boolean)
          .join(" / "),
      )
    : "";
  const artists = authors.map((author: RawEntry) => ({
    id: author && author.author_id !== undefined ? String(author.author_id) : "",
    name: decodeName((author && author.author_name) || ""),
  }));

  const filename = String(source.filename || "");
  const name = decodeName(
    source.songname || (filename ? filename.split(" - ").slice(1).join(" - ") : ""),
  );

  const coverTemplate = trans.union_cover || source.album_sizable_cover || "";
  const interval = Number(source.duration || 0);

  const hashes: Record<string, string> = {};
  const sizes: Record<string, number> = {};
  const put = (quality: string, hash: unknown, size: unknown) => {
    if (!hash || !size) return;
    hashes[quality] = String(hash);
    sizes[quality] = Number(size);
  };
  put("128k", source.hash, source.filesize);
  put("320k", source["320hash"], source["320filesize"]);
  put("flac", source.sqhash, source.sqfilesize);
  put("flac24bit", source.hash_high, source.filesize_high);

  const hashOffset = trans.hash_offset || null;
  const trialDuration = Number((hashOffset && hashOffset.end_ms) || 0);

  return {
    id: String(source.audio_id || source.hash || ""),
    mid: "",
    audioId: Number(source.audio_id || 0),
    albumAudioId: Number(source.album_audio_id || 0),
    /** 歌曲主键（album_audio_id 口径），签播放地址用它 */
    mixSongId: String(source.album_audio_id || ""),
    hash: String(source.hash || ""),
    name,
    artist: artistName,
    artists,
    album: "",
    albumMid: "",
    albumId: String(source.album_id || ""),
    cover: fillCover(coverTemplate, 300) ?? "",
    coverOriginal: fillCover(coverTemplate, 480) ?? "",
    duration: interval * 1000,
    interval,
    rank: Number(source.sort || 0),
    qualities: Object.keys(hashes),
    hashes,
    sizes,
    pay: {
      payplay: Number(source.pay_type || 0),
      privilege: Number(source.privilege || 0),
      feetype: Number(source.feetype || 0),
      pkgPrice: Number(source.pkg_price || 0),
      price: Number(source.price || 0),
    },
    trial: {
      available: trialDuration > 0,
      duration: trialDuration,
    },
    file: {},
  };
};

/**
 * 读取榜单元信息（榜单名、简介、封面）
 *
 * 元信息端点不可用时不影响曲目返回，由调用方拿到空元信息。
 * @param rankid - 榜单号
 * @returns 榜单元信息，取不到时返回 null
 */
const fetchBoardMeta = async (rankid: number): Promise<Record<string, any> | null> => {
  try {
    const body = await kgRequest<{ data?: RawEntry }>(
      `${KG_RANK_INFO_URL}?rankid=${encodeURIComponent(rankid)}&format=json`,
    );
    const data = body?.data;
    if (!data || typeof data !== "object") return null;
    return {
      title: decodeName(data.rankname || ""),
      intro: decodeName(data.intro || ""),
      cover: fillCover(data.imgurl, 300) ?? "",
      coverOriginal: fillCover(data.imgurl, 480) ?? "",
    };
  } catch (err) {
    coreLog.warn("[kg-leaderboard] 酷狗榜单元信息获取失败:", err);
    return null;
  }
};

/**
 * 读取酷狗音乐榜单清单
 * @param params.groupId - 分组号（classify），不传则返回全部分组
 */
export const leaderboard_list: KGModule = async (params: KGParams) => {
  const groupId = Number(params.groupId ?? params.group_id ?? 0);

  try {
    const body = await kgRequest<{ data?: { info?: RawEntry[] } }>(KG_RANK_LIST_URL);
    const boards = body?.data?.info || [];
    if (!Array.isArray(boards)) {
      return { code: 502, message: "酷狗榜单清单获取失败：上游响应缺少榜单列表" };
    }

    const normalized = boards.map(normalizeBoard);

    const groups = Object.keys(GROUP_NAMES)
      .map(Number)
      .sort((left, right) => left - right)
      .filter((id) => !groupId || id === groupId)
      .map((id) => ({
        groupId: id,
        groupName: GROUP_NAMES[id],
        type: id,
        toplists: normalized.filter((board) => board.classify === id),
      }))
      .filter((group) => group.toplists.length > 0);

    const toplists = groups.flatMap((group) =>
      group.toplists.map((board) => ({
        ...board,
        groupId: group.groupId,
        groupName: group.groupName,
      })),
    );

    return {
      code: 200,
      total: toplists.length,
      groups,
      toplists,
    };
  } catch (err) {
    coreLog.error("[kg-leaderboard-list] 酷狗榜单清单获取异常:", err);
    return {
      code: 502,
      message: `酷狗榜单清单获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};

/**
 * 读取单个酷狗音乐榜单的详情（榜单元信息 + 曲目列表）
 * @param params.rankid - 榜单号，默认 8888（TOP500）
 * @param params.page - 页码，从 1 开始
 * @param params.limit - 每页条数，默认 50
 */
export const leaderboard_detail: KGModule = async (params: KGParams) => {
  const rankid = Number(
    params.rankid ?? params.rank_id ?? params.id ?? params.topid ?? DEFAULT_RANKID,
  );
  if (!rankid) return { code: 400, message: "rankid 不能为空" };

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const limit = Math.max(1, Number(params.limit ?? params.pagesize ?? DEFAULT_LIMIT) || DEFAULT_LIMIT);

  try {
    const body = await kgRequest<{ data?: { info?: RawEntry[]; total?: number } }>(
      `${KG_RANK_SONG_URL}?rankid=${rankid}&page=${page}&pagesize=${limit}`,
    );
    const info = body?.data?.info || [];
    if (!Array.isArray(info)) {
      return { code: 502, message: "酷狗榜单详情获取失败：上游响应缺少曲目列表" };
    }

    const songs = info.map(normalizeSong);
    const meta = await fetchBoardMeta(rankid);
    const first = info[0] || {};

    const ranks = songs.map((song) => ({
      rank: song.rank,
      songId: song.mixSongId,
      title: song.name,
      singer: song.artist,
      singerMid: "",
      albumMid: "",
      cover: song.cover,
    }));

    return {
      code: 200,
      topid: rankid,
      rankid,
      title: (meta && meta.title) || "",
      subTitle: "",
      intro: (meta && meta.intro) || "",
      cover: (meta && meta.cover) || "",
      coverOriginal: (meta && meta.coverOriginal) || "",
      period: first.issue === undefined ? "" : String(first.issue),
      updateTime: first.rank_id_publish_date || "",
      listenCount: 0,
      total: Number(body?.data?.total || songs.length),
      page,
      limit,
      songs,
      ranks,
    };
  } catch (err) {
    coreLog.error("[kg-leaderboard-detail] 酷狗榜单详情获取异常:", err);
    return {
      code: 502,
      message: `酷狗榜单详情获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
