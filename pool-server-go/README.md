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

## Docker 部署

### 1) 构建镜像

在项目根目录执行：

```bash
docker build -t your-registry/dy-pool-server:latest ./pool-server-go
```

多架构（例如 `amd64/arm64`）可用：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-registry/dy-pool-server:latest \
  --push \
  ./pool-server-go
```

### 2) 推送到镜像仓库（可选）

```bash
docker push your-registry/dy-pool-server:latest
```

### 3) 服务器运行（内存模式，无 Redis）

先准备服务器配置文件（例如 `/opt/dy-pool/config.json`，`redis.enabled=false`）：

```bash
docker run -d \
  --name dy-pool-server \
  --restart unless-stopped \
  -p 9090:9090 \
  -v /opt/dy-pool/config.json:/app/config.json:ro \
  -e POOL_CONFIG_FILE=/app/config.json \
  your-registry/dy-pool-server:latest
```

### 4) 服务器运行（Redis 共享池模式）

`config.json` 可以把 `redis.enabled=true` 并写入 Redis 地址，或直接用环境变量覆盖：

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
  your-registry/dy-pool-server:latest
```

### 5) 验证

```bash
curl http://127.0.0.1:9090/health
curl "http://127.0.0.1:9090/pool/top?limit=50"
```

### 6) 使用 docker compose（可选）

`pool-server-go/docker-compose.yml` 已提供模板：

```bash
cd pool-server-go
docker compose up -d
```

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
