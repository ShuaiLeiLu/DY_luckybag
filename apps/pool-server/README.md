# Pool Server

Go 服务端负责候选池、派单、扫描调度、任务反馈和学习回放，支持内存与 Redis 两种存储模式。

## 启动与测试

在仓库根目录执行：

```bash
npm run server:run
npm run server:test
```

也可在本目录执行 `go run ./cmd/poolserver` 或 `go test ./...`。
默认监听 `127.0.0.1:9090`。首次运行先在仓库根目录执行 `npm run setup:local`。
业务接口要求配置的 Bearer 令牌，健康检查与更新静态文件除外。
绑定非回环地址必须设置 `server.apiToken` 或环境变量 `POOL_API_TOKEN`。

## 配置文件

优先读取环境变量 `POOL_CONFIG_FILE` 指定的文件，否则读取仓库根目录 `config.json` 的 `poolServer` 节点。
可从 `config.example.json` 复制配置，使用 `redis.enabled` 选择 Redis 或内存模式。

系统公告读取 `poolServer.desktopNoticeMarkdown`，也可通过 `POOL_DESKTOP_NOTICE_MARKDOWN` 覆盖。修改后重启服务，桌面端从 `GET /desktop/notice` 获取公告。
参与历史保存在桌面端本地；`POST /task/feedback` 按事件 ID 幂等处理，
默认同步落盘到 `data/feedback.jsonl`；内存模式重启会重放日志。
任务领取、续期、释放、完成均校验实际租约与账号所有者，Redis 修改通过 Lua 原子执行。

## Docker

在仓库根目录执行：

```bash
npm run server:docker:build
npm run server:docker:up
# 本地 Redis + pool-server，使用 config.json
npm run server:docker:up:local
# 监听代码变化，自动构建并重启
npm run server:docker:watch:local
```

本地业务服务地址为 `http://127.0.0.1:9090`，Redis 地址为 `127.0.0.1:16379`。
使用 `npm run server:docker:watch:local -- --port 9092` 可透传部署参数。

## Desktop 热更新资源

构建镜像时会自动构建桌面端前端，静态资源位于 `/app/static/desktop`，可通过 `POOL_DESKTOP_STATIC_DIR` 覆盖。
对外路径为 `/desktop/hot-manifest.json` 和 `/desktop/<version>/`。

## 目录

```text
cmd/
├── poolserver/        # 服务入口
└── learning-replay/   # 学习回放入口
internal/pool/         # 候选池、派单、学习、Redis 实现
Dockerfile
docker-compose.yml
docker-compose.redis.yml
docker-compose.local.yml
```
