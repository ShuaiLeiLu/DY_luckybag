#!/bin/bash

echo "🚀 启动抖音福袋助手..."
echo ""
echo "📦 检查依赖..."

# 检查 node_modules 是否存在
if [ ! -d "node_modules" ]; then
    echo "⚠️  未找到 node_modules，正在安装依赖..."
    npm install
fi

echo ""
echo "✅ 依赖检查完成"
echo ""
echo "🎯 启动应用..."
echo ""

npm run electron:dev
