# Pool Server

Go 服务端目录，负责候选池、派单、授权、试用和管理后台。

## 启动

```bash
cd apps/pool-server
go run ./cmd/poolserver
```

默认监听 `0.0.0.0:9090`。

## 配置文件

服务端按以下顺序查找配置：

1. `POOL_CONFIG_FILE`
2. 当前目录 `config.json`
3. 仓库根目录 `apps/pool-server/config.json`

示例配置见 [config.example.json](/Users/lushuailei/PycharmProjects/dy_fudai/apps/pool-server/config.example.json)。

## 常用命令

在仓库根目录执行：

```bash
npm run server:run
npm run server:test:license
npm run server:docker:build
npm run server:docker:up
npm run server:db:init
```

## 目录

```text
apps/pool-server/
├── cmd/
│   ├── poolserver/        # 服务入口
│   └── learning-replay/   # 学习回放入口
├── internal/
│   ├── license/           # 授权、试用、小程序绑定
│   └── pool/              # 候选池、派单、学习、Redis 实现
├── sql/                   # MySQL 初始化 SQL
├── Dockerfile
├── docker-compose.yml
├── docker-compose.redis.yml
├── config.example.json
└── README.md
```
