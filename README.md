# 抖娃福袋 Monorepo

仓库包含 Electron 桌面端、Go 福袋服务端及 Android 协议桥接应用。

## 目录结构

```text
apps/
├── desktop/       # Electron + React 桌面端
└── pool-server/   # Go 候选池、派单、学习反馈服务
android/           # Android 协议桥接应用
scripts/           # 构建和部署脚本
config.example.json
```

- [桌面端使用说明](apps/desktop/README.md)
- [服务端说明](apps/pool-server/README.md)
- [Android 说明](android/README.md)
- [部署指南](DEPLOY.md)

## 开发

需要 Node.js 22 及以上版本；本地运行 Go 服务端需要 Go 1.25 及以上版本。

```bash
npm ci
# 将 config.example.json 复制为 config.json，并按需修改服务地址及 Redis 配置
npm run desktop:electron:dev
```

客户端启动后直接进入工作台，添加抖音账号并登录即可使用。
全项目配置文件位于仓库根目录的 `config.json`。

## 常用命令

```bash
# 桌面端构建与测试
npm run desktop:build
npm run desktop:test

# Windows 安装包，输出到 apps/desktop/dist-electron
npm run desktop:electron:build:win

# Go 服务端与测试
npm run server:run
npm run server:test

# 构建镜像；使用根目录 config.json 部署
npm run server:docker:build
npm run server:docker:up

# 本地 Docker 环境：Redis + pool-server，使用 config.example.json
npm run server:docker:up:local
npm run server:docker:watch:local

# 生成桌面端热更新 manifest
npm run desktop:hot:manifest -- --base-url https://your-cdn.example.com/dy-fudai/desktop/3.0.0/
```

## Docker 热启动开发

`npm run server:docker:watch:local` 会先构建并部署，再监听服务端、桌面端、构建脚本和配置文件；修改后自动重新构建镜像并重启容器。按 `Ctrl+C` 停止监听。

本地服务地址为 `http://127.0.0.1:9090`，Redis 地址为 `127.0.0.1:16379`。
可用 `npm run server:docker:watch:local -- --port 9092` 覆盖业务服务端口。
