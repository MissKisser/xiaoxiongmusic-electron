# SPlayer 上游代码严格迁移方案

> 生成时间: 2026-05-31
> 基于: 逐文件代码差异分析

## 判定标准

| 标记 | 含义 | 操作 |
|------|------|------|
| **可直接复制** | 上游新增文件，我方无同名文件，无依赖冲突 | 直接从上游复制 |
| **需合并** | 两方都有修改，需逐函数对比后合并 | 手动合并，保留双方修改 |
| **保留我方** | 我方独有或上游无对应，必须完整保留 | 不动 |
| **需迁移** | 上游已重构，我方旧版需迁移到新架构 | 删除旧文件 + 引入新文件 + 迁移自定义逻辑 |
| **跳过** | 不适用或不影响代码 | 不处理 |

---

## 第一部分：可直接复制的文件（43 个）

### 1.1 src/ 新增工具文件

| 文件 | 上游路径 |
|------|----------|
| `TypedEventTarget.ts` | `src/utils/TypedEventTarget.ts` |
| `assGenerator.ts` | `src/utils/assGenerator.ts` |
| `automix.ts` | `src/utils/automix.ts` |
| `error.ts` | `src/utils/error.ts` |
| `fileUrl.ts` | `src/utils/fileUrl.ts` |
| `style.ts` | `src/utils/style.ts` |
| `version.ts` | `src/utils/version.ts` |
| `lyricFormat.ts` | `src/utils/lyric/lyricFormat.ts` |
| `lyricProfanity.ts` | `src/utils/lyric/lyricProfanity.ts` |
| `lyricStripper.ts` | `src/utils/lyric/lyricStripper.ts` |
| `parseTTML.ts` | `src/utils/lyric/parseTTML.ts` |

### 1.2 src/ 新增类型定义

| 文件 | 说明 |
|------|------|
| `src/types/audio/` | 音频类型定义（目录） |
| `src/types/color.d.ts` | 颜色类型 |
| `src/types/settings.ts` | 设置系统类型（设置系统迁移前置依赖） |
| `src/types/shared/` | 共享类型（目录） |

### 1.3 src/ 新增 composables

| 文件 | 说明 |
|------|------|
| `src/composables/useInit.ts` | 初始化逻辑 |
| `src/composables/useQualityControl.ts` | 音质控制 |
| `src/composables/List/useDragSort.ts` | 列表拖拽排序 |

### 1.4 src/ 新增 API

| 文件 | 说明 |
|------|------|
| `src/api/streaming/emby.ts` | Emby 流媒体支持（547 行新文件） |

### 1.5 src/ 新增组件

| 文件 | 说明 |
|------|------|
| `src/components/Global/PlayerProvider.vue` | 播放器提供者 |
| `src/components/Modal/ABLoop.vue` | AB 循环播放 |
| `src/components/Modal/CopySongInfo.vue` | 复制歌曲信息 |
| `src/components/Modal/ScalingModal.vue` | 缩放弹窗 |
| `src/components/Modal/ThemeConfig.vue` | 主题配置弹窗 |
| `src/components/Modal/Setting/CoverManager.vue` | 封面管理 |
| `src/components/Modal/Setting/ExcludeComment.vue` | 排除评论 |
| `src/components/Modal/Setting/FullscreenPlayerManager.vue` | 全屏播放器管理 |
| `src/components/Modal/Setting/LocalMusicDirectory.vue` | 本地音乐目录 |
| `src/components/Modal/Setting/PlaylistPageManager.vue` | 播放列表页管理 |
| `src/assets/icons/Palette.svg` | 调色板图标 |

### 1.6 src/ 新增核心模块

| 文件 | 说明 |
|------|------|
| `src/core/automix/` | 自动混音模块（4 个文件） |
| `src/core/resource/LyricProcessor.ts` | 歌词处理器 |
| `src/core/audio-player/ffmpeg-engine/SharedRingBuffer.ts` | 共享环形缓冲区 |
| `src/core/audio-player/ffmpeg-engine/ffmpeg.js` | FFmpeg 入口 |
| `src/core/audio-player/ffmpeg-engine/ffmpeg.worker.ts` | FFmpeg worker |
| `src/views/TaskbarLyric/` | 任务栏歌词视图 |

### 1.7 electron/ 新增文件

| 文件 | 说明 |
|------|------|
| `electron/main/ipc/ipc-taskbar.ts` | 任务栏歌词 IPC |
| `electron/main/ipc/ipc-mac-statusbar.ts` | macOS 状态栏歌词 IPC |
| `electron/main/services/DownloadService.ts` | 下载服务 |
| `electron/main/services/MusicMetadataService.ts` | 音乐元数据服务 |
| `electron/main/utils/format.ts` | 格式化工具 |
| `electron/main/utils/taskbar-lyric-manager.ts` | 任务栏歌词管理器 |
| `electron/main/windows/floating-taskbar-lyric-window.ts` | 浮动歌词窗口 |
| `electron/main/windows/taskbar-lyric-window.ts` | 任务栏歌词窗口 |
| `electron/main/workers/` | Worker 目录 |

### 1.8 其他

| 文件 | 说明 |
|------|------|
| `native/taskbar-lyric/` | 任务栏歌词原生模块 |
| `public/icons/tray/tray-dark.png` | 深色托盘图标 |
| `public/icons/tray/tray-light.png` | 浅色托盘图标 |

> **复制后验证**: 检查 import 路径是否在我方项目中存在，特别是 `@native/tools`、`@shared`、`fast-glob`、`music-metadata` 等依赖。

---

## 第二部分：需合并的文件（30 个）

按风险等级和复杂度排序。

### 2.1 低复杂度合并（改动小，冲突少）

| 文件 | 我方需保留 | 上游需引入 | 合并要点 |
|------|-----------|-----------|----------|
| `src/stores/index.ts` | `useAuthStore` 导出 | 无新增 | 保持我方额外导出即可 |
| `electron/preload/index.ts` | — | — | **完全相同**，无需操作 |
| `electron/server/unblock/match.ts` | — | — | **完全相同**，无需操作 |
| `electron/server/unblock/unblock.d.ts` | — | — | 仅类型声明顺序不同，**无需操作** |

### 2.2 中等复杂度合并

| 文件 | 我方需保留 | 上游需引入 | 合并要点 |
|------|-----------|-----------|----------|
| `src/stores/music.ts` | — | `sendTaskbarLyrics` 调用 | 在 `setSongLyric()` 末尾添加 1 行 + import |
| `src/api/streaming/index.ts` | — | `emby` 导出 | 添加 `export { default as emby } from "./emby"` |
| `src/api/song.ts` | — | dolby 音质支持、`unlockSongUrl` 新参数 | 添加 dolby 分支，扩展函数签名 |
| `electron/main/store/index.ts` | `proxy` 相关 key | `taskbar`、`macos`、`downloadThreadCount`、`updateChannel` key | 添加上游新增的 store key |
| `electron/main/windows/index.ts` | — | `webPreferences` 深合并修复 | 替换 `Object.assign` 为分层合并逻辑 |
| `electron/main/windows/main-window.ts` | — | 图片导航拦截、Explorer 重启钩子 | 添加上游新增的事件处理 |
| `electron/main/windows/lyric-window.ts` | — | 桌面歌词相关更新 | 对比合并 |
| `electron/main/update/index.ts` | — | 更新相关更新 | 对比合并 |
| `electron/main/tray/index.ts` | — | 托盘相关更新 | 对比合并 |
| `electron/main/thumbar/index.ts` | — | 缩略图工具栏更新 | 对比合并 |
| `electron/main/ipc/index.ts` | — | 注册 `ipc-taskbar`、`ipc-mac-statusbar` | 添加新 IPC 模块注册 |
| `electron/main/ipc/ipc-*.ts`（其余） | — | 各 IPC 处理更新 | 逐个对比合并 |
| `electron/main/services/CacheService.ts` | — | 缓存服务更新 | 对比合并 |
| `electron/main/services/LocalMusicService.ts` | — | 本地音乐服务更新 | 对比合并 |
| `electron/main/services/MpvService.ts` | — | MPV 服务更新 | 对比合并 |
| `electron/main/services/MusicCacheService.ts` | — | 缓存匹配改进 | 对比合并 |
| `electron/main/database/LocalMusicDB.ts` | — | 本地数据库更新 | 对比合并 |
| `electron/main/utils/helper.ts` | — | 辅助函数更新 | 对比合并 |
| `electron/main/utils/native-loader.ts` | — | 原生加载器更新 | 对比合并 |
| `electron/server/index.ts` | **CORS hook、proxy 注册、host 绑定** | 可能新增服务注册 | 保留我方 CORS/proxy，添加上游新增 |
| `electron/server/netease/index.ts` | — | 网易云 API 更新 | 对比合并 |
| `electron/server/qqmusic/index.ts` | — | QQ 音乐更新 | 对比合并 |
| `electron/server/qqmusic/qrc.ts` | — | QRC 歌词更新 | 对比合并 |
| `electron/preload/index.d.ts` | `window.logger` 命名空间 | 更丰富的 export/import 返回类型 | 统一 API 命名空间 |

### 2.3 高复杂度合并（需仔细逐函数对比）

| 文件 | 我方需保留 | 上游需引入 | 合并要点 |
|------|-----------|-----------|----------|
| `src/stores/setting.ts` | `useKeepAlive` 等独有字段 | ~50 个新字段、10+ 字段重命名 | **最关键**。需同步 `migrations/settingMigrations.ts`（v8→v11），确保用户升级时自动迁移 |
| `src/stores/local.ts` | — | `isInitialized`、`reorderSongsInLocalPlaylist`、扩展 `isLocalPlaylist` 签名 | 添加新方法和状态 |
| `src/utils/helper.ts` | `copyData()` 数组处理、`getShareUrl()` 格式支持 | `handleSongQuality()` 重写（dolby、AI 级别） | 取上游重写，保留我方扩展 |
| `src/utils/modal.ts` | — | 全部改为 async 动态导入、10+ 新弹窗函数、单例管理 | 采用上游 async 模式，添加所有新弹窗 |
| `src/utils/auth.ts` | 多账号切换系统（saveCurrentAccount 等）、本地播放列表删除支持 | `toLogout()` 参数扩展、`updateUserLikePlaylist` await | 合并双方修改 |
| `src/composables/useSongMenu.ts` | — | 复制歌曲信息菜单、评论查看菜单、wiki 路由名称变更 | 取上游新增菜单项，更新路由名 |
| `src/router/routes.ts` | `/bamger/*` 全部 Admin 路由（含 beforeEnter 守卫） | wiki 路由改为 `/song/wiki`、评论路由改为 query 参数、新增 taskbar-lyric 路由 | **破坏性变更**：wiki/comment URL 变化需评估影响 |
| `src/App.vue` | `GlobalAuthModal` + 授权检查逻辑 | 桌面歌词条件渲染（`isDesktopLyric`） | 取上游条件渲染，保留我方授权逻辑 |
| `src/core/player/PlayerController.ts` | — | automix 集成、ReplayGain、rate ramping、`currentRequestToken` 改为 public | **高复杂度**，需逐方法合并 |

---

## 第三部分：设置系统迁移（独立评估）

### 3.1 现状对比

| 维度 | 我方（旧） | 上游（新） |
|------|-----------|-----------|
| 架构 | 10 个独立 Vue 组件（~4,110 行） | config 驱动 + 通用渲染器（~5,840 行，17 文件） |
| Tab 数 | 8 个（general/play/lyrics/keyboard/local/third/streaming/other） | 8 个（general/appearance/play/lyrics/keyboard/local/network/about） |
| 搜索 | 无 | fuse.js 模糊搜索 |
| 设置项 | 约 80 项 | 约 150+ 项（大幅扩展） |

### 3.2 判定：**本次不迁移设置系统**

理由：
1. **规模过大**：涉及 17 个文件替换 + 10 个文件删除，约 10,000 行代码变更
2. **我方自定义逻辑需移植**：`useKeepAlive`、主题色内联控件等需转为 config 格式
3. **store 联动风险高**：setting.ts 的 ~50 个字段变更 + 3 级迁移链必须同步完成
4. **测试复杂度高**：所有设置项的 UI 渲染、持久化、迁移都需要验证
5. **与授权系统有交互**：`GlobalAuthModal` 的显示逻辑依赖 App.vue

### 3.3 设置系统相关文件的本次处理

| 文件 | 本次操作 | 理由 |
|------|----------|------|
| `src/types/settings.ts` | **复制** | 纯类型定义，无副作用 |
| `src/components/Setting/MainSetting.vue` | **保留我方** | 旧版组件，暂不替换 |
| `src/components/Setting/GeneralSetting.vue` 等 8 个 | **保留我方** | 旧版组件，暂不替换 |
| `src/components/Setting/UniversalSetting.vue` 等 3 个 | **暂不引入** | 依赖完整的 config 系统才能工作 |
| `src/components/Setting/config/*` 7 个 | **暂不引入** | 同上 |
| `src/components/Setting/components/*` 5 个 | **暂不引入** | 同上 |

### 3.4 设置系统迁移建议（后续专项）

将设置系统迁移作为独立任务，拆分为：
1. 先同步 `setting.ts` + `settingMigrations.ts`（字段和迁移）
2. 引入 config/ + UniversalSetting + SettingItemRenderer
3. 将我方自定义设置项转为 config 格式
4. 删除旧组件
5. 全面测试

---

## 第四部分：保留我方的文件（不动）

| 文件/目录 | 说明 |
|-----------|------|
| `src/views/Admin/**` | 管理后台全部文件 |
| `src/components/Modal/GlobalAuthModal.vue` | 授权弹窗 |
| `src/components/Player/PlayerSettingsModal.vue` | 播放器设置弹窗 |
| `src/components/Player/SettingsModals/**` | 设置弹窗组件 |
| `src/stores/auth.ts` | 授权状态管理 |
| `src/utils/lyric/**` | 我方歌词解析工具 |
| `src/utils/init.ts` | 初始化工具 |
| `src/utils/lyricFontConfig.ts` | 歌词字体配置 |
| `src/utils/lyricParser.ts` | 歌词解析器 |
| `src/utils/lyricStripper.ts` | 歌词剥离器 |
| `src/assets/ffmpeg/**` | FFmpeg 资源 |
| `src/types/shared.ts` | 共享类型 |
| `electron/server/proxy/**` | 音频代理服务 |
| `electron/server/unblock/kuwo.ts` | 酷我解锁（**已与上游相同**） |
| `electron/server/unblock/bodian.ts` | 波点解锁（**已与上游相同**） |
| `electron/server/unblock/gequbao.ts` | 歌曲宝解锁（**已与上游相同**） |
| `electron/server/unblock/index.ts` | 解锁入口（**已与上游相同**） |

---

## 第五部分：跳过的文件

| 文件 | 原因 |
|------|------|
| `.github/**` | CI/CD 配置，我方独立维护 |
| `CHANGELOG.md` | 上游变更日志 |
| `AGENTS.md` | 上游 Claude Code 配置 |
| `screenshots/` | 上游截图 |
| `dev-app-update.yml` | 上游自动更新配置 |
| `nginx.conf` | 上游 Nginx 配置（我方有独立配置） |
| `.gitattributes` | 上游 Git 属性 |
| `CLAUDE.md` | 我方独立维护 |
| `README.md` | 我方独立维护 |
| `LICENSE` | 相同协议 |

---

## 第六部分：执行顺序

```
步骤 1: 复制所有 "可直接复制" 的文件（43 个）
        ↓ pnpm typecheck 验证
步骤 2: 合并低复杂度文件（4 个，其中 3 个无需操作）
        ↓
步骤 3: 合并中等复杂度文件（23 个）
        ↓ pnpm typecheck 验证
步骤 4: 合并高复杂度文件（7 个）
        - setting.ts + migrations 优先处理
        - router/routes.ts 注意 URL 破坏性变更
        - App.vue 保留授权逻辑
        - PlayerController.ts 最复杂，最后处理
        ↓ pnpm typecheck + pnpm build:web 验证
步骤 5: 确认验证清单
```

### 验证清单

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm build:web` 成功
- [ ] Admin WebUI 可访问（`/bamger/*`）
- [ ] 授权弹窗正常显示
- [ ] 解锁功能正常（多解锁源）
- [ ] 均衡器设置保留
- [ ] 歌曲百科功能保留
- [ ] 流媒体（Subsonic/Jellyfin/Emby）正常
- [ ] 新增功能（AB Loop、复制歌曲信息等）可用
- [ ] 设置项持久化正常（用户升级后旧数据不丢失）
