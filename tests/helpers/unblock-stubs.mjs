/**
 * 站外换源链（酷我 / 波点）的桩件
 *
 * 同一份模块兼三重角色：
 * - 默认导出：假 axios（酷我检索 / 酷我取链 / 波点取链 / 直链体积探测全部本地应答）
 * - serverLog：日志桩件，记录调用供断言
 *
 * 可控状态挂在 globalThis.__unblockState 上，供测试读写。
 */

const state = {
  /** 酷我检索返回的原始条目 */
  searchList: [],
  /** 酷我取链应答形态："placeholder" | "normal" | "noUrl" */
  kuwoMode: "placeholder",
  /** 波点取链业务码 */
  bodianCode: 20018,
  /** 直链体积（字节） */
  contentLength: 4318872,
  /** 波点取链被请求的次数 */
  bodianCalls: 0,
  /** 日志记录 */
  logs: [],
};

globalThis.__unblockState = state;

/** 构造 axios 形态的响应 */
const makeResponse = (status, data, headers = {}) => ({
  status,
  data,
  headers,
  statusText: "",
  config: {},
});

/** 酷我检索应答 */
const searchResponse = () => ({
  content: [
    null,
    {
      abslist: state.searchList.map((item) => ({
        MUSICRID: `MUSIC_${item.rid}`,
        SONGNAME: item.title,
        ARTIST: item.artist,
        DURATION: item.duration,
      })),
    },
  ],
});

/** 酷我取链应答（纯文本键值对） */
const kuwoResponse = () => {
  if (state.kuwoMode === "noUrl") return "format=mp3\r\nbitrate=128\r\ntype=0\r\n";
  if (state.kuwoMode === "normal") {
    return (
      "format=mp3\r\nbitrate=128\r\n" +
      "url=http://kw-bj.kuwo.cn/ny/resource/n3/74/31/1074588829.mp3\r\n" +
      "sig=4615323880699299558\r\nrid=228908\r\ntype=0\r\n"
    );
  }
  // 受限曲目：上游回固定的「登录后畅听」占位资源
  return (
    "format=mp3\r\nbitrate=1\r\n" +
    "url=http://kw-er.kuwo.cn/x/resource/30106/trackmedia/M5000004Gmy54cGDqK.mp3\r\n" +
    "sig=16640715010319386463\r\nrid=260839262\r\ntype=1\r\n"
  );
};

/** 假 axios */
const fakeAxios = {
  async get(url) {
    const href = String(url);
    if (href.includes("search.kuwo.cn/r.s")) return makeResponse(200, searchResponse());
    if (href.includes("mobi.kuwo.cn/mobi.s")) return makeResponse(200, kuwoResponse());
    if (href.includes("bd-api.kuwo.cn/api/play/music/v2/audioUrl")) {
      state.bodianCalls += 1;
      if (state.bodianCode === 200) {
        return makeResponse(200, {
          code: 200,
          msg: "success",
          data: { audioUrl: "http://bd-bj.kuwo.cn/ny/resource/n3/54/50/2780682814.mp3" },
        });
      }
      return makeResponse(200, { code: state.bodianCode, msg: "没有解锁付费歌曲" });
    }
    throw new Error(`未预期的 GET：${href}`);
  },
  async post(url) {
    const href = String(url);
    if (href.includes("bd-api.kuwo.cn/api/service/advert/watch")) return makeResponse(200, {});
    throw new Error(`未预期的 POST：${href}`);
  },
  async head(url) {
    const href = String(url);
    if (!/^https?:\/\//.test(href)) throw new Error(`未预期的 HEAD：${href}`);
    return makeResponse(200, "", { "content-length": String(state.contentLength) });
  },
  create() {
    return fakeAxios;
  },
  isAxiosError() {
    return false;
  },
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
