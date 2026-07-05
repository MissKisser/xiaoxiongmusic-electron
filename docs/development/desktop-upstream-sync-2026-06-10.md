# 桌面端上游同步记录（2026-06-10）

## 同步窗口

- 上游：`imsyy/SPlayer` `dev`
- 对比范围：`28b76bad..40d9ec60`（即 2026-06-08 同步窗口之后的新增提交）
- 上游 tip：`40d9ec60` Merge pull request #1098 from U1traVeno/fix/macos-dock-activate（2026-06-10 11:56）

## 本轮范围

继续沿用上轮「只同步低风险、可验证补丁」的策略，不合入任务栏歌词大重构或大版本依赖升级。

### 已同步

#### 1. macOS 激活时恢复主窗口（上游 `ab30aa0d`）

- 上游 PR：#1098（`U1traVeno/fix/macos-dock-activate`）
- 问题：macOS 下点击 dock 图标时只调用 `allWindows[0].focus()`，当窗口已被关闭但应用仍运行时无法恢复窗口。
- 改动：`electron/main/index.ts` 的 `app.on("activate", ...)` 增加 `isMac` 分支，调用 `mainWindow.showWindow()` 后直接返回。
- 兼容性：`isMac` 已在文件顶部导入；`mainWindow` 默认导出的实例有 `showWindow()` 方法（`electron/main/windows/main-window.ts`）。

#### 2. Linux 桌面项 WMClass 不匹配修复（上游 `aaef104c`）

- 上游 PR：#1099（`MoYingJi/fix/linux-desktop`）
- 问题：`.desktop` 文件的 WMClass 与 MPRIS `desktop_entry`、运行时窗口 WMClass 不一致，导致任务栏 / dock 无法正确关联应用窗口与桌面项。
- 改动（结合本地分叉调整，详见下节）：
  - `package.json` 新增顶层 `desktopName: "top.misskisser.XiaoxiongMusic"`。
  - `electron-builder.config.ts` Linux 块新增 `syncDesktopName: true`（让生成的 `.desktop` 文件名 = `desktopName`）。
  - `native/external-media-integration/src/sys_media/linux.rs` 新增 `.desktop_entry("top.misskisser.XiaoxiongMusic")`，并将 MPRIS `.identity("SPlayer")` 改为 `.identity("XiaoxiongMusic")`。
  - 升级 `electron-builder: ^26.0.12 → ^26.15.3`（对齐上游，`syncDesktopName` 选项需要新版支持）。

> **关键约束**：`package.json` 的 `desktopName` 必须与 `linux.rs` 的 `desktop_entry` 字符串**完全相同**，这是本修复生效的必要条件。

### 本地分叉处理

由于本地仓库与上游基于不同基线，本地的 `linux.rs` 此前**没有** `.desktop_entry(...)` 这一行（上游是在已有 `"SPlayer"` 的基础上替换）。因此本地采用「新增一行 + 改 identity 显示名」的方式达成同等效果，而非照搬上游 diff。

其他刻意保留、与上游 `splayer/dev` 当前状态完全一致的字段：

- `package.json` 的 `appId: com.imsyy.splayer`：保留，避免升级后 macOS/Windows 配置目录迁移导致用户数据丢失。Linux 上 `appId` 与 `desktopName` 相互独立，不影响 WMClass 修复。
- `pnpm.overrides` 继续锁定 `dmg-builder: "26.0.12"` 与 `electron-builder-squirrel-windows: "26.0.12"`：**上游 `splayer/dev` 当前同样保留这两个 override 在 26.0.12**（`electron-builder` 主包为 `^26.15.3`，但 dmg-builder / squirrel-windows 子包被锁住），这是上游作者有意保留的状态。本地严格对齐上游，不擅自升级这两个子包。安装时会出现 peer dependency 版本不匹配的警告（`electron-builder 26.15.3` 期望 `dmg-builder 26.15.3`），属上游固有问题，不影响 Linux 构建路径，macOS DMG 构建是否受影响留待 mac 构建机实测。
- `electron-builder.config.ts` 中 nsis / portable / dmg / zip / pacman 等 target 的纯格式化改动：未同步，无功能意义。
- `maintainer`、`MimeType` 等本地已定制字段：保持不变。

### 本轮跳过

- **eslint release 脚本豁免**（上游 `f22aa312`）：仅为 `.github/scripts/prepare-release-assets.cjs` 增加 lint 豁免规则，本地不存在该脚本，同步后规则无目标文件，无意义。
- 任务栏歌词架构重构：与上一轮一致，需单独专项分支评估。
- 大版本依赖升级（Electron / Vue / AMLL 等）：本轮只升级 `electron-builder` 一个包。

## 验证结果

- `pnpm install`：通过，`electron-builder` 升级至 `26.15.3`，`dmg-builder` / `electron-builder-squirrel-windows` 经 `pnpm.overrides` 保持 `26.0.12`（与上游一致）。postinstall（`@electron/rebuild`）正常完成，`bcrypt` / `better-sqlite3` 原生模块 rebuild 通过。安装时有上游固有的 peer dependency 版本不匹配警告，不影响构建。
- `pnpm typecheck:node`：通过。
- `pnpm typecheck:web`：通过（仅历史遗留 TS6307 告警，与本次无关）。
- `git diff --check -- . ':!.omc' ':!pnpm-lock.yaml'`：通过。
- Rust 端 `linux.rs` 改动与 Linux 实际构建环境验证：留待 Linux 构建机确认（本机为 Windows，无完整 Linux 工具链）。

## 后续建议

1. 在 Linux 构建机执行 `pnpm build:linux` 验证 `.desktop` 文件名、WMClass、MPRIS `desktop_entry` 三者一致。
2. 在 macOS 上验证点击 dock 图标能恢复主窗口（覆盖窗口已关闭但进程未退出的场景）。
3. 评估是否需要把 `appId` 一并迁移到 `top.misskisser.XiaoxiongMusic`（需提供配置迁移逻辑，避免老用户数据丢失）。
