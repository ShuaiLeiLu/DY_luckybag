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
npm run desktop:hot:manifest -- --base-url https://your-cdn.example.com/dy-fudai/desktop/3.0.0/
npm run desktop:test
npm run desktop:electron:dev
npm run desktop:electron:build:win
```

## 配置文件

- `config.json`（仓库根目录）：统一配置文件，桌面端读取 `desktop` 节点
- `apps/desktop/tokens.example.json`：Token 示例模板

### 前端热更新（仅 Desktop 渲染层）

桌面端支持只更新 `apps/desktop/dist`（不更新 Electron 主进程）。  
在 `config.json` 的 `desktop` 节点增加以下配置：

```json
{
  "hotUpdateEnabled": true,
  "hotUpdateManifestUrl": "https://your-cdn.example.com/dy-fudai/desktop/hot-manifest.json",
  "hotUpdateReloadOnApply": false
}
```

- `hotUpdateEnabled`：是否启用渲染层热更新
- `hotUpdateManifestUrl`：热更新 manifest 地址
- `hotUpdateReloadOnApply`：下载完成后是否立即重载页面（`false` 为下次启动生效）

manifest 生成命令：

```bash
npm run desktop:build
npm run desktop:hot:manifest -- --base-url https://your-cdn.example.com/dy-fudai/desktop/3.0.0/
```

生成文件默认位于：`apps/desktop/dist/hot-manifest.json`。  
将 `dist` 文件夹内容上传到 `baseUrl` 对应目录，再把 manifest 上传到 `hotUpdateManifestUrl` 即可。
