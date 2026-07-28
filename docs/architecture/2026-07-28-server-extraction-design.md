# Server 抽取独立仓库设计

- **状态**:草案(待用户审阅)
- **日期**:2026-07-28
- **范围**:仅抽取 `server/`,其他代码(src/、electron/、native/、android/ 等)保持现状不动
- **目标**:解决两个下游仓库(electron / capacitor)各自维护 `server/` 副本导致的**后端代码漂移**问题

## 1. 背景与问题

当前存在三个相关项目:

| 项目 | 路径 | 角色 |
|---|---|---|
| `xiaoxiongmusic` | `D:\document\Projects\xiaoxiongmusic\xiaoxiongmusic\` | Electron 桌面端(从 SPlayer 二次开发) |
| `xiaoxiongmusic_capacitor` | `D:\document\Projects\xiaoxiongmusic\xiaoxiongmusic_capacitor\` | Capacitor 移动端(从 electron 独立开发) |
| `splayer-upstream-new` | `D:\document\Projects\xiaoxiongmusic\splayer-upstream-new\` | SPlayer 上游(只读参考) |

**核心问题**:两个下游仓库各有一份 `server/` 副本,通过手动复制同步。经实测:

- 17 个文件两边字节相同
- 6 个文件内容分叉,**其中 5 个是 electron 版本更新、capacitor 版本落后**
- electron 有 8 个 capacitor 缺失的文件(`package.json`、`tsconfig.json`、部署文档、`ncm-config.ts` 等)
- capacitor 有 2 个 electron 缺失的文件(`start-server*.bat` Windows 启动脚本)
- capacitor 的 `server/` 整体落后约 3~4 个月

具体漂移点(以 electron 为准):
- `routes/auth.ts`:electron 改为"按平台独立绑定",capacitor 仍是旧的"单设备绑定"
- `routes/version.ts`:electron 支持预发布版本号(`3.0.0-beta.9`),capacitor 只支持简单比较
- `routes/admin.ts`:electron 多了 IP 记录、设备活跃列表、按码聚合的设备视图
- `netease/index.ts`:electron 多了 `ncm-config` 配置加载逻辑
- `index.ts` / `start-simple.js`:仅注释/文案差异

**结论**:**electron 的 `server/` 是 canonical 版本**,capacitor 的是过时快照。抽取时直接以 electron 版本为准。

## 2. 设计决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 抽取范围 | 仅 `server/`,其他不动 | 用户明确要求最小范围;src/ 等留待将来评估 |
| capacitor 引用方式 | git submodule | 锁定 commit、git 原生、避免复制漂移 |
| server 仓库形态 | 独立 GitHub 仓库 `xiaoxiongmusic-server` | server 自带 CI/部署、两个项目平等引用 |
| 分叉文件裁决 | 以 electron 版本为准 | electron 版本更新,capacitor 落后;capacitor 独有 `.bat` 合并进来 |
| 部署配置归属 | server 仓库自带**纯 server** Dockerfile/CI/nginx | 线上已是分离部署;server 职责单一;老全家桶 Dockerfile 过渡期保留在 electron 仓库,新部署稳定后再删 |
| server 仓库 git 历史 | **全新仓库**,`git init` 从头开始 | 个人+AI 协作项目,blame 需求低;老仓库历史仍可查;`filter-repo` 投入产出比低 |
| 执行方式 | 先写 plan → 用户审 → 再执行 | 多步跨仓迁移,plan 能提前暴露问题,执行时按验证节点推进 |

## 3. 目标拓扑

### GitHub 仓库

```
MissKisser/xiaoxiongmusic-server     ← 新仓库(server 独立,自带 CI/部署)
MissKisser/xiaoxiongmusic            ← electron(server/ 改为 submodule)
MissKisser/xiaoxiongmusic_capacitor  ← capacitor(server/ 改为 submodule)
```

### 本地目录结构(改动后)

**electron 仓库** `xiaoxiongmusic/`:
```
xiaoxiongmusic/
├── .gitmodules                    ← 新增:记录 server submodule
├── server/                        ← 改为 submodule(指向 xiaoxiongmusic-server)
├── package.json                   ← 调整 server:* 脚本路径
├── electron/main/index.ts         ← 调整 import 路径(../server 不变,因为 submodule 仍在 server/ 目录)
├── electron/, src/, native/, ...  ← 完全不动
└── (Dockerfile, ecosystem.config.js, deploy/ 暂留;部署配置迁移到 server 仓库后可考虑清理)
```

**capacitor 仓库** `xiaoxiongmusic_capacitor/`:
```
xiaoxiongmusic_capacitor/
├── .gitmodules                    ← 新增
├── server/                        ← 改为 submodule(指向同一个 xiaoxiongmusic-server)
├── package.json                   ← 调整 server:dev 脚本路径
├── android/, src/, ...            ← 完全不动
```

**server 独立仓库** `xiaoxiongmusic-server/`(GitHub 新仓库):
```
xiaoxiongmusic-server/
├── package.json                   ← @xiaoxiong/server(原 electron server/package.json 改名)
├── tsconfig.json
├── index.ts
├── db.ts
├── check-port.ts, config.ts, logger.ts, store.ts, verify.ts, start.ts
├── start-simple.js
├── start-server.bat               ← 从 capacitor 合并
├── start-server-background.bat    ← 从 capacitor 合并
├── routes/
│   ├── auth.ts                    ← electron 版本(按平台独立绑定)
│   ├── admin.ts                   ← electron 版本(含设备视图、IP 记录)
│   └── version.ts                 ← electron 版本(支持预发布版本号)
├── netease/
│   ├── index.ts                   ← electron 版本(含 ncm-config 加载)
│   ├── ncm-config.ts              ← electron 独有,一并迁入
│   ├── ncm-api.d.ts               ← electron 独有,一并迁入
│   └── ...(其余 netease 文件两边相同)
├── qqmusic/                       ← 两边相同
├── unblock/                       ← 两边相同
├── proxy/                         ← 两边相同
├── .env.example                   ← electron 独有
├── .gitignore
├── Dockerfile                     ← 新写:纯 server Dockerfile(install + build:server + start)
├── docker-compose.yml             ← 新写:配套纯 server 容器
├── ecosystem.config.js            ← 新写:PM2 配置(纯 server)
├── nginx/                         ← 新写或迁入:nginx 反代配置
├── README.md
├── DEPLOYMENT.md
├── BAOTA-DEPLOY.md
├── BUILD-FRONTEND.md
├── .github/workflows/ci.yml       ← 新:server 独立 CI(tsc 编译 + 冒烟测试)
└── .github/workflows/deploy.yml   ← 新:server 部署到 music.viaxv.top
```

## 4. 迁移步骤(高层)

详细的步骤清单会在实施计划(plan)中展开,这里只列高层阶段:

**阶段 1:创建 server 独立仓库(全新 git 历史)**
1. 在本地新建 `xiaoxiongmusic-server/` 目录,`git init`(全新仓库,不从 electron 抽历史)
2. 从 electron `server/` 复制全部内容(33 个文件,即 canonical 版本)
3. 合并 capacitor 的 `start-server*.bat`(2 个文件)
4. 调整 `package.json` name 为 `@xiaoxiong/server`
5. **新写一个纯 server 的 Dockerfile**(不搬 electron 根的老全家桶 Dockerfile):`pnpm install → pnpm build:server → node out/server/start.js`。配套 `docker-compose.yml`、PM2 `ecosystem.config.js`、nginx 配置都按纯 server 重写
6. 创建独立 GitHub 仓库 `MissKisser/xiaoxiongmusic-server` 并推送
7. (可选)在 `docs/` 记一句"历史来源:从 electron 仓库 server/ 抽取,老仓库 `git log -- server/` 可查演进"

**阶段 2:electron 仓库接入 submodule**
1. 在 electron 仓库新建分支 `refactor/server-submodule`
2. 删除 `server/` 目录(`git rm -r server/`)
3. `git submodule add <server-repo-url> server`
4. 验证 `electron/main/index.ts:5` 的 `import initAppServer from "../server"` 仍能工作(submodule 在 `server/` 路径下,相对路径不变)
5. 验证 `package.json` 的 `server:*` 脚本(`build:server` 用 `tsconfig.server.json` 编译 `server/` → `out/server/`)路径仍正确
6. 验证 `electron.vite.config.ts` 的 `/api` 代理不受影响
7. 本地 `pnpm dev` 跑通桌面端、`pnpm server:dev` 跑通独立 server

**阶段 3:capacitor 仓库接入 submodule**
1. 在 capacitor 仓库新建分支 `refactor/server-submodule`
2. 删除 `server/` 目录
3. `git submodule add <server-repo-url> server`
4. 验证 `package.json` 的 `server:dev` 脚本路径
5. 验证 `vite.config.ts` 的 `/api` 代理目标(`https://music.viaxv.top`)不受影响
6. 本地 `pnpm dev` + `pnpm cap:sync` 跑通移动端

**阶段 4:CI 与部署迁移**
1. server 仓库配置独立 CI(GitHub Actions:`tsc --noEmit` + 可选冒烟测试)
2. server 仓库配置部署 workflow(用阶段 1 写的纯 server Dockerfile,构建 + 推送到 `music.viaxv.top`)
3. **过渡期保留** electron 根的老全家桶 Dockerfile,不删;线上切换到 server 仓库的新部署、稳定运行一段时间后,再清理 electron 根的 Dockerfile/docker-compose/ecosystem.config.js

**阶段 5:文档与 AGENTS 契约**
1. 在 server 仓库根写 `AGENTS.md`,说明这是两个 app(electron / capacitor)共享的后端
2. 在 electron 和 capacitor 仓库的 `CLAUDE.md`/`AGENTS.md` 里补一句:`server/` 是 submodule,指向 `xiaoxiongmusic-server`,改动请在 server 仓库进行
3. 更新两边的 `docs/.../upstream-sync.md`,把 server 相关的受保护文件清单标注为"已在 submodule,无需在主仓库同步"

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `electron/main/index.ts:5` 的 `import "../server"` 跨 submodule 失效 | electron 启动失败 | submodule checkout 后 `server/` 是正常目录,相对路径不变;阶段 2 步骤 4 验证 |
| `tsconfig.server.json` 编译 `server/` 时 TS 解析跨 submodule 出问题 | `pnpm build:server` 失败 | submodule 是普通目录,TS 无差别处理;阶段 2 步骤 5 验证 |
| submodule 初始化克隆漏掉 `--recursive` | 新人/CI 克隆后 server 为空 | `.gitmodules` + 仓库 README 标注 + CI 用 `actions/checkout` 时带 `submodules: true` |
| capacitor 原来依赖 server 落后版本的行为(如旧 auth 逻辑) | capacitor 接入新 server 后行为变化 | capacitor 现在用的是部署版 `music.viaxv.top`(已是 electron 的逻辑),本地 server 只用于开发;接入后本地开发行为与线上一致,反而是修复 |
| 部署配置迁移后路径错乱 | server 部署失败 | 阶段 1 步骤 4 单独验证 Dockerfile/nginx 路径;先在测试环境跑通再切线上 |
| git 历史断裂 | server 的 blame 丢失 | server 仓库可选择性用 `git filter-repo` 从 electron 历史里抽出 server/ 的提交历史(可选,非必须) |

## 6. 验收标准

迁移完成后,以下条件全部满足即为成功:

- [ ] `xiaoxiongmusic-server` GitHub 仓库存在,包含 35 个文件(33 + 2 bat)
- [ ] electron 仓库 `server/` 显示为 submodule(`git submodule status`)
- [ ] capacitor 仓库 `server/` 显示为 submodule,指向同一 commit
- [ ] electron:`pnpm dev` 能启动桌面端,API 正常(`electron/main/index.ts` 成功 import server)
- [ ] electron:`pnpm server:dev` 能独立启动 server,访问 `/api` 正常
- [ ] capacitor:`pnpm dev` + `/api` 代理正常
- [ ] capacitor:`pnpm cap:sync android` 不报错
- [ ] server 仓库 CI 通过(`tsc --noEmit`)
- [ ] server 独立部署到 `music.viaxv.top` 可用(或至少 CI 能构建镜像)
- [ ] 两个仓库的 `CLAUDE.md`/`AGENTS.md` 均说明 server 是 submodule

## 7. 不在本次范围

明确**不做**的事(避免范围蔓延):

- `src/` 的合并或共享(304 相同 + 89 分叉文件,留待将来评估)
- `native/` 的统一
- `public/assets/` 的共享
- electron/capacitor 合并为单一 monorepo
- iOS 支持
- SPlayer 上游同步流程的改造(本次只更新文档说明 server 已外部化)

## 8. 未来可选的演进

本次只抽 server。若将来想进一步统一:

1. **抽 `src/assets/`**:152 个纯静态资源两边字节相同,共享几乎零风险
2. **抽 `src/api/`、`src/views/`、`src/components/`**:大部分相同,但需处理分叉
3. **完整 monorepo**:server + renderer + 两个 app 统一管理

每一步都可以独立评估,本次不预设。
