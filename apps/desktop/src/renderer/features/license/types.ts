export type UiLogLevel = 'info' | 'warning' | 'error' | 'success'

export type LicenseBindSession = {
  bindToken?: string
  sceneCode?: string
  status?: string
  message?: string
  remainingSec?: number
  adUnlockDays?: number
  authorized?: boolean
  wechatNickname?: string
  expireAt?: number
}
