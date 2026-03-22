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
  Go 服务端目录，包含派单、授权、试用、管理后台和 Docker 部署文件。
- [apps/license-miniapp/README.md](/Users/lushuailei/PycharmProjects/dy_fudai/apps/license-miniapp/README.md)
  微信小程序目录，负责扫码绑定和广告授权链路。

## 常用命令

```bash
# 桌面端开发
npm run desktop:electron:dev

# 桌面端构建
npm run desktop:build

# 桌面端测试
npm run desktop:test

# Go 服务端启动
npm run server:run

# Go 授权模块测试
npm run server:test:license

# 本地构建服务端镜像
npm run server:docker:build

# 本地部署服务端
npm run server:docker:up
```

## 说明

- 根目录只保留仓库级入口、通用脚本和文档。
- 桌面端构建产物输出到 `apps/desktop/dist` 和 `apps/desktop/dist-electron`。
- 服务端配置文件位于 `apps/pool-server/config.json`。
- `超人福袋助手_1.0.10/` 仅作为本地参考资源，已被 git 忽略。
