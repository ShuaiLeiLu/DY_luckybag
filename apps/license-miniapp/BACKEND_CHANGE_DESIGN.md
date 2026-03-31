# 小程序授权链路后端改造设计（暂不实施）

> 目标：当前先只改小程序前端。本文件整理后端待改项，供后续评审与排期。

## 1. 激励广告发奖防刷（高优先级）

### 当前现状
- 小程序前端可在“看完广告”后再调用 `/miniapp/bind-session/grant`。
- 但后端并不知道“是否真的看完广告”，理论上可被绕过直接请求 grant。

### 建议改造
- 将发奖改为两段式：
1. `POST /miniapp/reward/session/create`
   - 入参：`scene`、`sessionToken`
   - 出参：`rewardSessionId`、`expiresAt`
2. `POST /miniapp/reward/session/complete`
   - 入参：`rewardSessionId`、`scene`、`sessionToken`
   - 行为：校验会话有效性、幂等、频控，通过后发放签到奖励（等价当前 grant）

### 关键约束
- `rewardSessionId` 必须短时有效（建议 5 分钟）。
- 每个 `rewardSessionId` 只能消费 1 次。
- 与每日签到限制（同 openId/设备/scene）统一做幂等判断。
- 完成事件写审计日志，便于风控排查。

## 2. 小程序管理台鉴权改造（高优先级）

### 当前现状
- 小程序端管理页直接使用 `x-admin-token` 调用 `/admin/api/*`。
- 该 token 权限过大，不适合长期放在小程序端输入和存储。

### 建议改造
- 新增小程序管理员登录：
1. `POST /miniapp/admin/login`
   - 入参：`sessionToken`
   - 后端依据管理员白名单（openId/unionId）签发短期 `adminAccessToken`（例如 30 分钟）
2. 小程序管理接口改为 `/miniapp/admin/*`，使用 `Authorization: Bearer <adminAccessToken>`

### 权限建议
- 角色拆分：
  - `viewer`：只读
  - `operator`：可续期/解绑/启停
  - `owner`：可删除、全局开关
- 所有写操作记录 `operatorOpenId` 与操作前后快照。

## 3. 管理台聚合接口（中优先级）

### 当前现状
- 前端通过 `/admin/api/licenses` 列表本地计算概览指标。
- 数据量大时，移动端首屏和筛选体验会下降。

### 建议改造
- 新增聚合概览：
  - `GET /miniapp/admin/dashboard`
  - 返回：`total`、`active`、`boundDevices`、`wechatBound`、`riskStats[]`、`serviceStatus`
- 新增操作流水：
  - `GET /miniapp/admin/activity?page=&pageSize=`
  - 用于展示签到/绑定/启停/解绑等审计事件。

## 4. 风控与可观测性（中优先级）

### 建议补充
- grant 频控维度：
  - openId 每日上限
  - 设备指纹每日上限
  - IP / UA 异常突增告警
- 新增错误码细分：
  - `reward_session_expired`
  - `reward_session_already_consumed`
  - `admin_token_expired`
  - `admin_permission_denied`

## 5. 配置项建议（中优先级）

### 建议新增服务端配置
- `miniApp.admin.openIdWhitelist`
- `miniApp.admin.tokenTTLSeconds`
- `miniApp.reward.sessionTTLSeconds`
- `miniApp.reward.dailyLimitPerOpenId`
- `miniApp.reward.dailyLimitPerDevice`

## 6. 数据表建议（可选）

### 建议新增
- `miniapp_reward_sessions`
  - `id/reward_session_id/open_id/scene/status/created_at/consumed_at/expire_at`
- `miniapp_admin_audit_logs`
  - `id/operator_open_id/action/target_id/payload_before/payload_after/created_at`

---

## 兼容策略（建议）
- 第一阶段：保留旧 `/miniapp/bind-session/grant`，新增奖励会话接口，前端灰度切换。
- 第二阶段：管理台切到 `/miniapp/admin/*` 后，逐步下线小程序端直连 `/admin/api/*`。
- 第三阶段：开启严格风控和审计告警阈值。
