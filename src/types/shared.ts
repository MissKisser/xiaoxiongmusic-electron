/**
 * @fileoverview 所有主进程和渲染进程都需要用到的、且不依赖其他文件的类型定义
 */

/**
 * 循环模式
 *
 * off: 不循环 | list: 列表循环 | one: 单曲循环
 */
export type RepeatModeType = "off" | "list" | "one";

/**
 * 随机模式
 *
 * off: 关闭 | on: 随机播放 | heartbeat: 心动模式
 */
export type ShuffleModeType = "off" | "on" | "heartbeat";

/**
 * 用于 "play-mode-change" 事件的负载结构
 */
export interface PlayModePayload {
  repeatMode: RepeatModeType;
  shuffleMode: ShuffleModeType;
}

// Based on SPlayer-Next

/**
 * 环境信息（主进程提供，用于设置面板「环境信息」展示）
 */
export interface EnvironmentInfo {
  /** 应用版本 */
  appVersion: string;
  /** 应用名称 */
  appName: string;
  /** 平台（win32 / darwin / linux 等） */
  platform: string;
  /** CPU 架构（x64 / arm64 等） */
  arch: string;
  /** 操作系统类型 */
  osType: string;
  /** 操作系统版本 */
  osRelease: string;
  /** Electron 版本 */
  electronVersion: string;
  /** Chromium 版本 */
  chromeVersion: string;
  /** Node.js 版本 */
  nodeVersion: string;
  /** V8 版本 */
  v8Version: string;
  /** 应用数据目录磁盘占用（字节） */
  diskUsage: number;
  /** 缓存大小（字节） */
  cacheSize: number;
}

/**
 * WebDAV 远程歌单配置（创建远程歌单时由渲染进程提交给主进程）
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 */
export interface WebDavPlaylistInput {
  /** WebDAV 服务地址，如 https://dav.example.com */
  url: string;
  /** WebDAV 用户名 */
  username: string;
  /** WebDAV 密码（由主进程加密存储，不落盘明文） */
  password: string;
  /** WebDAV 挂载目录，如 /music */
  rootPath: string;
  /** WebDAV 扫描深度（0-10） */
  scanDepth: number;
}

export { DEFAULT_TASKBAR_CONFIG, TASKBAR_IPC_CHANNELS } from "./shared/taskbar-ipc";
export type {
  SyncStatePayload,
  SyncTickPayload,
  TaskbarConfig,
} from "./shared/taskbar-ipc";
