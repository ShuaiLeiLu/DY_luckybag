# Desktop App

Windows 桌面端在这个目录下独立维护。

## 目录

```text
apps/desktop/
├── electron/     # 主进程、preload、桌面状态存储、更新服务
├── src/
│   ├── renderer/ # React 页面
│   ├── services/ # 自动化调度与服务端调用
│   ├── shared/   # 前后端共享模型
│   └── utils/    # 工具函数
├── build/        # 打包资源
├── index.html
├── tsconfig.json
└── vite.config.mjs
```

## 常用命令

在仓库根目录执行：

```bash
npm run desktop:dev
npm run desktop:build
npm run desktop:test
npm run desktop:electron:dev
npm run desktop:electron:build:win
```

## 配置文件

- `apps/desktop/config.json`：桌面端默认配置（实际生效文件）
- `apps/desktop/config.example.json`：配置模板
- `apps/desktop/tokens.example.json`：Token 示例模板
