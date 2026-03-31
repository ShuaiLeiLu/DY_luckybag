# License Miniapp

微信小程序目录，负责扫码绑定和激励视频授权链路。

## 需要配置

先修改服务端配置文件：

`apps/pool-server/config.json`

```json
{
  "license": {
    "enabled": true,
    "miniAppEnabled": true,
    "miniAppAppId": "你的微信小程序AppID",
    "miniAppAppSecret": "你的微信小程序AppSecret",
    "miniAppSessionSecret": "服务端自定义长随机串",
    "miniAppPagePath": "pages/index/index",
    "miniAppEnvVersion": "release",
    "adUnlockDays": 30
  }
}
```

再修改小程序本地配置（统一结构）：

- `apps/license-miniapp/config.example.js`：模板文件（可提交）
- `apps/license-miniapp/config.local.js`：本地覆盖文件（实际生效，默认已忽略）
- `apps/license-miniapp/config.js`：加载入口（优先读取 `config.local.js`，不存在则回退模板）

`config.local.js` 示例（推荐多环境可切换）：

```js
module.exports = {
  ACTIVE_ENV: 'local',
  ENVIRONMENTS: {
    local: {
      BASE_URL: 'http://127.0.0.1:9090',
      REWARDED_VIDEO_AD_UNIT_ID: ''
    },
    dev: {
      BASE_URL: 'https://dev.example.com',
      REWARDED_VIDEO_AD_UNIT_ID: ''
    },
    prod: {
      BASE_URL: 'https://api.example.com',
      REWARDED_VIDEO_AD_UNIT_ID: ''
    }
  },
  SIGNIN_REWARD_DAYS: 1,
  AD_UNLOCK_DAYS: 30
}
```

说明：
- 只改 `ACTIVE_ENV` 即可切换环境。
- 兼容旧写法：若你直接在配置根级写 `BASE_URL`，仍可生效。

## 当前接口

- `POST /miniapp/auth/login`
- `GET /miniapp/bind-session/status?scene=...`
- `POST /miniapp/bind-session/scan`
- `POST /miniapp/bind-session/grant`
- `GET /license/bind-session/miniapp-code?sceneCode=...`

## 后端待改设计

前端已先行落地，后端建议改造方案见：

- `apps/license-miniapp/BACKEND_CHANGE_DESIGN.md`
