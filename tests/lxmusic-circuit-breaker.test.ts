/**
 * 落雪换源链的熔断与失败日志
 *
 * 覆盖四块判据：
 * - 熔断触发：上游连续故障到阈值即熔断，熔断期内零请求直接跳过
 * - 熔断豁免：无候选 / 匹配失败 / 4xx 语义业务码属请求侧结论，不计入熔断
 * - 失败日志节流：同源同曲在 10 秒窗口内只写一条
 * - 日志文案：失败日志带歌名 / 歌手与 match.ts 的原因常量
 *
 * 全程本地应答：不依赖网络，也不起 Electron 实例。
 * 熔断器是模块级状态，每个用例都另取一份模块实例，用例之间互不影响。
 */

import { register } from "node:module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FETCH_FAILED_REASON,
  MATCH_FAILED_REASON,
  NO_CANDIDATE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
} from "../electron/server/unblock/match";

register(new URL("./helpers/lxmusic-hooks.mjs", import.meta.url));

type LxState = {
  lxMode: string;
  lxCalls: number;
  searchSongs: unknown[];
  songDetail: unknown;
  logs: { level: string; name: string; args: unknown[] }[];
};

type UnlockResult = { code: number; url: string | null; reason?: string };
type UnlockFn = (target: unknown, options?: unknown) => Promise<UnlockResult>;

/** 桩件状态：桩件模块被加载时才创建 */
const getState = (): LxState => (globalThis as unknown as { __lxState: LxState }).__lxState;

/** 模块实例计数：用于取一份新的模块实例（熔断器是模块级状态） */
let instanceSeq = 0;

/**
 * 取一份新的换源模块实例
 * @returns 换源函数
 */
const loadUnlock = async (): Promise<UnlockFn> => {
  instanceSeq += 1;
  const mod = await import(`../electron/server/unblock/lxmusic?instance=${instanceSeq}`);
  return mod.default as UnlockFn;
};

/** 取日志里匹配指定文案的条数 */
const countLogs = (needle: string): number =>
  getState().logs.filter((entry) => entry.args.some((arg) => String(arg).includes(needle))).length;

/** 清空日志与计数 */
const resetLogs = (): void => {
  getState().logs.length = 0;
  getState().lxCalls = 0;
};

/** 曲目详情桩件 */
const songDetail = {
  mid: "002MXZNu1GToOk",
  title: "不能说的秘密",
  singer: [{ name: "周杰伦" }],
  interval: 296,
  file: { media_mid: "000cZNr42YkLl1" },
};

/** 直查入参 */
const directOptions = { platform: "qqmusic", platformId: "002MXZNu1GToOk" };

describe("落雪换源链熔断", () => {
  it("上游连续故障到阈值即熔断，熔断期内零请求跳过", async () => {
    const unlock = await loadUnlock();
    resetLogs();
    getState().lxMode = "http500";
    getState().songDetail = songDetail;
    const target = { title: "熔断用例", artist: "测试歌手", duration: 296 };

    for (let i = 0; i < 3; i += 1) {
      const result = await unlock(target, directOptions);
      assert.equal(result.code, 404, "上游故障时换源失败");
      assert.equal(result.reason, FETCH_FAILED_REASON, "失败原因是取链失败");
    }
    const callsBeforeTrip = getState().lxCalls;
    assert.ok(callsBeforeTrip > 0, "熔断前确有上游请求");

    const tripped = await unlock(target, directOptions);
    assert.equal(tripped.reason, UPSTREAM_UNAVAILABLE_REASON, "熔断期内直接跳过");
    assert.equal(getState().lxCalls, callsBeforeTrip, "熔断期内零上游请求");
    assert.ok(countLogs("落雪音源 连续 3 次失败") >= 1, "熔断状态变化应写日志");
    assert.ok(countLogs("处于熔断状态，跳过本次换源") >= 1, "跳过时应写日志");
  });

  it("4xx 语义业务码属请求侧拒绝，不计入熔断", async () => {
    const unlock = await loadUnlock();
    resetLogs();
    getState().lxMode = "biz404";
    getState().songDetail = songDetail;
    const target = { title: "请求侧用例", artist: "测试歌手", duration: 296 };

    for (let i = 0; i < 4; i += 1) {
      const result = await unlock(target, directOptions);
      assert.equal(result.reason, FETCH_FAILED_REASON, "取链失败");
    }
    assert.equal(countLogs("连续 3 次失败"), 0, "请求侧拒绝不应触发熔断");
    assert.ok(getState().lxCalls > 0, "每次都真实打到了上游");
  });

  it("非 4xx 语义业务码计入上游故障", async () => {
    const unlock = await loadUnlock();
    resetLogs();
    getState().lxMode = "biz4601";
    getState().songDetail = songDetail;
    const target = { title: "业务故障用例", artist: "测试歌手", duration: 296 };

    for (let i = 0; i < 3; i += 1) {
      const result = await unlock(target, directOptions);
      assert.equal(result.reason, FETCH_FAILED_REASON, "取链失败");
    }
    assert.ok(countLogs("连续 3 次失败") >= 1, "上游业务故障应触发熔断");
  });
});

describe("落雪换源链失败日志", () => {
  it("同源同曲在 10 秒窗口内只写一条失败日志", async () => {
    const unlock = await loadUnlock();
    resetLogs();
    getState().lxMode = "biz404";
    getState().songDetail = songDetail;
    const target = { title: "节流用例", artist: "测试歌手", duration: 296 };

    await unlock(target, directOptions);
    await unlock(target, directOptions);
    await unlock(target, directOptions);
    assert.equal(countLogs("落雪音源 换源失败"), 1, "同源同曲只写一条失败日志");
    assert.equal(countLogs("节流用例"), 1, "日志带歌名");
  });

  it("不同曲目各写各的失败日志", async () => {
    const unlock = await loadUnlock();
    resetLogs();
    getState().lxMode = "biz404";
    getState().songDetail = songDetail;

    await unlock({ title: "曲目甲", artist: "测试歌手", duration: 296 }, directOptions);
    await unlock({ title: "曲目乙", artist: "测试歌手", duration: 296 }, directOptions);
    assert.equal(countLogs("落雪音源 换源失败"), 2, "不同曲目各写一条");
  });

  it("无候选时写的是 match.ts 的无候选原因", async () => {
    const unlock = await loadUnlock();
    resetLogs();
    getState().lxMode = "biz404";
    getState().searchSongs = [];
    getState().songDetail = null;

    const result = await unlock({ title: "无候选用例", artist: "测试歌手" });
    assert.equal(result.reason, NO_CANDIDATE_REASON, "无候选的原因文案");
    assert.ok(countLogs(NO_CANDIDATE_REASON) >= 1, "日志带 match.ts 的原因常量");
  });

  it("候选未通过校验时写的是 match.ts 的匹配失败原因", async () => {
    const unlock = await loadUnlock();
    resetLogs();
    getState().lxMode = "biz404";
    getState().searchSongs = [
      {
        mid: "0039MnYb0qxYhV",
        title: "完全不同的歌名",
        singer: [{ name: "完全不同的歌手" }],
        interval: 12,
        file: { media_mid: "003Qui1q2u1Zho" },
      },
    ];
    getState().songDetail = null;

    const result = await unlock({ title: "匹配失败用例", artist: "测试歌手", duration: 296 });
    assert.equal(result.reason, MATCH_FAILED_REASON, "匹配失败的原因文案");
    assert.ok(countLogs(MATCH_FAILED_REASON) >= 1, "日志带 match.ts 的原因常量");
  });
});
