# Go 高并发福袋筛选服务

仅做服务端筛选池：

- 批量接收候选福袋
- 去重（`roomId + lotteryId`）
- TTL 过期
- 统一过滤（`type=3+6`、粉丝团、实物）
- 统一评分并输出 TopN

账号执行、参与结果、账号统计都留在本地客户端。

## 启动

```bash
cd pool-server-go
go run ./cmd/poolserver
```

默认监听：`0.0.0.0:9090`

## Docker 部署教程（完整）

### 0) 前置条件

- Linux 服务器（Ubuntu/CentOS 均可）
- Docker 24+
- Docker Compose 插件（`docker compose version` 可用）
- 无需镜像仓库（本教程只讲本地构建+本机部署）

### 1) 本地一键构建镜像

从 GitHub 拉代码后，在项目根目录执行：

```bash
npm run pool:docker:build
```

默认会生成：

- `dy-pool-server:latest`

自定义本地镜像名和版本：

```bash
IMAGE_NAME=dy-pool-server IMAGE_TAG=v1.0.0 npm run pool:docker:build
```

### 2) 服务器准备目录

```bash
sudo mkdir -p /opt/dy-pool
sudo chown -R $USER:$USER /opt/dy-pool
cd /opt/dy-pool
```

把以下文件放到服务器 `/opt/dy-pool`：

- `config.json`（可从 `config.example.json` 复制修改）
- `docker-compose.yml`（内存模式模板）
- 或 `docker-compose.redis.yml`（内置 Redis 模式模板）

### 3) 配置文件（先内存模式跑通）

`config.json` 最小示例：

```json
{
  "server": { "host": "0.0.0.0", "port": 9090 },
  "redis": { "enabled": false }
}
```

### 4) 启动服务（内存模式）

方式 A：`docker run`

```bash
docker run -d \
  --name dy-pool-server \
  --restart unless-stopped \
  -p 9090:9090 \
  -v /opt/dy-pool/config.json:/app/config.json:ro \
  -e POOL_CONFIG_FILE=/app/config.json \
  dy-pool-server:latest
```

方式 B：`docker compose`（推荐）

```bash
cd /opt/dy-pool
POOL_IMAGE=dy-pool-server:latest docker compose -f docker-compose.yml up -d
```

### 5) 启动服务（Redis 共享池模式）

如果你有多个客户端节点，建议启用 Redis。

方案 A：连接外部 Redis（推荐生产）

- `config.json` 中 `redis.enabled=true` 并填写 `addr/password/db`
- 或通过环境变量覆盖：

```bash
docker run -d \
  --name dy-pool-server \
  --restart unless-stopped \
  -p 9090:9090 \
  -v /opt/dy-pool/config.json:/app/config.json:ro \
  -e POOL_CONFIG_FILE=/app/config.json \
  -e POOL_REDIS_ENABLED=true \
  -e REDIS_ADDR=10.0.0.8:6379 \
  -e REDIS_PASSWORD=your-password \
  -e REDIS_DB=0 \
  dy-pool-server:latest
```

方案 B：服务器内置 Redis（快速验证）

```bash
cd /opt/dy-pool
POOL_IMAGE=dy-pool-server:latest docker compose -f docker-compose.redis.yml up -d
```

### 6) 健康检查与日志

```bash
curl http://127.0.0.1:9090/health
curl http://127.0.0.1:9090/stats
curl "http://127.0.0.1:9090/pool/top?limit=50"

docker logs -f dy-pool-server
```

### 7) 客户端接入

前端配置面板把“筛选服务地址”设置成：

- `http://你的服务器IP:9090`
- 或域名：`https://pool.example.com`（若你前面挂了反向代理）

### 8) 升级与回滚

升级：

```bash
IMAGE_NAME=dy-pool-server IMAGE_TAG=v1.0.1 npm run pool:docker:build
docker stop dy-pool-server && docker rm dy-pool-server
docker run -d --name dy-pool-server --restart unless-stopped -p 9090:9090 \
  -v /opt/dy-pool/config.json:/app/config.json:ro \
  -e POOL_CONFIG_FILE=/app/config.json \
  dy-pool-server:v1.0.1
```

回滚就是把 tag 换回旧版本重启。

### 9) 常见问题

- `connection refused`：确认服务器安全组/防火墙已放行 `9090`。
- `Redis connect fail`：检查 `REDIS_ADDR`、密码、白名单、端口。
- `/pool/top` 长期为空：说明采集端还未上报有效候选，先看 `/stats` 的 `totalAccepted` 是否增长。
- `404/跨域`：服务已内置 CORS，若走 Nginx 反代，确认转发到 `9090`。

## 配置文件（推荐）

默认会按以下顺序找配置文件：

1. `POOL_CONFIG_FILE` 指定路径
2. 当前目录 `config.json`
3. 仓库根目录 `pool-server-go/config.json`

项目已提供 `config.json` 和 `config.example.json`。

### 本地无 Redis（单机内存模式）

保持：

```json
"redis": {
  "enabled": false
}
```

这样服务会使用本机内存池，不依赖 Redis。

### 多客户端共享池（Redis 模式）

设置：

```json
"redis": {
  "enabled": true,
  "addr": "你的Redis地址:6379",
  "password": "",
  "db": 0,
  "prefix": "lottery_pool"
}
```

说明：即使本机没有 Redis，也可以连接远端 Redis 地址。

## 环境变量

- `POOL_SERVER_HOST` 默认 `0.0.0.0`
- `POOL_SERVER_PORT` 默认 `9090`
- `POOL_SERVER_MAX_BODY_BYTES` 默认 `6291456`
- `POOL_SERVER_TOP_CACHE_MAX` 默认 `2500`
- `POOL_SERVER_TOP_CACHE_REFRESH_MS` 默认 `400`
- `POOL_SERVER_EXPIRE_SWEEP_MS` 默认 `500`
- `POOL_SERVER_TTL_GRACE_SEC` 默认 `8`
- `POOL_SERVER_MAX_BATCH_SIZE` 默认 `1000`
- `POOL_SERVER_SHARDS` 默认 `64`

### Redis（共享池）配置

- `POOL_REDIS_ENABLED` 显式开关（`1/true` 启用）
- `REDIS_ADDR` 或 `POOL_REDIS_ADDR` 例如 `127.0.0.1:6379`（设置后会启用共享模式）
- `REDIS_PASSWORD` 默认空
- `REDIS_DB` 默认 `0`
- `POOL_REDIS_PREFIX` 默认 `lottery_pool`
- `POOL_REDIS_POOL_SIZE` 默认 `120`
- `POOL_REDIS_MIN_IDLE_CONNS` 默认 `16`
- `POOL_REDIS_DIAL_TIMEOUT_MS` 默认 `2000`
- `POOL_REDIS_READ_TIMEOUT_MS` 默认 `3000`
- `POOL_REDIS_WRITE_TIMEOUT_MS` 默认 `3000`

环境变量优先级高于配置文件。

## 接口

- `GET /health`
- `GET /stats`
- `GET /filter/profile`
- `POST /filter/profile`
- `POST /candidate/batch-upsert`
- `GET /pool/top?limit=50`
