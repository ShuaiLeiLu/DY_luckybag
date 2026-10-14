# 抖娃福袋助手 - 全栈部署指南 (Ready for Production)

这份指南将指导您如何把配置好的【桌面端】、【小程序端】和【服务端】打包并部署上线。

## 步骤 1：同步全局配置
在项目根目录（`dy_fudai`）下，有一个核心配置文件 `config.json`。请确保里面的域名（`poolServerUrl`, `baseUrl`）、MySQL 密码、微信小程序 `AppId` 和 `AppSecret` 已经修改为您线上的真实数据。

确认无误后，在根目录运行自动化脚本，它会将配置刷入所有前后端代码中：
```bash
node deploy-setup.js
```
*(注：如果看到三个 ✅ 符号，说明配置同步成功。)*

---

## 步骤 2：部署服务端 (Backend / Pool Server)
服务端采用 Go 语言编写，依赖 MySQL 和 Redis。项目已经内置了 `docker-compose.yml`，推荐使用 Docker 一键部署。

1. 将 `apps/pool-server` 目录上传到您的云服务器。
2. 在服务器的 `pool-server` 目录下，运行以下命令启动服务：
```bash
docker-compose up -d --build
```

本地开发时，如果希望修改代码后自动更新 Docker，可在仓库根目录运行：
```bash
npm run server:docker:up:local
```
本地完整 Docker 栈包含 MySQL、Redis、pool-server 和 license-admin。需要代码修改后自动更新时运行 `npm run server:docker:watch:local`；脚本会先部署一次，之后监听 Go 服务端、Desktop 源码、Docker 文件和配置，检测到修改后自动重建镜像并重启容器。
3. **域名反向代理**：配置 Nginx（或宝塔面板），将您的域名（例如 `http://fudai.shuai.help:9090`）反向代理到服务器的 `9090` 端口。

---

## 步骤 3：发布微信小程序 (License Miniapp)
小程序用作用户的“授权控制台”。

1. 打开 **微信开发者工具**。
2. 导入目录：选择 `apps/license-miniapp` 文件夹。
3. 检查效果：此时您应该能看到全新的极简深色控制台。
4. **上传代码**：点击右上角的“上传”按钮。
5. 登录微信公众平台，将刚刚上传的版本提交审核，审核通过后发布上线。

---

## 步骤 4：打包桌面端客户端 (Windows Desktop App)
桌面端是用户实际挂机跑任务的程序。

1. 确保您在 `dy_fudai` 根目录下，并安装了所有依赖（如果您还没安装依赖，请运行 `npm install`）。
2. 运行构建与打包命令：
```bash
npm run desktop:build
npm run desktop:dist
```
3. 打包完成后，您可以在 `apps/desktop/dist` 目录下找到 `.exe` 安装包。将这个安装包分发给您的用户即可。