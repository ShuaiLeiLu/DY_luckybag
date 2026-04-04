#!/bin/bash

echo "启动抖娃福袋桌面端..."
echo ""
echo "检查依赖..."

if [ ! -d "node_modules" ]; then
    echo "未找到 node_modules，正在安装依赖..."
    npm install
fi

echo ""
echo "依赖检查完成"
echo ""
echo "启动 Electron 桌面端..."
echo ""

npm run desktop:electron:dev
