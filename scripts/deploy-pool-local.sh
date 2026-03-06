#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POOL_DIR="${ROOT_DIR}/pool-server-go"
BUILD_SCRIPT="${ROOT_DIR}/scripts/build-pool-image.sh"

IMAGE_NAME="${IMAGE_NAME:-dy-pool-server}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
POOL_PORT="${POOL_PORT:-9090}"
USE_REDIS="${USE_REDIS:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
NO_CLEAN="${NO_CLEAN:-0}"

print_help() {
  cat <<'EOF'
一键部署福袋筛选服务（本地构建 + 本机 docker 启动）

用法:
  bash ./scripts/deploy-pool-local.sh [选项]

选项:
  --redis              使用 Redis 共享池 compose（docker-compose.redis.yml）
  --skip-build         跳过镜像构建，直接启动容器
  --no-clean           启动前不清理旧容器
  --image <name>       镜像名，默认 dy-pool-server
  --tag <tag>          镜像 tag，默认 latest
  --port <port>        对外端口，默认 9090
  -h, --help           显示帮助

环境变量:
  IMAGE_NAME, IMAGE_TAG, POOL_PORT, USE_REDIS, SKIP_BUILD, NO_CLEAN

示例:
  bash ./scripts/deploy-pool-local.sh
  bash ./scripts/deploy-pool-local.sh --redis
  bash ./scripts/deploy-pool-local.sh --image dy-pool-server --tag v1.0.1 --port 9091
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --redis)
      USE_REDIS=1
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

if [[ ! -f "${POOL_DIR}/config.json" ]]; then
  if [[ -f "${POOL_DIR}/config.example.json" ]]; then
    cp "${POOL_DIR}/config.example.json" "${POOL_DIR}/config.json"
    echo ">>> 已自动生成配置文件: pool-server-go/config.json"
  else
    echo "缺少配置文件: ${POOL_DIR}/config.json"
    exit 1
  fi
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
if [[ "${USE_REDIS}" == "1" ]]; then
  COMPOSE_FILE="docker-compose.redis.yml"
fi

IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"

echo ">>> 部署目录: ${POOL_DIR}"
echo ">>> 镜像: ${IMAGE_REF}"
echo ">>> 模式: $([[ "${USE_REDIS}" == "1" ]] && echo "redis" || echo "memory")"
echo ">>> 端口: ${POOL_PORT}"

if [[ "${SKIP_BUILD}" != "1" ]]; then
  if [[ ! -x "${BUILD_SCRIPT}" ]]; then
    chmod +x "${BUILD_SCRIPT}"
  fi
  bash "${BUILD_SCRIPT}" --image "${IMAGE_NAME}" --tag "${IMAGE_TAG}"
else
  echo ">>> 跳过镜像构建"
fi

if [[ "${NO_CLEAN}" != "1" ]]; then
  docker rm -f dy-pool-server >/dev/null 2>&1 || true
  if [[ "${USE_REDIS}" != "1" ]]; then
    docker rm -f dy-pool-redis >/dev/null 2>&1 || true
  fi
fi

cd "${POOL_DIR}"
POOL_IMAGE="${IMAGE_REF}" POOL_PORT="${POOL_PORT}" "${COMPOSE_BIN[@]}" -f "${COMPOSE_FILE}" up -d --remove-orphans

echo ">>> 等待服务启动..."
sleep 2

if command -v curl >/dev/null 2>&1; then
  curl -fsS "http://127.0.0.1:${POOL_PORT}/health" && echo
  echo "✅ 部署完成，健康检查通过"
else
  echo "✅ 部署完成（未检测到 curl，已跳过健康检查）"
fi

echo "查看日志: docker logs -f dy-pool-server"
