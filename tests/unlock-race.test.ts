import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SongUnlockServer } from "../src/types/shared";
import { raceUnlockSources, type UnlockAttempt } from "../src/utils/unlockRace";

/**
 * 延迟指定毫秒
 *
 * @param ms 毫秒数
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("并行竞速换源编排器", () => {
  it("两个源并发、均会成功：快者胜（即使慢者之后也成功，胜者仍是快者）", async () => {
    const servers = [SongUnlockServer.NETEASE, SongUnlockServer.BODIAN] as const;

    const result = await raceUnlockSources(servers, async (server) => {
      if (server === SongUnlockServer.NETEASE) {
        await sleep(50);
        return {
          ok: true,
          server,
          durationMs: 50,
          value: "慢速直链",
        };
      }
      await sleep(10);
      return {
        ok: true,
        server,
        durationMs: 10,
        value: "快速直链",
      };
    });

    assert.ok(result.winner, "应存在胜者");
    assert.equal(result.winner.server, SongUnlockServer.BODIAN);
    assert.equal(result.winner.value, "快速直链");

    // 等待慢速源落定，确认不会抛出未处理异常
    await sleep(60);
  });

  it("首源失败、次源成功：次源胜", async () => {
    const servers = [SongUnlockServer.NETEASE, SongUnlockServer.BODIAN] as const;

    const result = await raceUnlockSources(servers, async (server) => {
      if (server === SongUnlockServer.NETEASE) {
        await sleep(10);
        return {
          ok: false,
          server,
          durationMs: 10,
          reason: "网易云无候选",
        };
      }
      await sleep(25);
      return {
        ok: true,
        server,
        durationMs: 25,
        value: "波点可用直链",
      };
    });

    assert.ok(result.winner, "应存在胜者");
    assert.equal(result.winner.server, SongUnlockServer.BODIAN);
    assert.equal(result.winner.value, "波点可用直链");
  });

  it("全部失败：返回无胜者，failures 按传入顺序聚合且 reason 正确", async () => {
    const servers = [
      SongUnlockServer.NETEASE,
      SongUnlockServer.BODIAN,
      SongUnlockServer.KUWO,
    ] as const;

    const result = await raceUnlockSources(servers, async (server) => {
      if (server === SongUnlockServer.NETEASE) {
        await sleep(30);
        return { ok: false, server, durationMs: 30, reason: "网易云失败" };
      }
      if (server === SongUnlockServer.BODIAN) {
        await sleep(10);
        return { ok: false, server, durationMs: 10, reason: "波点失败" };
      }
      await sleep(20);
      return { ok: false, server, durationMs: 20, reason: "酷我失败" };
    });

    assert.equal(result.winner, undefined, "全败时不应有胜者");
    assert.equal(result.failures.length, 3, "失败列表长度应与传入源数量一致");
    assert.deepEqual(result.failures, [
      { server: SongUnlockServer.NETEASE, reason: "网易云失败" },
      { server: SongUnlockServer.BODIAN, reason: "波点失败" },
      { server: SongUnlockServer.KUWO, reason: "酷我失败" },
    ]);
  });

  it("servers 为空数组：立即返回、attempt 从未被调用", async () => {
    let callCount = 0;
    const result = await raceUnlockSources([], async (server) => {
      callCount++;
      return {
        ok: false,
        server,
        durationMs: 0,
        reason: "不应被调用",
      };
    });

    assert.equal(callCount, 0, "attempt 函数不应被调用");
    assert.equal(result.winner, undefined);
    assert.deepEqual(result.failures, []);
  });

  it("attempt 意外 reject（违反契约时）：被兜底归一为失败，不产生 unhandled rejection，其余源仍可取胜", async () => {
    const servers = [SongUnlockServer.NETEASE, SongUnlockServer.BODIAN] as const;

    const result = await raceUnlockSources(servers, async (server) => {
      if (server === SongUnlockServer.NETEASE) {
        await sleep(10);
        throw new Error("意外网络崩溃");
      }
      await sleep(25);
      return {
        ok: true,
        server,
        durationMs: 25,
        value: "正常次源直链",
      };
    });

    assert.ok(result.winner, "其余源仍应可以取胜");
    assert.equal(result.winner.server, SongUnlockServer.BODIAN);
    assert.equal(result.winner.value, "正常次源直链");

    // 全抛错场景兜底原因归一化
    const allRejectResult = await raceUnlockSources(servers, async () => {
      await sleep(10);
      throw new Error("全部异常");
    });

    assert.equal(allRejectResult.winner, undefined);
    assert.deepEqual(allRejectResult.failures, [
      { server: SongUnlockServer.NETEASE, reason: "请求异常" },
      { server: SongUnlockServer.BODIAN, reason: "请求异常" },
    ]);
  });

  it("attempt 的调用次序等于传入数组次序", async () => {
    const servers = [
      SongUnlockServer.FISH,
      SongUnlockServer.CHANGQING,
      SongUnlockServer.MIGU,
      SongUnlockServer.KUWO,
    ] as const;

    const callOrder: SongUnlockServer[] = [];
    await raceUnlockSources(servers, async (server) => {
      callOrder.push(server);
      return {
        ok: false,
        server,
        durationMs: 0,
        reason: "测试次序",
      };
    });

    assert.deepEqual(callOrder, [
      SongUnlockServer.FISH,
      SongUnlockServer.CHANGQING,
      SongUnlockServer.MIGU,
      SongUnlockServer.KUWO,
    ]);
  });
});
