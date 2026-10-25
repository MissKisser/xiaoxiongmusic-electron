/**
 * 落雪换源链的桩件
 *
 * 同一份模块兼三重角色：
 * - 默认导出：假 axios（lx 后端、QQ 检索、曲目详情全部本地应答，测试不依赖网络）
 * - serverLog：日志桩件，记录调用供断言
 * - callQQMusic：QQ 网关桩件，按真实模块的归一化口径返回结果
 *
 * 可控状态挂在 globalThis.__lxState 上，供测试读写。
 */

const state = {
  /** lx 后端的应答口径 */
  lxMode: "http500",
  /** lx 后端被请求的次数 */
  lxCalls: 0,
  /** QQ 检索返回的原始歌曲条目 */
  searchSongs: [],
  /** QQ 曲目详情返回的原始条目 */
  songDetail: null,
  /** 日志记录 */
  logs: [],
};

globalThis.__lxState = state;

/** 构造 axios 形态的响应 */
const makeResponse = (status, data) => ({
  status,
  data,
  headers: {},
  statusText: "",
  config: {},
});

/** lx 后端的应答 */
const lxResponse = () => {
  state.lxCalls += 1;
  switch (state.lxMode) {
    case "http500":
      return makeResponse(500, "");
    case "biz4601":
      return makeResponse(200, { code: 4601, msg: "QQ音乐 暂时无法获取，请稍后重试" });
    case "biz404":
      return makeResponse(200, { code: 404, msg: "无此音质档位" });
    default:
      return makeResponse(200, { code: 200, url: "" });
  }
};

/** 假 axios */
const fakeAxios = {
  async get(url) {
    const href = String(url);
    if (href.includes("/ip.php")) return makeResponse(200, { ip: "203.0.113.7" });
    if (href.includes("/lx/api/")) return lxResponse();
    throw new Error(`未预期的 GET：${href}`);
  },
  async post(url, body) {
    const href = String(url);
    if (!href.includes("musicu.fcg")) throw new Error(`未预期的 POST：${href}`);
    const request = body?.request ?? {};
    if (request.module === "music.pf_song_detail_svr") {
      return makeResponse(200, {
        code: 0,
        request: { code: 0, data: { track_info: state.songDetail } },
      });
    }
    if (request.module === "music.search.SearchCgiService") {
      return makeResponse(200, {
        code: 0,
        request: {
          code: 0,
          data: { body: { item_song: state.searchSongs }, meta: { sum: state.searchSongs.length } },
        },
      });
    }
    throw new Error(`未预期的 module：${request.module}`);
  },
  async head(url) {
    throw new Error(`未预期的 HEAD：${String(url)}`);
  },
  create() {
    return fakeAxios;
  },
  isAxiosError() {
    return false;
  },
};

/** 去掉搜索结果里的高亮标签 */
const stripHighlight = (text) => (typeof text === "string" ? text.replace(/<\/?em>/g, "") : "");

/** 拼接歌手名 */
const formatSingerName = (singers) =>
  Array.isArray(singers)
    ? singers
        .map((item) => stripHighlight(item?.name ?? "").trim())
        .filter(Boolean)
        .join(" / ")
    : "";

/** 归一化搜索结果 */
const normalizeSong = (song) => ({
  mid: song?.mid ?? "",
  name: stripHighlight(song?.title ?? song?.name ?? ""),
  artist: formatSingerName(song?.singer),
  duration: Number(song?.interval ?? 0) * 1000,
  mediaMid: song?.file?.media_mid ?? "",
});

/** 归一化曲目详情 */
const normalizeTrack = (track) => ({
  mid: track?.mid ?? "",
  name: stripHighlight(track?.title ?? track?.name ?? ""),
  artist: formatSingerName(track?.singer),
  duration: Number(track?.interval ?? 0) * 1000,
  mediaMid: track?.file?.media_mid ?? "",
});

/** QQ 音乐网关桩件 */
export const callQQMusic = async (name, params = {}) => {
  if (name === "search") {
    return {
      code: 200,
      songs: state.searchSongs.map(normalizeSong),
      total: state.searchSongs.length,
    };
  }
  if (name === "song_info") {
    const mid = String(params.mid ?? "").trim();
    if (!mid || !state.songDetail) return { code: 404, message: "song not found" };
    return { code: 200, song: normalizeTrack(state.songDetail) };
  }
  throw new Error(`未知的 qm api：${name}`);
};

/** 日志作用域：记录调用供断言 */
const createLogScope = (name) => ({
  debug: (...args) => state.logs.push({ level: "debug", name, args }),
  log: (...args) => state.logs.push({ level: "log", name, args }),
  info: (...args) => state.logs.push({ level: "info", name, args }),
  warn: (...args) => state.logs.push({ level: "warn", name, args }),
  error: (...args) => state.logs.push({ level: "error", name, args }),
});

/** 日志桩件 */
export const serverLog = createLogScope("server");
export const coreLog = createLogScope("core");
export const processLog = createLogScope("process");

export default fakeAxios;
