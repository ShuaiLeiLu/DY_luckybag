# 微信小程序接入说明

## 当前链路

1. 桌面端创建一次性绑定会话
2. 服务端根据会话生成微信小程序码图片
3. 用户用微信直接扫描桌面端的小程序码
4. 小程序打开后自动 `wx.login`
5. 小程序从 `scene` 自动识别当前客户端并完成绑定
6. 用户观看激励视频
7. 广告完整播放后服务端直接写入授权
8. 桌面端继续轮询 `/license/bind-session/status`，状态变成已授权

当前小程序页面里已经没有“再次扫码绑定”的入口。

## 你需要配置的内容

修改 [`/Users/lushuailei/PycharmProjects/dy_fudai/pool-server-go/config.json`](/Users/lushuailei/PycharmProjects/dy_fudai/pool-server-go/config.json) 的 `license` 段：

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

修改 [`/Users/lushuailei/PycharmProjects/dy_fudai/miniapp/config.js`](/Users/lushuailei/PycharmProjects/dy_fudai/miniapp/config.js)：

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

## 当前仍未完成

- 广告行为风控与频控
- 同一微信账号的授权历史记录页面
- 小程序运营后台
- 失败重试和更细的状态提示
