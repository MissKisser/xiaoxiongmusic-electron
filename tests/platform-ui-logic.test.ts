/**
 * 平台账号菜单的登录入口分发
 *
 * 覆盖：平台账号列表构建 → 条目点击动作分发；
 * 核心护栏：未登录网易云时，第三方平台（QQ / 酷狗）的登录入口
 * 必须独立放行，严禁被拦截或导流至网易云登录。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildPlatformListItems,
  resolvePlatformSelectAction,
  PLATFORM_META,
} from "../src/api/platform/capability";

describe("平台账号列表与登录动作分发", () => {
  it("未登录任何平台时独立放行第三方平台登录", () => {
    // 场景 1：全新冷启动状态，未登录任何平台账号（网易云未登录，QQ/酷狗无凭据）
    const freshList = buildPlatformListItems("netease", { loggedIn: false }, {});
    assert.equal(freshList.length, 3);
    const [neteaseItem, qqItem, kugouItem] = freshList;

    // 初始状态：网易云处于激活但未登录，第三方平台未激活且未登录
    assert.equal(neteaseItem.platform, "netease");
    assert.equal(neteaseItem.name, PLATFORM_META.netease.name);
    assert.equal(neteaseItem.active, true);
    assert.equal(neteaseItem.loggedIn, false);

    assert.equal(qqItem.platform, "qqmusic");
    assert.equal(qqItem.name, PLATFORM_META.qqmusic.name);
    assert.equal(qqItem.active, false);
    assert.equal(qqItem.loggedIn, false);

    assert.equal(kugouItem.platform, "kugou");
    assert.equal(kugouItem.name, PLATFORM_META.kugou.name);
    assert.equal(kugouItem.active, false);
    assert.equal(kugouItem.loggedIn, false);

    // 未登录网易云时，点击 QQ 音乐或酷狗音乐必须分发至对应平台自身的登录弹窗
    assert.deepEqual(resolvePlatformSelectAction(qqItem), {
      type: "login-platform",
      platform: "qqmusic",
    });
    assert.deepEqual(resolvePlatformSelectAction(kugouItem), {
      type: "login-platform",
      platform: "kugou",
    });
    assert.deepEqual(resolvePlatformSelectAction(neteaseItem), {
      type: "login-netease",
    });
  });

  it("网易云未登录但第三方平台已登录时仍可独立操作", () => {
    // 场景 2：网易云未登录，但 QQ 音乐已登录并处于激活状态
    const qqLoggedInList = buildPlatformListItems(
      "qqmusic",
      { loggedIn: false },
      {
        qqmusic: {
          nickname: "QQ听众",
          userId: "10001",
          avatarUrl: "https://example.com/avatar.jpg",
        },
      },
    );
    const activeQqItem = qqLoggedInList.find((i) => i.platform === "qqmusic");
    const unloggedNeteaseItem = qqLoggedInList.find((i) => i.platform === "netease");

    // 点击已登录平台执行平台切换
    assert.ok(activeQqItem);
    assert.equal(activeQqItem.active, true);
    assert.equal(activeQqItem.loggedIn, true);
    assert.equal(activeQqItem.nickname, "QQ听众");
    assert.equal(activeQqItem.avatarUrl, "https://example.com/avatar.jpg");
    assert.deepEqual(resolvePlatformSelectAction(activeQqItem), {
      type: "switch-platform",
      platform: "qqmusic",
    });

    // 在 QQ 音乐激活下点击未登录的网易云，仍然能够拉起网易云登录
    assert.ok(unloggedNeteaseItem);
    assert.equal(unloggedNeteaseItem.loggedIn, false);
    assert.deepEqual(resolvePlatformSelectAction(unloggedNeteaseItem), {
      type: "login-netease",
    });
  });

  it("上游昵称为空白串时回退到用户 ID 再回退到平台名", () => {
    const list = buildPlatformListItems(
      "kugou",
      { loggedIn: true },
      {
        qqmusic: { nickname: "   ", userId: 20002, avatarUrl: "" },
        kugou: { nickname: "", userId: "", avatarUrl: "" },
      },
    );
    const qqItem = list.find((i) => i.platform === "qqmusic");
    const kugouItem = list.find((i) => i.platform === "kugou");
    const neteaseItem = list.find((i) => i.platform === "netease");

    // QQ 昵称为空白串：回退到用户 ID
    assert.equal(qqItem?.nickname, "20002");
    // 酷狗昵称与用户 ID 均为空串：回退到平台名
    assert.equal(kugouItem?.nickname, PLATFORM_META.kugou.name);
    // 网易云昵称缺失：回退到「未知用户名」
    assert.equal(neteaseItem?.nickname, "未知用户名");
  });
});
