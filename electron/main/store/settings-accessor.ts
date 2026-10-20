import type Store from "electron-store";
import { useStore, type StoreType } from "./index";

let instance: Store<StoreType> | null = null;

/**
 * 获取进程内单例 Store
 * @returns Store 实例
 */
const getStore = (): Store<StoreType> => {
  if (!instance) instance = useStore();
  return instance;
};

/**
 * 点路径配置读取器
 *
 * 上游音源模块（酷狗等）以 `store.get("a.b.c")` 形式读取配置，
 * 此处对齐该接口，底层复用 3.x 的 electron-store。
 */
export const store = {
  /**
   * 按点路径读取配置项
   * @param key 点路径，如 `system.kugouLoginVersion`
   * @param fallback 缺省值
   * @returns 配置值，未配置时返回 fallback
   */
  get<T = unknown>(key: string, fallback?: T): T | undefined {
    return getStore().get(key, fallback) as T | undefined;
  },
};
