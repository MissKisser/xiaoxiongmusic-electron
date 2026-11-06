/**
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * Source: splayer-next-upstream @ f6bcdba (feat: 新增外部 API 局域网开关与任务栏歌词边距设置)
 *         electron/main/server/index.ts (外部 API 局域网开关)
 */
import axios, { AxiosInstance, AxiosRequestConfig, AxiosError, AxiosResponse } from "axios";
import { isDev } from "./env";
import { useSettingStore } from "@/stores";
import { getCookie } from "./cookie";
import { isLogin } from "./auth";
import axiosRetry from "axios-retry";

// 全局地址，避免遇到 VITE_API_URL 为 undefined 时变成字符串 "undefined" 的问题
const baseURL: string = isDev ? "/api/netease" : (import.meta.env["VITE_API_URL"] || "/api/netease");

/**
 * 主进程本地服务专属路由前缀
 *
 * 这些路由只存在于应用内嵌的本地服务器（解锁等），外部 API 地址不可能提供，
 * 开启外部 API 时不得改发，否则本地能力会被整体转发到外部地址而全部失败。
 */
const LOCAL_ONLY_BASE_PREFIXES = ["/api/unblock"];

/**
 * 判断请求是否指向主进程本地服务专属路由
 * @param baseURL 请求的 baseURL
 * @returns 命中本地专属前缀时返回 true
 */
const isLocalOnlyBase = (baseURL?: string): boolean =>
  LOCAL_ONLY_BASE_PREFIXES.some((prefix) => baseURL?.startsWith(prefix) ?? false);

// 基础配置
const server: AxiosInstance = axios.create({
  baseURL,
  // 允许跨域
  withCredentials: true,
  // 超时时间
  timeout: 15000,
});

// 请求重试
axiosRetry(server, {
  // 重试次数
  retries: 3,
});

// 请求拦截器
server.interceptors.request.use(
  (request) => {
    // pinia
    const settingStore = useSettingStore();
    if (!request.params) request.params = {};
    // 自定义外部 API baseURL（局域网开关）
    // 本地专属路由（解锁等）豁免改发：解锁能力只存在于应用内嵌服务器，必须保持本地
    if (
      settingStore.enableCustomApi &&
      settingStore.customApiBaseUrl &&
      !isLocalOnlyBase(request.baseURL)
    ) {
      request.baseURL = settingStore.customApiBaseUrl.replace(/\/+$/, "");
    }
    // Cookie
    if (!request.params.noCookie && (isLogin() || getCookie("MUSIC_U") !== null)) {
      const cookie = `MUSIC_U=${getCookie("MUSIC_U")};`;
      request.params.cookie = cookie;
    }
    // 自定义 realIP
    if (settingStore.useRealIP) {
      if (settingStore.realIP) {
        request.params.realIP = settingStore.realIP;
      } else {
        request.params.randomCNIP = true;
      }
    }
    // proxy
    if (settingStore.proxyProtocol !== "off") {
      const protocol = settingStore.proxyProtocol.toLowerCase();
      const server = settingStore.proxyServe;
      const port = settingStore.proxyPort;
      const proxy = `${protocol}://${server}:${port}`;
      if (proxy) request.params.proxy = proxy;
    }
    // 发送请求
    return request;
  },
  (error: AxiosError) => {
    console.error("请求发送失败：", error);
    return Promise.reject(error);
  },
);

// 响应拦截器
server.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    const { response } = error;
    // 状态码处理
    switch (response?.status) {
      case 400:
        console.error("客户端错误：", response.status, response.statusText);
        // 执行客户端错误的处理逻辑
        break;
      case 401:
        console.error("未授权：", response.status, response.statusText);
        // 执行未授权的处理逻辑
        break;
      case 403:
        console.error("禁止访问：", response.status, response.statusText);
        // 执行禁止访问的处理逻辑
        break;
      case 404:
        console.error("未找到资源：", response.status, response.statusText);
        // 执行未找到资源的处理逻辑
        break;
      case 500:
        console.error("服务器错误：", response.status, response.statusText);
        // 执行服务器错误的处理逻辑
        break;
      default:
        // 处理其他状态码或错误条件
        console.error("未处理的错误：", error.message);
    }
    // 返回错误
    return Promise.reject(error);
  },
);

// 请求
const request = async <T = any>(config: AxiosRequestConfig): Promise<T> => {
  // 返回请求数据
  const { data } = await server.request(config);
  return data as T;
};

export default request;
