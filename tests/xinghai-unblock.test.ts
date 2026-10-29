/**
 * 星海换源链单元测试
 *
 * 覆盖：
 * - netease 链位首位为 XINGHAI
 * - platformId 缺失时的失败返回（NO_CANDIDATE_REASON）
 * - 成功路径的时长/体积校验放行逻辑（包含 320k 直链 https 协议升级）
 * - 320k 失败自动降级 128k
 * - 时长偏离目标容差时的拦截
 * - 音频体积偏小异常时的拦截
 * - 上游连续故障熔断机制
 */

import { register } from "node:module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SongUnlockServer } from "../src/types/shared";
import { getUnlockPriority } from "../src/utils/unlockPriority";
import {
  FETCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  NO_CANDIDATE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
} from "../electron/server/unblock/match";

register(new URL("./helpers/xinghai-hooks.mjs", import.meta.url));

type XinghaiState = {
  mode: string;
  calls: number;
  contentLength: number;
  audioBuffer: Buffer;
  logs: { level: string; name: string; args: unknown[] }[];
};

type UnlockResult = {
  code: number;
  url: string | null;
  reason?: string;
  lengthVerified?: boolean;
};
type UnlockFn = (target: unknown, options?: unknown) => Promise<UnlockResult>;

const getState = (): XinghaiState =>
  (globalThis as unknown as { __xinghaiState: XinghaiState }).__xinghaiState;

let instanceSeq = 0;
const loadUnlock = async (): Promise<UnlockFn> => {
  instanceSeq += 1;
  const mod = await import(`../electron/server/unblock/xinghai?instance=${instanceSeq}`);
  return mod.default as UnlockFn;
};

const resetState = (): void => {
  const s = getState();
  s.mode = "ok";
  s.calls = 0;
  s.contentLength = 8000000;
  s.audioBuffer = Buffer.from([0xff, 0xfb, 0xe0, 0x00]);
  s.logs.length = 0;
};

describe("星海音源优先级配置", () => {
  it("网易云换源优先级首位为 XINGHAI", () => {
    const priority = getUnlockPriority("netease");
    assert.equal(priority[0], SongUnlockServer.XINGHAI, "星海音源应位于网易云链首位");
    assert.equal(priority[1], SongUnlockServer.NETEASE, "原网易云作为第二位兜底");
  });
});

describe("星海音源参数校验", () => {
  it("歌名或歌手缺失时返回 404", async () => {
    const unlock = await loadUnlock();
    resetState();

    const noTitle = await unlock({ title: "", artist: "周杰伦" }, { platformId: "123" });
    assert.equal(noTitle.code, 404);
    assert.equal(noTitle.reason, MISSING_TITLE_REASON);

    const noArtist = await unlock({ title: "夜曲", artist: "" }, { platformId: "123" });
    assert.equal(noArtist.code, 404);
    assert.equal(noArtist.reason, MISSING_ARTIST_REASON);
  });

  it("platformId 缺失时返回失败并指示无候选", async () => {
    const unlock = await loadUnlock();
    resetState();

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const result = await unlock(target, {});
    assert.equal(result.code, 404);
    assert.equal(result.reason, NO_CANDIDATE_REASON);
    assert.equal(result.url, null);
    assert.equal(getState().calls, 0, "缺少 platformId 时不打上游");
  });
});

describe("星海音源取链与时长体积校验", () => {
  it("成功路径：320k 满足时长与体积校验并升级 https", async () => {
    const unlock = await loadUnlock();
    resetState();

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "netease", platformId: "186016" };

    const result = await unlock(target, options);
    assert.equal(result.code, 200);
    assert.ok(result.url?.startsWith("https://m10.music.126.net/"), "应升级为 https 直链");
    assert.equal(result.lengthVerified, true, "体积与时长应已完成校验");
    assert.equal(getState().calls, 1, "一次取链成功");
  });

  it("320k 失败时降级 128k 取链放行", async () => {
    const unlock = await loadUnlock();
    resetState();
    getState().mode = "fail320k";
    // 128k MPEG1 Layer3 44.1kHz: bitrateIndex 9 (128k) -> 0x90
    getState().audioBuffer = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    // 200s * 128kbps = 3,200,000 bytes
    getState().contentLength = 3200000;

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "netease", platformId: "186016" };

    const result = await unlock(target, options);
    assert.equal(result.code, 200);
    assert.ok(result.url?.includes("fallback128k.mp3"));
    assert.equal(getState().calls, 2, "经历了 320k 降级 128k 两次尝试");
  });

  it("时长超出容差时拒绝放行", async () => {
    const unlock = await loadUnlock();
    resetState();
    // 目标时长 200s，但文件头解析出 100s（4,000,000 bytes / 320kbps = 100s）
    getState().contentLength = 4000000;

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "netease", platformId: "186016" };

    const result = await unlock(target, options);
    assert.equal(result.code, 404);
    assert.equal(result.reason, FETCH_FAILED_REASON);
  });

  it("文件体积偏小命中异常特征时拒绝放行", async () => {
    const unlock = await loadUnlock();
    resetState();
    // 长歌曲（200s）文件只有 50000 字节，远低于合理下限
    getState().contentLength = 50000;

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "netease", platformId: "186016" };

    const result = await unlock(target, options);
    assert.equal(result.code, 404);
    assert.equal(result.reason, FETCH_FAILED_REASON);
  });

  it("上游连续故障达到阈值熔断", async () => {
    const unlock = await loadUnlock();
    resetState();
    getState().mode = "http500";

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "netease", platformId: "186016" };

    for (let i = 0; i < 3; i += 1) {
      const res = await unlock(target, options);
      assert.equal(res.code, 404);
      assert.equal(res.reason, FETCH_FAILED_REASON);
    }

    const callsBefore = getState().calls;
    const tripped = await unlock(target, options);
    assert.equal(tripped.code, 404);
    assert.equal(tripped.reason, UPSTREAM_UNAVAILABLE_REASON);
    assert.equal(getState().calls, callsBefore, "熔断期内零网络请求");
  });
});
