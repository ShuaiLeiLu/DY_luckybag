# 抖娃福袋部署指南

## 配置

将根目录 `config.example.json` 复制为 `config.json`，设置：

- `desktop.poolServerUrl`：桌面端访问的业务服务地址。
- `poolServer.server`：服务端监听地址、端口和请求体限制。
- `poolServer.redis`：共享候选池的 Redis 地址及连接参数；关闭 `enabled` 可使用内存模式。
- `poolServer.desktopNoticeMarkdown`：可选的桌面端系统公告。
- `desktop.updateFeedUrl` 和热更新配置：客户端更新资源地址。

桌面端和服务端均可直接读取根配置。需要同步桌面端内置地址及生成服务端独立配置时，执行 `node deploy-setup.js`。

## 服务端

在仓库根目录执行：

```bash
npm ci
npm run server:docker:build
npm run server:docker:up
```

默认部署使用 `config.json` 中配置的外部 Redis。需要同时部署 Redis 时，执行：

```bash
bash ./scripts/deploy-pool-local.sh --redis
```

本地开发环境使用示例配置和内置 Redis：

```bash
npm run server:docker:up:local
# 修改源码后自动构建、重启
npm run server:docker:watch:local
```

业务服务默认监听 `9090` 端口，可将域名反向代理到此端口。
健康检查地址：`http://127.0.0.1:9090/health`。
镜像构建会同时生成桌面前端热更新资源，通过 `/desktop/hot-manifest.json` 和 `/desktop/<version>/` 提供访问。

## Windows 桌面端

```bash
npm ci
npm run desktop:electron:build:win
```

安装包输出到 `apps/desktop/dist-electron`；单独的前端构建产物位于 `apps/desktop/dist`。
打开客户端后直接进入工作台，添加抖音账号、扫码登录并启动任务。
