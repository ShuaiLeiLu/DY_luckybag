#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POOL_DIR="${ROOT_DIR}/apps/pool-server"
PROJECT_CONFIG="${ROOT_DIR}/config.json"
BUILD_SCRIPT="${ROOT_DIR}/scripts/build-pool-image.sh"

IMAGE_NAME="${IMAGE_NAME:-dy-pool-server}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
POOL_PORT="${POOL_PORT:-9090}"
USE_REDIS="${USE_REDIS:-0}"
USE_LOCAL_STACK="${USE_LOCAL_STACK:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
NO_CLEAN="${NO_CLEAN:-0}"
GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
GOSUMDB="${GOSUMDB:-sum.golang.google.cn}"
GOPRIVATE="${GOPRIVATE:-}"

print_help() {
  cat <<'EOF'
一键部署福袋筛选服务（本地构建 + 本机 docker 启动，默认 Redis 模式）

用法:
  bash ./scripts/deploy-pool-local.sh [选项]

选项:
  --redis              使用内置 Redis compose（docker-compose.redis.yml）
  --local              启动本地完整栈（Redis + pool-server）
  --skip-build         跳过镜像构建，直接启动容器
  --no-clean           启动前不清理旧容器
  --image <name>       镜像名，默认 dy-pool-server
  --tag <tag>          镜像 tag，默认 latest
  --port <port>        对外端口，默认 9090
  --goproxy <url>      Go 代理，默认 https://goproxy.cn,direct
  --gosumdb <value>    Go sumdb，默认 sum.golang.google.cn
  --goprivate <value>  Go 私有模块域名（可选）
  -h, --help           显示帮助

环境变量:
  IMAGE_NAME, IMAGE_TAG, POOL_PORT, USE_REDIS, USE_LOCAL_STACK, SKIP_BUILD, NO_CLEAN
  GOPROXY, GOSUMDB, GOPRIVATE

示例:
  bash ./scripts/deploy-pool-local.sh
  bash ./scripts/deploy-pool-local.sh --redis
  bash ./scripts/deploy-pool-local.sh --local
  bash ./scripts/deploy-pool-local.sh --goproxy https://goproxy.cn,direct
  bash ./scripts/deploy-pool-local.sh --image dy-pool-server --tag v1.0.1 --port 9091
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --redis)
      USE_REDIS=1
      shift
      ;;
    --local)
      USE_LOCAL_STACK=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --no-clean)
      NO_CLEAN=1
      shift
      ;;
    --image)
      IMAGE_NAME="$2"
      shift 2
      ;;
    --tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --port)
      POOL_PORT="$2"
      shift 2
      ;;
    --goproxy)
      GOPROXY="$2"
      shift 2
      ;;
    --gosumdb)
      GOSUMDB="$2"
      shift 2
      ;;
    --goprivate)
      GOPRIVATE="$2"
      shift 2
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "未知参数: $1"
      print_help
      exit 1
      ;;
  esac
done

if [[ ! -d "${POOL_DIR}" ]]; then
  echo "未找到目录: ${POOL_DIR}"
  exit 1
fi

if [[ "${USE_LOCAL_STACK}" == "1" && ! -f "${PROJECT_CONFIG}" ]]; then
  node "${ROOT_DIR}/scripts/setup-local.mjs"
fi

if [[ ! -f "${PROJECT_CONFIG}" ]]; then
  echo "缺少配置文件: ${PROJECT_CONFIG}"
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_BIN=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN=(docker-compose)
else
  echo "未检测到 docker compose，请安装 Docker Compose 插件"
  exit 1
fi

COMPOSE_FILE="docker-compose.yml"
if [[ "${USE_LOCAL_STACK}" == "1" ]]; then
  COMPOSE_FILE="docker-compose.local.yml"
elif [[ "${USE_REDIS}" == "1" ]]; then
  COMPOSE_FILE="docker-compose.redis.yml"
fi

IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"

echo ">>> 部署目录: ${POOL_DIR}"
echo ">>> 镜像: ${IMAGE_REF}"
if [[ "${USE_LOCAL_STACK}" == "1" ]]; then
  echo ">>> 模式: local(本地 Redis + pool-server)"
elif [[ "${USE_REDIS}" == "1" ]]; then
  echo ">>> 模式: redis(内置 Redis 容器)"
else
  echo ">>> 模式: redis(外部/配置文件)"
fi
echo ">>> 端口: ${POOL_PORT}"
echo ">>> GOPROXY: ${GOPROXY}"

if [[ "${SKIP_BUILD}" != "1" ]]; then
  if [[ ! -x "${BUILD_SCRIPT}" ]]; then
    chmod +x "${BUILD_SCRIPT}"
  fi
  bash "${BUILD_SCRIPT}" \
    --image "${IMAGE_NAME}" \
    --tag "${IMAGE_TAG}" \
    --goproxy "${GOPROXY}" \
    --gosumdb "${GOSUMDB}" \
    --goprivate "${GOPRIVATE}"
else
  echo ">>> 跳过镜像构建"
fi

if [[ "${NO_CLEAN}" != "1" ]]; then
  docker rm -f dy-pool-server dy-pool-server-local >/dev/null 2>&1 || true
  if [[ "${USE_LOCAL_STACK}" != "1" && "${USE_REDIS}" != "1" ]]; then
    docker rm -f dy-pool-redis >/dev/null 2>&1 || true
  fi
fi

cd "${POOL_DIR}"
POOL_IMAGE="${IMAGE_REF}" POOL_PORT="${POOL_PORT}" "${COMPOSE_BIN[@]}" -f "${COMPOSE_FILE}" up -d --force-recreate --remove-orphans

echo ">>> 等待服务启动..."
sleep 2

if command -v curl >/dev/null 2>&1; then
  curl -fsS "http://127.0.0.1:${POOL_PORT}/health" && echo
  echo "✅ 部署完成，健康检查通过"
else
  echo "✅ 部署完成（未检测到 curl，已跳过健康检查）"
fi

if [[ "${USE_LOCAL_STACK}" == "1" ]]; then
  echo "本地服务: http://127.0.0.1:${POOL_PORT}"
  echo "查看日志: docker logs -f dy-pool-server-local"
else
  echo "查看日志: docker logs -f dy-pool-server"
fi
