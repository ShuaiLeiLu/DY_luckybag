# douyin.apk 静态逆向初步报告

日期：2026-10-12

输入文件：`/Users/lushuailei/Downloads/douyin.apk`

SHA-256：`2aa34b2139ba1f9a18d32b597cd0b1d845c89866a3f753e31d0b4bc6772a221c`

## 结论摘要

1. 该 APK 的直播福袋相关请求属于 Android 原生网络栈，至少包含：
   - `/webcast/lottery/melon/lottery_info/`
   - `/webcast/lottery/melon/`
   - `/webcast/luckybox/box/list/`
   - `/webcast/room/enter/`
   - `/webcast/openapi/lottery/melon/`
2. APK 内存在 ByteDance 的原生安全组件：`libEncryptor.so`、`libropaencrypt.so`、`bdticketguard` 相关类和大量设备/密钥证明配置。它们不是一个仅由 `room_id + lottery_id` 决定的普通哈希函数。
3. APK 字符串中能看到 `x-argus` 与 `x-ss-stub`，但没有看到 `a_bogus`；这与 Android 原生请求链路和 Web 侧签名链路的区分一致。仅凭字符串出现不能推出完整算法。
4. `libropaencrypt.so` 暴露的 `RopaEncrypt` 主要被定位到位置数据加解密调用（`EncryptLocation` / `DecryptLocation`），不能据此认为它就是福袋请求签名算法。
5. `libEncryptor.so` 仅暴露 `JNI_OnLoad`，字符串中出现 `ttEncrypt`，其业务 JNI 通过动态注册完成；没有从 APK 静态字符串中得到可直接移植的公开方法签名。
6. 当前项目中的 `apps/desktop/electron/douyinLiveRemote.js` 已经实现的是 Web 侧 `a_bogus` 风格签名（RC4 + SM3 + 自定义 Base64 表），它与 Android APK 的原生安全链路不是同一个算法，也不能作为 Android `x-*`/TicketGuard 结果的替代品。

## APK 结构观察

- 文件大小约 209 MiB。
- 包含 `classes.dex` 到 `classes45.dex`，共 46 个 DEX 文件。
- 当前 APK 只提供 `arm64-v8a` 原生库目录。
- 福袋/红包相关业务类和模型分布在多个 DEX 中，例如：
  - `com.bytedance.android.live.profit.lottery.*`
  - `com.ss.android.ugc.aweme.im.business.luckybag.*`
  - `com.ss.android.ugc.aweme.goldbooster.entrance.task.IBottomLuckyBagTaskApi`
  - `com.bytedance.kmp.coin.bigredpacket.BigRedPacketRequestContract`
  - `com.bytedance.ropa.encrypt.RopaEncrypt`

## 观察到的福袋业务接口

静态字符串与调用点显示，直播福袋至少涉及以下接口前缀或路径：

```text
/webcast/lottery/melon/lottery_info/
/webcast/lottery/melon/
/webcast/openapi/lottery/melon/
/webcast/luckybox/box/list/
/webcast/room/enter/
/webcast/room/enter_backend/
```

福袋模型字段中能确认的业务字段包括：`lottery_id` / `lottery_id_str`、`room_id` / `room_id_str`、`candidate_num`、`lucky_count`、`prize_count`、`conditions`、`draw_time`、`server_biz_data` 等。

这些字段只能说明协议和数据模型，不代表可以脱离客户端直接构造一个有效的参与请求。

## 原生加密/安全组件

### `libEncryptor.so`

- ELF AArch64，已剥离大部分符号。
- 导出表中可见 `JNI_OnLoad`，没有可直接调用的业务导出函数。
- 字符串中存在 `ttEncrypt`，说明存在动态注册的 JNI 加密入口。
- 静态字符串还出现 `x-argus` 与 `x-ss-stub`，但没有足够的调用上下文确认其参数拼接、版本分支和输出编码。
- 该库与 Android 端通用安全/请求保护组件相关，但静态结果不足以确定其输入字段、密钥来源、版本分支和签名输出格式。

### `libropaencrypt.so`

- ELF AArch64，包含 AES-128-GCM 和 AES-128-CBC 相关调用。
- JNI 注册类为：`com.bytedance.ropa.encrypt.RopaEncrypt`。
- 可见方法：

```text
getRandom()
generateKey(long)
encryptData(String, String, String, String, String, String)
decryptData(String, String, String, String, String, String)
getEncryptSeq(String, boolean)
getEncryptSeqV2(String, int, String)
getDecryptSeq(String)
getHash(String)
```

- DEX 交叉引用显示 `getEncryptSeq` / `getDecryptSeq` 被 `EncryptLocation` / `DecryptLocation` 使用，当前证据不支持把它当成福袋接口签名。

### TicketGuard / 设备证明链路

APK 中存在以下类型的静态证据：

```text
bdticketguard
sign_cache
ree_hmac
tee
key_attestation
staticSign
attestSign
loadEncryption
loadRee
loadTee
```

这表明 Android 请求保护包含设备密钥、TEE/REE 状态、缓存签名和远端策略等上下文。仅复制一段 AES/SM3/RC4 代码，不能生成等价的 Android 请求证明。

## 与当前项目的对应关系

当前项目调用的是 Web 直播接口，并在 `douyinLiveRemote.js` 中生成 `a_bogus`：

```text
sign(query, user-agent, args)
  -> generate_random_str()
  -> generate_rc4_bb_str()
  -> SM3(query + suffix)
  -> RC4
  -> 自定义 Base64 字符表
```

当前项目已使用的福袋路径包括：

```text
/webcast/lottery/melon/lottery_info/
/webcast/lottery/melon/attend/
/webcast/web/partition/detail/room/
```

因此当前代码走的是“浏览器/桌面 Web 协议”而不是“Android APK 原生协议”。把 APK 里的原生安全库强行移植到桌面端，会同时遇到：

- 动态 JNI 注册入口不可直接调用；
- 设备标识、密钥、TicketGuard 会话状态缺失；
- TEE/REE/Key Attestation 无法在普通桌面进程中复现；
- 请求签名的版本、策略和服务端下发参数可能随 APK 版本变化；
- 即使算法字节级复刻，仍可能因为会话、设备和风控上下文不一致而失效。

## 本轮没有做的事情

- 没有修改当前用户已有的未提交工作区改动。
- 没有提取或复用账号 Cookie、Token、设备密钥或个人会话数据。
- 没有尝试绕过登录、设备证明、TicketGuard 或风控校验。
- 没有把 APK 原生安全组件编译进桌面项目。

## 工程方向（按 Android 原生目标调整）

目标已经调整为 Android 原生客户端，不再以当前 Electron/Web 请求层作为最终实现。Android 版本应单独建立 Kotlin/Gradle 工程，并把福袋业务、直播间扫描、任务调度和网络层迁移到 Android 模块中。

需要区分两部分：

- 福袋业务协议、数据模型和调度逻辑可以迁移并在自有测试服务上验证；
- `TicketGuard` / `x-argus` / TEE/REE 设备证明不是可脱离客户端状态的普通加密函数，不能直接从当前 Electron 代码迁移成 Kotlin 实现。

如果目标是对自有服务做协议兼容测试，应在测试服务中定义自己的签名协议，并提供脱敏请求/响应样本、固定测试向量和服务端验证器；这样可以实现可重复的单元测试，而不需要复制第三方客户端的设备证明链路。

## Android 原生链路的进一步定位

针对“改成 Android 原生”这一目标，继续对 `bdticketguard` 的 DEX 方法和字符串引用进行了定位。

### 请求签名入口

`TicketGuardManager` 中存在以下与请求签名直接相关的入口：

```text
TicketGuardManager.LJIJJLI(RequestContext, boolean, boolean)
TicketGuardManager.LJFF(RequestDescriptor)
TicketGuardManager.LJJJJJ(SignCacheKey, int, boolean, boolean, boolean)
MainTicketGuardManager.LJJLIIIJLLLLLLLZ(byte[], String)
```

其中 `TicketGuardManager.LJFF(...)` 的静态代码会处理：

```text
request_sign
custom_ts_sign
sec_ts
sign_type_tee
sign_type_ree
ree_hmac
bd-ticket-guard-server-data
bd-ticket-guard-server-cert
bd-ticket-guard-client-cert
bd-ticket-guard-attestkey-ts-sign
bd-ticket-guard-ree-public-key
/passport/ticket_guard/verify_pub_key/
```

`RequestContextKt.LIZ(JSONObject, RequestContext, boolean)` 会把以下字段写入诊断/签名上下文：

```text
sign_path
sign_ticket
ticket_type
sign_timestamp
ree_key_from
ecdh_key_from
sign_req_param_timestamp_ms
sign_retry_count
with_ticket_guard
is_ticket_init
has_get_ticket
cache_config_type
cache_hit_type
cache_sign_type
cache_miss_reason
ree_sign
hmac_sign
tee_req_sign
tee_pub
tee_create_error_desc
tee_alias_load_error
tee_keypair_load_error
config_sign_type
is_enable_token_guard
tee_credential
```

`RequestContext.LIZJ()` 对 `ticket`、`tsSign`、`tsSignRee`、证书、公钥、凭据等字段做非空和一致性检查。这进一步证明 Android 请求签名不是单一的本地摘要算法。

### 进程间安全组件

`SubTicketGuardManager` 还包含以下路径：

```text
REE sign uses IPC
REE HMAC uses IPC
sign_type_tee
sign_type_ree
get_attest_sign_cache
get_tee_static_sign_result
update_ticket_data
```

也就是说，部分签名材料来自主进程/子进程之间的 IPC，以及 TEE/REE 密钥状态。把 APK 中的 `libEncryptor.so` 单独复制到新 Android 工程，并不能得到完整可用的签名链路。

## 对 Android 项目的实际影响

当前仓库是 Electron/Node 桌面项目，没有 Android Gradle module、Manifest、Kotlin/Java 源码或 Android 构建配置。因此“改成 Android”不是简单把现有 `douyinLiveRemote.js` 改成 Kotlin，而是需要新增 Android 客户端和完整的请求层。

可行的 Android 工程边界应当是：

1. 新建独立 Android app/module。
2. 将福袋业务模型、直播间扫描和任务调度迁移到 Kotlin。
3. 请求层使用 Android 客户端自己的会话和设备上下文。
4. `TicketGuard`/`x-argus` 部分只能通过合法可用的 SDK/API 或客户端本身的授权链路接入，不能将其简化成普通 AES/SM3/RC4 函数。
5. 使用脱敏的、由自有测试设备生成的请求样本和固定测试向量验证字段映射；不能用账号 Cookie、设备密钥或线上认证材料作为测试资产。

当前仓库没有 Android 工程，因此本轮只完成了 Android 原生签名链路的静态定位，没有把第三方原生安全库复制到项目中，也没有生成伪造 `x-argus`/TicketGuard 的实现。

## 额外发现：APK 内部的高层 TicketGuard 适配器

在 `classes19.dex` 中还发现了：

```text
com.bytedance.bdinstall.ticket.TicketGuardAdapter
```

其方法包括：

```text
init(...)
providerTicketHeader(String, boolean, boolean, String): List
consumerTicketData(String, String, String, boolean): List
handleProviderResponse(...): List
decryptTicket(byte[]): byte[]
getTimestamp(): Map
```

这比直接调用 `libEncryptor.so` 更接近 APK 的真实网络集成层：业务网络代码先向 `TicketGuardAdapter.providerTicketHeader(...)` 获取请求头，再把服务端返回的 TicketGuard 数据交回 `handleProviderResponse(...)`。不过该类属于 APK 内部实现，不是当前项目可直接依赖的公开 Android SDK；将其直接复制出来仍然缺少初始化参数、证书、设备状态和服务端策略。

### 适配器参数形态

对 `TicketGuardAdapter.providerTicketHeader(...)` 的方法体继续反汇编后，可以确认它会：

1. 解析传入 URL，提取 `host` 和 `path`；
2. 创建 TicketGuard 请求描述对象；
3. 调用 `TicketGuardManager.LJIILL(...)`；
4. 返回 `TicketGuardManager` 产生的 header 列表；
5. 记录 `get_ticket` 时间戳。

`consumerTicketData(...)` 则会解析服务端 URL，创建完整的请求描述对象，调用 `TicketGuardManager.LJFF(...)`，并记录 `consumer_ticket` 时间戳。

因此 Android 端的协议适配器已按 APK 的真实调用形态调整为：

```text
providerTicketHeader(url, withTicketGuard, isTicketInit, signPath)
consumerTicketData(url, responseBody, responseLogId, isRetry)
```

## 第二轮：字符串表实测（自写 Node DEX 解析器，2026-10-14）

为核对签名头集合，用自写的 DEX 解析器遍历 45 个 `classes*.dex` 的 `string_ids` 表逐项实测：

| 头 | 本 APK 字符串表 | 位置 |
|---|---|---|
| `x-argus` | 有 | classes18.dex `string_ids[57693]`；`libsscronet.so` 同步 |
| `x-ss-req-ticket` | 有 | classes26.dex `string_ids[61526]`；`libsscronet.so` |
| `x-security-argus` | 有 | classes26.dex `string_ids[61520]` |
| `x-bd-client-key` / `x-bd-kmsv` / `x-bdms-*` | 有 | classes26.dex `string_ids[61491..61498]`；`libmetasec_ml.so` 声明 `X-BD-KMSV`、`X-BD-CLIENT-KEY` |
| `x-ladon` / `x-gorgon` / `x-khronos` / `x-ss-stub` | 无 | 45 个 dex 全表无匹配 |

### 解读

- 本 APK（`version_code` 300800）真实存在的签名头是 `x-argus`、`x-ss-req-ticket`、`x-security-argus` 以及 metasec 的 `x-bd-*` 族。
- `x-ladon` / `x-gorgon` / `x-khronos` / `x-ss-stub` 不在本包字符串表，属旧代协议遗留；桌面端 `android-sign-algorithms.js` 仍按社区公开实现产出四件套，作为旧代兼容路径。
- `libEncryptor.so` 仅 `JNI_OnLoad` 一个导出符号，内部串仅 `ttEncrypt`，业务 JNI 动态注册 → 无法离线复刻；`libmetasec_ml.so` 是 metasec 新链路的载体。
- TicketGuard 由 `MainTicketGuardManager` / `SubTicketGuardManager`（classes19.dex，方法名混淆为 `VLLIIIIZL` 等）驱动，依赖 TEE/REE + Key Attestation。

### 工程对应

- JS 侧：`apps/desktop/electron/android-sign-algorithms.js` + `android-signature-provider.js` 已实现四件套（Feistel / protobuf / 下标打包）并接入 `AndroidSignatureProvider`。
- 测试：`android-sign-algorithms.test.js` 11 个固定向量；全量 59 passed。
- 仍依赖授权 Android 运行时补全 TicketGuard 的 `providerTicketHeader` / `consumerTicketData`。
