/**
 * 星海换源链的桩件
 *
 * 假 axios 响应出口 IP、lx 后端取链、音频文件头与文件体积探测，全部本地应答。
 * 可控状态挂在 globalThis.__xinghaiState 上。
 */

const state = {
  /** 后端应答模式："ok" | "http500" | "biz404" | "fail320k" */
  mode: "ok",
  /** 请求次数 */
  calls: 0,
  /** 探测返回的文件体积（字节） */
  contentLength: 8000000,
  /** 探测返回的文件头（默认 MPEG1 Layer3 320k 44.1kHz） */
  audioBuffer: Buffer.from([0xff, 0xfb, 0xe0, 0x00]),
  /** 日志记录 */
  logs: [],
};

globalThis.__xinghaiState = state;

/** 构造 axios 形态的响应 */
const makeResponse = (status, data, headers = {}) => ({
  status,
  data,
  headers,
  statusText: "",
  config: {},
});

/** 假 axios */
const fakeAxios = {
  async get(url, options = {}) {
    const href = String(url);
    if (href.includes("/ip.php")) {
      return makeResponse(200, { ip: "156.238.224.81" });
    }
    if (href.includes("/lx/api/")) {
      state.calls += 1;
      if (state.mode === "http500") {
        return makeResponse(500, "");
      }
      if (state.mode === "biz404") {
        return makeResponse(200, { code: 404, msg: "无此音质档位" });
      }
      if (state.mode === "fail320k") {
        if (href.includes("quality=320k")) {
          return makeResponse(200, { code: 404, msg: "暂无320k" });
        }
        return makeResponse(200, {
          code: 200,
          url: "http://m10.music.126.net/fallback128k.mp3",
        });
      }
      return makeResponse(200, {
        code: 200,
        url: "http://m10.music.126.net/test320k.mp3",
      });
    }
    if (href.includes("126.net")) {
      return makeResponse(200, state.audioBuffer, {
        "content-length": String(state.audioBuffer.length),
        "content-range": `bytes 0-${state.audioBuffer.length - 1}/${state.contentLength}`,
      });
    }
    throw new Error(`未预期的 GET 请求: ${href}`);
  },
  async head(url) {
    const href = String(url);
    if (href.includes("126.net")) {
      return makeResponse(200, "", {
        "content-length": String(state.contentLength),
      });
    }
    throw new Error(`未预期的 HEAD 请求: ${href}`);
  },
  create() {
    return fakeAxios;
  },
  isAxiosError() {
    return false;
  },
};

/** 日志作用域 */
const createLogScope = (name) => ({
  debug: (...args) => state.logs.push({ level: "debug", name, args }),
  log: (...args) => state.logs.push({ level: "log", name, args }),
  info: (...args) => state.logs.push({ level: "info", name, args }),
  warn: (...args) => state.logs.push({ level: "warn", name, args }),
  error: (...args) => state.logs.push({ level: "error", name, args }),
});

export const serverLog = createLogScope("server");
export const coreLog = createLogScope("core");
export const processLog = createLogScope("process");

export default fakeAxios;
