# 纯安卓协议改造与验证边界

范围：2026-10-15。

## 已删除的执行链路

- Web 请求执行器、BrowserProtocolClient、账号浏览器窗口、网页脚本与原网页登录流程。
- execute-script、navigate-to、浏览器监控等业务 IPC 白名单。
- Android app、WebViewRuntime、CompanionServer、手机桥接及其配置/测试。
- 原网页分类请求；纯协议尚未验收的分类、红包及复杂参与条件不回退旧链路。

Electron 保留自己的管理界面；Go 任务池及其租约、权限、持久反馈继续使用。

## 新链路

原生设备注册/加密复用 → 原生 HTTP 二维码申请与轮询 → 手机确认 → 当前账号身份检查 → 加密保存会话 → 原生 HTTP 福袋详情 → 验证报告 → 显式启动任务。
桌面“添加账号”已使用二维码流程，无需手动填写 JSON；旧会话导入仅作诊断兼容入口。
主进程从加密存储读取 Cookie 和设备参数，渲染层不接收凭据。
报告包含 authentication、signature、details 三个独立状态；只有当前账号身份及有效目标详情均确认才允许执行。
账号更换、重新导入、风险/认证失败或验证过期会关闭执行入口。

自我资料验证入口为 /aweme/v1/user/profile/self/，详情入口为 /webcast/lottery/melon/lottery_info/。
要求 status_code=0、明确账号 UID 及目标 lottery_id，未知响应结构不会被当作成功。
会话内提供 userId 时必须与响应 UID 匹配。
POST 签名只使用实际发送的 URL 参数及请求体；不将 body 业务字段混入签名 query。

## 自动化验证

~~~powershell
npm run desktop:test
npm run desktop:build
npm run server:test
npm run test:offline
npm run protocol:diagnose -- --anonymous --output .tmp/protocol-diagnostic.json
npm run protocol:login-diagnose
~~~

离线联调运行真实 Electron、preload IPC、签名 HTTP 客户端和 Go 服务。
本地上游夹具核对请求签名、Cookie、device_id 和 POST 线格式；验证扫码生命周期、加密会话/设备保存、界面重载恢复、旧脚本 IPC 不可用、账号隔离、身份/详情闸门、租约和持久幂等反馈。
桌面测试 111 项通过，管理界面构建通过，Electron + 原生 HTTP 夹具 + Go 池离线联调通过。
它不代表真实抖音账号验证成功。

## 当前真实诊断

原生设备注册返回服务端 ID；原生二维码申请、等待扫码（new）、已扫码（scanned）已得到真实响应。
用户已在手机确认，但 `/passport/mobile/check_qrconnect/` 返回 1049，提示当前版本过低或非官方渠道来源。
先补齐 32.2.6 的完整版本字段，再升级为官方 40.7.0 的版本组和 SDK 参数，最后补齐真实响应下发的 Passport CSRF 头，确认后仍返回 1049。
因此不能将 1049 唯一归因于版本号，也不能据此断言具体是哪一项签名或设备条件未通过。

authentication=failed（扫码会话交换未成功）；signature=unverified；details=not_tested；sessionSaved=false。
只有设备参数已加密保存；未把二维码令牌、HTTP 200 或手机确认当作可用会话。没有发起真实福袋参与请求。
本地 experimental-aes-v1 固定向量仅证明计算一致性，未实现官方设备密钥证明，也没有真实账号身份读取成功的证据。

## 剩余阻塞

1. 适配并验证真实原生请求签名、客户端校验和设备证明上下文，完成扫码后的会话交换。禁止用猜测签名宣称登录成功。
2. 自我资料返回当前账号 UID，验证会话加密保存和重启后恢复；遇到验证要求时停止。
3. 登录完成后通过原生直播列表发现目标直播间，再确认真实详情返回有效 lottery_id 和开奖时间。用户没有提供 room_id，当前受登录阻塞，尚未启动此项测试。
4. 后续单次参与、开奖响应和登录刷新协议，均需单独验收。

复杂条件及红包未验收，不自动执行。参与请求不自动重放，未知结果不计作成功或未中奖。
