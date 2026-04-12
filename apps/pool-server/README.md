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
- `POOL_LICENSE_ADMIN_USERNAME`
- `POOL_LICENSE_ADMIN_PASSWORD`
- `POOL_ADMIN_SESSION_SECRET`
- `POOL_ADMIN_SESSION_TTL_HOURS`

兼容说明：

- `POOL_LICENSE_ADMIN_PASSWORD` 未配置时，会回退使用 `POOL_LICENSE_ADMIN_TOKEN` 作为登录密码。

## 配置文件

服务端按以下顺序查找配置：

1. `POOL_CONFIG_FILE`
2. 仓库根目录 `config.json`
3. 当前目录 `config.json`（兼容旧路径）

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
