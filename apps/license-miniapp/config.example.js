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
  AD_UNLOCK_DAYS: 1
}
