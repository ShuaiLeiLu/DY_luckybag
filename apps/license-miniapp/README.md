# License Miniapp

微信小程序目录，负责扫码绑定和激励视频授权链路。

## 需要配置

先修改服务端配置文件：

[apps/pool-server/config.json](/Users/lushuailei/PycharmProjects/dy_fudai/apps/pool-server/config.json)

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

再修改小程序本地配置：

[config.js](/Users/lushuailei/PycharmProjects/dy_fudai/apps/license-miniapp/config.js)

```js
module.exports = {
  BASE_URL: 'https://你的服务端地址',
  AD_UNIT_ID: '你的激励视频广告位',
  AD_UNLOCK_DAYS: 30
}
```

## 当前接口

- `POST /miniapp/auth/login`
- `GET /miniapp/bind-session/status?scene=...`
- `POST /miniapp/bind-session/scan`
- `POST /miniapp/bind-session/grant`
- `GET /license/bind-session/miniapp-code?sceneCode=...`
