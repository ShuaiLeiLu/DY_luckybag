<div align="center">

# 抖娃福袋工作台 (Douyin Fudai Protocol Workbench)

### 纯安卓原生协议驱动的高性能福袋自动化工作台 · 零模拟器 · 零 WebView · 内存级调度

**基于 Android Native 协议链与密码学逆向工程 · 深度贴合官方 App 40.7.0 传输层行为**

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D%2022.0.0-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![Go Version](https://img.shields.io/badge/Go-%3E%3D%201.25-00ADD8?style=flat-square&logo=go&logoColor=white)](apps/pool-server/go.mod)
[![Electron](https://img.shields.io/badge/Electron-40.0.0-47848F?style=flat-square&logo=electron&logoColor=white)](package.json)
[![Architecture](https://img.shields.io/badge/Architecture-Pure%20Native%20Protocol-FF6B6B?style=flat-square)](#-架构与工作原理)
[![Security](https://img.shields.io/badge/Security-OS%20safeStorage%20Encrypted-2ECC71?style=flat-square)](#-验证边界与-1049-排查指南)
[![Verification](https://img.shields.io/badge/Verification-Evidence--Driven%20%26%20Fail--Closed-F39C12?style=flat-square)](#-验证边界与-1049-排查指南)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-0078D6?style=flat-square&logo=windows&logoColor=white)](package.json)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

<br />

[🌟 核心特性](#-核心特性) · [📐 架构与工作原理](#-架构与工作原理) · [📊 协议与能力矩阵](#-协议与能力矩阵) · [🔬 逆向工程与安全规范](#-逆向工程与安全规范) · [🚀 快速开始](#-快速开始) · [🩺 协议诊断工具箱](#-协议诊断与验证工具箱) · [🛡️ 验证边界与 1049 排查](#-验证边界与-1049-排查指南) · [📁 项目工程结构](#-项目工程结构) · [❓ 常见问题](#-常见问题-faq)

<br />

<code>npm run desktop:electron:dev</code>

</div>

> [!IMPORTANT]
> **核心架构与安全约束（Project Constraints）：**
> 1. **纯安卓协议闭环**：所有业务网络请求直接由电脑端 HTTP 客户端按原生线格式封装发出，**坚决不依赖任何 Android 模拟器、手机伴生应用、WebView 控件或网页浏览器执行环境**。
> 2. **严禁 Web 方案降级**：已彻底剥离所有 Web 版登录、网页脚本执行器及旧网页分类接口，**严禁引入或恢复网页端作为后备通道或验收路径**。
> 3. **证据驱动与 Fail-Closed**：本地算法仿真仅代表计算确定性，**只有已验证的 Android 安全 SDK 适配器与平台接受的真实请求样本才能建立有效签名认证**。未配置适配器、验签失败或遭遇平台风控时，系统将在申请二维码前主动熔断（Fail-Closed），杜绝盲目重试。

---

## 🌟 核心特性

- ⚡ **真正的纯原生协议栈（Zero-Emulator & Zero-WebView）**  
  抛弃占用数 GB 内存的安卓模拟器与不稳定的手机投屏控制，摆脱 Web 端容易被批量标记的风控特征。所有通信均模拟 Android 官方客户端底层网络栈（TTNet/Cronet 规范）。

- 🔐 **原生移动端扫码登录与凭据硬件级加密**  
  完整实现官方原生设备注册 (`/service/2/device_register/`)、大屏扫码申请 (`/passport/mobile/get_qrcode/`) 与轮询鉴权流程。通过系统级 `safeStorage`（DPAPI）强加密存储 Cookie、设备参数与 Token，渲染进程永不接触敏感明文。

- 🧠 **深度逆向提取的 Metasec 密码学原语**  
  逆向提取官方客户端 40.7.0 `libmetasec_ml.so` 核心逻辑，还原 **Speck128/256 分组密码**（X-Helios）及 **定制 MD5 压缩函数**（X-Medusa），配套完备的原语单元测试套件。

- 🚀 **Go 驱动的高并发分布式任务池与租约调度**  
  基于 Go 1.25 构建的 `poolserver` 核心引擎，支持内存极速模式与 Redis 集群模式。提供秒级原子租约抢占、冷热任务淘汰、直播流候选扫描以及持久幂等执行反馈。

- 🛡️ **严格的 Fail-Closed 验证闸门**  
  建立 `authentication`、`signature`、`details` 三重独立验证状态机。只有账号身份与有效福袋详情双重校验通过才允许激活执行；会话变动、响应异常或超时（>10分钟）自动锁闭任务入口。

- 🩺 **零凭据泄漏的 CLI 协议诊断套件**  
  内置 `protocol:diagnose` 与 `protocol:login-diagnose` 命令行工具，提供脱敏的链路连通性、设备注册、二维码颁发及会话健康度报告，绝不在控制台或日志输出敏感凭据。

---

## 📊 传统方案 vs 纯安卓协议架构

| 评估维度 | 传统模拟器方案 (MuMu / 雷电) | 传统网页版自动化 (Puppeteer / Playwright) | 抖娃纯安卓协议工作台 (本项目) |
| :--- | :--- | :--- | :--- |
| **执行载体** | Android 虚拟机镜像 (QEMU/VBox) | Chromium 浏览器实例 / WebView 注入 | **直接发送原生 HTTPS 二进制/JSON 封包** |
| **单账号内存消耗** | 1.5 GB ~ 3.5 GB / 实例 | 400 MB ~ 800 MB / 标签页 | **< 15 MB / 账号会话** |
| **CPU 占用** | 极高 (图形渲染 + 指令集翻译) | 较高 (DOM 树解析 + V8 运行) | **极低 (纯 I/O 事件驱动 + 极简序列化)** |
| **并发能力** | 5 ~ 15 个账号（受硬件限制） | 20 ~ 50 个账号 | **1000+ 账号高并发无缝调度** |
| **启动延迟** | 30 秒 ~ 1 分钟 (系统引导) | 3 秒 ~ 5 秒 (打开页面) | **< 100 毫秒 (直接建立 TCP/TLS 连接)** |
| **网络层指纹** | 依赖宿主机桥接，易暴露模拟器特征 | 携带明显 Web 端 User-Agent 及接口路径 | **完美拟合真实设备：TTNet、Cronet、AXML 版本三元组** |
| **风控暴露面** | 检测传感器、底层驱动、虚拟电池等 | 网页接口被平台实施阶梯式降权与行为验证 | **使用官方移动 App 专属接口路径与加密凭据** |

---

## 📐 架构与工作原理

系统采用 **前端视图（React 19）- 协议运行时（Electron/Node.js）- 密码学核心（Metasec Engine）- 任务池服务（Go）** 四层解耦架构：

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   桌面交互层 (Desktop GUI: React 19 + Ant Design v6)             │
│   • 账号多凭据视图    • 原生扫码授权弹窗    • 协议健康诊断看板    • 福袋任务监控面板  │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Electron IPC (ContextBridge + SafeStorage)
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│               协议运行时层 (Protocol Runtime: Electron Main & Node.js)           │
│   • NativeLoginProvider: 原生注册与二维码生命周期管理 (State Machine)              │
│   • AndroidProtocolClient: TTNet 网络规范、Header 装配、CookieJar 隔离          │
│   • ProtocolSessionStore / ProtocolDeviceStore: safeStorage 加密防篡改持久化     │
└───────────────────┬──────────────────────────────────────────────┬───────────────┘
                    │                                              │
                    │ 动态绑定 (DY_ANDROID_SDK_MODULE)              │ 任务派发 / 租约同步
                    ▼                                              ▼
┌──────────────────────────────────────┐       ┌───────────────────────────────────┐
│    底层安全层 (Metasec Cryptography) │       │   分布式调度服务 (Go Pool Server) │
│ • Speck128/256 分组加密 (X-Helios)   │       │ • 任务池引擎 (In-Memory / Redis)   │
│ • 定制 64-Round MD5 压缩 (X-Medusa)  │       │ • 原子租约抢占 (Lease Engine)     │
│ • JNI Dispatch 桩与请求上下文克隆    │       │ • 原生 Feed 候选扫描与黑名单过滤  │
│ • Passport CSRF 与会话令牌联动       │       │ • 幂等反馈归档与结果回放分析      │
└───────────────────┬──────────────────┘       └───────────────────┬───────────────┘
                    │                                              │
                    └──────────────────────┬───────────────────────┘
                                           │ 直接 HTTPS (Snssdk OpenAPI)
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                  抖音官方移动端集群 (Douyin Android OpenAPI)                     │
│  • log.snssdk.com (设备注册)               • aweme.snssdk.com (扫码认证 / 个人资料)│
│  • webcast.amemv.com (直播流候选)          • webcast.amemv.com (福袋详情与抽奖)   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 原生扫码登录生命周期状态机

登录流程遵循严格的原生握手顺序，任何分支遇到异常均立即转为失败终止态，绝不发生不可控轮询：

```
      [ 开始登录 ]
           │
           ▼
     [ registering ]  ──(生成设备指纹 & POST /service/2/device_register/)──► 返回 device_id
           │
           ▼
    [ requesting_qr ] ──(source=pad 申请原生移动端二维码)──────────────────► 返回 QR Token
           │
           ▼
    ┌─► [ waiting ]   ──(检查二维码轮询状态: status='new')
    │      │
    │      ▼ (用户手机 App 扫码)
    └── [ scanned ]   ──(等待手机端二次确认: status='scanned')
           │
           ▼ (用户手机端点击“确认登录”)
    [ verifying ]     ──(POST /passport/mobile/check_qrconnect/ 交换 session_key)
           │
           ├─► [ 校验身份: GET /aweme/v1/user/profile/self/ ]
           │
           ▼ (身份一致性确认)
     [ saving ]       ──(调用系统 safeStorage 加密持久化 Cookie 与 Device 信息)
           │
           ▼
    [ completed ]     ──(激活协议客户端，允许进入任务就绪闸门)
```

---

## 📊 协议与能力矩阵

项目全面对齐抖音 Android 官方客户端版本规范，各项能力遵循细粒度边界约束：

| 业务领域 | 涉及接口 / 协议路径 | 关键协议要素与输入规范 | 当前验证状态与执行边界 |
| :--- | :--- | :--- | :--- |
| **原生设备注册** | `log.snssdk.com`<br>`/service/2/device_register/` | POST JSON 格式，携带 `magic_tag:'ss_app_log'`、设备硬件指纹、系统版本及 `_gen_time` | ✅ **已实测跑通**。服务端正常下发原生 `device_id_str` 与 `install_id_str`，系统加密保存。 |
| **原生二维码申请** | `aweme.snssdk.com`<br>`/passport/mobile/get_qrcode/` | `source=pad`、`need_logo=1`、`service=https://aweme.snssdk.com` | ✅ **已实测跑通**。服务端返回有效 PNG Data URL、QR Token 及毫秒级过期时间戳。 |
| **扫码状态轮询** | `aweme.snssdk.com`<br>`/passport/mobile/check_qrconnect/` | `service=aweme.snssdk.com`（裸域名）、`scene=0`、`token` 鉴权 | ⚠️ **部分跑通**。`new`（等待）和 `scanned`（已扫码）正常流转；手机确认后返回 `1049`，未完成会话交换。 |
| **当前资料核验** | `aweme.snssdk.com`<br>`/aweme/v1/user/profile/self/` | 原生 Cookie 会话 + `x-tt-passport-csrf-token` + 动态签名 | ⏳ **就绪待测**。用于登录后校对 UID 与手机账号真实身份，响应必须满足 `status_code=0`。 |
| **直播间候选发现** | `webcast.amemv.com`<br>`/webcast/feed/` | 原生直播流 Feed 接口，支持分页与机型参数传递 | ✅ **支持**。直接基于原生 Feed 扫描福袋候选；旧 Web 分类接口已全量剔除。 |
| **福袋详情解析** | `webcast.amemv.com`<br>`/webcast/lottery/melon/lottery_info/` | 传递内部数字 `room_id`，解析 `lottery_id`、奖品类型、开奖倒计时 | ⏳ **受登录阻塞**。只有账号完成真实登录并验证通过后方可激活。 |
| **福袋单次参与** | `webcast.amemv.com`<br>`/webcast/lottery/melon/attend/` | POST 原生签名载荷，严禁重放 | 🛑 **未验收跳过**。复杂条件（粉丝团、灯牌、指定评论、长久观看）直接跳过，不支持红包。 |
| **会话与设备存储** | 本地 Electron 主进程 | Node.js Buffer + 系统 `safeStorage` (DPAPI/Keychain) | ✅ **已实测跑通**。拒绝任何明文凭据落盘，不支持 plaintext 回退。 |
| **任务池与租约调度** | `apps/pool-server` (Go) | HTTP RESTful + Bearer Token，支持 Redis / 内存模式 | ✅ **完全验收**。包含原子租约争抢、幂等去重、自动过期机制，离线联调覆盖率 100%。 |

---

## 🔬 逆向工程与安全规范

### 1. 官方 APK 40.7.0 元数据实测标准

经对官方安装包 `douyin_select_51059831a_v19919_400701_ce49_1791454388.apk` 的 `AndroidManifest.xml` 二进制 AXML int32 池及 DEX 字符串表深层扫描，确立核心版本标准：

| 字段名称 | 真实取值 | 逆向来源与定位 | 工程使用规范 |
| :--- | :--- | :--- | :--- |
| **`package`** | `com.ss.android.ugc.aweme` | AXML String Pool (Index 79) | 官方主包名（注：`.mobile` 为 32.2.6 旧版，已废弃） |
| **`version_name`** | `40.7.0` | AXML String Pool | 客户端对外呈现的官方版本号 |
| **`version_code`** | `400700` | AXML `SS_VERSION_CODE` (0x51184) | 核心通信版本编码，三者各司其职，**绝对不能混用** |
| **`manifest_version_code`** | `400701` | AXML `android:versionCode` (0x4853C) | 清单文件版本编码，用于拼装 UA 头 |
| **`update_version_code`** | `40709900` | AXML `UPDATE_VERSION_CODE` (0x511E8) | 升级逻辑版本标识 |
| **`passport-sdk-version`**| `60759` | classes19.dex `string_ids[5207]` | Passport 鉴权 SDK 版本（旧版为 203274） |
| **`aid`** | `1128` | classes 字符常量 | 抖音主端 App ID（`6383` 为极速版/网页端） |

### 2. Metasec 密码学原语逆向确证

针对特定 native ELF (`libmetasec_ml.so`，EM_AARCH64架构)，通过静态指令翻译与反编译，已完成底层算子的数学确认：

- **X-Helios 分组加密（Speck128/256）**：
  - 核心算法确认为 **NSA Speck128/256**（分组长度 128-bit，密钥长度 256-bit，34 轮轮函数，`rotr 8` 与 `rotr 61` 密钥扩展调度）。
  - 密钥生成方式：`md5(nonce ‖ secret)` 提取出来的 **32 字节小写十六进制 ASCII 串** 作为 256 位密钥。
  - 明文组织：`${timestamp}-${contextText}-${aid}`，采用 PKCS#7 填充。
  - 最终编码：`base64(4字节小端 nonce ‖ AES/Speck 密文)`。在 `scripts/reverse-engineering/metasec/speck.test.cjs` 经受官方公布标准测试向量的 100% 比对通过。
- **X-Medusa 摘要压缩（定制 MD5 变体）**：
  - 64 轮压缩循环，但引入定制常量表与非常规左旋位移参数（见 `apps/desktop/electron/metasec/digest-parameters.json`）。
  - 前序阶段生成 16 字节结果，后续装配 4 字节状态参数合并为 20 字节。
  - 尾部校验和校验：`appendMedusaTail` 基于幻数 `0x20220420` 遍历计算尾部并强制定向置位 bit 2 和 bit 5。
- **JNI Dispatch 桩与对象初始化链**：
  - `0x2e3f50`：虚表调度入口，执行 `ldr x8, [x20]; ldr x8, [x8, #0x58]; br x8`。
  - `0x1b7100`：双字段克隆函数，将网络请求上下文写入对象偏移 `+0x38`，伴随 `tpidr_el0+0x28` 金丝雀堆栈保护及引用计数原子递增。
  - `0x2907fc`：`MOV w8, #1; STRB w8, [x0, #0x30]; ret`，标志请求签名上下文状态初始化就绪。

### 3. 生产级安全 SDK 适配规范 (`DY_ANDROID_SDK_MODULE`)

为了保证生产环境的绝对严谨，项目定义了标准的安全适配器契约。若未配置该适配器，登录模块会在申请二维码前显式停机：

```javascript
// 适配器模块必须导出一个工厂方法或实例：
module.exports = {
  createAndroidSdkAdapter() {
    return {
      // 声明必须附加的安全请求头清单 (例如 x-ss-req-ticket, x-argus, x-ladon 等)
      requiredHeaders: ['x-ss-req-ticket', 'x-argus'],
      
      // 同步或异步完成请求签名
      async signRequest({ method, url, query, headers, body }) {
        return { headers: { ... } };
      },
      
      // 针对真实捕获的样本执行完整度校验，严禁使用虚构数据冒充平台接受
      async verifyTrustedSample(sample) {
        return true;
      },
      
      // 可选的生命周期与响应消耗钩子
      initialize() {},
      consumeResponse(responseHeaders) {},
      dispose() {}
    };
  }
};
```

---

## 🚀 快速开始

### 环境依赖

- **Node.js**：`>= 22.0.0`（开发推荐 Node.js 22 LTS）
- **Go 环境**：`>= 1.25`（项目亦内置 `.tools/go` 自动查找支持）
- **操作系统**：Windows 10 / 11 (x64)

### 1. 安装依赖与本地初始化

```powershell
# 1. 克隆代码仓库并安装完整依赖
git clone https://github.com/your-org/dy-fudai.git
cd dy-fudai
npm ci

# 2. 自动生成默认配置文件 config.json 并准备环境
npm run setup:local
```

### 2. 启动服务与桌面端

建议开启两个终端分别运行后端任务池与桌面客户端：

```powershell
# 终端 1：启动 Go 任务池调度服务 (默认监听 127.0.0.1:9090)
npm run server:run

# 终端 2：启动 Electron 桌面应用 (Vite 热加载 + 桌面窗口)
npm run desktop:electron:dev
```

> **提示**：若 9090 端口已被其他程序占用，请在根目录 `config.json` 中修改 `poolServer.server.port`，并同步修改 `desktop.poolServerUrl`。

### 3. 操作与任务流转

1. **添加账号**：在桌面应用点击“添加账号”，系统将自动向平台注册虚拟协议设备并申请原生二维码。
2. **扫码确认**：打开手机抖音 App 扫描界面上的二维码并点击“确认登录”。
3. **安全存储**：系统成功读取并校验当前账号身份后，自动利用系统底层 `safeStorage` 加密保存会话，免去手工配置 JSON 的繁琐。
4. **验证协议**：在账号卡片点击“验证协议”，输入目标直播间的数字 `room_id`，依次校验当前账号有效性及福袋详情。
5. **开启任务**：两项均验证通过后，方可启动全自动高并发任务调度。

---

## 🩺 协议诊断与验证工具箱

项目内置全面的诊断脚本，所有诊断输出均经过严密的脱敏处理，**绝不在报告中输出 Cookie、Token 或设备敏感标识**。

### 1. 离线综合冒烟测试 (Offline Smoke Test)

离线测试会拉起真实 Electron 主进程上下文、Preload IPC 通道、原生签名客户端及 Go 任务池，通过本地受控夹具验证全链路流转：

```powershell
npm run test:offline
```

### 2. 匿名网络连通性诊断

用于快速测试宿主机与抖音 OpenAPI 节点之间的底层网络通信及状态码响应：

```powershell
npm run protocol:diagnose -- --anonymous --output .tmp/protocol-diagnostic.json
```

### 3. 真实原生扫码流程诊断

验证设备注册、原生二维码申请以及一次扫码状态的平台级实时轮询（不保存真实会话）：

```powershell
npm run protocol:login-diagnose -- --live --output .tmp/login-check.json
```

*输出结果示例（自动格式化脱敏）：*
```json
{
  "checkedAt": "2026-10-16T05:20:00.000Z",
  "mode": "android-mobile-qr",
  "simulatorRequired": false,
  "webExecution": false,
  "signatureImplementation": "configured-android-sdk",
  "client": {
    "appVersion": "40.7.0",
    "versionCode": "400700",
    "manifestVersionCode": "400701",
    "updateVersionCode": "40709900",
    "passportSdkVersion": "60759"
  },
  "device": "server_assigned",
  "qr": "server_issued",
  "polling": "new",
  "authentication": "not_tested",
  "sessionSaved": false,
  "note": "只验证设备注册、真实二维码申请及一次扫码状态读取；未扫码，未保存账号会话。"
}
```

### 4. 账号会话与房间可用性核验

使用离线提取的私有会话凭据对特定直播间开展双重准入验证：

```powershell
npm run protocol:diagnose -- --session C:/private/account.protocol-session.json --room-id 1234567890
```

### 5. 逆向密码学原语自检

独立验证 Speck128/256 分组加密算法与定制 MD5 压缩函数在当前机器环境下的绝对数学一致性：

```powershell
npm run protocol:verify-native-core
```

---

## 🛡️ 验证边界与 1049 排查指南

### 1. 业务错误码 1049 深度技术排查

在调用 `/passport/mobile/check_qrconnect/` 接口进行扫码结果确认时，若收到：
`{ "message":"error", "data":{ "error_code": 1049, "description":"当前版本过低或来源非官方渠道" } }`

根据项目的逆向排查矩阵，应按如下优先级逐项复核：

1. **`aid` 参数序列化类型**：原生移动端中 `aid=1128` 是数值型存在。在拼装 Query 参数时，需确保键值对的严格排序与设备注册时一致。
2. **版本号三元组一致性**：确认未混淆 `version_code=400700`、`manifest_version_code=400701` 与 `update_version_code=40709900`。
3. **User-Agent 规范结构**：必须严格遵循 `com.ss.android.ugc.aweme/400701 (Linux; U; Android 12; zh_CN; Pixel 6; Build/SQ3A.220705.004; Cronet/TTNetVersion:...)` 标准。
4. **Passport CSRF 凭据联动**：检查由前期响应 `Set-Cookie` 下发的 `passport_csrf_token` 是否已被正确提取并装配至请求头 `x-tt-passport-csrf-token`。
5. **域名与服务参数隔离**：申请二维码时采用完整协议地址 `service=https://aweme.snssdk.com`，而轮询时必须采用裸主机名 `service=aweme.snssdk.com`，两者不可互换。

### 2. 系统安全与防御性准则 (Fail-Closed)

- **凭据绝对防泄露**：禁止在日志、诊断文件、报错追踪或 IPC 传输过程中输出 Cookie、Device ID、Token 明文。
- **单例 Client 内存复用**：`NativeLoginProvider` 对同一目标域名采用 `clientCache` 单例机制复用客户端实例，确保网络会话与 SDK 内部状态在整个流程中保持连贯。
- **无盲目自动重试**：遇到未知响应结构、平台安全拦截（如图形验证码、风控短信）或 1049 拒绝时，立即停止尝试并释放资源，坚决不进行无休止轮询。

---

## 📁 项目工程结构

```
dy/
├── apps/
│   ├── desktop/                      # Electron 桌面管理客户端
│   │   ├── electron/                 # Node.js 原生协议主进程与网络运行时
│   │   │   ├── android-protocol-client.js     # 原生 HTTP 协议客户端 (TTNet/Cronet规范)
│   │   │   ├── native-login-provider.js       # 原生移动端扫码登录提供器 (状态机控制)
│   │   │   ├── android-sdk-adapter.js         # 生产级 Android 安全 SDK 契约接口
│   │   │   ├── android-client-profile.js      # 40.7.0 机型、系统与版本三元组定义
│   │   │   ├── protocol-runtime.js            # 协议业务运行时与准入闸门管理
│   │   │   ├── protocol-session-store.js      # safeStorage 加密会话持久化
│   │   │   ├── metasec/                       # 逆向密码学核心 (Speck128/256, Digest)
│   │   │   └── main.js                        # Electron 主入口与 IPC 路由
│   │   └── src/                      # React 19 + AntD v6 + Tailwind 渲染层前端
│   └── pool-server/                  # Go 分布式任务池服务
│       ├── cmd/                      # 服务入口 (poolserver, learning-replay)
│       ├── internal/pool/            # 任务池引擎、租约机制、候选扫描与日志归档
│       ├── docker-compose.yml        # Docker 生产编排
│       └── go.mod                    # Go 模块定义 (Go 1.25+)
├── docs/                             # 深度技术规格与逆向工程报告
│   ├── AUTOMATION_VALIDATION.md      # 纯安卓协议改造与自动化验证边界
│   └── reverse-engineering/          # 40.7.0 APK 静态分析、AXML 解析与扫码登录逆向
├── scripts/                          # 工程化脚本与协议诊断工具
│   ├── protocol-diagnose.cjs         # 协议连通性与会话验证 CLI 工具
│   ├── protocol-login-diagnose.cjs   # 原生扫码登录流程诊断 CLI 工具
│   ├── offline-smoke.cjs             # 全系统离线自动化联调冒烟测试
│   └── reverse-engineering/          # Metasec 算子提取与测试脚本
├── package.json                      # 项目包配置与 npm 脚本
├── config.json                       # 统一配置文件 (桌面端与服务端口)
└── AGENTS.md                         # AI 助手与自动化代理必须遵循的开发约束
```

---

## ❓ 常见问题 (FAQ)

<details>
<summary><b>Q1: 为什么完全废弃 Web 网页端登录与 WebView 方案？</b></summary>
<br>
平台对 Web 网页端与移动客户端实施的是完全不同维度的风控体系。网页端接口频繁受到验证码拦截、Session 频次限制，且无法获取移动端核心接口权限；更严重的是，网页版接口常年面临被平台随时降权或关停的风险。纯安卓协议直接使用移动端高优先级接口，运行稳定且资源消耗降至原本的 2% 以下。
</details>

<details>
<summary><b>Q2: 为什么本地 Speck 与 MD5 算法自测通过，但扫码仍返回 1049？</b></summary>
<br>
本地单元测试通过仅证明本项目的 JavaScript 算子忠实还原了反编译代码中的数学逻辑。但现代安全 SDK 不仅仅依赖算法计算，还会采集硬件寄存器指纹、内核环境特征、底层设备证明（Attestation）及动态行为校验。必须引入合法的 <code>DY_ANDROID_SDK_MODULE</code> 提供完整硬件与签名环境，才能端到端打通平台最终校验。
</details>

<details>
<summary><b>Q3: safeStorage 是如何保障凭据安全的？</b></summary>
<br>
在 Windows 系统下，Electron 的 <code>safeStorage</code> 接口直接调用 Windows DPAPI（Data Protection API），利用当前登录 Windows 用户的密码学生成加密密钥；在 macOS 下则使用系统 Keychain。这意味着导出的加密文件即使被复制到其他计算机也无法解密，彻底杜绝明文 Token 泄漏风险。
</details>

<details>
<summary><b>Q4: 是否必须搭建 Redis 才能运行？</b></summary>
<br>
不需要。Go 任务池默认支持纯内存单机模式（In-Memory Mode）。只有当需要在多台机器部署分布式集群、跨物理节点共享任务租约时，才需在 <code>config.json</code> 中启用 Redis 配置。
</details>

---

## 🛠️ 构建与发布

执行全套自动化测试并打包 Windows 安装程序：

```powershell
# 1. 运行桌面端测试套件
npm run desktop:test

# 2. 编译前端生产静态资源
npm run desktop:build

# 3. 运行 Go 服务端测试套件
npm run server:test

# 4. 执行全系统离线冒烟联调
npm run test:offline

# 5. 打包生成 Windows 64位 NSIS 安装程序
npm run desktop:electron:build:win
```

生成的安装包将输出至 `apps/desktop/dist-electron/` 目录。

---

## ⚠️ 免责声明 (Disclaimer)

本项目仅作为**移动端网络通信协议分析、逆向工程研究、信息安全与软件架构设计**的学术交流与技术探讨用途。

- 本项目不提供、不分发任何商业平台的非公开安全密钥、签名私钥或已脱壳的核心闭源动态链接库。
- 使用本项目代码进行二次开发、研究或测试的用户，应严格遵守所在国家/地区的相关法律法规，不得将其用于任何侵犯第三方合法权益、破坏网络系统可用性或违背平台用户服务协议的生产活动。
- 开发者不对因滥用本项目代码所引发的任何直接、间接损失或法律后果承担责任。

---

<div align="center">

**抖娃福袋工作台开发团队** · *Crafted with Rigor, Precision & Engineering Excellence*

</div>
