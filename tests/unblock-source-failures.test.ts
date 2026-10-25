/**
 * 站外换源链（酷我 / 波点）的取链判定与失败日志
 *
 * 覆盖四块判据：
 * - 占位应答识别：上游回「登录后畅听」占位资源时判为逐曲拒绝（不计熔断），失败原因写明是试听片段
 * - 正常直链：上游给出完整直链时能出链并通过体积校验
 * - 逐曲拒绝不计熔断：波点回「没有解锁付费歌曲」时整源不熔断
 * - 失败日志节流：同源同曲在 10 秒窗口内只写一条，日志带 match.ts 的原因常量
 *
 * 全程本地应答：不依赖网络，也不起 Electron 实例。
 * 熔断器与节流表是模块级状态，每个用例都另取一份模块实例，用例之间互不影响。
 */

import { register } from "node:module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FETCH_FAILED_REASON,
  NO_CANDIDATE_REASON,
  TRIAL_ONLY_REASON,
} from "../electron/server/unblock/match";

register(new URL("./helpers/unblock-hooks.mjs", import.meta.url));

type UnblockState = {
  searchList: unknown[];
  kuwoMode: string;
  bodianCode: number;
  contentLength: number;
  bodianCalls: number;
  logs: { level: string; name: string; args: unknown[] }[];
};

type UnlockResult = { code: number; url: string | null; reason?: string };
type UnlockFn = (target: unknown, options?: unknown) => Promise<UnlockResult>;

/** 桩件状态：桩件模块被加载时才创建 */
const getState = (): UnblockState => (globalThis as unknown as { __unblockState: UnblockState }).__unblockState;

/** 模块实例计数：用于取一份新的模块实例（熔断器与节流表是模块级状态） */
let instanceSeq = 0;

/**
 * 取一份新的换源模块实例
 * @param moduleName 模块文件名（不含扩展名）
 * @returns 换源函数
 */
const loadUnlock = async (moduleName: string): Promise<UnlockFn> => {
  instanceSeq += 1;
  const mod = await import(`../electron/server/unblock/${moduleName}?instance=${instanceSeq}`);
  return mod.default as UnlockFn;
};

/** 取日志里匹配指定文案的条数 */
const countLogs = (needle: string): number =>
  getState().logs.filter((entry) => entry.args.some((arg) => String(arg).includes(needle))).length;

/** 清空日志与计数 */
const resetLogs = (): void => {
  getState().logs.length = 0;
  getState().bodianCalls = 0;
};

/** 酷我候选条目 */
const kuwoCandidate = {
  rid: "228908",
  title: "晴天",
  artist: "周杰伦",
  duration: 269,
};

describe("酷我取链判定", () => {
  it("上游回占位资源时判为逐曲拒绝，原因写明是试听片段", async () => {
    const unlock = await loadUnlock("kuwo");
    resetLogs();
    getState().searchList = [kuwoCandidate];
    getState().kuwoMode = "placeholder";

    const result = await unlock({ title: "晴天", artist: "周杰伦", duration: 269 });
    assert.equal(result.code, 404, "占位资源不应交付");
    assert.equal(result.reason, TRIAL_ONLY_REASON, "失败原因是试听片段而非通用取链失败");
    assert.ok(countLogs(TRIAL_ONLY_REASON) >= 1, "失败日志带 match.ts 的原因常量");
  });

  it("占位资源属逐曲拒绝，连续失败不触发熔断", async () => {
    const unlock = await loadUnlock("kuwo");
    resetLogs();
    getState().searchList = [kuwoCandidate];
    getState().kuwoMode = "placeholder";

    for (let i = 0; i < 4; i += 1) {
      const result = await unlock({ title: "晴天", artist: "周杰伦", duration: 269 });
      assert.equal(result.reason, TRIAL_ONLY_REASON, "每次都是逐曲拒绝");
    }
    assert.equal(countLogs("处于熔断状态，跳过本次换源"), 0, "逐曲拒绝不应触发熔断");
  });

  it("上游给出完整直链时能出链并通过体积校验", async () => {
    const unlock = await loadUnlock("kuwo");
    resetLogs();
    getState().searchList = [kuwoCandidate];
    getState().kuwoMode = "normal";
    getState().contentLength = 4318872;

    const result = await unlock({ title: "晴天", artist: "周杰伦", duration: 269 });
    assert.equal(result.code, 200, "完整直链应能出链");
    assert.ok(result.url && result.url.includes("kuwo.cn"), "直链指向酷我 CDN");
    assert.ok(countLogs("KuwoSong URL") >= 1, "成功时写直链日志");
  });

  it("直链体积过小时判为取链失败", async () => {
    const unlock = await loadUnlock("kuwo");
    resetLogs();
    getState().searchList = [kuwoCandidate];
    getState().kuwoMode = "normal";
    getState().contentLength = 185336;

    const result = await unlock({ title: "晴天", artist: "周杰伦", duration: 269 });
    assert.equal(result.code, 404, "体积过小不应交付");
    assert.equal(result.reason, FETCH_FAILED_REASON, "失败原因是取链失败");
  });
});

describe("波点取链判定", () => {
  it("「没有解锁付费歌曲」属逐曲拒绝，不触发熔断", async () => {
    const unlock = await loadUnlock("bodian");
    resetLogs();
    getState().searchList = [kuwoCandidate];
    getState().bodianCode = 20018;

    for (let i = 0; i < 4; i += 1) {
      const result = await unlock({ title: "晴天", artist: "周杰伦", duration: 269 });
      assert.equal(result.code, 404, "无版权资源不应交付");
    }
    assert.equal(countLogs("处于熔断状态，跳过本次换源"), 0, "逐曲拒绝不应触发熔断");
    assert.ok(getState().bodianCalls >= 4, "每次都真实打到了上游");
  });

  it("同源同曲在 10 秒窗口内只写一条失败日志", async () => {
    const unlock = await loadUnlock("bodian");
    resetLogs();
    getState().searchList = [kuwoCandidate];
    getState().bodianCode = 20018;

    await unlock({ title: "晴天", artist: "周杰伦", duration: 269 });
    await unlock({ title: "晴天", artist: "周杰伦", duration: 269 });
    await unlock({ title: "晴天", artist: "周杰伦", duration: 269 });
    assert.equal(countLogs("波点 换源失败"), 1, "同源同曲只写一条失败日志");
    assert.equal(countLogs("波点 换源失败（晴天"), 1, "日志带歌名");
  });

  it("检索不到候选时写的是 match.ts 的无候选原因", async () => {
    const unlock = await loadUnlock("bodian");
    resetLogs();
    getState().searchList = [];
    getState().bodianCode = 20018;

    // 候选池按「歌名 + 歌手」缓存，换一组键避免命中上一用例的池
    const result = await unlock({ title: "空池用例", artist: "测试歌手" });
    assert.equal(result.reason, NO_CANDIDATE_REASON, "无候选的原因文案");
    assert.ok(countLogs(NO_CANDIDATE_REASON) >= 1, "日志带 match.ts 的原因常量");
  });
});
