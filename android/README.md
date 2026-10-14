# 抖娃福袋 Android 客户端基础模块

这个目录是 Android 原生迁移的起点，负责承载 Kotlin 协议层和后续 UI/调度模块。

## 当前已完成

- 福袋接口路径映射：`lottery_info`、`lottery_melon`、`openapi/lottery_melon`、`luckybox`。
- APK 静态分析得到的 TicketGuard 请求上下文字段投影。
- `TicketGuardSigner` 授权边界接口。
- `AndroidTicketGuardRuntime` / `RuntimeTicketGuardSigner`：对应 APK 内部 `TicketGuardAdapter.providerTicketHeader(...)` 和 `consumerTicketData(...)` 的接入边界。
- 未配置签名供应商时默认 fail-closed，不生成伪造 `x-argus`。
- 协议层单元测试夹具。

## 尚未完成

APK 的 Android 签名依赖 TicketGuard、TEE/REE、证书、ticket 和服务端状态。不能把 `x-argus` 当作普通本地加密函数实现。生产实现需要由合法授权的 Android SDK/运行时实现 `AndroidTicketGuardRuntime`，并用脱敏测试向量验证；协议层不会自行生成 `x-argus`。

当前机器未检测到 Gradle/Android SDK，因此尚未执行 APK 编译；源码和测试夹具已落盘，待配置 Android toolchain 后运行：

```bash
cd android
./gradlew test
./gradlew assembleDebug
```
