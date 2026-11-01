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
import crypto from "node:crypto";
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
  ticketCalls: number;
  jiexiangRequests: { headers: Record<string, string>; body: string }[];
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

const resetState = async (): Promise<void> => {
  const s = getState();
  s.fishMode = "ok";
  s.fishCalls = 0;
  s.fishResponse = null;
  s.fishContentLength = 8000000;
  s.fishAudioBuffer = Buffer.from([0xff, 0xfb, 0xe0, 0x00]);

  s.jiexiangMode = "ok";
  s.jiexiangCalls = 0;
  s.ticketCalls = 0;
  s.jiexiangRequests = [];
  s.jiexiangContentLength = 8000000;
  s.jiexiangAudioBuffer = Buffer.from([0xff, 0xfb, 0xe0, 0x00]);

  s.logs.length = 0;
  const { invalidateQingTicket } = await import("../electron/server/unblock/qing-gateway");
  invalidateQingTicket();
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

  it("首触超时后重试一次并命中上游缓存", async () => {
    const unlock = await loadFish();
    resetState();
    getState().fishMode = "timeout_once";

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "qqmusic", platformId: "0039MnYb0qxYhV" };

    const result = await unlock(target, options);
    assert.equal(result.code, 200, "重试命中后应正常交付直链");
    assert.ok(result.url?.includes("qqmusic.qq.com"));
    assert.equal(getState().fishCalls, 2, "首触超时后应再发一次请求");
  });

  it("重试仍超时时判失败并计入熔断", async () => {
    const unlock = await loadFish();
    resetState();
    getState().fishMode = "timeout_always";

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "qqmusic", platformId: "0039MnYb0qxYhV" };

    const result = await unlock(target, options);
    assert.equal(result.code, 404);
    assert.equal(result.reason, FETCH_FAILED_REASON);
    assert.equal(getState().fishCalls, 2, "只重试一次，不做无止境重试");
  });

  it("上游返回 HTTP 5xx 时不重试", async () => {
    const unlock = await loadFish();
    resetState();
    getState().fishMode = "http500";

    const target = { title: "夜曲", artist: "周杰伦", duration: 200 };
    const options = { platform: "qqmusic", platformId: "0039MnYb0qxYhV" };

    const result = await unlock(target, options);
    assert.equal(result.code, 404);
    assert.equal(getState().fishCalls, 1, "服务端故障由熔断器处理，不做即时重试");
  });
});

describe("吉祥音源（酷狗曲库）换源逻辑", () => {
  it("歌名或歌手缺失时返回 404", async () => {
    const unlock = await loadJiexiang();
    await resetState();

    const noTitle = await unlock({ title: "", artist: "周杰伦" }, { platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" });
    assert.equal(noTitle.code, 404);
    assert.equal(noTitle.reason, MISSING_TITLE_REASON);

    const noArtist = await unlock({ title: "晴天", artist: "" }, { platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" });
    assert.equal(noArtist.code, 404);
    assert.equal(noArtist.reason, MISSING_ARTIST_REASON);
  });

  it("platformId 缺失时直接失败返回 NO_CANDIDATE_REASON", async () => {
    const unlock = await loadJiexiang();
    await resetState();

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const result = await unlock(target, {});
    assert.equal(result.code, 404);
    assert.equal(result.reason, NO_CANDIDATE_REASON);
    assert.equal(getState().jiexiangCalls, 0, "缺少 platformId 时不打上游");
  });

  it("成功路径：直链保留 http 协议原样交付且音质标识 qu320 匹配", async () => {
    const unlock = await loadJiexiang();
    await resetState();

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
    await resetState();
    getState().jiexiangMode = "wrong_token";

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const options = { platform: "kugou", platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" };

    const result = await unlock(target, options);
    assert.equal(result.code, 404);
    assert.equal(result.reason, FETCH_FAILED_REASON);
  });

  it("320k 失败时降级 128k 档取链", async () => {
    const unlock = await loadJiexiang();
    await resetState();
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
    await resetState();
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

  it("成功路径（HTTP 201 + 嵌套 data.url）正常出链且含 qu320 标识", async () => {
    const unlock = await loadJiexiang();
    await resetState();
    getState().jiexiangMode = "http201";

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const options = { platform: "kugou", platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" };

    const result = await unlock(target, options);
    assert.equal(result.code, 200);
    assert.ok(result.url?.includes("qu320"));
    assert.equal(result.lengthVerified, true);
  });

  it("HTTP 503 + UPSTREAM_NO_RESOURCE 判单曲拒绝且不推进熔断计数", async () => {
    const unlock = await loadJiexiang();
    await resetState();
    getState().jiexiangMode = "no_resource";

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const options = { platform: "kugou", platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" };

    for (let i = 0; i < 4; i += 1) {
      const res = await unlock(target, options);
      assert.equal(res.code, 404);
      assert.equal(res.reason, FETCH_FAILED_REASON);
    }
  });

  it("APP_UPGRADE_REQUIRED → 票据缓存被作废、自动换票重试一次后成功", async () => {
    const unlock = await loadJiexiang();
    await resetState();
    getState().jiexiangMode = "auth_expired_once";

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const options = { platform: "kugou", platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" };

    const result = await unlock(target, options);
    assert.equal(result.code, 200);
    assert.ok(result.url?.includes("qu320"));
    assert.equal(getState().jiexiangCalls, 2, "应重试一次解析请求");
    assert.equal(getState().ticketCalls, 2, "作废缓存后应重新请求 ticket");
  });

  it("重试后仍鉴权失败 → 判上游故障（计熔断）", async () => {
    const unlock = await loadJiexiang();
    await resetState();
    getState().jiexiangMode = "auth_expired_always";

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const options = { platform: "kugou", platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" };

    for (let i = 0; i < 3; i += 1) {
      const res = await unlock(target, options);
      assert.equal(res.code, 404);
      assert.equal(res.reason, FETCH_FAILED_REASON);
    }

    const tripped = await unlock(target, options);
    assert.equal(tripped.code, 404);
    assert.equal(tripped.reason, UPSTREAM_UNAVAILABLE_REASON);
  });

  it("请求头完整性：捕获发出的请求头，重算 stringToSign 验证 X-Qing-Sign 并验证 nonce 防重放", async () => {
    const unlock = await loadJiexiang();
    await resetState();

    const target = { title: "晴天", artist: "周杰伦", duration: 200 };
    const options = { platform: "kugou", platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7" };

    await unlock(target, options);
    await unlock(target, options);

    const requests = getState().jiexiangRequests;
    assert.equal(requests.length, 2);
    const [req1, req2] = requests;

    const SIGN_SECRET = "qm-gw-7c1f4e9a2b8d5360e1a7c4f9b2d8036c";

    for (const req of [req1, req2]) {
      assert.equal(req.headers["X-Qing-App-Id"], "qingmusic-android");
      assert.equal(req.headers["X-Qing-App-Version"], "1.4.0");
      assert.ok(req.headers["X-Qing-Device-Id"]?.startsWith("qingmusic-android-"));
      assert.match(req.headers["X-Qing-Ts"], /^\d{13}$/);
      assert.match(req.headers["X-Qing-Nonce"], /^[a-f0-9]{32}$/);
      assert.match(req.headers["X-Qing-Sign"], /^[a-f0-9]{64}$/);
      assert.ok(req.headers["Authorization"]?.startsWith("Bearer "));

      const bodySha256 = crypto.createHash("sha256").update(req.body).digest("hex");
      const stringToSign = [
        req.headers["X-Qing-App-Id"],
        req.headers["X-Qing-Ts"],
        req.headers["X-Qing-Nonce"],
        "POST",
        "/v1/music/resolve-url",
        bodySha256,
      ].join("\n");
      const expectedSign = crypto
        .createHmac("sha256", SIGN_SECRET)
        .update(stringToSign)
        .digest("hex");
      assert.equal(req.headers["X-Qing-Sign"], expectedSign);
    }

    assert.notEqual(req1.headers["X-Qing-Nonce"], req2.headers["X-Qing-Nonce"]);
  });
});
