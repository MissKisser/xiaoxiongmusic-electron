/**
 * 登录态失效信号在主进程与渲染端之间的传递
 *
 * 覆盖：结构化错误 → IPC 失败分类 → 渲染端异常类型
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { QQMusicApiError } from "../electron/main/apis/qqmusic/core/auth";
import { KugouApiError } from "../electron/main/apis/kugou/core/auth";
import { toPlatformErrorResponse } from "../electron/main/ipc/platform-error";
import { PlatformAuthExpiredError } from "../src/api/platform/music";

describe("结构化错误 → IPC 失败分类", () => {
  it("凭据失效映射为 AUTH_EXPIRED 并带上业务码", () => {
    const res = toPlatformErrorResponse(
      new QQMusicApiError({
        outer: 0,
        inner: 1000,
        module: "music.UserInfo.userInfoServer",
        method: "GetLoginUserInfo",
        authExpired: true,
      }),
    );
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "AUTH_EXPIRED");
    assert.equal(res.outer, 0);
    assert.equal(res.inner, 1000);
  });

  it("非鉴权的业务拒绝映射为 BUSINESS_ERROR", () => {
    const res = toPlatformErrorResponse(
      new QQMusicApiError({
        outer: 0,
        inner: 500003,
        module: "music.asset.MusicAsset",
        method: "QueryQQMusicAsset",
        authExpired: false,
      }),
    );
    assert.equal(res.errorCode, "BUSINESS_ERROR");
  });

  it("酷狗业务错误映射为 AUTH_EXPIRED 并带上业务码", () => {
    const res = toPlatformErrorResponse(new KugouApiError(2003, "token invalid"));
    assert.equal(res.errorCode, "AUTH_EXPIRED");
    assert.equal(res.inner, 2003);
  });

  it("网络故障映射为 UNKNOWN，不触发登出", () => {
    const res = toPlatformErrorResponse(new Error("fetch failed"));
    assert.equal(res.errorCode, "UNKNOWN");
    assert.equal(res.error, "fetch failed");
  });
});

describe("渲染端异常类型", () => {
  it("保留平台与业务码，便于界面区分提示", () => {
    const error = new PlatformAuthExpiredError("qqmusic", "登录已过期", 0, 1000);
    assert.equal(error.platform, "qqmusic");
    assert.equal(error.outer, 0);
    assert.equal(error.inner, 1000);
    assert.ok(error instanceof Error);
  });
});
