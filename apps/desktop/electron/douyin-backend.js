/**
 * 抖音请求后端抽象基类
 */

class DouyinRequestBackend {
  constructor(name = 'base') {
    this.name = name
  }

  /**
   * 检查当前后端是否就绪可用
   */
  async isAvailable() {
    return true
  }

  /**
   * 获取福袋详情
   * @param {object} input { roomId, accountId, webRid, isRedPacket }
   */
  async getLotteryDetail(input) {
    throw new Error(`getLotteryDetail not implemented for backend ${this.name}`)
  }

  /**
   * 获取红包详情 (便捷方法)
   * @param {object} input { roomId, accountId, webRid }
   */
  async getRedpacketDetail(input) {
    return this.getLotteryDetail({ ...input, isRedPacket: true })
  }

  /**
   * 参与福袋
   * @param {object} input { roomId, lotteryId, webRid, accountId }
   */
  async attendLottery(input) {
    throw new Error(`attendLottery not implemented for backend ${this.name}`)
  }

  /**
   * 搜索/获取所有热门直播间列表
   * @param {object} input { maxTime, accountId }
   */
  async searchLiveByAll(input) {
    throw new Error(`searchLiveByAll not implemented for backend ${this.name}`)
  }

  /**
   * 按分类获取直播间列表
   * @param {object} input { categoryId, offset, count, accountId, resolvedCategory }
   */
  async searchLiveByCategory(input) {
    throw new Error(`searchLiveByCategory not implemented for backend ${this.name}`)
  }

  /**
   * 直播间点赞
   * @param {object} input { roomId, accountId, count }
   */
  async roomLike(input) {
    throw new Error(`roomLike not implemented for backend ${this.name}`)
  }

  /**
   * 发送弹幕
   * @param {object} input { roomId, content, accountId }
   */
  async roomChat(input) {
    throw new Error(`roomChat not implemented for backend ${this.name}`)
  }
}

module.exports = {
  DouyinRequestBackend
}
