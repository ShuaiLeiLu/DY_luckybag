# License Miniapp

微信小程序目录，负责扫码绑定和激励视频授权链路。

## 需要配置

全项目统一配置文件为仓库根目录：

`config.json`

```json
{
  "miniapp": {
    "baseUrl": "http://192.168.3.47:9090",
    "rewardedVideoAdUnitId": "",
    "signinRewardDays": 1,
    "adUnlockDays": 1
  },
  "poolServer": {
    "license": {
      "enabled": true,
      "miniAppEnabled": true,
      "miniAppAppId": "你的微信小程序AppID",
      "miniAppAppSecret": "你的微信小程序AppSecret",
      "miniAppSessionSecret": "服务端自定义长随机串",
      "miniAppPagePath": "pages/index/index",
      "miniAppEnvVersion": "release"
    }
  }
}
```

## 当前接口

- `POST /miniapp/auth/login`
- `GET /miniapp/bind-session/status?scene=...`
- `POST /miniapp/bind-session/scan`
- `POST /miniapp/bind-session/grant`
- `GET /license/bind-session/miniapp-code?sceneCode=...`

## 后端待改设计

前端已先行落地，后端建议改造方案见：

- `apps/license-miniapp/BACKEND_CHANGE_DESIGN.md`
