/**
 * 平台热搜分派与缓存回归测试
 *
 * 覆盖：
 * - 酷狗平台热搜分派：模块名路由、参数传递（默认 20 条）、字段归一化与 score 缺省断言
 * - QQ 音乐 / 网易云热搜回归：保留 score 热度数字段
 * - 酷狗空列表降级：空列表返回空数组
 * - 缓存跳过空结果（skipEmpty）：空结果不写缓存、空缓存视为失效并重新拉取
 */

import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve as pathResolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { InternalAxiosRequestConfig } from "axios";

// 注入测试环境全局对象，模拟浏览器基础 API
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
  key: () => null,
};

const testDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = pathResolve(testDir, "..");
const srcDir = pathResolve(repoRoot, "src");

// 存根模块：隔离渲染端 UI / 路由依赖，保证在纯 Node 环境可测
const storesStubSource = `
const dummy = () => ({ proxyProtocol: "off" });
export const useShortcutStore = dummy;
export const useSettingStore = () => ({ proxyProtocol: "off", enableCustomApi: false, useRealIP: false });
export const useStatusStore = dummy;
export const useMusicStore = dummy;
export const useDataStore = () => ({ userData: { name: '' } });
export const useLocalStore = dummy;
export const useStreamingStore = dummy;
export const useAuthStore = dummy;
export const usePlatformStore = () => ({ platformProfiles: {} });
export const PLATFORM_META = {};
export const onPlatformChange = () => () => {};
export const onAccountChange = () => () => {};
`;

const requestStubSource = `
let mockHandler = async () => ({
  data: [{ searchWord: "网易热搜关键词", score: 88480, content: "网易热搜描述" }]
});
const request = async (config) => mockHandler(config);
request.setMockHandler = (fn) => { mockHandler = fn; };
export default request;
`;

const hookCode = `
import { pathToFileURL } from "node:url";
import { resolve as pathResolve } from "node:path";
import { existsSync, statSync } from "node:fs";

const SRC_DIR = ${JSON.stringify(srcDir)};

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const target = pathResolve(SRC_DIR, rel);
    if (existsSync(target + ".ts")) {
      return nextResolve(pathToFileURL(target + ".ts").href, context);
    }
    if (existsSync(target + ".js")) {
      return nextResolve(pathToFileURL(target + ".js").href, context);
    }
    if (existsSync(target) && statSync(target).isDirectory()) {
      if (existsSync(pathResolve(target, "index.ts"))) {
        return nextResolve(pathToFileURL(pathResolve(target, "index.ts")).href, context);
      }
    }
    return nextResolve(pathToFileURL(target).href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".vue")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default {};",
    };
  }
  if (url.includes("src/router")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default { push: () => {}, replace: () => {} };",
    };
  }
  if (
    url.includes("src/stores/index.ts") ||
    url.includes("src/stores/data.ts") ||
    url.includes("src/stores/platform.ts")
  ) {
    return {
      format: "module",
      shortCircuit: true,
      source: ${JSON.stringify(storesStubSource)},
    };
  }
  if (url.includes("src/utils/request.ts")) {
    return {
      format: "module",
      shortCircuit: true,
      source: ${JSON.stringify(requestStubSource)},
    };
  }
  if (url.includes("src/utils/format.ts")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export const formatArtistsList = () => []; export const formatCommentList = () => []; export const formatCoverList = () => []; export const formatSongsList = () => [];",
    };
  }
  if (url.includes("src/utils/env.ts")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export const isDev = true; export const isDevBuild = false; export const isWin = true; export const isMac = false; export const isLinux = false; export const isElectron = true; export const isMobile = false;",
    };
  }
  return nextLoad(url, context);
}
`;

register(`data:text/javascript;base64,${Buffer.from(hookCode).toString("base64")}`);

const { getPlatformInstance } = await import("../src/api/platform/http");
const { dispatchHotSearch } = await import("../src/api/platform/dispatch");
const { getCacheData } = await import("../src/utils/cache");

describe("平台热搜分派逻辑", () => {
  it("酷狗热搜分派：路由到 hot_search 模块，参数带默认条数 20，条目不含 score", async () => {
    const kgInstance = getPlatformInstance("kugou");
    let interceptedConfig: InternalAxiosRequestConfig | null = null;

    kgInstance.defaults.adapter = async (config) => {
      interceptedConfig = config;
      return {
        data: {
          code: 200,
          total: 2,
          list: [
            { rank: 1, keyword: "说好再见却再也不见", description: "" },
            { rank: 2, keyword: "我好像在哪见过你", description: "" },
          ],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    const result = await dispatchHotSearch("kugou");

    // 验证请求路由与默认参数
    assert.ok(interceptedConfig);
    assert.equal(interceptedConfig.url, "/hot_search");
    assert.deepEqual(interceptedConfig.params, { limit: 20 });

    // 验证返回条数与字段归一化
    assert.equal(result.length, 2);
    assert.equal(result[0].searchWord, "说好再见却再也不见");
    assert.equal(result[0].content, "");
    assert.equal(result[1].searchWord, "我好像在哪见过你");

    // 酷狗不造假热度分，score 必须缺省为 undefined
    assert.equal(result[0].score, undefined);
    assert.equal(result[1].score, undefined);
    assert.equal("score" in result[0], false);
  });

  it("酷狗热搜空列表降级：主进程返回空列表时分派结果为空数组", async () => {
    const kgInstance = getPlatformInstance("kugou");

    kgInstance.defaults.adapter = async (config) => {
      return {
        data: {
          code: 200,
          total: 0,
          list: [],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    const result = await dispatchHotSearch("kugou");
    assert.deepEqual(result, []);
  });

  it("QQ 音乐 / 网易云回归保护：原有平台仍保留 score 热度数字", async () => {
    // QQ 音乐分支保护
    const qqInstance = getPlatformInstance("qqmusic");
    qqInstance.defaults.adapter = async (config) => {
      return {
        data: {
          code: 200,
          total: 1,
          list: [{ rank: 1, keyword: "QQ热搜关键词", score: 95270, description: "QQ热搜描述" }],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    const qqResult = await dispatchHotSearch("qqmusic");
    assert.equal(qqResult.length, 1);
    assert.equal(qqResult[0].searchWord, "QQ热搜关键词");
    assert.equal(qqResult[0].content, "QQ热搜描述");
    assert.equal(typeof qqResult[0].score, "number");
    assert.equal(qqResult[0].score, 95270);

    // 网易云分支保护
    const neteaseResult = await dispatchHotSearch("netease");
    assert.equal(neteaseResult.length, 1);
    assert.equal(neteaseResult[0].searchWord, "网易热搜关键词");
    assert.equal(neteaseResult[0].content, "网易热搜描述");
    assert.equal(typeof neteaseResult[0].score, "number");
    assert.equal(neteaseResult[0].score, 88480);
  });
});

describe("缓存 skipEmpty 选项语义", () => {
  it("skipEmpty 为 true 时空数组结果不写回缓存，且命中空缓存视为失效重新请求", async () => {
    const memoryStorage = new Map<string, string>();
    const fakeSessionStorage = {
      getItem: (key: string) => memoryStorage.get(key) ?? null,
      setItem: (key: string, value: string) => memoryStorage.set(key, value),
      removeItem: (key: string) => memoryStorage.delete(key),
      clear: () => memoryStorage.clear(),
      length: 0,
      key: () => null,
    };

    globalThis.window = {
      sessionStorage: fakeSessionStorage,
      localStorage: fakeSessionStorage,
    } as unknown as Window & typeof globalThis;

    // 断言 1：请求返回空数组，开启 skipEmpty 时不写入缓存
    let fetchCount1 = 0;
    const fetcher1 = async () => {
      fetchCount1++;
      return [];
    };

    const result1 = await getCacheData(fetcher1, {
      key: "test-hot-search-empty",
      time: 10,
      skipEmpty: true,
    });

    assert.deepEqual(result1, []);
    assert.equal(fetchCount1, 1);
    assert.equal(memoryStorage.has("test-hot-search-empty"), false);

    // 断言 2：缓存中预置旧的空数组，开启 skipEmpty 时视为失效重新发起请求
    memoryStorage.set(
      "test-hot-search-stale",
      JSON.stringify({ value: [], expiry: Date.now() + 600000 }),
    );

    let fetchCount2 = 0;
    const fetcher2 = async () => {
      fetchCount2++;
      return [{ searchWord: "实时热搜", content: "" }];
    };

    const result2 = await getCacheData(fetcher2, {
      key: "test-hot-search-stale",
      time: 10,
      skipEmpty: true,
    });

    assert.equal(fetchCount2, 1);
    assert.deepEqual(result2, [{ searchWord: "实时热搜", content: "" }]);

    // 断言 3：默认 skipEmpty: false 时，空数组正常缓存（保护既有调用方行为）
    let fetchCount3 = 0;
    const fetcher3 = async () => {
      fetchCount3++;
      return [];
    };

    const result3 = await getCacheData(fetcher3, {
      key: "test-default-empty",
      time: 10,
    });

    assert.deepEqual(result3, []);
    assert.equal(fetchCount3, 1);
    assert.equal(memoryStorage.has("test-default-empty"), true);
  });
});
