# 抖娃福袋 Monorepo

当前仓库已经按应用边界拆分，前后端目录完全分离。

## 目录结构

```text
dy_fudai/
├── apps/
│   ├── desktop/           # Electron + React 桌面端
│   ├── pool-server/       # Go 服务端
│   └── license-miniapp/   # 微信小程序
├── scripts/               # 仓库级运维脚本
├── package.json           # 根脚本入口（统一调度）
├── start.sh               # 桌面端开发启动脚本
└── README.md
```

## 应用说明

- [apps/desktop/README.md](/Users/lushuailei/PycharmProjects/dy_fudai/apps/desktop/README.md)
  桌面端目录，包含 Electron 主进程、React 渲染层、共享模型和桌面构建配置。
- [apps/pool-server/README.md](/Users/lushuailei/PycharmProjects/dy_fudai/apps/pool-server/README.md)
  Go 服务端目录，包含派单、授权、试用，以及独立的管理后台服务。
- [apps/license-miniapp/README.md](/Users/lushuailei/PycharmProjects/dy_fudai/apps/license-miniapp/README.md)
  微信小程序目录，负责扫码绑定和广告授权链路。

## 常用命令

```bash
# 桌面端开发
npm run desktop:electron:dev

# 桌面端构建
npm run desktop:build

# 生成桌面端热更新 manifest（仅前端资源）
npm run desktop:hot:manifest -- --base-url https://your-cdn.example.com/dy-fudai/desktop/3.0.0/

# 桌面端测试
npm run desktop:test

# Go 服务端（pool + admin）一起启动
npm run server:run

# 仅启动业务服务（poolserver）
npm run server:run:pool

# 仅启动授权管理后台（独立服务）
npm run server:run:admin

# Go 授权模块测试
npm run server:test:license

# 本地构建服务端镜像
npm run server:docker:build

# 本地部署服务端
npm run server:docker:up

# 本地完整 Docker 环境（MySQL + Redis + pool-server + license-admin）
npm run server:docker:up:local

# 本地 Docker 热启动：修改代码后自动重建镜像并重启容器
npm run server:docker:watch:local
```

## 说明

- 根目录只保留仓库级入口、通用脚本和文档。
- 桌面端构建产物输出到 `apps/desktop/dist` 和 `apps/desktop/dist-electron`。
- 全项目统一配置文件为根目录 `config.json`。

## Docker 热启动开发

运行 `npm run server:docker:watch:local` 后，脚本会：

1. 先执行一次本地 Docker 构建和部署；
2. 监听 `apps/pool-server`、桌面端源码、构建脚本和配置文件；
3. 每次修改完成后自动重新构建镜像，并重新创建 `dy-pool-server` 容器；
4. 忽略 `node_modules`、构建产物、缓存和 Docker 运行数据，避免自动构建造成循环触发。

可将部署参数透传给原有部署脚本，例如：

```bash
npm run server:docker:watch:local
npm run server:docker:watch:local -- --port 9091
```

按 `Ctrl+C` 停止监听。

本地 Docker 服务地址：

- pool-server：`http://127.0.0.1:9090`
- license-admin：`http://127.0.0.1:9091/admin`
- MySQL：`127.0.0.1:13306`
- Redis：`127.0.0.1:16379`
- 默认管理后台账号：`admin / admin123456`
