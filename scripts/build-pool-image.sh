#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTEXT_DIR="${ROOT_DIR}/apps/pool-server"
DOCKERFILE_PATH="${CONTEXT_DIR}/Dockerfile"

IMAGE_NAME="${IMAGE_NAME:-dy-pool-server}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
USE_BUILDX="${USE_BUILDX:-0}"
PUSH_IMAGE="${PUSH_IMAGE:-0}"
LOAD_IMAGE="${LOAD_IMAGE:-1}"
NO_CACHE="${NO_CACHE:-0}"
GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
GOSUMDB="${GOSUMDB:-sum.golang.google.cn}"
GOPRIVATE="${GOPRIVATE:-}"

print_help() {
  cat <<'EOF'
一键构建 Go 福袋筛选服务镜像

用法:
  bash ./scripts/build-pool-image.sh [选项]

选项:
  --image <name>       镜像名，默认 dy-pool-server
  --tag <tag>          镜像 tag，默认 latest
  --platform <p>       构建平台，如 linux/amd64 或 linux/amd64,linux/arm64
  --buildx             强制使用 docker buildx build
  --push               构建后推送到仓库（自动启用 buildx）
  --no-load            buildx 模式下不加载到本地
  --no-cache           不使用构建缓存
  --goproxy <url>      Go 代理，默认 https://goproxy.cn,direct
  --gosumdb <value>    Go sumdb，默认 sum.golang.google.cn
  --goprivate <value>  Go 私有模块域名（可选）
  -h, --help           显示帮助

环境变量:
  IMAGE_NAME, IMAGE_TAG, PLATFORM, USE_BUILDX, PUSH_IMAGE, LOAD_IMAGE, NO_CACHE
  GOPROXY, GOSUMDB, GOPRIVATE

示例:
  bash ./scripts/build-pool-image.sh
  bash ./scripts/build-pool-image.sh --image your-registry/dy-pool-server --tag v1.0.0
  bash ./scripts/build-pool-image.sh --goproxy https://goproxy.cn,direct
  bash ./scripts/build-pool-image.sh --platform linux/amd64,linux/arm64 --push --image your-registry/dy-pool-server --tag latest
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      IMAGE_NAME="$2"
      shift 2
      ;;
    --tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --platform)
      PLATFORM="$2"
      USE_BUILDX=1
      shift 2
      ;;
    --buildx)
      USE_BUILDX=1
      shift
      ;;
    --push)
      PUSH_IMAGE=1
      USE_BUILDX=1
      shift
      ;;
    --no-load)
      LOAD_IMAGE=0
      shift
      ;;
    --no-cache)
      NO_CACHE=1
      shift
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

if [[ ! -f "${DOCKERFILE_PATH}" ]]; then
  echo "未找到 Dockerfile: ${DOCKERFILE_PATH}"
  exit 1
fi

IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
COMMON_ARGS=(--file "${DOCKERFILE_PATH}" --tag "${IMAGE_REF}")
COMMON_ARGS+=(--build-arg "GOPROXY=${GOPROXY}" --build-arg "GOSUMDB=${GOSUMDB}" --build-arg "GOPRIVATE=${GOPRIVATE}")
if [[ "${NO_CACHE}" == "1" ]]; then
  COMMON_ARGS+=(--no-cache)
fi

echo ">>> 镜像: ${IMAGE_REF}"
echo ">>> 上下文: ${CONTEXT_DIR}"
echo ">>> GOPROXY: ${GOPROXY}"
echo ">>> GOSUMDB: ${GOSUMDB}"

if [[ "${USE_BUILDX}" == "1" || "${PUSH_IMAGE}" == "1" ]]; then
  if ! docker buildx version >/dev/null 2>&1; then
    echo "当前 Docker 不支持 buildx，请安装/启用 Docker Buildx 后重试"
    exit 1
  fi

  CMD=(docker buildx build "${COMMON_ARGS[@]}" --platform "${PLATFORM}")
  if [[ "${PUSH_IMAGE}" == "1" ]]; then
    CMD+=(--push)
  elif [[ "${LOAD_IMAGE}" == "1" ]]; then
    CMD+=(--load)
  fi
else
  CMD=(docker build "${COMMON_ARGS[@]}")
fi

CMD+=("${CONTEXT_DIR}")

echo ">>> 执行: ${CMD[*]}"
"${CMD[@]}"

echo "✅ 构建完成: ${IMAGE_REF}"
