# 桌面端上游同步记录（2026-06-08）

## 同步窗口

- 上游：`imsyy/SPlayer` `dev`
- 本地上游镜像：`splayer-upstream-new`
- 对比范围：`3380dcd3..28b76bad`
- 执行分支：`sync/desktop-upstream-2026-06-08`

## 本轮执行范围

本轮只同步低风险且可验证的桌面端补丁，不合入任务栏歌词大重构。

### 已同步

- 桌面歌词 loading 状态修复
  - 切歌进入歌词加载时，立即向桌面歌词窗口发送新歌 `currentTime`、`songId`、`songOffset`、空歌词数组和 `lyricIndex: -1`。
  - 桌面歌词窗口忽略同一首歌的 loading-only 旧包，避免旧歌词被“加载中”误覆盖。
  - 桌面歌词主动请求数据时，若主播放器仍在加载歌词，只返回空歌词数组，避免旧歌词回灌。

- Netease API xeapi 配置预热
  - 新增 Electron 内置服务与独立服务端各自的 `ncm-config.ts` / `ncm-api.d.ts`。
  - 动态 API 路由过滤 `@neteasecloudmusicapienhanced/api/server.js` 的服务层导出，避免暴露为 `/netease/*` 路由。
  - 服务启动时非阻塞预热 NCM 配置；实际 API 调用前等待配置就绪。
  - `@neteasecloudmusicapienhanced/api` 对齐上游到 `^4.34.3`。

- 编译门槛兼容修复
  - 恢复 `@shared` 对任务栏歌词 IPC 类型和默认配置的导出。
  - 为 `@native/taskbar-lyric` 补充 node 端路径别名。
  - 修复托盘接口与调用方的不一致。
  - 删除 `src/utils/helper.ts` 中导致 Web 类型检查直接语法失败的重复残片。
  - 补齐 FFmpeg worker 的流式解码、WAV 导出、倍速/变调消息类型声明。
  - 隔离未接入运行时的实验性 `AutomixManager.ts`，保留 Automix 共享类型继续纳入检查。

### 本轮跳过

- 任务栏歌词架构重构：涉及 `windows/taskbar-lyric/**`、`native/taskbar-lyric`、旧 `src/views/TaskbarLyric/**` 删除，风险高，需单独分支。
- Electron / Vue / AMLL / 构建工具大版本升级：本轮只升级 NCM API 包，不跟进整仓依赖。
- gequbao / 授权系统 / Admin WebUI：保持本地实现不变。

## 验证结果

- `node scripts/test-desktop-upstream-sync.mjs`：通过。
- `pnpm build:server`：通过。
- `pnpm typecheck:node`：通过。
- `pnpm typecheck:web`：通过。
- `pnpm exec tsx -e "import { NON_API_EXPORTS } from './server/netease/ncm-config.ts'; console.log(NON_API_EXPORTS.has('server'))"`：通过，输出 `true`。
- `git diff --check -- . ':!.omc'`：通过。

## 后续建议

1. 单独开任务栏歌词专项分支，决定是否采用上游新 `windows/taskbar-lyric/**` 架构。
2. 单独评估实验性 Automix 是否继续接入；若接入，再按当前 PlayerController / SongManager API 重写边界。
3. 若继续同步上游依赖，分批处理 AMLL、Electron、Vue、构建工具，避免一次性大升级。
