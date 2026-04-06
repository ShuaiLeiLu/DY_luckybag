module.exports = {
  // local / dev / prod
  ACTIVE_ENV: 'local',
  ENVIRONMENTS: {
    local: {
      BASE_URL: 'http://127.0.0.1:9090',
      REWARDED_VIDEO_AD_UNIT_ID: 'adunit-3258e3a8e5773f65'
    },
    dev: {
      BASE_URL: 'http://110.40.169.26:9090',
      REWARDED_VIDEO_AD_UNIT_ID: 'adunit-3258e3a8e5773f65'
    },
    prod: {
      BASE_URL: 'https://api.example.com',
      REWARDED_VIDEO_AD_UNIT_ID: 'adunit-3258e3a8e5773f65'
    }
  },
  SIGNIN_REWARD_DAYS: 1,
  AD_UNLOCK_DAYS: 1
}
