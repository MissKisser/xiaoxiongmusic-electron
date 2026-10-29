/**
 * 换源音源清单的规整（老配置迁移）
 *
 * 覆盖三块判据：
 * - 新增音源补齐：老配置里没有落雪音源时，按默认开关状态补进来并默认启用
 * - 既有开关保持：其余音源的开关状态一律保持原样，用户手工关掉的源不被重置
 * - 失效键剔除：已下线的音源键不参与渲染，也不进配置面板
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SongUnlockServer } from "../src/types/shared";
import {
  SONG_UNLOCK_SOURCE_DEFAULTS,
  createDefaultSongUnlockSources,
  normalizeSongUnlockSources,
} from "../src/utils/songUnlockSources";

describe("换源音源清单规整", () => {
  it("老配置（无落雪音源）补齐后新源默认启用", () => {
    const oldConfig = [
      { key: SongUnlockServer.BODIAN, enabled: true },
      { key: SongUnlockServer.NETEASE, enabled: true },
      { key: SongUnlockServer.KUWO, enabled: false },
      { key: SongUnlockServer.MIGU, enabled: true },
      { key: SongUnlockServer.CHANGQING, enabled: true },
    ];
    const normalized = normalizeSongUnlockSources(oldConfig);
    const lxmusic = normalized.find((item) => item.key === SongUnlockServer.LXMUSIC);
    assert.ok(lxmusic, "落雪音源应被补齐");
    assert.equal(lxmusic.enabled, true, "落雪音源应默认启用");
    const xinghai = normalized.find((item) => item.key === SongUnlockServer.XINGHAI);
    assert.ok(xinghai, "星海音源应被补齐");
    assert.equal(xinghai.enabled, true, "星海音源应默认启用");
  });

  it("补齐落雪、星海与歌曲宝音源时其余源的开关状态保持原样", () => {
    const oldConfig = [
      { key: SongUnlockServer.BODIAN, enabled: false },
      { key: SongUnlockServer.NETEASE, enabled: true },
      { key: SongUnlockServer.KUWO, enabled: false },
      { key: SongUnlockServer.MIGU, enabled: false },
      { key: SongUnlockServer.CHANGQING, enabled: true },
    ];
    const normalized = normalizeSongUnlockSources(oldConfig);
    const stateOf = (key: SongUnlockServer) =>
      normalized.find((item) => item.key === key)?.enabled;
    assert.equal(stateOf(SongUnlockServer.BODIAN), false, "波点应保持关闭");
    assert.equal(stateOf(SongUnlockServer.NETEASE), true, "网易云应保持开启");
    assert.equal(stateOf(SongUnlockServer.KUWO), false, "酷我应保持关闭");
    assert.equal(stateOf(SongUnlockServer.MIGU), false, "咪咕应保持关闭");
    assert.equal(stateOf(SongUnlockServer.CHANGQING), true, "长青应保持开启");
    assert.equal(stateOf(SongUnlockServer.LXMUSIC), true, "落雪应默认启用");
    assert.equal(stateOf(SongUnlockServer.XINGHAI), true, "星海应默认启用");
    assert.equal(stateOf(SongUnlockServer.GEQUBAO), true, "歌曲宝应默认启用");
    assert.equal(normalized.length, 8, "补齐后应恰好八项");
  });

  it("已下线的音源键被剔除，其余条目不受影响", () => {
    const normalized = normalizeSongUnlockSources([
      { key: "retired-source", enabled: true },
      { key: SongUnlockServer.BODIAN, enabled: true },
    ]);
    assert.equal(
      normalized.some((item) => (item.key as string) === "retired-source"),
      false,
      "已下线的音源键不应残留",
    );
    assert.equal(normalized.length, 8, "补齐后应恰好八项");
  });

  it("开关字段缺失时按默认清单补齐", () => {
    const normalized = normalizeSongUnlockSources([
      { key: SongUnlockServer.KUWO },
      { key: SongUnlockServer.LXMUSIC },
      { key: SongUnlockServer.XINGHAI },
    ]);
    const kuwo = normalized.find((item) => item.key === SongUnlockServer.KUWO);
    const lxmusic = normalized.find((item) => item.key === SongUnlockServer.LXMUSIC);
    const xinghai = normalized.find((item) => item.key === SongUnlockServer.XINGHAI);
    assert.equal(kuwo?.enabled, false, "酷我默认关闭");
    assert.equal(lxmusic?.enabled, true, "落雪默认启用");
    assert.equal(xinghai?.enabled, true, "星海默认启用");
  });

  it("重复键只保留首次出现的那一条", () => {
    const normalized = normalizeSongUnlockSources([
      { key: SongUnlockServer.BODIAN, enabled: false },
      { key: SongUnlockServer.BODIAN, enabled: true },
    ]);
    const bodian = normalized.filter((item) => item.key === SongUnlockServer.BODIAN);
    assert.equal(bodian.length, 1, "重复键应去重");
    assert.equal(bodian[0].enabled, false, "保留首次出现的开关状态");
  });

  it("既有条目的相对顺序保持不变，新增音源接在末尾", () => {
    const normalized = normalizeSongUnlockSources([
      { key: SongUnlockServer.CHANGQING, enabled: true },
      { key: SongUnlockServer.BODIAN, enabled: true },
    ]);
    assert.equal(normalized[0].key, SongUnlockServer.CHANGQING);
    assert.equal(normalized[1].key, SongUnlockServer.BODIAN);
    assert.equal(normalized[normalized.length - 3].key, SongUnlockServer.LXMUSIC);
    assert.equal(normalized[normalized.length - 2].key, SongUnlockServer.XINGHAI);
    assert.equal(normalized[normalized.length - 1].key, SongUnlockServer.GEQUBAO);
  });

  it("默认清单含落雪、星海与歌曲宝音源且默认启用", () => {
    const defaults = createDefaultSongUnlockSources();
    assert.equal(defaults.length, SONG_UNLOCK_SOURCE_DEFAULTS.length);
    const lxmusic = defaults.find((item) => item.key === SongUnlockServer.LXMUSIC);
    assert.ok(lxmusic, "默认清单应含落雪音源");
    assert.equal(lxmusic.enabled, true, "落雪音源默认启用");
    const xinghai = defaults.find((item) => item.key === SongUnlockServer.XINGHAI);
    assert.ok(xinghai, "默认清单应含星海音源");
    assert.equal(xinghai.enabled, true, "星海音源默认启用");
    const gequbao = defaults.find((item) => item.key === SongUnlockServer.GEQUBAO);
    assert.ok(gequbao, "默认清单应含歌曲宝音源");
    assert.equal(gequbao.enabled, true, "歌曲宝音源默认启用");
    assert.notEqual(defaults, SONG_UNLOCK_SOURCE_DEFAULTS, "默认清单应返回独立副本");
  });

  it("空配置与非法配置按默认清单补齐", () => {
    for (const input of [undefined, [], [null as unknown as { key: string }]]) {
      const normalized = normalizeSongUnlockSources(input);
      assert.equal(normalized.length, 8);
      assert.equal(
        normalized.find((item) => item.key === SongUnlockServer.LXMUSIC)?.enabled,
        true,
      );
      assert.equal(
        normalized.find((item) => item.key === SongUnlockServer.XINGHAI)?.enabled,
        true,
      );
      assert.equal(
        normalized.find((item) => item.key === SongUnlockServer.GEQUBAO)?.enabled,
        true,
      );
    }
  });
});
