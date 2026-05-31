# SPlayer 上游代码同步 — 执行 Prompt

请严格按照迁移方案执行 SPlayer 上游代码同步。方案文件在 `.omc/plans/strict-migration-plan.md`，上游代码在 `D:\document\Projects\xiaoxiongmusic\splayer-upstream-new`。

## 项目背景

小熊音乐基于 SPlayer 二次开发，独有功能：均衡器、歌曲百科、授权系统、Admin WebUI、多源歌词解析、音频代理。同步时必须保留这些独有内容。

## 上游代码位置

- 上游仓库：`D:\document\Projects\xiaoxiongmusic\splayer-upstream-new`（分支 `dev`）
- 本项目：`D:\document\Projects\xiaoxiongmusic\xiaoxiongmusic`（分支 `main`）

## 执行规则

1. 使用 `git mv` 或 `cp` 从上游复制文件，不要手动重写
2. 每个步骤完成后运行 `pnpm typecheck` 验证，通过后才进入下一步
3. 遇到不确定的代码差异，必须读取双方文件逐函数对比，禁止猜测
4. 所有 `src/views/Admin/**`、`src/stores/auth.ts`、`electron/server/proxy/**`、`src/components/Modal/GlobalAuthModal.vue` 及相关授权代码严禁修改
5. 提交时不添加 Co-Authored-By 标记，使用中文 commit message

---

## 步骤 1：复制新增文件（43 个）

从上游仓库复制以下文件到本项目对应路径。对于目录类型的（如 `src/types/audio/`、`src/types/shared/`、`src/core/automix/`、`src/views/TaskbarLyric/`、`electron/main/workers/`、`native/taskbar-lyric/`），复制整个目录。

### src/utils/ 新增
```
cp {上游}/src/utils/TypedEventTarget.ts src/utils/
cp {上游}/src/utils/assGenerator.ts src/utils/
cp {上游}/src/utils/automix.ts src/utils/
cp {上游}/src/utils/error.ts src/utils/
cp {上游}/src/utils/fileUrl.ts src/utils/
cp {上游}/src/utils/style.ts src/utils/
cp {上游}/src/utils/version.ts src/utils/
```

### src/utils/lyric/ 新增
```
cp {上游}/src/utils/lyric/lyricFormat.ts src/utils/lyric/
cp {上游}/src/utils/lyric/lyricProfanity.ts src/utils/lyric/
cp {上游}/src/utils/lyric/lyricStripper.ts src/utils/lyric/
cp {上游}/src/utils/lyric/parseTTML.ts src/utils/lyric/
```

### src/types/ 新增
```
cp -r {上游}/src/types/audio src/types/
cp {上游}/src/types/color.d.ts src/types/
cp {上游}/src/types/settings.ts src/types/
cp -r {上游}/src/types/shared src/types/
```

### src/composables/ 新增
```
cp {上游}/src/composables/useInit.ts src/composables/
cp {上游}/src/composables/useQualityControl.ts src/composables/
cp {上游}/src/composables/List/useDragSort.ts src/composables/List/
```

### src/api/ 新增
```
cp {上游}/src/api/streaming/emby.ts src/api/streaming/
```

### src/components/ 新增
```
cp {上游}/src/components/Global/PlayerProvider.vue src/components/Global/
cp {上游}/src/components/Modal/ABLoop.vue src/components/Modal/
cp {上游}/src/components/Modal/CopySongInfo.vue src/components/Modal/
cp {上游}/src/components/Modal/ScalingModal.vue src/components/Modal/
cp {上游}/src/components/Modal/ThemeConfig.vue src/components/Modal/
cp {上游}/src/components/Modal/Setting/CoverManager.vue src/components/Modal/Setting/
cp {上游}/src/components/Modal/Setting/ExcludeComment.vue src/components/Modal/Setting/
cp {上游}/src/components/Modal/Setting/FullscreenPlayerManager.vue src/components/Modal/Setting/
cp {上游}/src/components/Modal/Setting/LocalMusicDirectory.vue src/components/Modal/Setting/
cp {上游}/src/components/Modal/Setting/PlaylistPageManager.vue src/components/Modal/Setting/
cp {上游}/src/assets/icons/Palette.svg src/assets/icons/
```

### src/core/ 新增
```
cp -r {上游}/src/core/automix src/core/
cp {上游}/src/core/resource/LyricProcessor.ts src/core/resource/
cp {上游}/src/core/audio-player/ffmpeg-engine/SharedRingBuffer.ts src/core/audio-player/ffmpeg-engine/
cp {上游}/src/core/audio-player/ffmpeg-engine/ffmpeg.js src/core/audio-player/ffmpeg-engine/
cp {上游}/src/core/audio-player/ffmpeg-engine/ffmpeg.worker.ts src/core/audio-player/ffmpeg-engine/
cp -r {上游}/src/views/TaskbarLyric src/views/
```

### electron/ 新增
```
cp {上游}/electron/main/ipc/ipc-taskbar.ts electron/main/ipc/
cp {上游}/electron/main/ipc/ipc-mac-statusbar.ts electron/main/ipc/
cp {上游}/electron/main/services/DownloadService.ts electron/main/services/
cp {上游}/electron/main/services/MusicMetadataService.ts electron/main/services/
cp {上游}/electron/main/utils/format.ts electron/main/utils/
cp {上游}/electron/main/utils/taskbar-lyric-manager.ts electron/main/utils/
cp {上游}/electron/main/windows/floating-taskbar-lyric-window.ts electron/main/windows/
cp {上游}/electron/main/windows/taskbar-lyric-window.ts electron/main/windows/
cp -r {上游}/electron/main/workers electron/main/
```

### native/ 和 public/ 新增
```
cp -r {上游}/native/taskbar-lyric native/
cp -r {上游}/public/icons/tray public/icons/
```

复制完成后运行 `pnpm typecheck`，记录错误但不修复（后续步骤处理依赖问题）。

---

## 步骤 2：合并低复杂度文件

以下文件经确认双方相同或仅需微小调整：

- `src/stores/index.ts` — 确保保留 `useAuthStore` 导出
- `electron/preload/index.ts` — 完全相同，跳过
- `electron/server/unblock/match.ts` — 完全相同，跳过
- `electron/server/unblock/unblock.d.ts` — 仅类型顺序不同，跳过

运行 `pnpm typecheck` 验证。

---

## 步骤 3：合并中等复杂度文件（23 个）

对每个文件：
1. 用 `diff` 对比上游和本项目的差异
2. 将上游的新增代码合入我方文件，保留我方独有修改
3. 重点关注下表列出的保留项

| 文件 | 合并要点 |
|------|----------|
| `src/stores/music.ts` | 在 `setSongLyric()` 末尾添加 `sendTaskbarLyrics(this.songLyric)` + import |
| `src/api/streaming/index.ts` | 添加 `export { default as emby } from "./emby"` |
| `src/api/song.ts` | 添加 dolby 音质分支，扩展 `unlockSongUrl` 的 songName/artist 参数 |
| `electron/main/store/index.ts` | 添加 `taskbar`、`macos`、`downloadThreadCount`、`updateChannel` key |
| `electron/main/windows/index.ts` | 替换 `Object.assign` 为 webPreferences 深合并逻辑 |
| `electron/main/windows/main-window.ts` | 添加图片导航拦截、Explorer 重启钩子 |
| `electron/main/ipc/index.ts` | 注册 `ipc-taskbar`、`ipc-mac-statusbar` |
| `electron/server/index.ts` | **保留我方 CORS hook、proxy 注册、host 绑定**，添加上游新增 |
| `electron/preload/index.d.ts` | 统一 API 命名空间（取上游更丰富的返回类型） |
| 其余 `electron/main/` 下的 IPC/服务/工具文件 | 逐个 diff 对比合并上游改动 |

每合并 5 个文件后运行一次 `pnpm typecheck`。

---

## 步骤 4：合并高复杂度文件（7 个）

这是最关键的步骤，必须逐函数仔细对比。

### 4.1 `src/stores/setting.ts` + `src/stores/migrations/settingMigrations.ts`

**最优先处理。** 操作：
1. 读取上游 `setting.ts`，找出所有新增字段和重命名字段
2. 将新增字段添加到我方 `setting.ts` 的 State 接口和默认值中
3. 重命名字段用 upstream 的名称（如 `showYrc` → `showWordLyrics`）
4. 保留我方独有字段：`useKeepAlive`
5. **必须同时更新** `settingMigrations.ts`：从上游复制 v9→v11 的迁移逻辑
6. 确保迁移链完整：v8 → v9 → v10 → v11

### 4.2 `src/stores/local.ts`

添加上游新增：
- `isInitialized` ref
- `reorderSongsInLocalPlaylist()` 方法
- 扩展 `isLocalPlaylist()` 签名接受 `number | string | undefined | null`
- `addSongsToLocalPlaylist` 改用 `unshift`（前插）

### 4.3 `src/utils/helper.ts`

- 取上游的 `handleSongQuality()` 重写（dolby、AI 级别过滤）
- **保留我方**的 `copyData()` 数组 join 处理
- **保留我方**的 `getShareUrl()` shareUrlFormat 支持

### 4.4 `src/utils/modal.ts`

- 采用上游的 async 动态导入模式
- 添加所有新弹窗函数（openPlaylistPageManager、openCopySongInfo、openABLoop 等）
- 保留我方已有的自定义弹窗

### 4.5 `src/utils/auth.ts`

- 取上游的多账号切换系统（saveCurrentAccount、switchAccount、removeAccount）
- **保留我方**的本地播放列表删除支持
- **保留我方**的 `toLogout()` clearUserList 参数

### 4.6 `src/router/routes.ts`

**注意破坏性变更：**
- wiki 路由从 `{ path: "/wiki", name: "wiki" }` 改为 `{ path: "/song/wiki", name: "song-wiki" }`
- 评论路由从 `{ path: "/comment/:id", name: "comment", props: true }` 改为 query 参数
- 新增 `{ path: "/taskbar-lyric", name: "taskbar-lyric" }` 路由
- **必须保留**我方全部 `/bamger/*` Admin 路由（含 beforeEnter 守卫）
- 如果 wiki/comment URL 变更会导致外部链接失效，考虑保留旧路由做重定向

### 4.7 `src/App.vue`

- 取上游的桌面歌词条件渲染（`isDesktopLyric` 判断）
- **保留我方**的 `GlobalAuthModal` 和授权检查逻辑

合并格式：
```vue
<template>
  <Provider v-if="!isDesktopLyric">
    <router-view />
    <GlobalAuthModal v-if="isElectron" />
  </Provider>
  <router-view v-else />
</template>
```

### 4.8 `src/core/player/PlayerController.ts`

**最复杂。** 逐方法对比：
- 添加 automix 相关 import 和状态
- 添加 ReplayGain 支持
- 添加 rate ramping 逻辑
- `currentRequestToken` 改为 public
- 保留我方所有现有功能

### 4.9 `src/composables/useSongMenu.ts`

- 添加 `openCopySongInfo` 菜单项
- 添加评论查看菜单项
- 更新 wiki 路由名称为 `song-wiki`
- 保留我方其他自定义菜单

完成后运行 `pnpm typecheck` + `pnpm build:web`。

---

## 步骤 5：最终验证

检查以下功能完整性：

1. **授权系统**：`/bamger/login` 可访问，授权弹窗正常显示
2. **解锁功能**：多解锁源（酷我、歌曲宝、波点）正常工作
3. **均衡器**：设置中均衡器选项保留
4. **歌曲百科**：wiki 功能可用
5. **Admin WebUI**：Dashboard、授权码管理、设备管理正常
6. **流媒体**：Subsonic/Jellyfin/Emby 连接正常
7. **新增功能**：AB Loop、复制歌曲信息等可操作
8. **设置持久化**：用户升级后旧设置数据通过迁移保留

---

## 提交规范

每个步骤完成后单独提交：
```
同步: 引入上游新增文件（43个）
同步: 合并 electron 层中等复杂度更新
同步: 合并 Store 和 API 层更新
同步: 合并路由和核心播放器更新
同步: 合并工具函数更新
```
