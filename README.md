# 抖音福袋助手

基于 Electron + Vue 3 的多账号抖音福袋工具，支持自动扫描、条件过滤、自动参与、红包尝试、运行日志和账号统计。

## 免责声明

本项目仅供学习与技术研究用途。  
请自行评估并承担使用风险，包括但不限于账号限制、接口风控、平台条款冲突等后果。

## 当前功能

- 多账号隔离运行（独立 `session partition`）。
- 自动登录信息识别（优先接口获取昵称与用户 ID）。
- 福袋扫描（全站 + 分类）。
- 福袋条件过滤（按“超人福袋”逻辑，严格条件过滤后入池）。
- 参与策略（UI 参与优先，接口重试兜底）。
- 会员/粉丝团限制过滤（扫描阶段过滤，不入池）。
- 自动抢红包（带限制识别跳过）。
- 默认静音。
- 默认关闭直播画面渲染（降低资源占用）。
- 分级日志（`error/warn/info/debug`）与环境开关。
- 实时运行日志、账号统计、中奖与收益统计。

## 环境要求

- Node.js 18.18+（推荐 20 LTS）
- npm 8+
- macOS / Windows / Linux（开发）
- Windows（生成 `exe`）

## 安装与运行

```bash
npm install
```

开发模式：

```bash
npm run electron:dev
```

或：

```bash
./start.sh
```

## 打包

全部平台：

```bash
npm run electron:build
```

Windows 安装包（`.exe`）：

```bash
npm run electron:build:win
```

macOS：

```bash
npm run electron:build:mac
```

产物默认输出到：

- `dist-electron/抖音福袋助手 Setup <version>.exe`
- `dist-electron/win-unpacked`
- `dist-electron/win-ia32-unpacked`

## 使用流程

1. 点击“添加账号”。
2. 在弹出窗口扫码登录抖音。
3. 登录成功后本地保存 Token 与账号信息。
4. 点击账号“启动”。
5. 系统自动扫描并参与福袋，日志区查看实时过程。

## 默认行为（已启用）

- 账号窗口默认静音。
- 进入直播间后默认关闭直播画面渲染。
- 参与流程为单轮模式：一个福袋结束后再进入下一轮扫描/参与。

## 配置说明

- `概率筛选`：仅参与预测概率高于阈值的福袋。
- `二次复检`：参与前再检查概率是否达标。
- `参与上限`：单账号最大参与次数。
- `运行时长`：单账号最大运行小时数。
- `过滤粉丝团`：跳过粉丝团/会员限制福袋。
- `人数过滤`：可按在线人数上限过滤直播间。
- `自动抢红包`：参与福袋后尝试红包领取。
- `随机互动`：随机点赞等轻量互动。

## 项目结构

```text
.
├── electron/
│   ├── logger.js
│   ├── main-browserview.js
│   └── douyinLiveRemote.js
├── src/
│   ├── App.vue
│   ├── renderer-entry.js
│   ├── components/
│   ├── utils/
│   │   ├── lotteryRules.js
│   │   └── logger.js
│   └── services/
│       ├── LotteryManager-lite.js
│       ├── scanCollector.js
│       ├── scanRiskPolicy.js
│       └── joinExecutor.js
├── tokens.json
└── package.json
```

## 常见问题

Q: 扫描不到福袋？  
A: 先降低筛选阈值（概率/人数），再看日志是否出现 `444` 或 `NON_JSON_RESPONSE` 风控错误。

Q: 日志提示 `444 Access Denied`？  
A: 这是网关风控，已内置退避重试与限并发；仍频繁出现时建议降低并发、减少账号同时扫描。

Q: 登录后昵称未更新？  
A: 点击账号“刷新”或重新登录一次，系统会优先通过 creator 接口补齐账号信息。

Q: 为什么有些福袋会被过滤？  
A: 当前池逻辑会过滤不满足条件的福袋，且会员/粉丝团限制福袋在扫描阶段直接不入池。

## 开发脚本

- `npm run dev`：仅前端 Vite
- `npm run build`：仅前端构建
- `npm run pool:server:go`：启动 Go 高并发福袋筛选服务
- `npm run pool:docker:build`：一键构建筛选服务 Docker 镜像（默认 `dy-pool-server:latest`）
- `npm run electron:dev`：Electron + Vite 联调
- `npm run electron:build`：Electron 打包
- `npm run electron:build:win`：Windows 打包
- `npm run electron:build:mac`：macOS 打包

## 筛选服务（可选）

当你需要多节点采集聚合时，可以单独启动筛选服务：

```bash
npm run pool:server:go
```

一键构建 Docker 镜像：

```bash
npm run pool:docker:build
# 自定义镜像名与版本
IMAGE_NAME=your-registry/dy-pool-server IMAGE_TAG=v1.0.0 npm run pool:docker:build
```

配置文件默认读取 `pool-server-go/config.json`（或在 `pool-server-go` 目录运行时读取 `config.json`）。
本地无 Redis 时保持 `redis.enabled=false`；多客户端共享数据时把 `redis.enabled=true` 并填远端 Redis 地址。

完整接口说明见：

- `pool-server-go/README.md`

## 日志级别开关

- 主进程日志级别：使用环境变量 `DY_LOG_LEVEL`（可选值：`error` / `warn` / `info` / `debug`）。
- 渲染层日志级别：开发时可在 DevTools 设置 `localStorage.setItem('DY_LOG_LEVEL', 'debug')`。

示例：

```bash
DY_LOG_LEVEL=debug npm run electron:dev
DY_LOG_LEVEL=warn npm run electron:build
```

## License

MIT
