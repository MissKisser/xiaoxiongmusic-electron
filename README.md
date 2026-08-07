<div align="center">
<img alt="logo" height="100" width="100" src="public/icons/favicon.png" />
<h2> 小熊音乐 </h2>
<p> 一个简约的音乐播放器 </p>

[Releases](https://github.com/MissKisser/xiaoxiongmusic-electron/releases) | [上游项目 SPlayer](https://github.com/imsyy/SPlayer)

<br />

![Version](https://img.shields.io/github/v/release/MissKisser/xiaoxiongmusic-electron)
![License](https://img.shields.io/github/license/MissKisser/xiaoxiongmusic-electron)
![Stars](https://img.shields.io/github/stars/MissKisser/xiaoxiongmusic-electron?style=flat)

</div>

## 关于本项目

本项目基于 [SPlayer](https://github.com/imsyy/SPlayer)（作者 [imsyy](https://github.com/imsyy)）进行二次开发，在保留上游核心功能的基础上，新增了以下独有功能：

- **音频均衡器** - 支持多频段调节，打造个性化听感
- **歌曲百科** - 展示歌曲详细信息、艺术家介绍
- **授权系统** - 完整的客户端授权验证与管理后台
- **Admin WebUI** - 管理后台界面，支持授权码管理、设备管理、数据统计
- **多源歌词解析** - 支持 QQ 音乐、网易云等多平台歌词源
- **歌曲解锁增强** - 多解锁源支持（酷我、歌曲宝、波点音乐等）

本项目采用 [Vue 3](https://cn.vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) + [Naive UI](https://www.naiveui.com/) + [Electron](https://www.electronjs.org/) 开发，支持网页端与客户端。

> [!IMPORTANT]
>
> 本项目基于 [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) 许可协议开源，二次开发时请遵守以下规则：
>
> - 修改和分发必须基于 AGPL-3.0，源代码必须一并提供
> - 派生作品必须同样采用 AGPL-3.0
> - 必须注明原作者（imsyy）及上游项目（SPlayer）
> - 禁止用于商业及非法用途

## 功能特性

### 核心功能

- ✨ 扫码登录 / 手机号登录
- 🎵 播放网易云音乐（支持无版权歌曲解锁）
- ⬇️ 歌曲下载（最高支持 Hi-Res）
- 📁 本地歌曲管理与标签编辑
- ☁️ 云盘音乐上传与管理
- 📝 逐字歌词显示与滚动
- 🎶 音乐频谱显示
- 🌐 Subsonic / Navidrome 流媒体服务支持
- 📱 移动端基础适配

### 独有功能

| 功能 | 说明 |
|------|------|
| 🎛️ 音频均衡器 | 10频段调节，预设方案保存 |
| 📖 歌曲百科 | 歌曲详情、艺术家介绍、专辑信息 |
| 🔐 授权系统 | 客户端授权验证，防止未授权使用 |
| 🖥️ Admin WebUI | 授权码管理、设备管理、数据统计 |
| 🔄 多源歌词 | QQ 音乐歌词、TTML 歌词优先级选择 |
| 🔓 解锁增强 | 酷我、歌曲宝、波点音乐等多源解锁 |

### 界面特性

- 🎨 封面主题色自适应，全站着色
- 🌚 Light / Dark / Auto 模式切换
- 💻 桌面歌词（客户端）
- 🔄 PWA 支持
- 💬 评论区支持
- 🎵 Last.fm Scrobble

## 授权系统

本项目包含完整的客户端授权系统，仅对 Electron 桌面客户端生效。

### 系统架构

```
客户端 (Electron)
    ├── 授权弹窗 - 验证授权码
    ├── 设备 ID - 唯一标识
    └── Pinia Store - 授权状态管理

后端服务
    ├── 授权 API - /api/auth/*
    ├── 管理 API - /api/admin/*
    └── JWT 认证 - 管理员登录

数据库 (MySQL)
    ├── auth_codes - 授权码表
    ├── devices - 设备绑定表
    ├── admin_users - 管理员表
    └── audit_logs - 操作日志表
```

### 授权机制

- **平台独立绑定**：同一授权码可在 Windows/macOS 各绑定一台设备
- **自动踢出**：新设备登录自动踢掉同平台旧设备
- **管理后台**：`/admin` 路径访问，支持授权码生成、查询、禁用

详细实现请参考 [上游同步指南](docs/development/upstream-sync.md)。

## 环境要求

- Node.js >= 20
- pnpm >= 8
- Rust 工具链（可选，用于原生模块）
- MySQL（授权系统需要）

## 快速开始

### 安装

```bash
# 安装 pnpm
npm install pnpm -g

# 克隆项目
git clone https://github.com/MissKisser/xiaoxiongmusic-electron.git

# 安装依赖
cd xiaoxiongmusic-electron && pnpm install
```

### 开发

```bash
# Electron 开发模式
pnpm dev

# Web 开发模式
pnpm web:dev
```

### 构建

```bash
# Windows 客户端
pnpm build:win

# 多架构构建
pnpm build:win -- --x64 --arm64

# Web 前端
pnpm build:web
```

### 后端服务

```bash
# 开发模式
pnpm server:dev

# 生产模式
pnpm server:start
```

## 环境配置

复制 `.env.example` 为 `.env`：

```bash
# 网易云 API 地址（必填）
VITE_API_URL=https://your-api.example.com

# 服务器端口
VITE_SERVER_PORT=25884

# 数据库配置（授权系统）
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=music
DB_PORT=3306

# JWT 密钥
JWT_SECRET=your_secret_key
```

## 获取客户端

前往 [Releases](https://github.com/MissKisser/xiaoxiongmusic-electron/releases) 页面下载最新版本：

| 文件 | 说明 |
|------|------|
| `小熊音乐-x.x.x-setup.exe` | 双架构安装包（x64 + arm64） |
| `小熊音乐-x.x.x-portable.exe` | 双架构便携版 |
| `小熊音乐-x.x.x-x64-setup.exe` | x64 安装包 |
| `小熊音乐-x.x.x-arm64-setup.exe` | arm64 安装包 |

## 常见问题

**Q: 原生模块编译失败？**

> 设置环境变量跳过：`SKIP_NATIVE_BUILD=true pnpm install`

**Q: 授权系统如何部署？**

> 1. 创建 MySQL 数据库
> 2. 执行 `scripts/init_database.sql` 初始化表结构
> 3. 配置 `.env` 中的数据库连接
> 4. 启动后端服务 `pnpm server:start`

**Q: 如何同步上游更新？**

> 参考 [上游同步指南](docs/development/upstream-sync.md) 中的同步流程

## 代码同步规范

从 SPlayer 同步代码时，请严格遵守 [上游同步指南](docs/development/upstream-sync.md)：

- 保留二次开发内容（均衡器、百科、授权系统）
- 不覆盖授权相关文件
- 使用规范的 Git 提交格式

## 免责声明

本项目仅供个人学习研究使用，禁止用于商业及非法用途。使用本项目带来的任何风险和责任由使用者自行承担。

本项目开发者不对本项目提供的服务和内容做出任何保证。

## 开源许可

- 本项目基于 [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) 许可
- 上游项目：[SPlayer](https://github.com/imsyy/SPlayer) by [imsyy](https://github.com/imsyy)
- 二次开发请遵守 AGPL-3.0 协议，注明原作者

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=MissKisser/xiaoxiongmusic-electron&type=Date)](https://star-history.com/#MissKisser/xiaoxiongmusic-electron&Date)