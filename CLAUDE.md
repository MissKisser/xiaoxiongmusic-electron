# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

小熊音乐 (SPlayer) - 一个简约的音乐播放器，基于 Vue 3 + TypeScript + Naive UI + Electron 开发，同时支持 Web 端和桌面客户端。

## 常用开发命令

```bash
# 开发
pnpm dev              # 启动 Electron 开发模式（包含热重载）
pnpm docs:dev         # 启动 VitePress 文档服务器

# 构建
pnpm build            # 构建生产包（包含类型检查）
pnpm build:win        # 构建 Windows 客户端 (x64/arm64)
pnpm build:mac        # 构建 macOS 客户端
pnpm build:linux      # 构建 Linux 客户端
pnpm build:native     # 构建 Rust 原生模块

# 代码质量
pnpm lint             # ESLint 检查并自动修复
pnpm format           # Prettier 格式化代码
pnpm typecheck        # TypeScript 类型检查（主进程 + 渲染进程）

# 服务器（后端 API）
pnpm server:dev       # 开发模式启动后端服务器
pnpm server:start     # 启动编译后的后端服务
pnpm server:verify    # 验证服务器配置
```

## 架构结构

### Electron 进程

- `electron/main/` - 主进程入口，包含窗口管理、IPC 通信、服务启动
- `electron/preload/` - 预加载脚本，暴露 `window.electron` 和 `window.api` 到渲染进程
- `electron/server/` - 内嵌后端服务（网易云 API 代理、歌曲解锁、QQ音乐歌词解析）

### 渲染进程 (Vue 应用)

- `src/core/` - 播放器核心逻辑
  - `player/PlayerController.ts` - 主播放控制器
  - `audio-player/` - 多种播放引擎（AudioElement、MPV、FFmpeg）
- `src/stores/` - Pinia 状态管理（music、data、setting、status、auth 等）
- `src/api/` - API 接口层（网易云、QQ音乐、流媒体服务）
- `src/views/` - 页面视图（Home、Search、Discover、Local 等）
- `src/components/` - UI 组件（Player、Modal、Setting 等）
- `src/utils/` - 工具函数（auth、format、lyricParser 等）

### 原生模块

- `native/external-media-integration/` - Rust 原生模块，提供系统媒体控制集成（Windows/macOS/Linux）
- `native/ferrous-opencc-wasm/` - OpenCC 繁简转换 WASM 模块

### 后端服务

- `server/` - 独立后端服务，提供授权系统 API
  > ⚠️ **`server/` 是 git submodule**,指向独立仓库 [xiaoxiongmusic-server](https://github.com/MissKisser/xiaoxiongmusic-server)。**不要直接在 `server/` 目录里改代码**——submodule 内容应视为只读引用。后端改动请到 xiaoxiongmusic-server 仓库进行,然后执行 `git submodule update --remote server` 同步。server 与移动端(xiaoxiongmusic_capacitor)共享同一份代码。首次克隆本仓库后需执行 `git submodule update --init --recursive` 初始化 server。
  - `routes/auth.ts` - 授权验证 API
  - `routes/admin.ts` - 管理后台 API

## IPC 通信模式

渲染进程通过 `window.electron.ipcRenderer` 与主进程通信：

```typescript
// 渲染进程发送
window.electron.ipcRenderer.send('event-name', data)
window.electron.ipcRenderer.invoke('store-get', key)

// 渲染进程接收
window.electron.ipcRenderer.on('play', () => player.play())
```

IPC 事件处理位于 `electron/main/ipc/` 目录。

## 状态管理

使用 Pinia + pinia-plugin-persistedstate 持久化：

- `useMusicStore()` - 当前播放歌曲、歌词、播放列表
- `useDataStore()` - 用户数据、收藏、歌单
- `useSettingStore()` - 用户设置
- `useStatusStore()` - 播放状态、音量、进度
- `useAuthStore()` - 授权状态（仅客户端）

## 播放器引擎

项目支持三种播放引擎，通过 `src/core/audio-player/` 实现：

1. **AudioElementPlayer** - 标准 HTML Audio 元素（Web 端默认）
2. **MpvPlayer** - MPV 播放器（客户端高性能播放）
3. **FFmpegAudioPlayer** - FFmpeg 解码（支持更多格式）

## 流媒体支持

支持 Subsonic/Navidrome/Jellyfin 流媒体服务：

- `src/api/streaming/` - 流媒体 API 接口
- `src/stores/streaming.ts` - 流媒体状态管理
- `src/views/Streaming/` - 流媒体页面

## 环境变量

复制 `.env.example` 为 `.env` 并配置：

```
VITE_API_URL=https://your-api.example.com  # 网易云 API 地址（必填）
VITE_SERVER_PORT=25884                      # 后端服务端口
DB_HOST/DB_USER/DB_PASSWORD/DB_NAME         # MySQL 数据库配置（授权系统）
JWT_SECRET                                  # JWT 密钥
```

## 系统要求

- Node.js >= 20（推荐 v24 LTS）
- pnpm >= 8
- Rust 工具链（可选，用于原生模块开发）

## Windows 开发注意事项

- 使用 PowerShell 命令语法
- 原生模块编译需要 Visual Studio Build Tools（MSVC + Windows SDK）
- 构建产物位于 `dist/` 目录