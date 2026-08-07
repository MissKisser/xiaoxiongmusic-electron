# 图标资源维护

> 本文档说明小熊音乐桌面端图标资源的统一来源、引用位置以及如何重新生成。

## 视觉主源

`public/icons/icon-1024.png`（1024 × 1024 PNG）是所有平台图标的视觉来源。

> 该文件与 `public/icons/logo-icon-1024x1024.png` 是同一份资源，可任选其一作为输入。

## 各图标用途

| 用途                              | 文件                                | 引用位置                                                    |
| --------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| 窗口 / 任务栏应用图标（开发态）   | `public/icons/logo.ico`             | `electron/main/windows/index.ts:5`（`?asset` 导入）         |
| 系统托盘主图标 Windows            | `public/icons/logo.ico`             | `electron/main/tray/index.ts:222`                           |
| 系统托盘主图标 macOS / Linux      | `public/icons/tray/tray@32.png`     | `electron/main/tray/index.ts:222`                           |
| electron-builder win `icon`       | `public/icons/logo.ico`             | `electron-builder.config.ts:38`                             |
| NSIS 安装/卸载图标                | `public/icons/favicon.ico`          | `electron-builder.config.ts:81,83`                          |
| macOS 打包图标                    | `public/icons/icon.icns`            | `electron-builder.config.ts:95`                             |
| Linux 打包图标                    | `public/icons/favicon-512x512.png`  | `electron-builder.config.ts:138`                            |
| 托盘菜单项图标（明暗两套）        | `public/icons/tray/*.png`           | `electron/main/tray/index.ts:58`                            |
| Windows 缩略图工具栏按钮          | `public/icons/thumbar/*.png`        | `electron/main/thumbar/index.ts:24-31`                      |

> **统一项**：Windows 平台上 任务栏托盘、窗口标题图标、打包后 EXE 图标 均来源于 `public/icons/logo.ico`，确保视觉一致。

## 重新生成 `logo.ico` 与 `tray@32.png`

`scripts/generate-icons.mjs` 会从 `icon-1024.png` 一次性生成：

- `public/icons/logo.ico` —— 含 **16 / 24 / 32 / 48 / 64 / 72 / 96 / 128 / 256** 九档 PNG 帧（用于 EXE 嵌入、`BrowserWindow.icon`、系统托盘）
- `public/icons/tray/tray@32.png` —— 32 × 32 RGBA PNG（用于 macOS/Linux 托盘主图标）

依赖：

- `png2icons`（已在 `devDependencies`）—— 用于 PNG → 多帧 ICO
- 系统 GDI+ —— 用于 1024 → 32 缩放（Windows 自带，无需额外安装）

运行：

```bash
node scripts/generate-icons.mjs
```

> 该脚本只在图标主源变更时使用，**不需要**作为常规构建步骤纳入 `pnpm build`。

## 当你换主图标时

1. 替换 `public/icons/icon-1024.png` 为新设计稿
2. 执行 `node scripts/generate-icons.mjs`
3. 检查三个 Windows 落地处的视觉效果（窗口、托盘、打包 EXE）
4. macOS / Linux 仍需手动用 IconUtil 等工具同步更新 `icon.icns` 与 `favicon-512x512.png`（本次范围外）
