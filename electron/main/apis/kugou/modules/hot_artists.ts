/**
 * 酷狗音乐热门歌手列表
 *
 * 走 `GET http://mobilecdn.kugou.com/api/v3/singer/list`（端点只能走 `http://`：
 * `mobilecdn.kugou.com` 的 https 证书不受信，握手会失败）：
 * - `data.enu_list.types[]`：分类清单（上游唯一真源，实测 9 项）
 * - `data.info[]`：歌手条目，带歌手号 `singerid`、歌手名 `singername`、
 *   粉丝数 `fanscount`、热度 `heat` 与头像模板（`imgurl`，尺寸写成 `{size}` 占位符）
 *
 * 分类口径：全部 key=0 / 华语 key=1 / 欧美 key=2 / 其他 key=4 / 日本 key=5 /
 * 韩国 key=6 / 粤语 key=7 / 闽南语 key=8；音乐人 key=0，与「全部」同键，
 * 靠 `musician=3` 区分（`musician=1` / `2` 是另两个音乐人维度，上游分类清单未暴露）。
 * 故对外分类标识取两种形态：`<key>` 与 `<key>:<musician>`，
 * 借后者唯一表达「音乐人」，其余分类直接用 key。
 *
 * 字段对照（上游 `data.info[]` → 对外条目）：
 *
 * | 对外字段        | 上游字段     | 说明                                    |
 * | --------------- | ------------ | --------------------------------------- |
 * | `id`            | `singerid`   | 酷狗歌手数字主键                        |
 * | `platformId`    | `singerid`   | 平台内字符串主键（可直接喂 artist 模块） |
 * | `name`          | `singername` | 歌手名（已反转义）                      |
 * | `cover`         | `imgurl`     | 头像模板，`{size}` → 300                |
 * | `coverOriginal` | `imgurl`     | 头像模板，`{size}` → 480                |
 * | `fansCount`     | `fanscount`  | 粉丝数                                  |
 * | `heat`          | `heat`       | 热度                                    |
 *
 * 分类字段对照（上游 `data.enu_list.types[]` → 对外 `types[]`）：
 *
 * | 对外字段 | 上游字段              | 说明                                    |
 * | -------- | --------------------- | --------------------------------------- |
 * | `id`     | `key`（+ `musician`） | 分类标识，音乐人维度非 0 时带 `:musician` |
 * | `name`   | `value`               | 分类名                                  |
 *
 * 上游 `albumcount` / `songcount` 恒为 0，不作对外字段，
 * 曲目数与专辑数由歌手详情模块给出。
 */

import { kgRequest } from "../core/request";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../../../logger";
import type { KGModule, KGParams } from "../core/types";

/** 歌手列表端点 */
const KG_SINGER_LIST_URL = "http://mobilecdn.kugou.com/api/v3/singer/list";

/** 默认分类（上游「全部」，key=0） */
const DEFAULT_TYPE_KEY = 0;

/** 默认页码 */
const DEFAULT_PAGE = 1;

/** 默认每页条数 */
const DEFAULT_LIMIT = 30;

/** 每页条数上限 */
const MAX_LIMIT = 100;

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 拼分类标识
 *
 * 音乐人维度非 0 时取 `<key>:<musician>`，其余分类取 `<key>`。
 * @param key - 上游分类键
 * @param musician - 音乐人维度
 * @returns 分类标识
 */
const formatTypeId = (key: number, musician: number): string =>
  musician ? `${key}:${musician}` : String(key);

/**
 * 解析分类标识
 *
 * 兼容纯数字形态（`<key>`）与带音乐人维度的形态（`<key>:<musician>`）。
 * @param raw - 分类标识
 * @returns 上游分类键与音乐人维度
 */
const parseTypeId = (raw: unknown): { key: number; musician: number } => {
  const text = String(raw ?? "").trim();
  if (!text) return { key: DEFAULT_TYPE_KEY, musician: 0 };

  const [keyPart, musicianPart] = text.split(":");
  const key = Number(keyPart);
  const musician = musicianPart === undefined ? Number.NaN : Number(musicianPart);
  return {
    key: Number.isFinite(key) ? key : DEFAULT_TYPE_KEY,
    musician: Number.isFinite(musician) ? musician : 0,
  };
};

/**
 * 归一化分类项
 * @param item - 上游分类项
 * @returns 归一化后的分类项
 */
const normalizeType = (item: RawEntry) => {
  const source = item || {};
  const key = Number(source.key ?? DEFAULT_TYPE_KEY);
  const musician = Number(source.musician ?? 0);
  return {
    id: formatTypeId(Number.isFinite(key) ? key : DEFAULT_TYPE_KEY, musician),
    name: decodeName(source.value ?? ""),
  };
};

/**
 * 归一化歌手条目
 *
 * 头像口径：模块层就把 `{size}` 换成实际尺寸（`cover` 用 300、`coverOriginal` 用 480），
 * 与本平台其他模块（搜索 / 专辑 / 歌单 / 榜单）保持一致，渲染端拿到即可直接用。
 * @param item - 上游歌手条目
 * @returns 归一化后的歌手条目
 */
const normalizeArtist = (item: RawEntry) => {
  const source = item || {};
  const singerId = String(source.singerid ?? "");
  return {
    id: Number(source.singerid ?? 0),
    platformId: singerId,
    name: decodeName(source.singername ?? ""),
    cover: fillCover(source.imgurl, 300) ?? "",
    coverOriginal: fillCover(source.imgurl, 480) ?? "",
    fansCount: Number(source.fanscount ?? 0),
    heat: Number(source.heat ?? 0),
  };
};

/**
 * 拼上游请求地址
 * @param key - 上游分类键
 * @param musician - 音乐人维度（0 表示不传）
 * @param page - 页码
 * @param limit - 每页条数
 * @returns 请求地址
 */
const buildSingerListUrl = (key: number, musician: number, page: number, limit: number): string => {
  const params = [
    `type=${encodeURIComponent(key)}`,
    `page=${encodeURIComponent(page)}`,
    `pagesize=${encodeURIComponent(limit)}`,
  ];
  if (musician) params.push(`musician=${encodeURIComponent(musician)}`);
  return `${KG_SINGER_LIST_URL}?${params.join("&")}`;
};

/**
 * 读取酷狗音乐热门歌手列表
 * @param params.type - 分类标识（`<key>` 或 `<key>:<musician>`），缺省取「全部」
 * @param params.page - 页码，从 1 开始
 * @param params.limit - 每页条数，默认 30，上限 100（`pagesize` 为等价别名）
 */
export const hot_artists: KGModule = async (params: KGParams) => {
  const page = Math.max(1, Number(params.page ?? DEFAULT_PAGE) || DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.limit ?? params.pagesize ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  const { key, musician } = parseTypeId(params.type);

  try {
    const body = await kgRequest<{
      data?: { info?: RawEntry[]; total?: number; enu_list?: { types?: RawEntry[] } };
    }>(buildSingerListUrl(key, musician, page, limit));

    const data = body?.data || {};
    const info = Array.isArray(data.info) ? data.info : [];
    const types = Array.isArray(data.enu_list?.types) ? data.enu_list.types : [];

    return {
      code: 200,
      total: Number(data.total ?? info.length),
      page,
      limit,
      types: types.map(normalizeType),
      artists: info.map(normalizeArtist),
    };
  } catch (err) {
    coreLog.error("[kg-hot-artists] 酷狗热门歌手列表获取异常:", err);
    return {
      code: 502,
      message: `酷狗热门歌手列表获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
