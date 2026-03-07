# 抖音福袋助手

基于 Electron + Vue 3 的多账号抖音福袋工具，支持自动扫描、过滤、参与、红包尝试与统计展示。

## 免责声明

仅用于学习与技术研究。请自行承担账号风控、平台限制与合规风险。

## 快速开始

### 环境

- Node.js >= 18.18
- npm >= 8

### 安装

```bash
npm install
```

### 开发运行

```bash
npm run electron:dev
```

## 基本使用

1. 点击“添加账号”，在弹窗中扫码登录。
2. 登录成功后，账号会出现在账号列表。
3. 点击“启动”，系统自动扫描并参与福袋。
4. 在“运行日志”和“福袋面板”查看实时结果与历史记录。

## 主要功能

- 多账号隔离运行（独立 session）
- 福袋扫描（全站 + 分类）
- 服务端筛选池（可选，支持多客户端共享候选）
- 严格过滤（粉丝团/会员、实物、红包策略等）
- 参与策略（UI 优先，接口重试兜底）
- 自动抢红包
- 等待开奖阶段随机互动（随机弹幕/点赞）
- 账号统计、收益统计、成功率统计

## 默认配置说明

- `参与上限`：默认关闭（不限制次数）
- `运行时长`：默认关闭
- `优先大红包`：默认开启
- `过滤粉丝团`：可在左侧配置开关

## 常用命令

```bash
# 前端构建
npm run build

# Electron 开发
npm run electron:dev

# 打包（全部平台）
npm run electron:build

# 打包 Windows 安装包（.exe）
npm run electron:build:win

# 打包 macOS
npm run electron:build:mac

# 启动 Go 筛选服务
npm run pool:server:go

# 一键构建筛选服务镜像
npm run pool:docker:build

# 一键本地部署筛选服务容器
npm run pool:docker:up
```

## Windows 打包产物

默认输出目录：`dist-electron/`

常见产物：

- `抖音福袋助手 Setup <version>.exe`
- `win-unpacked/`

## 可选：Go 筛选服务

适合多客户端采集共享候选池。

### 本地直接运行

```bash
npm run pool:server:go
```

默认监听：`http://0.0.0.0:9090`

### Docker 一键构建与部署

```bash
npm run pool:docker:build
npm run pool:docker:up
```

配置文件：`pool-server-go/config.json`

完整服务端说明见：[`pool-server-go/README.md`](./pool-server-go/README.md)

## 常见问题

### 1) 扫描少 / 频繁 444

通常是风控导致。可降低并发、减少同时运行账号、延长扫描间隔。

### 2) 登录弹出 bytedance 协议提示

Windows 缺少协议处理应用时会出现。建议用扫码登录，不要触发外部协议跳转。

### 3) 昵称未更新

重新登录一次或重新启动账号，系统会重新拉取并写入昵称。

## License

MIT
