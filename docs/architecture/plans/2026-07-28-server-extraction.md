# Server 抽取独立仓库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 electron 和 capacitor 两个仓库各自维护的 `server/` 副本抽成一个独立 GitHub 仓库 `xiaoxiongmusic-server`,两边以 git submodule 引用,根治后端代码漂移。

**Architecture:** 以 electron 的 `server/`(canonical,33 文件)为基础,合并 capacitor 独有的 2 个 `.bat`,组成独立仓库。electron 和 capacitor 各自把 `server/` 改为指向同一仓库的 submodule。因 submodule 仍 checkout 在 `server/` 路径下,所有相对路径 import / tsconfig / npm script **无需改动**。

**Tech Stack:** Fastify 5、TypeScript 5、mysql2、pnpm、git submodule、Docker、GitHub Actions

**Spec:** `docs/architecture/2026-07-28-server-extraction-design.md`

---

## 关键前置事实(已验证)

| 事实 | 来源 | 对 plan 的影响 |
|---|---|---|
| `electron/main/index.ts:5` = `import initAppServer from "../server"` | 实测 | submodule 在 `server/` 下,路径不变,**无需改** |
| `tsconfig.server.json`: `rootDir: ./server`, `include: server/**/*` | 实测 | 路径不变,**无需改** |
| `package.json` server 脚本全用 `server/` 相对路径 | 实测 | 路径不变,**无需改** |
| capacitor 无 `tsconfig.server.json`,server 也无 `package.json`,纯 `node --import tsx` 跑 | 实测 | capacitor 接入几乎零改动 |
| server 自带独立 `package.json`(`xiaoxiong-music-server`,含完整 build/dev/start) | 实测 | server 仓库可自给自足 |
| electron 根 `Dockerfile` 是全家桶(renderer+nginx+unblock) | 实测 | **不搬**,server 仓库新写纯 server Dockerfile |
| electron 根 `docker-compose.yml` 是 SPlayer UnblockNeteaseMusic 容器 | 实测 | **跟 server 无关,不动** |
| electron 根 `ecosystem.config.js` 只跑 `out/server/start.js` | 实测 | 可作为 server 仓库 PM2 配置的参考 |
| 两仓库均在 `main` 分支,有未提交改动 | 实测 | Task 0 先清理工作区 |

---

## Task 0:清理工作区,准备分支

**目的:** 确保迁移在干净 git 状态下进行,避免 submodule 操作和已有未提交改动纠缠。

**Files:** 无(仅 git 操作)

- [ ] **Step 1:处理 electron 仓库未提交改动**

当前 electron 仓库 `main` 分支有未跟踪文件:`docs/architecture/`(就是本设计文档和 plan)。

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git status
```

预期:看到 `?? docs/architecture/`。

先提交设计文档到 main(这是文档,不是代码改动,可直达 main):

```bash
git add docs/architecture/
git commit -m "docs: server 抽取独立仓库的设计与实施计划"
```

- [ ] **Step 2:为迁移新建分支**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git checkout -b refactor/server-submodule
```

预期:切到 `refactor/server-submodule` 分支。

- [ ] **Step 3:处理 capacitor 仓库未提交改动**

capacitor 仓库有改动:`scripts/test-android-desktop-lyric.ts` 已修改,还有未跟踪的 `AGENTS.md`、`scripts/test-active-lyric-width.mjs`、`tmp/`、`.omc/`。

**这些改动与 server 迁移无关**,先 stash 保护起来:

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git stash push -u -m "wip: 迁移前暂存无关改动"
git status
```

预期:`working tree clean`。

- [ ] **Step 4:为 capacitor 迁移新建分支**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git checkout -b refactor/server-submodule
```

预期:切到 `refactor/server-submodule` 分支。

---

## Task 1:在本地组装 server 独立仓库

**目的:** 把 electron `server/`(canonical)+ capacitor 的 2 个 bat 组装成一个独立目录,准备成为新仓库。

**Files:**
- Create: `D:/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server/` (整个目录)

- [ ] **Step 1:创建新目录并初始化 git**

```bash
mkdir -p /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server
git init
git checkout -b main
```

- [ ] **Step 2:复制 electron server 全部内容(canonical)**

```bash
cp -r /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic/server/* /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server/
cp -r /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic/server/.env.example /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server/
cp -r /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic/server/.gitignore /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server/
```

- [ ] **Step 3:合并 capacitor 独有的 .bat 启动脚本**

```bash
cp /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor/server/start-server.bat /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server/
cp /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor/server/start-server-background.bat /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server/
```

- [ ] **Step 4:验证文件清单完整性**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server
find . -type f -not -path './.git/*' | sort | wc -l
```

预期:`35`(electron 33 + capacitor 2 bat;若 .env.example 和 .gitignore 各算一个,核对总数为 electron 原有数 + 2)。

```bash
find . -type f -not -path './.git/*' | sort
```

预期看到全部文件,包括:`index.ts`、`db.ts`、`start.ts`、`start-simple.js`、`start-server.bat`、`start-server-background.bat`、`check-port.ts`、`config.ts`、`logger.ts`、`store.ts`、`verify.ts`、`package.json`、`tsconfig.json`、`README.md`、`.env.example`、`.gitignore`、`DEPLOYMENT.md`、`BAOTA-DEPLOY.md`、`BUILD-FRONTEND.md`、`routes/{auth,admin,version}.ts`、`netease/{index,ncm-config,ncm-api.d}.ts`、`qqmusic/{index,qrc,tripledes}.ts`、`unblock/{index,bodian,gequbao,kuwo,kwDES}.ts`、`unblock/unblock.d.ts`、`proxy/index.ts`。

- [ ] **Step 5:本地验证 server 能独立编译运行**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server
pnpm install
pnpm build
```

预期:`tsc` 编译成功,产出 `dist/` 目录(或按 package.json 的 `outDir`)。**注意**:若 `pnpm install` 报 native 模块(bcrypt)编译错误,需确认本机有 windows-build-tools 或改用预先编译版本——这是 server 本来就有的依赖,不是迁移引入的问题。

如果只是验证编译不跑起来,可跳过运行:`pnpm build` 通过即可。

---

## Task 2:为 server 仓库写部署配置

**目的:** server 仓库自带纯 server 的 Dockerfile / PM2 / nginx,可独立部署。

**Files:**
- Create: `xiaoxiongmusic-server/Dockerfile`
- Create: `xiaoxiongmusic-server/docker-compose.yml`
- Create: `xiaoxiongmusic-server/ecosystem.config.js`
- Create: `xiaoxiongmusic-server/nginx/server.conf`
- Create: `xiaoxiongmusic-server/.dockerignore`

- [ ] **Step 1:写纯 server Dockerfile**

参考 electron 根的老 Dockerfile,但**只编译 server,不编 renderer**。server 的 `package.json` 已经是独立的(`xiaoxiong-music-server`),`build` 脚本是 `tsc`,产物在 `dist/`。

`xiaoxiongmusic-server/Dockerfile`:
```dockerfile
# ---- build stage ----
FROM node:22-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./

RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install --ignore-scripts

COPY . .

RUN pnpm build

# ---- runtime stage ----
FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV VITE_SERVER_PORT=25884

EXPOSE 25884

CMD ["node", "dist/start.js"]
```

- [ ] **Step 2:写 docker-compose.yml**

`xiaoxiongmusic-server/docker-compose.yml`:
```yaml
services:
  xiaoxiong-server:
    build:
      context: .
    image: xiaoxiong-server
    container_name: xiaoxiong-server
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    ports:
      - "25884:25884"
    restart: always
    env_file:
      - .env
```

- [ ] **Step 3:写 PM2 ecosystem.config.js**

参考 electron 根的老配置(`script: ./out/server/start.js`),改成 server 仓库的路径(`dist/start.js`)。注意 server `package.json` 的 build 产物在 `dist/` 不是 `out/server/`。

`xiaoxiongmusic-server/ecosystem.config.js`:
```javascript
module.exports = {
  apps: [
    {
      name: "xiaoxiong-server",
      script: "./dist/start.js",
      cwd: "/www/wwwroot/music.viaxv.top",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        VITE_SERVER_PORT: 25884,
        LOG_DIR: "/www/wwwroot/music.viaxv.top/logs",
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_memory_restart: "500M",
      watch: false,
    },
  ],
};
```

- [ ] **Step 4:写 nginx 反代配置**

`xiaoxiongmusic-server/nginx/server.conf`:
```nginx
server {
    listen 80;
    server_name music.viaxv.top;

    # API 反代到 server (PM2 跑在 25884)
    location /api/ {
        proxy_pass http://127.0.0.1:25884;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 静态前端(如需 server 仓库也托管前端,可选;默认不托管)
    # location / {
    #     root /www/wwwroot/music.viaxv.top/web;
    #     try_files $uri $uri/ /index.html;
    # }
}
```

**注意**:老部署里 nginx 是否还托管前端,取决于现有 `music.viaxv.top` 的实际配置。本 plan 默认 server 仓库**只负责 /api**,前端静态仍由 electron 仓库的 `build:web` 产物 + 另一套 nginx 负责。若线上是同一 nginx 同时服务前端和 API,部署时把上面注释的 `location /` 恢复即可。

- [ ] **Step 5:写 .dockerignore**

`xiaoxiongmusic-server/.dockerignore`:
```
node_modules
dist
.git
*.log
logs
.env
```

- [ ] **Step 6:本地验证 Dockerfile 可构建(可选,需 Docker 环境)**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server
docker build -t xiaoxiong-server-test .
```

预期:构建成功。**若本机无 Docker,跳过此步**,留待 CI 验证。

---

## Task 3:为 server 仓库写 CI

**目的:** server 仓库独立 CI,每次 push 验证编译。

**Files:**
- Create: `xiaoxiongmusic-server/.github/workflows/ci.yml`

- [ ] **Step 1:写 CI workflow**

`xiaoxiongmusic-server/.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts || pnpm install --ignore-scripts

      - name: Type check
        run: pnpm build
```

- [ ] **Step 2:验证 CI 语法(本地 lint)**

无直接 lint 工具,肉眼检查 YAML 缩进即可。也可选装 `actionlint`:

```bash
# 可选,需安装 actionlint
actionlint xiaoxiongmusic-server/.github/workflows/ci.yml
```

---

## Task 4:更新 server 仓库文档

**目的:** 让 server 仓库自解释——说明它是两个 app 共享的后端、引用方式、部署方式。

**Files:**
- Modify: `xiaoxiongmusic-server/README.md`(已从 electron 复制,需增补)
- Create: `xiaoxiongmusic-server/AGENTS.md`
- Create: `xiaoxiongmusic-server/docs/HISTORY.md`

- [ ] **Step 1:增补 README.md 顶部**

在现有 README 顶部插入一段说明这是共享后端。读现有 README 头部:

```bash
head -10 /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server/README.md
```

在第一个 `# 标题` 下方插入:

```markdown
> **这是 xiaoxiongmusic(electron 桌面端)和 xiaoxiongmusic_capacitor(移动端)共享的后端服务。**
>
> 两个 app 通过 git submodule 引用本仓库。改动请在本仓库进行,然后各 app 执行 `git submodule update --remote` 同步。
```

- [ ] **Step 2:写 AGENTS.md**

`xiaoxiongmusic-server/AGENTS.md`:
```markdown
# AGENTS.md - xiaoxiongmusic-server

这是小熊音乐的共享后端服务,被两个前端 app 引用:

- **xiaoxiongmusic**(Electron 桌面端):`server/` 是指向本仓库的 git submodule
- **xiaoxiongmusic_capacitor**(Capacitor 移动端):`server/` 是指向本仓库的 git submodule

## AI 协作须知

- **所有后端改动在本仓库进行**,不要在 electron 或 capacitor 仓库的 `server/` 子目录里直接改(submodule 内容应只读)。
- 改动提交后,通知两个 app 仓库的维护者执行 `git submodule update --remote server`。
- 受 SPlayer 上游影响的代码仅限 `netease/`、`qqmusic/`、`unblock/`、`proxy/` 的 API 封装;`routes/auth.ts`、`routes/admin.ts`、`routes/version.ts`、`db.ts` 是 xiaoxiongmusic 的二次开发内容,不来自上游。
- 部署:`pnpm build` → 产物在 `dist/` → 用 `ecosystem.config.js`(PM2)或 `Dockerfile`(容器)部署到 `music.viaxv.top`。

## 技术栈

Fastify 5 + TypeScript 5 + mysql2 + bcrypt + jsonwebtoken

## 开发

```bash
pnpm install
pnpm dev          # node --import tsx start.ts
```
```

- [ ] **Step 3:写历史来源说明**

`xiaoxiongmusic-server/docs/HISTORY.md`:
```markdown
# 仓库历史

本仓库于 2026-07-28 从 `xiaoxiongmusic`(Electron 桌面端)仓库的 `server/` 目录抽取,以全新 git 历史初始化。

## 查阅旧历史

抽取前的提交历史保留在原仓库:

```bash
git clone https://github.com/MissKisser/xiaoxiongmusic.git
cd xiaoxiongmusic
git log --oneline -- server/
```

## capacitor 来源差异

合并自 capacitor 仓库的文件:
- `start-server.bat`
- `start-server-background.bat`

其余文件全部来自 electron 仓库(electron 版本是 canonical,capacitor 之前是落后快照)。
```

---

## Task 5:创建 GitHub 远程仓库并首次推送

**目的:** 把本地组装好的 server 仓库推到 GitHub,作为 submodule 的目标。

**Files:** 无(GitHub 仓库创建 + git remote)

- [ ] **Step 1:确认 GitHub 用户名**

```bash
gh auth status
```

预期:已登录为 `MissKisser`(或你的实际用户名)。

- [ ] **Step 2:创建 GitHub 仓库**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server
gh repo create MissKisser/xiaoxiongmusic-server --private --source=. --remote=origin --description="小熊音乐共享后端服务(Fastify)"
```

预期:仓库创建成功,remote `origin` 指向 `https://github.com/MissKisser/xiaoxiongmusic-server.git`。

**注意**:用 `--private`,这是内部后端,不公开。

- [ ] **Step 3:首次提交并推送**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server
git add .
git commit -m "feat: 初始化 xiaoxiongmusic-server 共享后端

从 electron 仓库 server/ 抽取(canonical 版本),合并 capacitor 的 Windows 启动脚本。
包含独立 Dockerfile / PM2 / nginx 部署配置。
被 xiaoxiongmusic(electron)和 xiaoxiongmusic_capacitor 通过 git submodule 引用。"
git push -u origin main
```

预期:推送成功,远程仓库可见全部文件。

- [ ] **Step 4:记录 commit hash**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server
git rev-parse HEAD
```

把输出的 hash 记下来,后续 submodule add 会用到。

---

## Task 6:electron 仓库接入 submodule

**目的:** 把 electron 仓库的 `server/` 从普通目录改成 submodule。

**Files:**
- Modify: `xiaoxiongmusic/.gitmodules`(新增)
- Modify: `xiaoxiongmusic/server/`(从目录变成 submodule)

**⚠️ 风险提示:** 本 task 删除 `server/` 目录。若失败,`git checkout main` 可恢复(因为已在 refactor 分支,且 Task 0 已提交干净状态)。

- [ ] **Step 1:确认在正确分支**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git branch --show-current
```

预期:`refactor/server-submodule`。

- [ ] **Step 2:删除 server 目录(git rm)**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git rm -r server
git status
```

预期:`server/` 下所有文件显示为 deleted,等待提交。

- [ ] **Step 3:暂存删除,先不 commit**

我们用 `git rm` 但暂不 commit,因为 `git submodule add` 需要在干净(或已 stash)状态进行。先把删除暂存:

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git stash push -m "tmp: rm server before submodule add"
```

- [ ] **Step 4:添加 submodule**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git submodule add https://github.com/MissKisser/xiaoxiongmusic-server.git server
```

预期:`server/` 重新出现,但现在是 submodule。`.gitmodules` 文件生成。`git status` 显示 `.gitmodules` 和 `server` 为新文件。

**如果报错** `server already exists in the index`:说明上一步 stash 没把删除生效,执行 `git rm -r --cached server` 后重试。

- [ ] **Step 5:初始化 submodule 内容**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git submodule update --init --recursive
ls server/
```

预期:`server/` 下有完整的 35 个文件(`index.ts`、`db.ts`、`routes/` 等)。

- [ ] **Step 6:提交 submodule 接入**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git add .gitmodules server
git commit -m "refactor: server/ 改为 git submodule 指向 xiaoxiongmusic-server

server 抽取为独立仓库 MissKisser/xiaoxiongmusic-server。
所有 import 路径、tsconfig、npm script 因 submodule 仍在 server/ 路径下而无需改动。"
```

---

## Task 7:验证 electron 仓库接入后功能正常

**目的:** 确认 submodule 化没有破坏任何东西。

**Files:** 无(验证步骤)

- [ ] **Step 1:验证 import 路径**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
grep -n 'from "../server"' electron/main/index.ts
```

预期:`5:import initAppServer from "../server";`(不变)。

- [ ] **Step 2:验证 tsconfig.server.json 路径**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
cat tsconfig.server.json | grep -E 'rootDir|outDir|include'
```

预期:`"outDir": "./out/server"`、`"rootDir": "./server"`、`"include": ["server/**/*"]`(全部不变)。

- [ ] **Step 3:验证 server 独立编译**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
pnpm build:server
ls out/server/
```

预期:`tsc -p tsconfig.server.json` 编译成功,`out/server/` 下有 `start.js`、`index.js`、`routes/` 等编译产物。

**⚠️ 关键验证点**:如果这步失败,说明 tsc 跨 submodule 解析出问题。排查:`cd server && ls node_modules`——submodule 自己的依赖是否安装了。如果没装:

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic/server
pnpm install
cd ..
pnpm build:server
```

- [ ] **Step 4:验证 server 独立启动(可选,需 .env)**

如果本机有 MySQL 和 `.env` 配置:

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
cp server/.env.example server/.env
# 编辑 server/.env 填入测试 DB 配置
pnpm server:dev
```

预期:Fastify 启动,监听 25884,日志显示路由注册成功。

**如果没有 MySQL 测试环境,跳过此步**——编译通过(Task 3)已足够证明代码完整。运行验证留到 capacitor task 之后的综合验证,或线上部署时。

- [ ] **Step 5:验证 electron 桌面端构建(可选,耗时)**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
SKIP_NATIVE_BUILD=true pnpm build
ls out/main/index.js out/preload/index.js out/renderer/
```

预期:electron-vite 构建成功,三套产物齐全。`SKIP_NATIVE_BUILD=true` 跳过 Rust 编译加快速度。

**若时间紧张,可只跑 `pnpm build:server`(Step 3)和 `pnpm typecheck`**,跳过完整 build。

---

## Task 8:capacitor 仓库接入 submodule

**目的:** 同样把 capacitor 的 `server/` 改成 submodule。

**Files:**
- Modify: `xiaoxiongmusic_capacitor/.gitmodules`(新增)
- Modify: `xiaoxiongmusic_capacitor/server/`(从目录变成 submodule)

- [ ] **Step 1:确认分支**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git branch --show-current
```

预期:`refactor/server-submodule`。

- [ ] **Step 2:删除 server 目录并暂存**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git rm -r server
git stash push -m "tmp: rm server before submodule add"
```

- [ ] **Step 3:添加 submodule**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git submodule add https://github.com/MissKisser/xiaoxiongmusic-server.git server
git submodule update --init --recursive
ls server/
```

预期:同 Task 6,`server/` 有完整 35 文件。

- [ ] **Step 4:提交**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git add .gitmodules server
git commit -m "refactor: server/ 改为 git submodule 指向 xiaoxiongmusic-server

server 抽取为独立仓库,与 electron 端共享同一份后端代码。
capacitor 的 server:dev 脚本路径不变。"
```

---

## Task 9:验证 capacitor 仓库接入后功能正常

**目的:** 确认 capacitor 端能正常使用共享 server。

- [ ] **Step 1:验证 server:dev 脚本**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
grep "server:dev" package.json
```

预期:`"server:dev": "node --import tsx server/start.ts"`(路径不变)。

- [ ] **Step 2:验证 server 依赖可装可跑**

capacitor 之前 server 没有 `package.json`,现在 submodule 带来了完整的 package.json。安装 server 自己的依赖:

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor/server
pnpm install
cd ..
pnpm server:dev
```

预期:Fastify 启动。**注意**:这一步现在会用到 server 仓库 `package.json` 里的依赖(fastify/mysql2/bcrypt 等),capacitor 仓库根的 devDependencies 里也有这些(之前为了能 `node --import tsx` 跑),可能会有重复。若启动报 "duplicate module" 之类警告,可后续清理 capacitor 根 devDeps 里的 server 依赖——但**本次迁移不清理**,先保证能跑。

- [ ] **Step 3:验证 vite 代理**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
pnpm dev
```

启动后,在浏览器开发者工具 Network 面板看 `/api` 请求是否走代理(`vite.config.ts` 配置 target `https://music.viaxv.top`)。这个验证不需要 server 本地运行(代理目标是远程线上 server)。

预期:`/api/*` 请求 200 返回。

- [ ] **Step 4:验证 cap sync(可选,需 Android 环境)**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
pnpm cap:sync android
```

预期:同步成功,无报错。

**若无 Android SDK 环境,跳过此步**。

---

## Task 10:更新两个 app 仓库的文档

**目的:** 让两个 app 仓库明确告知 AI agent 和协作者:server 是 submodule。

**Files:**
- Modify: `xiaoxiongmusic/CLAUDE.md`
- Modify: `xiaoxiongmusic_capacitor/CLAUDE.md`(若存在)
- Modify: `xiaoxiongmusic_capacitor/AGENTS.md`

- [ ] **Step 1:在 electron CLAUDE.md 增补说明**

读现有 CLAUDE.md 找到描述 server 的位置:

```bash
grep -n "server" /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic/CLAUDE.md
```

在合适位置(通常是架构说明部分)插入:

```markdown
## 后端 server 说明(重要)

`server/` 是 **git submodule**,指向独立仓库 [xiaoxiongmusic-server](https://github.com/MissKisser/xiaoxiongmusic-server)。

- **不要直接在 `server/` 目录里改代码**——submodule 内容应视为只读引用。
- 后端改动请到 xiaoxiongmusic-server 仓库进行,然后执行 `git submodule update --remote server` 同步。
- server 与移动端(xiaoxiongmusic_capacitor)共享同一份代码。
- 首次克隆本仓库后需执行 `git submodule update --init --recursive` 初始化 server。
```

- [ ] **Step 2:同样更新 capacitor 的 CLAUDE.md / AGENTS.md**

capacitor 仓库 CLAUDE.md 和 AGENTS.md 内容相同(已验证),都加上同一段说明。

- [ ] **Step 3:更新两边的 upstream-sync 文档**

spec §4 阶段 5 第 3 条要求:把 server 相关的受保护文件清单标注为"已外部化"。

electron 的 `docs/development/upstream-sync.md`:

```bash
grep -n "server" /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic/docs/development/upstream-sync.md
```

在受保护文件清单(server 相关条目,如 `server/routes/auth.ts`、`server/db.ts` 等)附近加注释:

```markdown
> **注意**:`server/` 已于 2026-07-28 抽取为独立仓库 [xiaoxiongmusic-server](https://github.com/MissKisser/xiaoxiongmusic-server),作为 git submodule 引用。
> 上列 server 相关受保护文件**已不在本仓库**,后续 server 的改动请在 server 仓库进行。SPlayer 上游同步不再涉及 server/。
```

capacitor 的 `docs/upstream/sync-guide.md` 同样处理。

- [ ] **Step 4:提交文档更新**

electron:
```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git add CLAUDE.md
git commit -m "docs: 标注 server/ 为 git submodule"
```

capacitor:
```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git add CLAUDE.md AGENTS.md
git commit -m "docs: 标注 server/ 为 git submodule"
```

---

## Task 11:合并分支到 main

**目的:** 把 refactor 分支合并回 main,完成迁移。

**Files:** 无(git 操作)

**⚠️ 风险提示:** 合并到 main 后改动正式生效。合并前确认 Task 7 / Task 9 的验证全部通过。

- [ ] **Step 1:electron 合并**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git checkout main
git merge refactor/server-submodule
```

预期:fast-forward 或干净 merge。

- [ ] **Step 2:capacitor 合并**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git checkout main
git merge refactor/server-submodule
```

- [ ] **Step 3:恢复 capacitor 之前 stash 的改动**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git stash list
git stash pop
```

预期:Task 0 stash 的 `scripts/test-android-desktop-lyric.ts` 改动等恢复。如有冲突,手动解决。

- [ ] **Step 4:推送两个仓库**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git push origin main

cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git push origin main
```

- [ ] **Step 5:删除 refactor 分支(可选)**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git branch -d refactor/server-submodule

cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git branch -d refactor/server-submodule
```

---

## Task 12:最终验收

**目的:** 按 spec §6 的验收标准逐项确认。

- [ ] **Step 1:确认 server GitHub 仓库存在且文件齐全**

```bash
gh repo view MissKisser/xiaoxiongmusic-server
gh api repos/MissKisser/xiaoxiongmusic-server/contents | jq '. | length'
```

预期:仓库可见,文件数 ≥ 35(加上 Dockerfile/docker-compose 等部署配置)。

- [ ] **Step 2:确认两个 app 的 server/ 是 submodule**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git submodule status

cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git submodule status
```

预期:两边都显示 `server` submodule,指向同一 commit hash。

- [ ] **Step 3:确认两边指向同一 commit**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git submodule status | awk '{print $1}'
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic_capacitor
git submodule status | awk '{print $1}'
```

预期:两个 hash 相同。

- [ ] **Step 4:确认 server CI 通过**

```bash
gh run list --repo MissKisser/xiaoxiongmusic-server --limit 3
```

预期:最新 CI run 状态为 success(或至少 build job 绿)。

- [ ] **Step 5:填验收清单**

对照 spec §6 逐项打勾:
- [ ] server GitHub 仓库存在,文件齐全
- [ ] electron server/ 是 submodule
- [ ] capacitor server/ 是 submodule,同一 commit
- [ ] electron `pnpm build:server` 通过
- [ ] capacitor `pnpm server:dev` 可启动(或有线上验证)
- [ ] server 仓库 CI 通过
- [ ] 两个仓库 CLAUDE.md/AGENTS.md 均说明 server 是 submodule

---

## 部署切换(迁移完成后,线上切换到新 server 仓库部署)

**这一步不在本 plan 的代码迁移范围内,但提供操作指南。**

- [ ] **Step 1:在测试环境用新 Dockerfile 跑 server**

```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic-server
docker build -t xiaoxiong-server-test .
docker run -p 25885:25884 --env-file .env xiaoxiong-server-test
```

测试 `http://localhost:25885/api/...` 返回正常。

- [ ] **Step 2:线上切换**

在 `music.viaxv.top` 服务器:
1. 克隆 server 仓库到新目录(如 `/www/wwwroot/xiaoxiong-server`)
2. `pnpm install && pnpm build`
3. 用新 `ecosystem.config.js` 起 PM2:`pm2 start ecosystem.config.js`
4. nginx 切换 `/api` 反代到新进程(若端口不变则无需改 nginx)
5. 观察 1~3 天,确认稳定后停掉老部署

- [ ] **Step 3:清理 electron 根的老部署配置**

线上稳定后,删除 electron 仓库根的:
- `Dockerfile`
- `docker-compose.yml`
- `ecosystem.config.js`
- `docker-entrypoint.sh`
- `nginx.conf`(若有)

**注意**:`docker-compose.yml` 是 SPlayer 的 UnblockNeteaseMusic 容器,确认线上没用它再删。

提交:
```bash
cd /d/document/Projects/xiaoxiongmusic/xiaoxiongmusic
git rm Dockerfile docker-compose.yml ecosystem.config.js docker-entrypoint.sh
git commit -m "chore: 移除已迁至 xiaoxiongmusic-server 的部署配置"
```
