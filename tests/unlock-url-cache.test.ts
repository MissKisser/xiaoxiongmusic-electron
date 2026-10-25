/**
 * 换源成功直链的进程内 TTL 缓存
 *
 * 覆盖五块判据：
 * - 命中：写入后能读回同一条直链，来源与音质一并保留
 * - 未命中：没有写过的键读回 null
 * - 过期：超过有效期后读回 null，条目同时被清掉
 * - 淘汰：条目数超过上限时淘汰最早过期的一条
 * - 试听不入：没有可用直链 / 没有换源来源的结果不入缓存
 *
 * 全程纯逻辑：不依赖网络，不起 Electron 实例。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UNLOCKED_URL_MAX_ENTRIES,
  UNLOCKED_URL_TTL_MS,
  UnlockUrlCache,
} from "../src/utils/unlockUrlCache";

describe("换源直链缓存", () => {
  it("写入后能读回直链，来源与音质一并保留", () => {
    const cache = new UnlockUrlCache<string>();
    cache.set("qqmusic-1", {
      url: "https://example.test/audio.mp3",
      quality: "HQ",
      unlockSource: "kuwo",
    });
    const hit = cache.get("qqmusic-1");
    assert.ok(hit, "写入后应能命中");
    assert.equal(hit?.url, "https://example.test/audio.mp3", "直链原样保留");
    assert.equal(hit?.quality, "HQ", "音质原样保留");
    assert.equal(hit?.unlockSource, "kuwo", "解锁来源原样保留");
  });

  it("没写过的键读回 null", () => {
    const cache = new UnlockUrlCache<string>();
    assert.equal(cache.get("kugou-9"), null, "未写入的键应读回 null");
  });

  it("超过有效期后读回 null，条目同时被清掉", () => {
    const cache = new UnlockUrlCache<string>(1000, 10);
    cache.set("qqmusic-2", { url: "https://example.test/a.mp3", unlockSource: "bodian" });
    const now = Date.now();
    assert.ok(cache.get("qqmusic-2", now), "有效期内应命中");
    assert.equal(cache.get("qqmusic-2", now + 1001), null, "过期后应读回 null");
    assert.equal(cache.size, 0, "过期条目应被清掉");
  });

  it("条目数超过上限时淘汰最早过期的一条", () => {
    const cache = new UnlockUrlCache<string>(UNLOCKED_URL_TTL_MS, 3);
    const base = Date.now();
    cache.set("k1", { url: "https://example.test/1.mp3", unlockSource: "kuwo" }, base);
    cache.set("k2", { url: "https://example.test/2.mp3", unlockSource: "kuwo" }, base + 1000);
    cache.set("k3", { url: "https://example.test/3.mp3", unlockSource: "kuwo" }, base + 2000);
    cache.set("k4", { url: "https://example.test/4.mp3", unlockSource: "kuwo" }, base + 3000);
    assert.equal(cache.size, 3, "条目数不应超过上限");
    assert.equal(cache.get("k1", base + 3000), null, "最早过期的一条应被淘汰");
    assert.ok(cache.get("k4", base + 3000), "最新写入的一条应保留");
  });

  it("没有可用直链或没有换源来源的结果不入缓存", () => {
    const cache = new UnlockUrlCache<string>();
    cache.set("trial-1", { url: "", quality: "LQ", unlockSource: "kuwo" });
    cache.set("trial-2", { url: "https://example.test/trial.mp3", quality: "LQ", unlockSource: "" });
    assert.equal(cache.get("trial-1"), null, "没有可用直链的结果不入缓存");
    assert.equal(cache.get("trial-2"), null, "没有换源来源的结果不入缓存");
    assert.equal(cache.size, 0, "缓存应为空");
  });

  it("默认有效期为 20 分钟、上限为 100 条", () => {
    assert.equal(UNLOCKED_URL_TTL_MS, 20 * 60 * 1000, "默认有效期为 20 分钟");
    assert.equal(UNLOCKED_URL_MAX_ENTRIES, 100, "默认上限为 100 条");
  });

  it("同键重写只保留最新一条", () => {
    const cache = new UnlockUrlCache<string>();
    const base = Date.now();
    cache.set("qqmusic-3", { url: "https://example.test/old.mp3", unlockSource: "kuwo" }, base);
    cache.set("qqmusic-3", { url: "https://example.test/new.mp3", unlockSource: "migu" }, base + 10);
    assert.equal(cache.size, 1, "同键重写后只应有一条");
    assert.equal(cache.get("qqmusic-3", base + 10)?.url, "https://example.test/new.mp3", "保留最新一条");
  });
});
