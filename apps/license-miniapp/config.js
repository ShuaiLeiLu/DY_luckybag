const DEFAULTS = {
  BASE_URL: 'https://fudai.shuai.help/admin',
  REWARDED_VIDEO_AD_UNIT_ID: 'adunit-3258e3a8e5773f65',
  SIGNIN_REWARD_DAYS: 1,
  AD_UNLOCK_DAYS: 1
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

let rootConfig = {}
try {
  rootConfig = require('../../config.json')
} catch (_) {
  rootConfig = {}
}

const miniappConfig = asObject(asObject(rootConfig).miniapp)

module.exports = {
  BASE_URL: String(miniappConfig.baseUrl || DEFAULTS.BASE_URL).trim() || DEFAULTS.BASE_URL,
  REWARDED_VIDEO_AD_UNIT_ID: String(miniappConfig.rewardedVideoAdUnitId || DEFAULTS.REWARDED_VIDEO_AD_UNIT_ID),
  SIGNIN_REWARD_DAYS: Math.max(1, Number(miniappConfig.signinRewardDays || DEFAULTS.SIGNIN_REWARD_DAYS)),
  AD_UNLOCK_DAYS: Math.max(1, Number(miniappConfig.adUnlockDays || DEFAULTS.AD_UNLOCK_DAYS))
}
