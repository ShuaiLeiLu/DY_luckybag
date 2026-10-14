FROM golang:1.25-alpine AS builder

WORKDIR /src

ARG TARGETOS=linux
ARG TARGETARCH=amd64
ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.google.cn
ARG GOPRIVATE=

ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}
ENV GOPRIVATE=${GOPRIVATE}

COPY go.mod go.sum ./
RUN set -eux; \
    n=0; \
    until [ "$n" -ge 5 ]; do \
      go mod download && break; \
      n=$((n+1)); \
      echo "go mod download failed, retry ${n}/5..."; \
      sleep $((n * 2)); \
    done; \
    [ "$n" -lt 5 ]

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/poolserver ./cmd/poolserver && \
    go build -trimpath -ldflags="-s -w" -o /out/licenseadmin ./cmd/licenseadmin

FROM alpine:3.20

RUN addgroup -S app && adduser -S -G app app \
    && apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /out/poolserver /app/poolserver
COPY --from=builder /out/licenseadmin /app/licenseadmin
COPY static /app/static

ENV POOL_SERVER_HOST=0.0.0.0
ENV POOL_SERVER_PORT=9090
ENV POOL_CONFIG_FILE=/app/config.json
ENV POOL_DESKTOP_STATIC_DIR=/app/static/desktop

EXPOSE 9090 9091

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -T 2 -O - http://127.0.0.1:9090/health >/dev/null || exit 1

USER app

ENTRYPOINT ["/app/poolserver"]
