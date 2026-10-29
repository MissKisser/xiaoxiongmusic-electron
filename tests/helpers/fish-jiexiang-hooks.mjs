/**
 * 模块解析钩子：把 Electron 主进程依赖与 axios 换成本地桩件
 *
 * 目的：在纯 Node 环境下直跑
 * `electron/server/unblock/fish.ts` 与 `jiexiang.ts` 的取链判定、熔断与放行校验逻辑。
 */
const STUB_URL = new URL("./fish-jiexiang-stubs.mjs", import.meta.url).href;

/** 需要替换的依赖 */
const REPLACED = new Map([
  ["axios", STUB_URL],
  ["main/logger", STUB_URL],
  ["main/apis/qqmusic", STUB_URL],
]);

export async function resolve(specifier, context, nextResolve) {
  for (const [suffix, url] of REPLACED) {
    if (suffix === "axios") {
      if (specifier === "axios") {
        return { url, shortCircuit: true, format: "module" };
      }
      continue;
    }
    if (specifier.replace(/\\/g, "/").endsWith(suffix)) {
      return { url, shortCircuit: true, format: "module" };
    }
  }
  return nextResolve(specifier, context);
}
