/**
 * 小鱼与吉祥换源链的桩件
 *
 * 假 axios 模拟小鱼（tang.api.s01s.cn）与吉祥（musicserver.haitangw.cc）网关响应、
 * 音频文件头与文件体积探测，全部本地应答。
 * 可控状态挂在 globalThis.__fishJiexiangState 上。
 */

const state = {
  // fish 相关
  fishMode: "ok",
  fishCalls: 0,
  fishResponse: null,
  fishContentLength: 8000000,
  fishAudioBuffer: Buffer.from([0xff, 0xfb, 0xe0, 0x00]), // MPEG1 Layer3 320k 44.1kHz

  // jiexiang 相关
  jiexiangMode: "ok",
  jiexiangCalls: 0,
  jiexiangContentLength: 8000000,
  jiexiangAudioBuffer: Buffer.from([0xff, 0xfb, 0xe0, 0x00]), // MPEG1 Layer3 320k 44.1kHz

  // 日志记录
  logs: [],
};

globalThis.__fishJiexiangState = state;

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
    if (href.includes("tang.api.s01s.cn")) {
      state.fishCalls += 1;
      if (state.fishMode === "http500") {
        return makeResponse(500, "");
      }
      if (state.fishMode === "empty") {
        return makeResponse(200, { song_mid: null });
      }
      if (state.fishMode === "mismatch_mid") {
        return makeResponse(200, {
          song_mid: "other_mid",
          song_play_time: 200,
          song_size_hq_str: 8000000,
          kbps_hq: 320,
          song_play_url_hq: "http://isure6.stream.qqmusic.qq.com/C600003Qui1q2u1Zho.m4a",
        });
      }
      if (state.fishMode === "wrong_duration") {
        return makeResponse(200, {
          song_mid: "0039MnYb0qxYhV",
          song_play_time: 100, // 偏离 200s
          song_size_hq_str: 8000000,
          kbps_hq: 320,
          song_play_url_hq: "http://isure6.stream.qqmusic.qq.com/C600003Qui1q2u1Zho.m4a",
        });
      }
      if (state.fishMode === "fail_hq") {
        return makeResponse(200, {
          song_mid: "0039MnYb0qxYhV",
          song_play_time: 200,
          song_size_hq_str: null,
          song_play_url_hq: null,
          song_size_standard_str: 8000000,
          kbps_standard: 320,
          song_play_url_standard: "http://isure6.stream.qqmusic.qq.com/C400003Qui1q2u1Zho.m4a",
        });
      }
      if (state.fishResponse) {
        return makeResponse(200, state.fishResponse);
      }
      return makeResponse(200, {
        song_name: "夜曲",
        singer_name: "周杰伦",
        song_mid: "0039MnYb0qxYhV",
        song_play_time: 200,
        song_size_hq_str: 8000000,
        kbps_hq: 320,
        song_play_url_hq: "http://isure6.stream.qqmusic.qq.com/C600003Qui1q2u1Zho.m4a?vkey=123",
        song_size_standard_str: 8000000,
        kbps_standard: 320,
        song_play_url_standard: "http://isure6.stream.qqmusic.qq.com/C400003Qui1q2u1Zho.m4a?vkey=123",
      });
    }

    if (href.includes("qqmusic.qq.com")) {
      return makeResponse(200, state.fishAudioBuffer, {
        "content-length": String(state.fishAudioBuffer.length),
        "content-range": `bytes 0-${state.fishAudioBuffer.length - 1}/${state.fishContentLength}`,
      });
    }

    if (href.includes("bdycdn.cn") || href.includes("kugou.com")) {
      return makeResponse(200, state.jiexiangAudioBuffer, {
        "content-length": String(state.jiexiangAudioBuffer.length),
        "content-range": `bytes 0-${state.jiexiangAudioBuffer.length - 1}/${state.jiexiangContentLength}`,
      });
    }

    throw new Error(`未预期的 GET 请求: ${href}`);
  },

  async post(url, body, options = {}) {
    const href = String(url);
    if (href.includes("musicserver.haitangw.cc")) {
      state.jiexiangCalls += 1;
      if (state.jiexiangMode === "http500") {
        return makeResponse(500, "");
      }
      if (state.jiexiangMode === "no_resource") {
        return makeResponse(503, {
          code: "UPSTREAM_NO_RESOURCE",
          message: "播放地址解析失败",
        });
      }
      if (state.jiexiangMode === "wrong_token") {
        // 返回不含 qu320 的 URL
        return makeResponse(200, {
          code: 0,
          message: "ok",
          data: { url: "http://v3-32-yp-qqmusic.a.bdycdn.cn/full/qu999_s123.mp3" },
        });
      }
      if (state.jiexiangMode === "fail_exhigh") {
        if (body?.level === "exhigh") {
          return makeResponse(200, {
            code: 1,
            message: "无高音质",
            data: null,
          });
        }
        return makeResponse(200, {
          code: 0,
          message: "ok",
          data: { url: "http://v3-32-yp-qqmusic.a.bdycdn.cn/full/qu128_s123.mp3" },
        });
      }
      const token = body?.level === "standard" ? "qu128" : "qu320";
      return makeResponse(200, {
        code: 0,
        message: "ok",
        data: {
          url: `http://v3-32-yp-qqmusic.a.bdycdn.cn/full/${token}_s123.mp3`,
        },
      });
    }

    throw new Error(`未预期的 POST 请求: ${href}`);
  },

  async head(url) {
    const href = String(url);
    if (href.includes("qqmusic.qq.com")) {
      return makeResponse(200, "", {
        "content-length": String(state.fishContentLength),
      });
    }
    if (href.includes("bdycdn.cn") || href.includes("kugou.com")) {
      return makeResponse(200, "", {
        "content-length": String(state.jiexiangContentLength),
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

export const callQQMusic = async (name, params = {}) => {
  if (name === "search") {
    return {
      code: 200,
      songs: [
        {
          id: "12345",
          mid: "0039MnYb0qxYhV",
          name: "夜曲",
          artist: "周杰伦",
          duration: 200000,
        },
      ],
      total: 1,
    };
  }
  throw new Error(`未知的 qm api：${name}`);
};

export default fakeAxios;
