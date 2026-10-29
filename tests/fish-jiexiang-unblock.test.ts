/**
 * 小鱼与吉祥换源单元测试
 *
 * 覆盖：
 * - 链位断言：qqmusic 首位为 FISH、kugou 首位为 JIEXIANG、netease 首位仍为 XINGHAI
 * - 小鱼音源：参数校验、mid 不符拒绝、时长偏差拒绝、档位挑选、熔断器
 * - 吉祥音源：参数校验、hash 缺失失败、音质标识核验（qu320 / qu128）、档位降级、熔断器
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

register(new URL("./helpers/fish-jiexiang-hooks.mjs", import.meta.url));

type StubState = {
  fishMode: string;
  fishCalls: number;
  fishResponse: unknown;
  fishContentLength: number;
  fishAudioBuffer: Buffer;

  jiexiangMode: string;
  jiexiangCalls: number;
  jiexiangContentLength: number;
  jiexiangAudioBuffer: Buffer;

  logs: { level: string; name: string; args: unknown[] }[];
};

type UnlockResult = {
  code: number;
  url: string | null;
  reason?: string;
  lengthVerified?: boolean;
};
type UnlockFn = (target: unknown, options?: unknown) => Promise<UnlockResult>;

const getState = (): StubState =>
  (globalThis as unknown as { __fishJiexiangState: StubState }).__fishJiexiangState;

let instanceSeq = 0;
const loadFish = async (): Promise<UnlockFn> => {
  instanceSeq += 1;
  const mod = await import(`../electron/server/unblock/fish?instance=${instanceSeq}`);
  return mod.default as UnlockFn;
};

const loadJiexiang = async (): Promise<UnlockFn> => {
  instanceSeq += 1;
  const mod = await import(`../electron/server/unblock/jiexiang?instance=${instanceSeq}`);
  return mod.default as UnlockFn;
};

const resetState = (): void => {
  const s = getState();
  s.fishMode = "ok";
  s.fishCalls = 0;
  s.fishResponse = null;
  s.fishContentLength = 8000000;
  s.fishAudioBuffer = Buffer.from([0xff, 0xfb, 0xe0, 0x00]);

  s.jiexiangMode = "ok";
  s.jiexiangCalls = 0;
  s.jiexiangContentLength = 8000000;
  s.jiexiangAudioBuffer = Buffer.from([0xff, 0xfb, 0xe0, 0x00]);

  s.logs.length = 0;
};

describe("换源链优先级配置", () => {
  it("QQ 音乐换源首位为 FISH", () => {
    const priority = getUnlockPriority("qqmusic");
    assert.equal(priority[0], SongUnlockServer.FISH, "小鱼音源应置于 QQ 音乐链首位");
  });

  it("酷狗换源首位为 JIEXIANG", () => {
    const priority = getUnlockPriority("kugou");
    assert.equal(priority[0], SongUnlockServer.JIEXIANG, "吉祥音源应置于酷狗链首位");
  });

  it("网易云换源首位保持 XINGHAI", () => {
    const priority = getUnlockPriority("netease");
    assert.equal(priority[0], SongUnlockServer.XINGHAI, "星海音源应保持网易云链首位");
  });
});

describe("小鱼音源（QQ 音乐）换源逻辑", () => {
  it("歌名或歌手缺失时返回 404", async () => {
    const unlock = await loadFish();
    resetState();

    const noTitle = await unlock({ title: "", artist: "周杰伦" }, { platformId: "0039MnYb0qxYhV" });
    assert.equal(noTitle.code, 404);
    assert.equal(noTitle.reason, MISSING_TITLE_REASON);

    const noArtist = await unlock({ title: "夜曲", artist: "" }, { platformId: "0039MnYb0qxYhV" });
    assert.equal(noArtist.code, 404);
    assert.equal(noArtist.reason, MISSING_ARTIST_REASON);
  });

  it("成功路径：直链解析成功并升级 https 协议", async () => {
    const unlock = await loadFish();
    resetState();

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "qqmusic", platformId: "0039MnYb0qxYhV" };

    const result = await unlock(target, options);
    assert.equal(result.code, 200);
    assert.ok(result.url?.startsWith("https://isure6.stream.qqmusic.qq.com/"), "QQ CDN 应升级为 https");
    assert.equal(result.lengthVerified, true);
    assert.equal(getState().fishCalls, 1);
  });

  it("回显 song_mid 不符时拒绝放行", async () => {
    const unlock = await loadFish();
    resetState();
    getState().fishMode = "mismatch_mid";

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "qqmusic", platformId: "0039MnYb0qxYhV" };

    const result = await unlock(target, options);
    assert.equal(result.code, 404);
    assert.equal(result.reason, FETCH_FAILED_REASON);
  });

  it("声明时长偏离目标容差时拒绝放行", async () => {
    const unlock = await loadFish();
    resetState();
    getState().fishMode = "wrong_duration";

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "qqmusic", platformId: "0039MnYb0qxYhV" };

    const result = await unlock(target, options);
    assert.equal(result.code, 404);
    assert.equal(result.reason, FETCH_FAILED_REASON);
  });

  it("320k 档缺失时自动降级 128k 档", async () => {
    const unlock = await loadFish();
    resetState();
    getState().fishMode = "fail_hq";

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "qqmusic", platformId: "0039MnYb0qxYhV" };

    const result = await unlock(target, options);
    assert.equal(result.code, 200);
    assert.ok(result.url?.includes("C400003Qui1q2u1Zho.m4a"));
  });

  it("上游连续故障达到阈值熔断", async () => {
    const unlock = await loadFish();
    resetState();
    getState().fishMode = "http500";

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "qqmusic", platformId: "0039MnYb0qxYhV" };

    for (let i = 0; i < 3; i += 1) {
      const res = await unlock(target, options);
      assert.equal(res.code, 404);
      assert.equal(res.reason, FETCH_FAILED_REASON);
    }

    const callsBefore = getState().fishCalls;
    const tripped = await unlock(target, options);
    assert.equal(tripped.code, 404);
    assert.equal(tripped.reason, UPSTREAM_UNAVAILABLE_REASON);
    assert.equal(getState().fishCalls, callsBefore, "熔断期内零网络请求");
  });
});

describe("吉祥音源（酷狗曲库）换源逻辑", () => {
  it("歌名或歌手缺失时返回 404", async () => {
    const unlock = await loadJiexiang();
    resetState();

    const noTitle = await unlock({ title: "", artist: "周杰伦" }, { platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" });
    assert.equal(noTitle.code, 404);
    assert.equal(noTitle.reason, MISSING_TITLE_REASON);

    const noArtist = await unlock({ title: "晴天", artist: "" }, { platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" });
    assert.equal(noArtist.code, 404);
    assert.equal(noArtist.reason, MISSING_ARTIST_REASON);
  });

  it("platformId 缺失时直接失败返回 NO_CANDIDATE_REASON", async () => {
    const unlock = await loadJiexiang();
    resetState();

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const result = await unlock(target, {});
    assert.equal(result.code, 404);
    assert.equal(result.reason, NO_CANDIDATE_REASON);
    assert.equal(getState().jiexiangCalls, 0, "缺少 platformId 时不打上游");
  });

  it("成功路径：直链保留 http 协议原样交付且音质标识 qu320 匹配", async () => {
    const unlock = await loadJiexiang();
    resetState();

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const options = { platform: "kugou", platformId: "B3A52A7A958BF0AED0EBFBA2E9A818B7" };

    const result = await unlock(target, options);
    assert.equal(result.code, 200);
    assert.ok(result.url?.startsWith("http://"), "直链应保持 http 原样交付");
    assert.ok(result.url?.includes("qu320"), "应包含 qu320 音质标识");
    assert.equal(result.lengthVerified, true);
    assert.equal(getState().jiexiangCalls, 1);
  });

  it("音质标识不匹配时拦截拒绝", async () => {
    const unlock = await loadJiexiang();
    resetState();
    getState().jiexiangMode = "wrong_token";

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const options = { platform: "kugou", platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" };

    const result = await unlock(target, options);
    assert.equal(result.code, 404);
    assert.equal(result.reason, FETCH_FAILED_REASON);
  });

  it("320k 失败时降级 128k 档取链", async () => {
    const unlock = await loadJiexiang();
    resetState();
    getState().jiexiangMode = "fail_exhigh";

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const options = { platform: "kugou", platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" };

    const result = await unlock(target, options);
    assert.equal(result.code, 200);
    assert.ok(result.url?.includes("qu128"));
    assert.equal(getState().jiexiangCalls, 2, "应尝试两次请求后成功");
  });

  it("上游连续故障达到阈值熔断", async () => {
    const unlock = await loadJiexiang();
    resetState();
    getState().jiexiangMode = "http500";

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const options = { platform: "kugou", platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" };

    for (let i = 0; i < 3; i += 1) {
      const res = await unlock(target, options);
      assert.equal(res.code, 404);
      assert.equal(res.reason, FETCH_FAILED_REASON);
    }

    const callsBefore = getState().jiexiangCalls;
    const tripped = await unlock(target, options);
    assert.equal(tripped.code, 404);
    assert.equal(tripped.reason, UPSTREAM_UNAVAILABLE_REASON);
    assert.equal(getState().jiexiangCalls, callsBefore, "熔断期内零网络请求");
  });
});
