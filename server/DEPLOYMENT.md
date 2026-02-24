# 后端独立部署指南

## 快速开始

### 1. 安装依赖

```bash
cd server
pnpm install
# 或
npm install
```

### 2. 配置环境变量（可选）

创建 `.env` 文件：

```bash
# 服务端口（默认：25884）
VITE_SERVER_PORT=25884

# 生产/开发环境
NODE_ENV=production

# 数据库配置（可选，如果需要授权功能）
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=xiaoxiong_music
```

### 3. 运行服务

#### 开发环境（使用 TypeScript 直接运行）

```bash
pnpm dev
```

#### 生产环境（编译后运行）

```bash
# 1. 编译
pnpm build

# 2. 运行
pnpm start
```

## 部署方式

### 方式一：使用 PM2（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start dist/start.js --name xiaoxiong-music-api

# 查看状态
pm2 status

# 查看日志
pm2 logs xiaoxiong-music-api

# 重启
pm2 restart xiaoxiong-music-api

# 停止
pm2 stop xiaoxiong-music-api

# 设置开机自启
pm2 startup
pm2 save
```

### 方式二：使用 Docker

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

# 复制 package.json 和 pnpm-lock.yaml
COPY package.json pnpm-lock.yaml* ./

# 安装 pnpm 和依赖
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 编译
RUN pnpm build

# 暴露端口
EXPOSE 25884

# 运行
CMD ["pnpm", "start"]
```

构建和运行：

```bash
docker build -t xiaoxiong-music-api .
docker run -d -p 25884:25884 --name music-api xiaoxiong-music-api
```

### 方式三：使用 systemd（Linux）

创建 `/etc/systemd/system/xiaoxiong-music.service`：

```ini
[Unit]
Description=Xiaoxiong Music API Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/server
ExecStart=/usr/bin/node dist/start.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=VITE_SERVER_PORT=25884

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable xiaoxiong-music
sudo systemctl start xiaoxiong-music
sudo systemctl status xiaoxiong-music
```

## 文件结构

```
server/
├── package.json        # 独立的包配置
├── tsconfig.json       # TypeScript 配置
├── .gitignore          # Git 忽略文件
├── start.ts            # 入口文件
├── index.ts            # 主服务器逻辑
├── config.ts           # 配置
├── logger.ts           # 日志工具
├── db.ts               # 数据库连接
├── routes/             # 路由
│   ├── admin.ts        # 管理接口
│   ├── auth.ts         # 授权接口
│   └── version.ts      # 版本接口
├── netease/            # 网易云 API
├── qqmusic/            # QQ 音乐 API
├── unblock/            # 解锁服务
└── proxy/              # 代理服务
```

## 修改 CORS 域名

如果前端域名改变，需要修改 `index.ts` 中的 CORS 白名单：

```typescript
const allowedOrigins = [
    "https://music.viaxv.cn",  // 改为新域名
    "http://localhost:5173",
    // ...
];
```

## 常见问题

### 1. 端口被占用

修改环境变量 `VITE_SERVER_PORT` 或在启动时指定：

```bash
VITE_SERVER_PORT=3000 pnpm start
```

### 2. 数据库连接失败

确保 MySQL 已安装并运行，检查 `.env` 中的数据库配置。

授权功能需要数据库，如果不需要可以忽略此错误。

### 3. TypeScript 编译错误

确保使用 Node.js 18+ 版本：

```bash
node -v  # 应该 >= 18.0.0
```

## API 端点

服务启动后，可以访问：

- **API 信息**: `http://localhost:25884/api`
- **网易云 API**: `http://localhost:25884/api/netease/*`
- **解锁服务**: `http://localhost:25884/api/unblock/*`
- **QQ 音乐**: `http://localhost:25884/api/qqmusic/*`
- **代理服务**: `http://localhost:25884/api/proxy/*`
- **授权接口**: `http://localhost:25884/api/auth/*`
- **管理接口**: `http://localhost:25884/api/admin/*`

## 性能优化建议

1. **使用编译后的代码**：生产环境务必使用 `pnpm build` 编译后的代码
2. **使用进程管理器**：PM2 可以自动重启、负载均衡
3. **配置反向代理**：使用 Nginx 或 Caddy 作为反向代理，提供 HTTPS
4. **启用缓存**：合理配置 Redis 缓存热门数据
5. **监控日志**：定期检查日志文件，及时发现问题

## 更新部署

```bash
# 1. 停止服务
pm2 stop xiaoxiong-music-api

# 2. 更新代码
git pull

# 3. 安装依赖（如有变化）
pnpm install

# 4. 重新编译
pnpm build

# 5. 启动服务
pm2 restart xiaoxiong-music-api
```

## 技术支持

如有问题，请查看：
- 项目主 README
- server/FIXES.md
- 日志文件
