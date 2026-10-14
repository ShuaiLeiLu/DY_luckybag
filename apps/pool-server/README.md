# Pool Server

Go 服务端目录，负责候选池、派单、授权、试用；管理后台已拆分为独立服务。

## 启动

```bash
cd apps/pool-server
go run ./cmd/poolserver
```

默认监听 `0.0.0.0:9090`。
建议开发时在仓库根目录使用 `npm run server:run` 一次性同时拉起 poolserver 与 admin。

## 管理后台（独立服务）

```bash
cd apps/pool-server
go run ./cmd/licenseadmin
```

默认监听 `127.0.0.1:9091`，访问 `http://127.0.0.1:9091/admin`。
`poolserver` 的 `/admin` 入口会重定向到该地址。

常用环境变量：

- `POOL_ADMIN_HOST` / `POOL_ADMIN_PORT`
- `POOL_ADMIN_SESSION_SECRET`
- `POOL_ADMIN_SESSION_TTL_HOURS`
- `POOL_LICENSE_ADMIN_USERNAME` / `POOL_LICENSE_ADMIN_PASSWORD`
  仅在数据库管理员表为空时用于首个管理员引导创建，后续登录认证走数据库。
  不建议写入 `config.json`，推荐只通过环境变量提供。

兼容说明：

- `POOL_LICENSE_ADMIN_PASSWORD` 未配置时，会回退使用 `POOL_LICENSE_ADMIN_TOKEN` 作为登录密码。

## 配置文件

服务端按以下顺序查找配置：

1. `POOL_CONFIG_FILE`
2. 仓库根目录 `config.json`

统一配置读取 `config.json` 的 `poolServer` 节点。

## 常用命令

在仓库根目录执行：

```bash
npm run server:run
npm run server:run:pool
npm run server:run:admin
npm run server:test:license
npm run server:docker:build
npm run server:docker:up

# 本地完整 Docker 环境（MySQL + Redis + pool-server + license-admin）
npm run server:docker:up:local

# 本地 Docker 热启动
npm run server:docker:watch:local
npm run server:db:init
```

## Desktop 热更新资源

- 执行 `npm run server:docker:build` 时，会自动构建 Desktop 前端并把最新资源打入服务端镜像。
- 镜像内默认静态目录：`/app/static/desktop`
- 对外访问路径：
  - `/desktop/hot-manifest.json`
  - `/desktop/<version>/...`（`index.html` 与 `assets/*`）

可通过环境变量覆盖静态目录：

```bash
POOL_DESKTOP_STATIC_DIR=/app/static/desktop
```

## 目录

```text
apps/pool-server/
├── cmd/
│   ├── licenseadmin/      # 独立授权管理后台
│   ├── poolserver/        # 服务入口
│   └── learning-replay/   # 学习回放入口
├── internal/
│   ├── license/           # 授权、试用、小程序绑定
│   └── pool/              # 候选池、派单、学习、Redis 实现
├── sql/                   # MySQL 初始化 SQL
├── Dockerfile
├── docker-compose.yml
├── docker-compose.redis.yml
└── README.md
```

## Docker 热启动

`npm run server:docker:watch:local` 会先部署一次，然后监听 Go 服务端、Desktop 源码、Docker 构建文件和配置文件。检测到代码变化后，会自动执行完整的镜像构建和容器重启，因此 Docker 中运行的代码始终是最新版本。

支持把部署参数透传给 `scripts/deploy-pool-local.sh`：

```bash
npm run server:docker:watch:local
npm run server:docker:watch:local -- --port 9092
```
