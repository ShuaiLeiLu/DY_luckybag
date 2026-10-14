/**
 * Android 端原生抖音请求后端实现
 * 由 AndroidProtocolClient 与 AndroidSignatureProvider 驱动，全量承接福袋、红包、参与及直播间交互
 */

const { DouyinRequestBackend } = require('./douyin-backend')
const {
  normalizeLotteryInfo,
  normalizeAttendResponse,
  parseFeedResponse,
  parsePartitionResponse,
  resolveCategoryPartitionParams,
  FIXED_CATEGORY_DEFAULT
} = require('./douyin-response-parser')
const {
  ERROR_CODES,
  sanitizeRoomId,
  sanitizeLotteryId
} = require('./douyin-request-models')
const { AndroidProtocolClient } = require('./android-protocol-client')

class AndroidDouyinBackend extends DouyinRequestBackend {
  constructor({
    protocolClient = null,
    safeGetAccountCookieString = null,
    traceScan = null,
    logger = null
  } = {}) {
    super('android')
    this.client = protocolClient || new AndroidProtocolClient({ logger })
    this.safeGetAccountCookieString = safeGetAccountCookieString || (async () => '')
    this.traceScan = traceScan || (() => {})
    this.logger = logger || console
  }

  getSigner() {
    return this.client.getSigner()
  }

  setSigner(signer) {
    this.client.setSigner(signer)
  }

  async isAvailable() {
    return true
  }

  async _getHeaders(accountId) {
    const headers = {}
    if (accountId) {
      try {
        const cookieString = await this.safeGetAccountCookieString(accountId)
        if (cookieString) {
          headers['Cookie'] = cookieString
        }
      } catch (_) {}
    }
    return headers
  }

  async getLotteryDetail({ roomId, webRid = null, accountId = '', isRedPacket = false } = {}) {
    const safeRoomId = sanitizeRoomId(roomId)
    if (!safeRoomId) {
      return { success: false, error: 'room_id为空', code: ERROR_CODES.INVALID_PARAMS }
    }

    const actionTag = isRedPacket ? 'get-redpacket-detail' : 'get-lottery-detail'

    try {
      this.traceScan(`request ${actionTag}-android`, {
        accountId: accountId || '',
        roomId: safeRoomId,
        webRid: String(webRid || '')
      })

      const headers = await this._getHeaders(accountId)
      const params = {
        room_id: safeRoomId,
        live_id: 1,
        enter_from: 'link_share',
        query_from: 1
      }

      const json = await this.client.get('/webcast/lottery/melon/lottery_info/', params, headers)
      const lottery_info = json?.data?.lottery_info || (json?.data?.lottery_id || json?.data?.lottery_id_str ? json.data : null)
      if (!lottery_info || typeof lottery_info !== 'object') {
        return {
          success: false,
          error: isRedPacket ? '红包信息数据格式错误' : '福袋信息数据格式错误',
          code: ERROR_CODES.INVALID_PARAMS,
          source: 'android'
        }
      }

      const lotteryDetail = normalizeLotteryInfo(lottery_info, { isRedPacket })

      this.traceScan(`response ${actionTag}-android`, {
        accountId: accountId || '',
        roomId: safeRoomId,
        success: true,
        source: 'android',
        lotteryId: String(lotteryDetail.lottery_id || ''),
        joinTotal: Number(lotteryDetail.joinTotal || 0),
        luckyCount: Number(lotteryDetail.winningTotal || 0)
      })

      return { success: true, lotteryDetail, source: 'android' }
    } catch (error) {
      this.traceScan(`response ${actionTag}-android`, {
        accountId: accountId || '',
        roomId: safeRoomId,
        success: false,
        error: error?.message || 'unknown',
        code: error?.code || ''
      })
      this.logger.debug?.(`[android] 获取${isRedPacket ? '红包' : '福袋'}详情失败:`, error)

      return {
        success: false,
        error: error.message,
        code: error?.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }

  async getRedpacketDetail(input) {
    return this.getLotteryDetail({ ...input, isRedPacket: true })
  }

  async attendLottery({ roomId, lotteryId, webRid = null, accountId = '' } = {}) {
    const safeRoomId = sanitizeRoomId(roomId)
    const safeLotteryId = sanitizeLotteryId(lotteryId)

    if (!safeRoomId || !safeLotteryId) {
      return {
        success: false,
        error: 'room_id或lottery_id为空',
        code: ERROR_CODES.INVALID_PARAMS,
        source: 'android'
      }
    }

    try {
      const headers = await this._getHeaders(accountId)
      const params = {
        room_id: safeRoomId,
        lottery_id: safeLotteryId
      }

      const json = await this.client.post('/webcast/lottery/melon/', params, headers)
      const result = normalizeAttendResponse(json)

      return {
        ...result,
        source: 'android'
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error?.code || ERROR_CODES.UNKNOWN,
        retryable: error?.retryable ?? false,
        source: 'android'
      }
    }
  }

  async searchLiveByAll({ maxTime = 0, accountId = '', customCount = 24 } = {}) {
    try {
      const headers = await this._getHeaders(accountId)
      const params = {
        style: 1,
        channel_id: 21,
        count: Math.max(8, Number(customCount) || 24)
      }
      if (Number(maxTime) > 0) {
        params.max_time = String(Number(maxTime))
      }

      const json = await this.client.get('/webcast/feed/', params, headers)
      const parsed = parseFeedResponse(json)

      return {
        ...parsed,
        source: 'android'
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error?.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }

  async searchLiveByCategory({
    categoryId = FIXED_CATEGORY_DEFAULT.categoryId,
    offset = 0,
    count = 15,
    accountId = '',
    resolvedCategory = null
  } = {}) {
    try {
      const targetCategory = resolvedCategory || resolveCategoryPartitionParams(categoryId)
      const safeOffset = Math.max(0, Number(offset) || 0)
      const safeCount = Math.max(1, Number(count) || 15)

      const headers = await this._getHeaders(accountId)
      const params = {
        partition: targetCategory.partition,
        partition_type: targetCategory.partitionType,
        offset: safeOffset,
        count: safeCount,
        req_from: 2
      }

      const json = await this.client.get('/webcast/web/partition/detail/room/', params, headers)
      const parsed = parsePartitionResponse(json, safeOffset, safeCount)

      return {
        ...parsed,
        source: 'android'
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error?.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }

  async roomLike({ roomId, accountId = '', count = 1 } = {}) {
    const safeRoomId = sanitizeRoomId(roomId)
    try {
      const headers = await this._getHeaders(accountId)
      const params = {
        room_id: safeRoomId,
        count: Math.max(1, Number(count) || 1)
      }

      const json = await this.client.post('/webcast/room/digg/', params, headers)
      return {
        success: json?.data?.status === 0 || json?.status_code === 0,
        data: json?.data || null,
        source: 'android'
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error?.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }

  async roomChat({ roomId, content = '', accountId = '' } = {}) {
    const safeRoomId = sanitizeRoomId(roomId)
    try {
      const headers = await this._getHeaders(accountId)
      const params = {
        room_id: safeRoomId,
        content: String(content || '')
      }

      const json = await this.client.post('/webcast/room/chat/', params, headers)
      return {
        success: json?.data?.status === 0 || json?.status_code === 0,
        data: json?.data || null,
        source: 'android'
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error?.code || ERROR_CODES.UNKNOWN,
        source: 'android'
      }
    }
  }
}

module.exports = {
  AndroidDouyinBackend
}
