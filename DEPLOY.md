# 部署与本地运行

先执行 npm ci 和 npm run setup:local，生成根目录 config.json。

- desktop.poolServerUrl：桌面端访问的任务池地址。
- desktop.poolServerToken 与 poolServer.server.apiToken：同一访问令牌。
- poolServer.server：监听地址、端口和请求大小限制。
- poolServer.redis：可选 Redis；本机内存模式关闭 enabled 即可。

默认端口 9090；若被占用，修改 poolServer.server.port，并同步 desktop.poolServerUrl。
健康检查 GET /health；业务接口使用 Bearer 令牌。

~~~powershell
npm run server:run
npm run desktop:electron:dev
~~~

桌面点击“添加账号”扫码登录并在手机抖音确认，然后“验证协议”。不需要部署手机服务或模拟器。
当前真实扫码确认仍被平台以 1049 拒绝；部署成功并不代表账号登录可用。具体阻塞见 [验证边界](docs/AUTOMATION_VALIDATION.md)。
会话及协议设备参数由 Electron safeStorage 加密保存；系统加密不可用时停止登录。会话失效后可重新扫码。

## Docker 与发布

~~~bash
npm run server:docker:build
npm run server:docker:up
# 包含本地 Redis
npm run server:docker:up:local
~~~

Docker pool-server 使用根配置，反馈日志保存在 pool-data 卷。桌面端反馈先写本地持久队列，再发送到服务端。
Go 候选池、租约、扫描许可和学习反馈接口保持不变。

Windows 安装包：npm run desktop:electron:build:win，输出 apps/desktop/dist-electron。
打包清单包含主进程使用的 src/shared/defaultSettings.json。
安装版账号和历史保存在用户数据目录；开发版在仓库 dy-fudai-desktop。

前端热更新默认关闭，仍要求 Ed25519 签名、同源 HTTPS 和文件 SHA256。
原网页执行版本的缓存前端不会被新主进程载入；新入口包含 native-protocol-runtime-v1 标识。
签名私钥不应放入配置或镜像。Go Docker 静态前端仅用于更新资源，不负责抖音网页执行。
