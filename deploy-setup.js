const fs = require('fs');
const path = require('path');

const ROOT_CONFIG_PATH = path.join(__dirname, 'config.json');
const DESKTOP_POOL_CLIENT_PATH = path.join(__dirname, 'apps', 'desktop', 'src', 'services', 'poolClient.js');
const MINIAPP_CONFIG_PATH = path.join(__dirname, 'apps', 'license-miniapp', 'config.js');
const BACKEND_CONFIG_PATH = path.join(__dirname, 'apps', 'pool-server', 'config.json');

function main() {
  console.log('🔄 开始同步全局配置到各个子项目...');

  if (!fs.existsSync(ROOT_CONFIG_PATH)) {
    console.error('❌ 未找到根目录下的 config.json，请先配置！');
    process.exit(1);
  }

  const rootConfig = JSON.parse(fs.readFileSync(ROOT_CONFIG_PATH, 'utf-8'));

  // 1. Update Desktop App
  if (fs.existsSync(DESKTOP_POOL_CLIENT_PATH)) {
    let desktopCode = fs.readFileSync(DESKTOP_POOL_CLIENT_PATH, 'utf-8');
    const newDesktopUrl = rootConfig.desktop.poolServerUrl;
    desktopCode = desktopCode.replace(
      /export const FIXED_POOL_SERVER_URL = '.*'/,
      `export const FIXED_POOL_SERVER_URL = '${newDesktopUrl}'`
    );
    fs.writeFileSync(DESKTOP_POOL_CLIENT_PATH, desktopCode, 'utf-8');
    console.log(`✅ [Desktop] 桌面端接口已同步为: ${newDesktopUrl}`);
  } else {
    console.warn('⚠️ 未找到桌面端 poolClient.js 文件，跳过。');
  }

  // 2. Update Miniapp
  if (fs.existsSync(MINIAPP_CONFIG_PATH)) {
    let miniappCode = fs.readFileSync(MINIAPP_CONFIG_PATH, 'utf-8');
    const miniappCfg = rootConfig.miniapp;
    
    // We rewrite the DEFAULTS block in the miniapp config
    const newDefaults = `const DEFAULTS = {
  BASE_URL: '${miniappCfg.baseUrl}',
  REWARDED_VIDEO_AD_UNIT_ID: '${miniappCfg.rewardedVideoAdUnitId}',
  SIGNIN_REWARD_DAYS: ${miniappCfg.signinRewardDays},
  AD_UNLOCK_DAYS: ${miniappCfg.adUnlockDays}
}`;
    
    miniappCode = miniappCode.replace(/const DEFAULTS = \{[\s\S]*?\}/, newDefaults);
    fs.writeFileSync(MINIAPP_CONFIG_PATH, miniappCode, 'utf-8');
    console.log(`✅ [Miniapp] 小程序端配置已同步，BaseURL: ${miniappCfg.baseUrl}`);
  } else {
    console.warn('⚠️ 未找到小程序端 config.js 文件，跳过。');
  }

  // 3. Update Backend (Pool Server)
  if (fs.existsSync(path.dirname(BACKEND_CONFIG_PATH))) {
    const backendCfg = rootConfig.poolServer;
    // We must ensure the backend structure exactly matches what Go expects.
    // Assuming rootConfig.poolServer is the exact JSON structure for the Go app.
    fs.writeFileSync(BACKEND_CONFIG_PATH, JSON.stringify(backendCfg, null, 2), 'utf-8');
    console.log(`✅ [Backend] 服务端配置已同步 (端口: ${backendCfg.server.port}, 数据库: ${backendCfg.license.database})`);
  } else {
    console.warn('⚠️ 未找到服务端配置目录，跳过。');
  }

  console.log('🎉 所有环境配置同步完成！您现在可以进行打包与部署了。');
}

main();