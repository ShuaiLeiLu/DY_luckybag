# 抖娃福袋：纯安卓协议工作台

Electron 桌面管理界面 + Node.js 安卓协议客户端 + Go 任务池。
业务请求由电脑直接通过 HTTP 发送，不需要模拟器、手机伴生应用、WebView 或抖音网页执行窗口。

## 本地启动

需要 Node.js 22+；Go 服务使用 Go 1.25+，也会查找仓库 .tools/go。

~~~powershell
npm ci
npm run setup:local
npm run server:run
# 另一个终端
npm run desktop:electron:dev
~~~

配置在根目录 config.json；桌面 poolServerUrl 与服务端监听端口需一致，访问令牌需匹配。
默认本地 9090，若已被其他项目占用，请同时修改两端配置。内存模式不需要 Redis。

## 先验证协议

1. 桌面点击“添加账号”，自动注册协议设备并申请原生登录二维码。
2. 用已登录的抖音 App 扫码并确认；校验当前账号身份后，自动用系统 safeStorage 加密保存会话和设备参数，无需填写 JSON。
3. 账号卡片点击“验证协议”，填写正在发福袋的内部数字 room_id，依次检查当前账号身份和目标详情。
4. 两项均确认后才允许启动任务。会话变更、风险响应或验证超过 10 分钟会要求重新验证。

也可运行诊断（报告不输出 Cookie、设备标识或签名值）：

~~~powershell
npm run protocol:diagnose
npm run protocol:login-diagnose -- --live --output .tmp/login-check.json
npm run protocol:diagnose -- --anonymous --output .tmp/protocol-diagnostic.json
npm run protocol:diagnose -- --session C:/private/account.protocol-session.json --room-id <内部房间ID>
~~~

会话过期可在“验证协议”里重新扫码。同一 UID 更新已有账号，重新登录不同账号不会覆盖原会话。
关闭登录窗口会取消轮询；过期、拒绝、风控或未知响应会停止，需手动重新获取二维码。
原会话导入 IPC 和 [安卓会话模板](protocol-session.example.json) 仅保留为诊断兼容入口。旧网页 Cookie 不自动迁移。
签名实现目前标记 experimental-aes-v1：固定向量通过仅证明本地一致性，不能证明真实平台接受。
已实测原生设备注册、二维码申请、等待扫码和已扫码状态。手机确认后仍收到业务码 1049（版本或客户端来源校验失败），未保存真实账号会话。
已按官方 40.7.0 安装包更新版本组和账号 SDK 参数，并补齐 Passport CSRF 头；真实签名/设备证明链路仍待适配，扫码登录尚未端到端跑通。福袋详情和参与未验收。
匿名请求、测试夹具或 HTTP 200 均不会被标成真实登录/福袋验证成功。登录诊断报告不会覆盖已有文件。

## 执行范围

保留多账号管理、候选扫描、任务租约、历史、开奖轮询、持久反馈与更新能力。
当前通过原生 feed 扫描；旧网页分类接口已移除。
评论、粉丝团、关注、观看时长、付费等未验收条件直接跳过；红包领取和随机互动停用。
参与请求只提交一次，响应丢失时不自动重放。缺乏明确开奖证据记录 unknown。

## 验证与构建

~~~powershell
npm run desktop:test
npm run desktop:build
npm run server:test
npm run test:offline
npm run desktop:electron:build:win
~~~

离线联调使用真实 Electron 主进程/preload、原生签名 HTTP 客户端和 Go 服务，业务响应由本地夹具提供。
测试使用独立 .tmp 目录和测试凭据，不读取用户账号。
Windows 安装包输出到 apps/desktop/dist-electron。

更多见 [验证边界](docs/AUTOMATION_VALIDATION.md)、[部署说明](DEPLOY.md)。
