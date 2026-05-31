# SPlayer 上游代码同步方案

> 生成时间: 2026-05-31
> 上游基准: `2268036e` (Apr 12) → `3380dcd3` (May 16)
> 本地基准: `8d6208e` (Apr 13)

## 一、差异概览

| 类别 | 数量 |
|------|------|
| src/ 差异文件 | 174 个 |
| 上游新增文件 (src/) | ~44 个 |
| 我方独有文件 (src/) | ~19 个 |
| electron/ 差异文件 | ~35 个 |
| 上游新增文件 (electron/) | 9 个 |
| 上游新提交 | 14 个 |

## 二、上游新增提交清单（14 个）

### 本次需同步的新提交

| Hash | 日期 | 描述 | 同步优先级 |
|------|------|------|-----------|
| `e9e2ffce` | 05-15 | chore(deps): 跟进更新 AMLL 相关依赖包 (#1054) | 中 |
| `843eb6e8` | 05-05 | fix: 修复原生模块 CI | 低 |
| `0383cb21` | 05-01 | fix(mobile): 让页面指示器更好点 | 中 |
| `80a5ee05` | 05-01 | fix(mobile): 修复鼠标无法切换页面 | 中 |
| `566bc036` | 04-17 | fix(taskbar-lyric): 修复任务栏歌词鼠标命中区域错位 | 中 |
| `6c8967d8` | 04-17 | feat(shortcut): 增加提示，设置完快捷键后 blur 输入框 | 低 |
| `3a0c6f4e` | 04-09 | fix(build): 修复无法在 Windows arm64 构建 | 中 |

### 可跳过的提交

| Hash | 日期 | 描述 | 原因 |
|------|------|------|------|
| `3380dcd3` | 05-16 | Delete .github/workflows/nightly.yml | CI 配置，不影响代码 |
| `f903f4d9` | 05-05 | docs: Update Docs | 文档更新 |
| `f99ddf3c` | 04-09 | chore(ci): 更新 GitHub Action 版本 | CI 配置 |
| `0d0dfc08` | 04-09 | refactor(ci): 同步 CI 文件 | CI 配置 |
| `4dbe0c45` | 04-09 | refactor(ci): 更新构建配置 | CI 配置 |

### 上游更早未同步的重大变更（基准前累积）

上游在 `2268036e` 之前已经有大量重构未完全同步到本项目：

- **设置系统重构**: 从独立 Vue 文件迁移到 config 驱动的统一系统
- **歌词处理模块化**: 拆分为多个独立工具（lyricFormat、lyricProfanity、lyricStripper、parseTTML）
- **FFmpeg 引擎重构**: SharedRingBuffer、新的 worker 架构
- **Emby 流媒体支持**: 新增 `emby.ts`
- **AB Loop 功能**: 新增循环播放控制
- **任务栏歌词**: 全新功能模块
- **Automix 功能**: 自动混音
- **类型系统**: 新增 `types/audio/`、`types/settings.ts`、`types/shared/`

## 三、上游新增文件清单

### src/ 新增文件（需同步引入）

**设置系统（重大重构）**:
- `src/components/Setting/SettingItemRenderer.vue` — 设置项渲染器
- `src/components/Setting/SettingSearch.vue` — 设置搜索
- `src/components/Setting/UniversalSetting.vue` — 统一设置页
- `src/components/Setting/components/` — 设置子组件目录
- `src/components/Setting/config/` — 设置配置目录
- `src/types/settings.ts` — 设置类型定义

**新功能组件**:
- `src/components/Global/PlayerProvider.vue` — 播放器提供者
- `src/components/Modal/ABLoop.vue` — AB 循环
- `src/components/Modal/CopySongInfo.vue` — 复制歌曲信息
- `src/components/Modal/ScalingModal.vue` — 缩放弹窗
- `src/components/Modal/ThemeConfig.vue` — 主题配置
- `src/components/Modal/Setting/CoverManager.vue` — 封面管理
- `src/components/Modal/Setting/ExcludeComment.vue` — 排除评论
- `src/components/Modal/Setting/FullscreenPlayerManager.vue` — 全屏播放器管理
- `src/components/Modal/Setting/LocalMusicDirectory.vue` — 本地音乐目录
- `src/components/Modal/Setting/PlaylistPageManager.vue` — 播放列表页管理
- `src/views/TaskbarLyric/` — 任务栏歌词视图

**新增 API**:
- `src/api/streaming/emby.ts` — Emby 流媒体支持

**新增工具/类型**:
- `src/utils/TypedEventTarget.ts`
- `src/utils/assGenerator.ts`
- `src/utils/automix.ts`
- `src/utils/error.ts`
- `src/utils/fileUrl.ts`
- `src/utils/style.ts`
- `src/utils/version.ts`
- `src/utils/lyric/lyricFontConfig.ts`
- `src/utils/lyric/lyricFormat.ts`
- `src/utils/lyric/lyricProfanity.ts`
- `src/utils/lyric/lyricStripper.ts`
- `src/utils/lyric/parseTTML.ts`
- `src/composables/useInit.ts`
- `src/composables/useQualityControl.ts`
- `src/composables/List/useDragSort.ts`
- `src/core/resource/LyricProcessor.ts`
- `src/core/automix/`
- `src/core/audio-player/ffmpeg-engine/SharedRingBuffer.ts`
- `src/core/audio-player/ffmpeg-engine/ffmpeg.js`
- `src/core/audio-player/ffmpeg-engine/ffmpeg.worker.ts`
- `src/types/audio/`
- `src/types/color.d.ts`
- `src/types/shared/`
- `src/assets/icons/Palette.svg`

### electron/ 新增文件（需同步引入）

- `electron/main/ipc/ipc-mac-statusbar.ts` — macOS 状态栏 IPC
- `electron/main/ipc/ipc-taskbar.ts` — 任务栏歌词 IPC
- `electron/main/services/DownloadService.ts` — 下载服务
- `electron/main/services/MusicMetadataService.ts` — 音乐元数据服务
- `electron/main/utils/format.ts` — 格式化工具
- `electron/main/utils/taskbar-lyric-manager.ts` — 任务栏歌词管理器
- `electron/main/windows/floating-taskbar-lyric-window.ts` — 浮动歌词窗口
- `electron/main/windows/taskbar-lyric-window.ts` — 任务栏歌词窗口
- `electron/main/workers/` — Worker 目录

### native/ 新增模块

- `native/taskbar-lyric/` — 任务栏歌词原生模块

## 四、我方独有文件（必须保留）

### 二次开发核心文件

| 文件 | 用途 |
|------|------|
| `src/views/Admin/` | Admin 管理后台（全部保留） |
| `src/components/Modal/GlobalAuthModal.vue` | 授权弹窗 |
| `src/components/Player/PlayerSettingsModal.vue` | 播放器设置弹窗 |
| `src/components/Player/SettingsModals/` | 设置弹窗组件 |
| `src/stores/auth.ts` | 授权状态管理 |
| `src/utils/lyric/` | 多源歌词解析（我方独立维护） |

### 我方旧设置组件（需评估迁移）

以下文件是旧版设置系统的组件，上游已重构为统一系统，需评估是否迁移：

| 文件 | 上游替代方案 |
|------|-------------|
| `src/components/Setting/GeneralSetting.vue` | → `UniversalSetting.vue` + `config/` |
| `src/components/Setting/KeyboardSetting.vue` | → `UniversalSetting.vue` + `config/` |
| `src/components/Setting/LocalSetting.vue` | → `UniversalSetting.vue` + `config/` |
| `src/components/Setting/LyricsSetting.vue` | → `UniversalSetting.vue` + `config/` |
| `src/components/Setting/OtherSetting.vue` | → `UniversalSetting.vue` + `config/` |
| `src/components/Setting/PlaySetting.vue` | → `UniversalSetting.vue` + `config/` |
| `src/components/Setting/StreamingSetting.vue` | → `UniversalSetting.vue` + `config/` |
| `src/components/Setting/ThirdSetting.vue` | → `UniversalSetting.vue` + `config/` |

## 五、同步方案（分阶段）

### 阶段一：低风险文件同步（预计冲突率 < 5%）

直接从上游复制，无需特殊处理：

1. **新增工具文件** — `TypedEventTarget.ts`、`assGenerator.ts`、`error.ts`、`fileUrl.ts`、`style.ts`、`version.ts`
2. **新增类型定义** — `types/audio/`、`types/color.d.ts`、`types/settings.ts`、`types/shared/`
3. **新增 API** — `api/streaming/emby.ts`
4. **新增 composables** — `useInit.ts`、`useQualityControl.ts`、`useDragSort.ts`
5. **新增资源** — `Palette.svg`
6. **Electron 新增** — `format.ts`、`DownloadService.ts`、`MusicMetadataService.ts`

### 阶段二：核心文件同步（预计冲突率 ~30%）

需要逐文件对比合并，保留我方扩展：

1. **API 层** — `song.ts`、`album.ts`、`cloud.ts`、`comment.ts`、`lastfm.ts`、`playlist.ts`、`other.ts`
2. **流媒体** — `streaming/index.ts`、`jellyfin.ts`、`subsonic.ts`
3. **Store** — `local.ts`、`setting.ts` 等状态文件
4. **Electron IPC** — 各 IPC 处理文件
5. **Electron 服务** — `MpvService.ts`、`MusicCacheService.ts`、`CacheService.ts` 等
6. **核心播放器** — `core/` 下相关文件
7. **解锁服务** — `unblock/match.ts`（需合并我方多解锁源扩展）

### 阶段三：高冲突区域（预计冲突率 > 60%）

需要手动合并，谨慎处理：

1. **设置系统迁移** — 最复杂的部分
   - 评估是否采用上游的统一设置系统
   - 如采用：需要将我方的自定义设置项（均衡器、授权相关）迁移到新 config 系统
   - 如不采用：保留旧组件，仅同步 bug 修复部分
   - **建议**: 暂不迁移，保留当前设置组件结构，仅同步功能修复

2. **设置弹窗组件** — `Modal/` 下新增的弹窗
   - `ABLoop.vue`、`CopySongInfo.vue`、`ScalingModal.vue`、`ThemeConfig.vue`
   - 这些可安全引入，不影响现有功能

3. **路由和导航** — `router/routes.ts`、`App.vue`
   - 上游可能新增了路由（任务栏歌词、新设置页面）
   - 需要保留我方的 Admin 路由和授权路由

### 阶段四：可选功能（按需引入）

1. **任务栏歌词** — 涉及 electron 新窗口 + IPC + 原生模块，工作量大
2. **Automix** — 自动混音功能
3. **AB Loop** — AB 循环播放
4. **FFmpeg 引擎重构** — SharedRingBuffer、新 worker 架构

### 阶段五：验证与清理

1. TypeScript 类型检查通过
2. 构建验证（`pnpm build:web`）
3. 确认二次开发功能完整（均衡器、百科、授权、Admin）
4. 更新 `upstream-sync.md` 文档

## 六、风险矩阵

| 风险项 | 等级 | 缓解措施 |
|--------|------|----------|
| 设置系统重构导致 UI 崩溃 | 高 | 阶段三独立处理，保留旧组件作为回退 |
| 解锁服务合并丢失多源扩展 | 中 | 逐函数对比，保留我方所有解锁源 |
| AMLL 依赖升级不兼容 | 中 | 测试 Apple Music 歌词渲染是否正常 |
| Electron IPC 变更导致通信失败 | 中 | 验证 preload 暴露的 API 接口 |
| 原生模块 taskbar-lyric 构建失败 | 低 | 可跳过，不影响核心功能 |
| Store 结构变更丢失用户数据 | 高 | 检查 persisted state 兼容性 |

## 七、建议执行顺序

```
阶段一 → 构建验证 → 阶段二 → 构建验证 → 阶段三 → 全面测试 → 阶段四（可选）→ 阶段五
```

每个阶段完成后执行 `pnpm typecheck` 和 `pnpm build:web` 验证。
