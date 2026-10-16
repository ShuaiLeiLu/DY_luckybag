# 安卓原生扫码登录：证据与实现边界

日期：2026-10-15（重逆向，实测自 APK `douyin_select_51059831a_v19919_400701_ce49_1791454388.apk`）。

## 输入

- SHA-256：`2aa34b2139ba1f9a18d32b597cd0b1d845c89866a3f753e31d0b4bc6772a221c`（约 208.7 MiB，与项目里既有的 `douyin-apk-static-analysis-2026-10-12.md` 同一份）。
- 45 个 `classes*.dex`；仅 `arm64-v8a` 原生库；只静态读字符串表与 AXML，不启动 Android 进程或原生库。

## 一、Manifest 实测（AXML 解码）

从 `AndroidManifest.xml` 的二进制 int32 池直读（不是从字符串表推断）：

| 字段 | 值 |
| --- | --- |
| package | `com.ss.android.ugc.aweme`（不是 `.mobile`；`.mobile` 是 32.2.6 的包名） |
| `android:versionName` | `40.7.0`（string 池 index 79） |
| `android:versionCode` | `400701`（raw int32 @ 0x4853C） |
| `SS_VERSION_CODE` | `400700`（raw int32 @ 0x51184） |
| `UPDATE_VERSION_CODE` | `40709900`（raw int32 @ 0x511E8） |

三者是不同字段，不能混为一个 `version_code`。渠道不能仅凭文件名或 DEX 字符串表判断，需核对 APK 元数据；本轮对另一份官方下载包的 Signing Block 复核见第九节。

## 二、DEX 字符串表实测

对 45 个 DEX 的 `string_ids` 表逐项扫描，只列本次关心的键（同键多处出现时给最早的一条）：

| 字符串 | 位置 | 备注 |
| --- | --- | --- |
| `x-argus` | classes18.dex `string_ids[57693]` | 字符串命中不能证明其用途或算法 |
| `x-security-argus` | classes14.dex `string_ids[55271]` | 已定位桥接上下文用途，不能认定为二层 AES 签名 |
| `x-ss-req-ticket` | classes26.dex `string_ids[61526]` | 毫秒时间戳；调用路径复核见第九节 |
| `x-bd-client-key` | classes25.dex `string_ids[64710]` | metasec 族 |
| `x-bd-kmsv` | classes25.dex `string_ids[64711]` | metasec 族 |
| `x-tt-passport-csrf-token` | classes19.dex `string_ids[57925]` | Passport CSRF 头 |
| `x-tt-token` | classes8.dex `string_ids[45924]` | Passport 会话头 |
| `x-tt-env` | classes.dex `string_ids[64309]` | metasec 上下文 |
| `x-tt-trace-id` | classes14.dex `string_ids[55274]` | metasec 上下文 |
| `x-tt-dt` | classes34.dex `string_ids[76352]` | metasec 上下文 |
| `60759` | classes19.dex `string_ids[5207]` | 40.7.0 的 `passport-sdk-version` |
| `1128` | 多处（首个 index 169657） | 主 app `aid` |
| `6383` | classes31.dex `string_ids[2752]` | 抖音 lite/网页 `aid` |
| `AES/CBC/NoPadding` | classes 多处 | 印证原生链路用 CBC + NoPadding |
| `/passport/mobile/get_qrcode/` | classes9.dex | 完整路径 |
| `/passport/mobile/check_qrconnect/` | classes9.dex | 完整路径 |
| `/service/2/device_register/` | classes34.dex | 完整路径 |
| `/passport/ticket_guard/verify_pub_key/` | classes19.dex `string_ids[4900]` | 完整路径 |
| `magic_tag` / `ss_app_log` / `_gen_time` | classes29.dex | 设备注册 body 的 JSON 分支 |

此前 DEX 字符串扫描未匹配到 `x-ladon`、`x-gorgon` 等字段，不能据此判断已废弃：本轮官方 APK 的 `libsscronet.so` 包含这些字段。版本整数、渠道字符串和签名字段也可能分别来自 AXML、APK Signing Block 或原生库，不能只检查 DEX 字符串表。

## 三、`passport-sdk-version`

- 32.2.6（旧分析记录）：`203274`
- **40.7.0（本 APK，实测）**：`60759`（classes19.dex `string_ids[5207]`）

代码里 `ACCOUNT_PARAMS['passport-sdk-version']` 已按 40.7.0 使用 `60759`，与实测一致。

## 四、原生登录链路（40.7.0 实测）

| 步骤 | origin | path | 关键点 |
| --- | --- | --- | --- |
| 设备注册 | `log.snssdk.com` | `/service/2/device_register/` | POST，JSON body：`{ magic_tag:'ss_app_log', header:{...}, _gen_time }`；返回 `device_id_str`、`install_id_str` |
| 申请二维码 | `aweme.snssdk.com` | `/passport/mobile/get_qrcode/` | 大屏扫码：`source=pad`、`need_logo=1`、`service=https://aweme.snssdk.com`；返回 `qrcode`（PNG data URL）、`token`、`expire_time` |
| 轮询状态 | `aweme.snssdk.com` | `/passport/mobile/check_qrconnect/` | `service=aweme.snssdk.com`（裸 host）、`scene=0`、`token`；`status=confirmed` 时 `user_data.user_id_str` + `user_data.session_key` |
| 自我资料 | `aweme.snssdk.com` | `/aweme/v1/user/profile/self/` | 确认 UID 与手机号一致 |
| 公钥校验 | `aweme.snssdk.com` | `/passport/ticket_guard/verify_pub_key/` | TicketGuard 使用，登录链路本身不依赖 |

**Passport 会话头**：响应 `Set-Cookie` 里的 `passport_csrf_token`（回退到 `passport_csrf_token_default`）由 `X.0uvF.LIZ` 复制为请求头 `x-tt-passport-csrf-token`；响应头 `x-tt-token` 由后续请求回填。这两步是 Passport 协议必需的，不是 metasec 的一部分。

**签名实现边界（已更正）**：项目中的固定密钥 AES 实现只是候选算法。没有官方签名输入/输出向量，也没有真实登录成功证据；字符串出现 `AES/CBC/NoPadding` 不能证明该算法用于登录签名。

- 当前 `experimental-aes-v2` 仍保留未经平台验证的候选 `x-argus`，不能称为官方 TicketGuard 实现。
- 不再生成或强制要求 AES 形式的 `x-security-argus`；已定位调用来自混合页面桥接上下文。
- `x-ss-req-ticket` 改为毫秒，并保留当前时刻的毫秒精度；独立于候选算法内部使用的秒值。
- 本地固定向量仅验证确定性，不能替代签名兼容性验证。旧 security AES 函数仅保留用于历史离线向量，运行时不发送其结果。

**安全相关请求头的来源待分别核对**：native 库中的字符串不能证明每个头都由 metasec 生成。已定位的 `ClientKeyManager` 会处理会话响应中的 `x-bd-lanusk` / `x-bd-lanusv`，供后续 `x-bd-client-key` / `x-bd-kmsv` 使用，详见第十节；其他环境头尚未做字节级复核。

## 五、`1049` 排查清单（按优先级）

真实响应体示例：`{ "message":"error", "data":{ "error_code":1049, "description":"..." } }`。`1049` 本身不足以细分，按下列顺序逐项核对：

1. **`aid` 类型**：原生客户端里 `aid=1128` 是整数值（DEX 里作为数字串存在），当前 `ACCOUNT_PARAMS` 传的是字符串 `'1128'`；`querystring.stringify` 输出相同，但序列化顺序必须与设备 `deviceInfo` 一致。
2. **版本三元组不能混**：`version_code=400700`、`manifest_version_code=400701`、`update_version_code=40709900`。当前客户端共享 UA 使用 `400701`，登录模块已改为引用该共享值，详情见第八节。
3. **UA 结构**：当前配置形如 `com.ss.android.ugc.aweme/400701 (Linux; U; Android 12; zh_CN; <Model>; Build/<id>; Cronet/TTNetVersion:<hash> <date> QuicVersion:<hash> <date>)`。此前登录模块写死的 `DesktopProtocol` UA 已移除；这只修复了配置未生效的问题，不能证明该 UA 的全部字段与官方运行时一致，也不能证明 1049 由 UA 单独引起。
4. **CSRF 头**：按 SDK 行为，从请求 URL 作用域内的 Cookie 复制 `x-tt-passport-csrf-token`。尚无证据把任一 CSRF 不匹配直接归因于 1049。
5. **`x-tt-env`**：尚未验证其在这条登录链路中的要求，不填入猜测的环境值。
6. **`/service/2/device_register/` 的 host**：当前使用 `log.snssdk.com`，真实注册返回有效 ID；没有把其他主机错误等同于 1049 的证据。
7. **`source` / `service` 组合**：大屏扫码 `source=pad` + `service=https://aweme.snssdk.com`（带协议），轮询 `check_qrconnect` 用裸 host `service=aweme.snssdk.com`。两者不能互换。

以上是排查项目，并无证据证明各项不匹配都会导致 1049。遇到 1049 时，`native-login-provider.js` 的 `passportData` 会终止当前 attempt，不保存会话。

## 六、生命周期（代码对应）

`protocol-login-service.js`：`registering → requesting_qr → waiting → scanned → verifying → saving → completed`；`expired/canceled/failed` 为终止态。轮询间隔 ≥ 2500ms，服务端 `expire_time` 与本地 180s 取较小者。取消、过期、拒绝、额外验证、未知结构、网络错误均 fail-closed，不自动重放。

`native-login-provider.js`：CookieJar + `x-tt-token` 头 + `x-tt-passport-csrf-token` 头（从同 host Cookie 读取），三者串成 Passport 会话；`verify` 阶段用 `sessionid` / `sessionid_ss` 匹配自我资料 UID。

## 七、此前状态（本轮更新见第九节）

- `npm test` 111 passed（14 个文件）。
- 静态逆向：本文所列字符串与整数字段全部在 APK 中定位到具体 dex / string_ids 索引。
- 1049 仍未消除；已核对 UA/参数/CSRF/路径 4 项；剩余可能落在 metasec 头（`x-tt-env`/`x-tt-dt`/`x-tt-trace-id`）与原生 `libEncryptor.so` 动态注册的 `ttEncrypt` 上，本机无 Android toolchain，无法运行 `./gradlew test` 复核 Kotlin 端。

诊断命令：`npm run protocol:login-diagnose -- --live --output .tmp/login-check.json`。默认不发网络请求，报告只含阶段与错误码。

## 八、登录 UA 与手机确认页标题复核（2026-10-15）

- 修正登录模块覆盖默认 UA 的问题：`NativeLoginProvider` 现在引用
  `android-protocol-client.js` 的 `DEFAULT_ANDROID_USER_AGENT`，并在读取旧设备档案时更新 UA，保留服务端分配的设备 ID。
- 新增两个经过生产 `clientFactory` 和 HTTP 请求头组装的回归场景，覆盖首次注册与旧设备恢复，以及取码、轮询、资料验证和会话返回值。完整桌面测试 113 项通过。
- 14:08 的真实取码与轮询请求均已确认携带共享 UA，不再发送 `DesktopProtocol` UA。UA 生效不等于平台接受登录。
- 对服务端返回的二维码进行本地解码：`qr_source_aid=1128`、`source=pad`，手机确认目标为
  `https://aweme.snssdk.com/passport/mobile/scan_qrcode/`。二维码外层是官方手机确认页，不由桌面程序加载或执行。
- 只读检查该确认页引用的[官方脚本](https://lf-dy-sourcecdn-tos.bytegecko.com/obj/byte-gurd-source/gecko/ucenter_web/account_h5/douyin_scan_code_login/resource/js/index.acaa1e5a.js)：标题优先使用
  `carrier_platform_info.device_login_display_name`；缺失或为空时回退为“抖音网页版”。因此手机显示该标题，不能单独证明使用了 `/passport/web/` 登录接口。
- 上述证据说明实际 UA 和二维码路由；没有证明当前候选签名被平台接受，也没有证明 1049 的唯一原因。未添加 Web、WebView 或模拟器执行路径。
- 14:13:54 启动修正后的真实扫码测试：服务端识别为 `scanned`，随后
  `/passport/mobile/check_qrconnect/` 返回 `1049`。本次取码与轮询均记录到修正后的 UA，
  未进入自我资料验证，未保存会话。UA 覆盖问题已修复，但平台的客户端校验仍未通过。

## 九、1049 后续：签名调用路径与设备一致性

本节复核的是官方下载的 40.7.0 APK：SHA-256 `88075d689a674d645f383250359ea82dc5280ffce2f9a5404f4e11e4449e90cf`，与文首记录的另一份 APK 分开。

1. `classes42.dex` 中 `com.bytedance.ttnet.retrofit.SsInterceptor.LIZIZ` 在偏移 `0x62247a` 调用 `System.currentTimeMillis()`，随后在 `0x62249a` 添加 `X-SS-REQ-TICKET`。已修复秒/毫秒错误。
2. `classes26.dex` 的 `X.0unJ.LIZ` 和 `AccountFetchMethod.handle` 从桥接上下文生成 `x-security-argus`；`classes37.dex` 的 `X.1Ej5.LIZ` 还存在以 `StaticResource/html/Argus aid/` 开头的文本值。这些调用不支持固定密钥 AES 二层签名的解释。
3. `classes46.dex` 的 `RegistrationHeaderHelper.LJ` 从同一 Android Build 读取型号、品牌、制造商、系统 API，并以整数写入版本/API 字段。原实现注册为 `DesktopProtocol/generic`，UA 却为 Pixel 6，且生成的 `clientudid` 未持久化；这些不一致已修复。
4. `android-client-profile.js` 统一注册、请求和会话所用参数。沿用 Pixel 6 / SQ3A.220705.004 配置，将系统 API 改为 32；[Google 文档](https://developer.android.com/about/versions/12/dev-support-images)将此构建列为 Android 12L。该配置是软件客户端参数，不是物理设备证明。
5. 旧设备档案不直接套用新型号。下次准备登录时仅注册一次替代档案；只有取得有效服务端 ID 后才原子替换加密存储。注册失败/取消时保留旧档案，新档案随后重启复用。`openudid/cdid/clientudid` 一并持久化。
6. APK Signing Block ID `0x71777777` 内确有 `meta_channel=49957579a`，因此当前渠道值有 APK 证据；不能仅因 DEX 不含它就判定渠道错误。

剩余未证实项包括候选 `x-argus` 与原生实现的一致性、客户端密钥/设备证明，以及配置 UA 中的 Cronet 版本后缀。上述修复均不能单独证明 1049 已消失，必须继续以真实确认后的会话结果判断。

本轮验证：116 项桌面测试通过；Electron UI/IPC、加密保存与恢复、协议 HTTP、Go 任务池离线联调通过。14:36 的真实免扫码预检中，新设备注册、取码和首次轮询均成功（`new`）；请求时间戳为毫秒，注册与登录均为 Pixel 6/API 32，未发送 `x-security-argus`，二次准备登录复用已注册设备。仍未验证扫码确认后的会话获取。

## 十、14:56 扫码确认复测：仍被客户端校验拒绝

2026-10-15 14:55:44 启动的真实测试已经检测到 `scanned`；用户确认已点击手机“确认登录”。14:56:06，`/passport/mobile/check_qrconnect/` 返回业务码 `1049`，原文为“当前应用版本过低或经非官方渠道下载，为了你的账号安全，请升级应用后重试”。没有验证码挑战，也没有进入自我资料验证；会话文件未生成。日志证实本次取码和轮询均使用毫秒时间戳、Pixel 6/API 32 和共享 UA，未发送 `x-security-argus`。因此第九节修复已生效，但没有解决登录拒绝。

本地脱敏证据：`.tmp/native-login-signing-attempt.json`，`checkedAt=2026-10-15T06:56:06.939Z`。此前几次仅二维码过期的记录不能当作本次确认后的结果。

继续静态追踪得到以下边界：

- `X.1Qgw.LJFF`（`classes42.dex`，`0x628ee0`）从 URL 中抽取设备字段，经 `EncryptorUtil` 处理，按配置写入 `ss_queries` / `X-SS-QUERIES`。这是设备参数加密分支，不能把它直接当作 `x-argus` 算法。
- `CronetUrlRequestContext.addSecurityFactor`（`0x5b2f50`）把 URL 和请求头交给 `onCallToAddSecurityFactor`，后者在 `0x41bca8` 调用事件监听器 `X.1POB.LIZIZ`。已定位接口边界，尚未复刻其实际安全头生成逻辑。
- `ClientKeyManager.LJ`（`0x631854`）先查找 `sessionid` 响应 Cookie，再读取 `x-bd-lanusk` / `x-bd-lanusv`，并与会话绑定保存。`SsInterceptor` 在 `0x622558` / `0x622570` 添加对应的 `x-bd-client-key` / `x-bd-kmsv`。这条分支依赖会话响应，当前没有证据认为随意补两个请求头就能修复首次登录的 1049；也不能把响应值直接当成应当自行生成的设备私钥。
- 离线输入审计确认：当前 `experimental-aes-v2` 中，固定时间和查询参数后改变正文不会改变候选 `x-argus`；查询参数改变会改变它。该审计仅描述本地实现，不能证明官方要求或 1049 的唯一原因。固定向量一致、本地测试通过、服务端发二维码均不构成签名兼容的证据。

当前明确缺口仍是经过官方输入/输出样本或成功认证验证的签名实现。没有将猜测的算法或客户端密钥接入运行时，也没有新增 Web、WebView、模拟器执行路径。新的签名证据或实质修复出现前，不重复要求用户扫码。

## 十一、继续追踪原生安全 SDK 与修复签名输入

本轮依然只对同一官方 APK 做静态读取、DEX 反汇编与 ARM64 指令解码，没有运行 APK、JNI 库或模拟器。`libmetasec_ml.so` 的 SHA-256 为 `1fe03703b1f3a806b220271ba2ec1dbed049d8b5f0216b70c0c724d5c5bc027c`；只导出 `JNI_OnLoad`（虚拟地址 `0x2a8bb8`）。

新增的已确认调用链如下：

1. `CronetUrlRequestContext` → `X.1PKU` → `AbsCronetDependAdapter.onCallToAddSecurityFactor`（`classes42.dex:0x5c556c`）→ `X.1PHV.LJIILLIIL`（`0x6151a8`）。
2. 该方法把请求头的名称和值展开为字符串数组，在 `0x6153bc` 调用 `ms.bd.c.k3.a(0x03000001, 0, handle, url, headerArray)`，把返回数组按名称/值配对转回 Map。另一个协议分支使用 `0x06000001`。这定位的是安全头生成入口，尚不是 `x-argus` 的完整加密算法。
3. `handle` 来自 `ms.bd.c.h5.LIZ(long)` 保存的实例值；初始化在 `classes54.dex` 的 `ms.bd.c.i3.LIZJ` 中加载 `metasec_ml`、序列化配置并以 `0x04000001` 调用原生函数。`k3.a` / `k3.c` 均声明为 native，没有 Java 函数体。
4. 静态 ARM64 中发现 `0x29b130` 通过 JNI 函数表注册指向 `0x29b2b4` 的入口，后者重排参数并转至 `0x18cb58`；该处把参数交给 `0x1816fc` 的数据驱动分发流程。名称/签名注册关联和内部运算还未全部恢复，不能直接把这个地址当作已验证的 `x-argus` 函数。记录保存在 `.tmp/login-signing-review/` 的 `metasec-register-refs.txt` / `metasec-dispatcher-candidate.txt`。

据官方代码完成的请求层修复：

- `TypedByteArray.md5Stub`（`classes42.dex:0x3d4ab0`）→ `DigestUtil.md5Hex`（`classes28.dex:0x502474`）直接计算原始字节的 MD5；`encodeHex` 使用 `DIGITS_UPPER`。Cronet 请求构造在 `0x6216ca` 将其写入 `X-SS-STUB`。项目现在在签名前计算该头，同时修正原工具函数把二进制转为 UTF-8、改变摘要的错误。
- 请求层在签名前确定毫秒时间戳和正文长度，签名器和发送层复用同一值；保留实际 URL 中的编码与参数顺序。清理旧签名头，避免混入历史值。
- 签名器返回不同 URL、查询、正文、正文摘要、时间戳或已有请求头时停止发送；签名器对正文 Buffer 的原地修改也会被检测。HTTP 头名按大小写不敏感合并和检查。
- 自定义签名适配器返回空/无效结果时报告失败，不再悄悄回退到实验性 AES，从而掩盖适配器没有生效的问题。

验证覆盖二进制正文、空正文/无正文、编码与重复查询键、签名后变更、请求头大小写和适配器失败。完整桌面测试 131 项通过，Electron/Go 离线联调通过（`.tmp/native-smoke-2IEpzn/desktop-smoke-ok.json`）；离线联调仍使用明确标记的测试响应，不是平台签名验收。本轮未发新二维码、未发送真实登录确认请求。

**未完成项**：默认 `experimental-aes-v2` 的计算本体本轮没有替换，不能声称已适配官方 `x-argus`。已找到入口和输入契约，但原生内部计算、初始化状态及可信输出样本还不完整；需要恢复计算本体并建立官方样本对照，才能评价纯协议签名的兼容性。查阅的公开 TikTok 示例使用不同应用/SDK，不能充当本版本抖音的官方实现，因此没有引入其算法、远程签名服务或模拟器。

公开材料只作为排查线索：[作者的 TikTok 45.7.3 / aid 1180 研究记录](https://zenn.dev/arise/articles/d4ea86d098fe4a)、[armxe 的 TikTok 算法源码](https://github.com/armxe/tiktok-api)。本轮生产代码修复依据是上述本地官方抖音 APK 的具体方法和偏移，未把公开材料中的 SDK 常量或成功结论套用到本项目。

## 十二、内部指令、实际头分支与摘要核心的静态恢复

本节仍针对第十一节的同一份 `libmetasec_ml.so`，没有运行 APK、JNI、Android 系统或任何模拟器。新增成果在 `scripts/reverse-engineering/metasec/`，不是生产签名器。`experimental-aes-v2` 尚未替换，1049 尚未解决，未生成新二维码。

### 可复现的提取流程

`extract.py` 对 ELF 做 SHA-256 强校验，按 PT_LOAD 映射读取虚拟地址，并使用 `R_AARCH64_RELATIVE` 的 addend 还原指针。输入不是该版本时直接失败，不把错误偏移套到其他版本。分析工具只反汇编指令、传播构造表中的常量、读取和解码数据，不执行原生指令或内嵌程序。

已还原的 HTTP 调用链：`k3.a(0x03000001, ...)` → `0x29b2b4` → `0x18cb58` → 第一个分发器 `0x1816fc` / 程序 `0x6efb0` → `0x2e600c` → `0x2e3b3c` → 对象虚表方法 `0x2d3788`。它经 `0x2d284c` 初始化内嵌程序，再调用 HTTP 模块导出 `F1`。此处需要有效实例及 ready 状态，不能拿任意整数替代 handle。

第二层加载器 `0x2e6a94` / `0x342638` 的格式已静态恢复：

- 外层逐字节 XOR 使用 `codecs[blobLength % codecCount].prefix[2]`。
- 容器分节形式类似 WASM，但代码体多一个 frame 字段，随后是固定宽度的 32 位指令，不能当成标准 WASM 执行。
- `0x39f06c` 先在字段区域旋转，再按字段编号重排位；每个函数初始描述符编号为 0，下一条使用“上一条解码结果 `% 12`”。
- `0x373944..0x379270` 的 5,712 条直线构造指令提供了 64 项主解码器表。对分支、指令处理器和操作数格式的恢复是静态证据，尚不是完整 VM 实现。

十个模块均已提取，所有指令字完成格式解码；下表的“未解析”是仍未映射到 IR 的指令条数，不能忽略后声称全部反编译完成：

| 加载调用地址 | 程序地址 | 函数体数 | 指令字数 | 未解析 IR |
| --- | --- | ---: | ---: | ---: |
| `0x2d3600` | `0x3fee70` | 2 | 1,543 | 0 |
| `0x2d64c8` | `0x4014c0` | 120 | 54,598 | 5 |
| `0x2d8864` | `0x439500` | 1 | 562 | 0 |
| `0x2d9a18` | `0x43a340` | 1 | 544 | 0 |
| `0x2db93c` | `0x43b030` | 5 | 3,020 | 5 |
| `0x2dd318` | `0x43eb90` | 2 | 162 | 0 |
| `0x2dea44` | `0x43f020` | 10 | 2,514 | 0 |
| `0x2df808` | `0x4420f0` | 8 | 1,579 | 0 |
| `0x32fd08` | `0x446730` | 171 | 7,881 | 5 |
| `0x36df58` | `0x450e80` | 171 | 7,881 | 2 |

导入索引必须按容器的 function imports 排列，不能把 `CF20` 当作第 20 项；导出名称也不能从函数体序号推算。例如模块 `0x43f020` 的导出 `F2` 对应函数体 5。工具已使用实际 imports/exports 表解析调用名称；输出中的 `FUNCTION n` 始终表示函数体序号。

### X-Argus 分支与复杂摘要不是同一个函数

模块 `0x439500` 的函数体 0 在 PC 166–179 构造并解码出 `X-Argus\0`。PC 187–198 从请求结构偏移 `+8` 取值，取低 32 位，以小端 4 字节经 `0x272e40` 建立字节串，`0x283d14` → `0x2702f0` 做标准 Base64。HTTP 上游通过 `0x298bb0` 取得秒值并写入该字段。`primitives.cjs` 的 `encodeArgusTimeWord` 只恢复这一条路径，不声称它是所有 SDK/所有模式通用的 x-argus 算法，也没有据此替换运行时签名。

同一程序还解出了 `X-Khronos`、`X-Gorgon`、`X-Ladon`、`X-Helios`、`X-Medusa`、`X-Perseus`。名称来自官方程序数据及 `0x297d10 / 0x298068 / 0x29863c / 0x296fd4 / 0x2976e4` 的循环 XOR，不是根据网上算法猜测。`header-paths.json` 保存可复现的名称与偏移。不能把一个头的静态编码过程当成整套安全头已经正确；还需核对配置分支、最终合并以及请求上的其他安全头。

`X-Medusa` 的生成调用 `0x2deb98`，进入模块 `0x43f020` 导出 `F2`，经 `F1` / `F0` 使用 `CF2` → `0x2df90c`，进入模块 `0x4420f0`。这条链中已恢复的 64 轮摘要计算具有 MD5 形式的布尔函数/旋转，但使用不同的初始状态、轮常量、消息字顺序、填充及最终 XOR；直接换成标准 MD5 不成立。

### 已落地的计算核心与验证范围

`primitives.cjs` 实现了三项可独立使用的纯 JavaScript 计算：

1. `compressMedusaBlock`：模块 `0x4420f0` 导出 `F7` 的 64 轮压缩函数。它的 1,023 条原始指令经静态去除保存/恢复、空操作和常量折叠，转写成 663 个算术表达式作为对照，再整理成轮函数实现。没有 VM 指令执行器。
2. `medusaDigest16`：导出 `F2/F3/F4` 的摘要初始化、分块、结束计算。初始字为 `79e0f2fb c8b52570 ebc2f8cd 7c104d93`；不是标准 `0x80` 加零填充，而是程序数据偏移 33 的 64 字节表；补至块偏移 60 后追加位数的低 32 位；最后按原程序 XOR 四个常量。
3. `encodeArgusTimeWord`：上文静态头分支的小端字编码。

验证已经通过：

- 1,024 组可重复的不同状态和 64 字节块，轮函数版本与逐项算术转写版本输出一致。
- 19 个正文长度，包括 0、59/60/61、63/64/65、123/124/127/128/129 等边界，初始化、填充和最终 XOR 与独立组织的转写参考一致。
- 12 组位描述符的原始 ELF 指令向量、连续 32 条指令的滚动选择、截断/越界/重复代码节等格式检查通过。
- 从原 ELF 重新提取，生成的三个核心 fixture 与仓库内容逐字节一致；提供匹配的 `classes54.dex` 时另核对初始化证据 fixture。

这些验证证明“已恢复部分的内部一致性”，**不是**运行官方 SDK 得到的输入/输出对照，更不是平台认证通过。fixture 没有会话、Cookie、设备 ID 或真实登录请求。提取报告固定标记 `official_signature_oracle=false`、`signature_verified=false`。

### 初始化已定位，仍缺的状态与外层计算

Java 初始化由 `SecApiImpl.LIZIZ` → `s2/u2` 配置 → `i3.LIZJ` → 原生 opcode `0x04000001` 组成。`u2.LIZ()`（`classes54.dex:0x424c44`）的数组有 17 项：0 为 aid，1–9 是配置字符串（其中 3 是 APK 内的 SDK license，4 是 `s4.LIZ` 的原生解码结果），10–12 是数值配置转字符串，13 是 `LJIJI`，14 是 `LJIJJ` 转字符串，15–16 是两个 Map 展平后的数组。`SecApiImpl` 将 `LJIIJ` 设为 0，并设置 `tk_key=douyin`。随后 `0x04000002` 获取实例 handle，再设置 device/install ID。持久化设备 ID 不等于恢复这些 SDK 对象及状态。

`s4.LIZ` 的常量解码路径现已恢复：`classes54.dex` SHA-256 为 `778e2caf2558eedb1c2cd02b972749f89f866af921fa7803c7ab7c09cce5f070`。`s4.<clinit>`（`0x7690c4`）传入 opcode `0x01000001`、字符串索引 `0x0ee2` 的 `443549` 和 `0x769104` 的 19 字节数组；分发器 `0x6f24c..0x6f28c` 通过表 `0x3f3a80+0x20` 进入 `0x18dbd8`。该函数先把 ELF `0x6ed4c` 的 10 字节常量与循环字符串 XOR，再与 DEX 数组循环 XOR，得到 **`v04.10.04.01-bugfix`**。这是安全 SDK 配置值，不能用抖音应用版本 `40.7.0` 替代。

`recover_initialization.py` 从经过哈希检查的 DEX 字符串表、数组和 ELF 指针重新提取该值，保存 `initialization-evidence.json`。该 native 函数另外存在依赖环境检查结果的输出修改分支（`0x18e234` 后），这里没有伪造或跳过 SDK 就绪检查；静态常量正确不代表初始化状态已经兼容。

实例 ready 的具体读写顺序也已定位：构造函数 `0x2905a8` 经 `0x290644` 在 `0x29065c` 清零对象 `+0x30`；初始化器 `0x2e3c80` 创建该对象，在 `0x2e3f50..0x2e3f60` 通过虚表 `+0x58` → `0x2d1038` → `0x1b7100` 将上下文关联到对象 `+0x38`，随后 `0x2e3f70` → `0x2e4a4c` → 虚表 `+0x38` → `0x2907fc` 设置 ready。签名入口 `0x2e3b64..0x2e3b6c` 读取 `handle+0x10` 所指对象的 `+0x30`；未就绪时在 `0x2e3c00` 返回空安全头集合。已找到标记的设置位置，不等于已恢复被关联上下文的内容和生命周期，不能仅在纯协议代码里把 ready 写成 true。

尚未完成的具体工作：

- 恢复 SDK 上下文的构建条件和环境/缓存状态；恢复逻辑状态，而不是在桌面端保存/复用原生指针。`s4.LIZ` 常量与 ready 读写位置已确认，整个原生初始化过程尚未完成。
- `0x4420f0` 导出 `F1` 在 16 字节摘要之后还生成 4 个依赖环境/缓存状态的字节，外层另有字段和标志处理。`medusaDigest16` 明确只返回 16 字节，不能拿它当作完整的 20 字节中间值或 X-Medusa。
- 模块 `0x43f020` 的外层消息构造、其余摘要/加密、最终封装，以及其他安全头与设备/会话状态的一致性。
- 官方同版本、明确输入状态的完整输出样本或真实认证证据。缺少这些证据时，不启用研究核心替换默认签名、不反复让用户扫码。

### 本机复现

依赖仅用于静态解码，可安装到虚拟环境；不需要 Android SDK、WebView 或模拟器：

```powershell
python -m pip install -r scripts/reverse-engineering/metasec/requirements.txt
python scripts/reverse-engineering/metasec/extract.py --elf .tmp/login-signing-review/libmetasec_ml.so --dex54 .tmp/login-signing-review/classes54.dex --out .tmp/metasec-reproduced --check-fixtures
python -m unittest discover -s scripts/reverse-engineering/metasec -p 'test_*.py'
npm run protocol:verify-native-core
```

原 APK/ELF 和完整解码产物保留在忽略的 `.tmp` 目录，仓库只保存提取工具、必要的静态对照表达式、参数和测试。研究核心没有接入桌面登录、Go 任务池或网络请求，也未增加任何 Web/WebView/模拟器路径。

## 十三、继续实现完整 SDK：已移入桌面端的摘要与 Helios 加密部件

本节的目标仍是“完整签名和 SDK 初始化接入扫码登录”，尚未完成。没有把局部加密通过测试解释为 SDK 通过平台验证，也没有发新二维码。

### 当前代码与旧结果的修正

- 摘要实现迁到 `apps/desktop/electron/metasec/digest.js`，参数放在同目录 `digest-parameters.json`；研究检查现在直接加载桌面端的这份实现，不再保留两份计算代码。桌面打包规则已经包含该目录。
- 增加 `MedusaDigest` 的初始化、连续 update、finalize 生命周期及缓冲区处理。对 1/3/59/60/61/63/64/65/127/128/129 等分块大小检查，结果与完整正文摘要一致。
- 恢复模块 `0x4420f0` 的 F5/F6（函数体 6/5）：从种子 `0x20220420` 出发，对摘要前 8 或 12 字节执行交替位运算，追加低 32 位并设置/清除第 16 字节的 bit 2。桌面函数为 `appendMedusaTail`；512 组数据、两个分支均与从原指令展开的表达式一致。F1 随后的 SDK 状态 bit 5、F0 的配置 bit 7 仍未恢复，不能直接当作最终中间值。
- 修正 registry 构造表提取遗漏的 ARM64 ADD immediate `lsl #12`：原来 `#1/#4/#5` 被误算成字节偏移，引发三个嵌套指针错误。另补全 `0x37b0cc` 的双表选择路径。第十二节中的 17 条 UNKNOWN 现已全部映射，10 个模块均为 0；已知摘要 fixture 从原 ELF 重新生成后逐字节一致。全部指令映射完成仍不等于全部业务语义恢复。
- 提取命令现在遇到任何 UNKNOWN 就失败，并核对桌面端的摘要参数与原 ELF 提取结果一致。

### Helios 的分组加密与值封装

`apps/desktop/electron/metasec/speck.js` 实现了 `0x2dc758` 的 256 位密钥扩展，以及模块 `0x43eb90/F1` 的 34 轮 128 位分组运算；64 位加法严格取模，小端读取两个 64 位字，旋转分别为右 8 位和左 3 位。`0x2dc510` 使用 PKCS#7 补至 16 字节整块，随后独立处理各块。该部件符合 Speck-128/256。

验证不是只做“自己算两遍”：密钥扩展前 8 个轮密钥和完整密文通过了[算法作者的 Implementation Guide 1.1](https://nsacyber.github.io/simon-speck/implementations/ImplementationGuide1.1.pdf)中公布的向量；另外 256 组密钥/正文与 APK 指令直接展开的 34 轮版本一致。公开向量验证的是分组密码部件，不是抖音 SDK 的完整安全头或登录认证。

`helios.js:createHeliosValue` 继续实现模块 `0x43eb90/F0` 的值封装：

1. 将随机数保存为 4 个小端字节作为前缀。
2. 与请求结构 `+184` 的字节串拼接，经过 `0x2835f8` → `0x283224` → `0x26e878` 标准 MD5，再经 `0x1ab5d0` 输出小写 hex；**32 个 ASCII 字节**作为分组密码密钥。
3. `0x27354c` 按静态格式 `%u-%s-%s` 构造正文，分别使用请求 `+8` 的秒值、请求 `+32` 的 C 字符串及 SDK 上下文选出的 aid 字符串。
4. PKCS#7 分组加密后，输出 `Base64(nonce[4] || ciphertext)`。

传入参数仍要求调用方提供真实 SDK 上下文中的 `+32` 和 `+184` 值，没有填入臆测密钥或把 app license 直接当作加密密钥。该完整头部计算函数已进入桌面代码，但其输入上下文尚未从初始化流程正确构造，因此还没有接到正式登录签名。

### 本节验证与下一步的实际缺口

`npm run protocol:verify-native-core` 目前 10 项通过，覆盖 1,024 组摘要压缩、19 个摘要长度、连续分块、1,024 次尾部对照、公开分组密码向量、256 组分组/密钥扩展对照及完整 Helios 封装。CI 已加入此命令。从固定 ELF/DEX 全量提取及 fixture 比对也通过。

当前正式请求仍调用实验性签名；完整 SDK 接入没有完成。接下来必须恢复请求结构 `+32/+184` 等值的初始化来源、Medusa 的剩余状态位与外层计算、其余头生成，再统一接入共享 SDK 实例。需要保留 SDK 生命周期：当前默认 NativeLoginProvider 每个请求会创建新的协议 client，完整 SDK 接入时必须共享签名实例，否则计数/缓存状态会丢失。不得用仅返回已有头、伪造 ready=true 或失败后退回 AES 的方式完成接入。
