#!/bin/bash

# SPlayer 部署脚本
# 用于在 Linux 服务器上快速部署

set -e

PROJECT_DIR="/www/wwwroot/music.viaxv.top"
cd "$PROJECT_DIR"

echo "=========================================="
echo "  SPlayer 部署脚本"
echo "=========================================="
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装 Node.js 20+"
    exit 1
fi

# 检查 pnpm
if ! command -v pnpm &> /dev/null; then
    echo "❌ 未找到 pnpm，请先安装 pnpm"
    exit 1
fi

echo "✅ 环境检查通过"
echo ""

# 安装依赖
echo "📦 安装依赖..."
pnpm install

# 构建项目
echo "🔨 构建前端..."
SKIP_NATIVE_BUILD=true pnpm build

echo "🔨 编译服务器..."
pnpm server:build

# 检查构建结果
if [ ! -f "out/renderer/index.html" ]; then
    echo "❌ 前端构建失败，未找到 index.html"
    exit 1
fi

if [ ! -f "out/server/start.js" ]; then
    echo "❌ 服务器编译失败，未找到 start.js"
    exit 1
fi

echo "✅ 构建完成"
echo ""

# PM2 管理
if command -v pm2 &> /dev/null; then
    echo "🔄 管理 PM2 进程..."
    
    # 检查是否已运行
    if pm2 list | grep -q "splayer-server"; then
        echo "  重启现有进程..."
        pm2 restart splayer-server
    else
        echo "  启动新进程..."
        pm2 start out/server/start.js --name splayer-server --env production
        pm2 save
    fi
    
    echo "✅ PM2 进程已启动"
    echo ""
    echo "📊 进程状态："
    pm2 status
    echo ""
    echo "📝 查看日志: pm2 logs splayer-server"
else
    echo "⚠️  未找到 PM2，请手动启动服务器"
    echo "   运行: node out/server/start.js"
fi

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo ""
echo "🌐 访问地址:"
echo "   前端: https://music.viaxv.top"
echo "   API:  https://music.viaxv.top/api"
echo ""
echo "📋 下一步："
echo "   1. 确保 Nginx 配置已更新"
echo "   2. 配置 SSL 证书（如未配置）"
echo "   3. 访问 https://music.viaxv.top 测试"
echo ""
