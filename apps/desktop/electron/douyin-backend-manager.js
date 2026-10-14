/**
 * 抖音后端管理器（全面切换至 Android 原生协议）
 */

const { ERROR_CODES } = require('./douyin-request-models')

class DouyinBackendManager {
  constructor({
    androidBackend,
    logger
  } = {}) {
    this.androidBackend = androidBackend
    this.logger = logger || console
  }

  getSigner() {
    return this.androidBackend?.getSigner?.()
  }

  setSignerHook(hook) {
    const signer = this.getSigner()
    if (signer && typeof signer.setSignerHook === 'function') {
      signer.setSignerHook(hook)
    }
  }

  async getLotteryDetail(input) {
    try {
      return await this.androidBackend.getLotteryDetail(input)
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }

  async getRedpacketDetail(input) {
    try {
      return await this.androidBackend.getRedpacketDetail(input)
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }

  async attendLottery(input) {
    try {
      return await this.androidBackend.attendLottery(input)
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code || ERROR_CODES.UNKNOWN,
        retryable: false,
        source: 'android'
      }
    }
  }

  async searchLiveByAll(input) {
    try {
      return await this.androidBackend.searchLiveByAll(input)
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }

  async searchLiveByCategory(input) {
    try {
      return await this.androidBackend.searchLiveByCategory(input)
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }

  async roomLike(input) {
    try {
      return await this.androidBackend.roomLike(input)
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }

  async roomChat(input) {
    try {
      return await this.androidBackend.roomChat(input)
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }
}

module.exports = {
  DouyinBackendManager
}
