/**
 * 平台数据面 HTTP 工厂
 *
 * 与网易云的 `src/utils/request.ts` 完全同构：同一套 axios 口径，
 * 只是基址换成平台路由段（路径段即模块名）。
 *
 * 与网易云请求的两点刻意差异：
 * - **不注入 `MUSIC_U` cookie**：第三方平台的凭据由主进程持有，
 *   渲染端只发无凭据的只读请求，账号态接口由主进程模块自行补齐；
 * - **不注入代理 / realIP 参数**：这两项只对网易云后端链路有意义。
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRetry from "axios-retry";
import type { ApiPlatform } from "@/types/shared";

/** 平台路由段（与内嵌 Fastify 服务同源，相对地址即可命中） */
const PLATFORM_BASE_URL: Record<ApiPlatform, string> = {
  netease: "/api/netease",
  qqmusic: "/api/qqmusic",
  kugou: "/api/kugou",
};

/** 请求超时时间（毫秒），对齐网易云口径 */
const TIMEOUT = 15000;

/** 失败重试次数 */
const RETRIES = 3;

/** 平台请求实例缓存 */
const instances = new Map<ApiPlatform, AxiosInstance>();

/**
 * 获取指定平台的 axios 实例
 * @param platform 音源平台
 * @returns axios 实例
 */
export const getPlatformInstance = (platform: ApiPlatform): AxiosInstance => {
  const cached = instances.get(platform);
  if (cached) return cached;

  const instance = axios.create({
    baseURL: PLATFORM_BASE_URL[platform],
    withCredentials: true,
    timeout: TIMEOUT,
  });

  // 请求重试（与网易云口径一致）
  axiosRetry(instance, { retries: RETRIES });

  instances.set(platform, instance);
  return instance;
};

/**
 * 发起平台数据面请求
 *
 * 调用方只需给出模块名与业务参数，路径形如 `/api/qqmusic/search`。
 * @param platform 音源平台
 * @param moduleName 模块名（与主进程模块注册表同名）
 * @param params 业务参数
 * @param config 额外请求配置
 * @returns 模块返回的业务数据
 */
export const platformRequest = async <T = unknown>(
  platform: ApiPlatform,
  moduleName: string,
  params: Record<string, unknown> = {},
  config: AxiosRequestConfig = {},
): Promise<T> => {
  const instance = getPlatformInstance(platform);
  const { data } = await instance.request<T>({
    url: `/${moduleName}`,
    params,
    ...config,
  });
  return data;
};

/**
 * 发起平台数据面请求并取回业务体
 *
 * 平台模块的业务失败（付费、无授权、上游凭证异常）用非 2xx 状态码表达，
 * 判据（`reason` / `status` / `privilege`）都放在响应体里。
 * 这里把失败响应体取回来交给调用方翻译，只有请求本身失败（网络异常、
 * 响应体缺失）才继续向上抛。
 * @param platform 音源平台
 * @param moduleName 模块名（与主进程模块注册表同名）
 * @param params 业务参数
 * @param config 额外请求配置
 * @returns 模块返回的业务数据
 */
export const platformRequestBody = async <T = unknown>(
  platform: ApiPlatform,
  moduleName: string,
  params: Record<string, unknown> = {},
  config: AxiosRequestConfig = {},
): Promise<T> => {
  try {
    return await platformRequest<T>(platform, moduleName, params, config);
  } catch (error) {
    const response = (error as AxiosError<T>)?.response;
    if (response?.data) return response.data;
    throw error;
  }
};

/**
 * 发起平台数据面写操作请求
 *
 * 写操作的参数含数组与对象（如加歌的 `songs`），
 * 走 query 会被序列化破坏结构，故统一用 POST + JSON body。
 *
 * 业务结果在响应体里，HTTP 状态只是业务码的镜像，
 * 因此这里不按状态码抛异常，由调用方按响应体判断成败；
 * 同时关掉自动重试，避免写操作被重复投递。
 * @param platform 音源平台
 * @param moduleName 模块名（与主进程模块注册表同名）
 * @param params 业务参数
 * @returns 模块返回的业务数据
 */
export const platformWriteRequest = async <T = unknown>(
  platform: ApiPlatform,
  moduleName: string,
  params: Record<string, unknown> = {},
): Promise<T> => {
  const instance = getPlatformInstance(platform);
  const { data } = await instance.request<T>({
    url: `/${moduleName}`,
    method: "POST",
    data: params,
    validateStatus: () => true,
    "axios-retry": { retries: 0 },
  });
  return data;
};
