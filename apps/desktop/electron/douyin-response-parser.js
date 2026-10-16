/**
 * 抖音接口响应归一化与解析器
 * 负责 Android 原生后端的统一响应模型与直播间数据映射
 */

const { ERROR_CODES, DouyinBackendError } = require('./douyin-request-models')

/**
 * 提取错误信息
 */
function extractErrorMessage(json) {
  if (!json || typeof json !== 'object') return ''
  return (
    json?.extra?.error_msg ||
    json?.extra?.description ||
    json?.data?.prompt ||
    json?.data?.toast ||
    json?.status_msg ||
    json?.message ||
    ''
  )
}

/**
 * 判断参与请求是否成功
 */
function isAttendSuccess(status, statusCode) {
  return statusCode === 0 && (status === 0 || status === undefined)
}

/**
 * 解析并归一化福袋/红包详情
 *
 * @param {object} lotteryInfo 接口返回的 lottery_info 字段
 * @param {object} options 可选配置，例如 { isRedPacket: false }
 * @returns {object} 归一化后的福袋详情对象
 */
function normalizeLotteryInfo(lotteryInfo, options = {}) {
  if (!lotteryInfo || typeof lotteryInfo !== 'object') {
    throw new DouyinBackendError('福袋信息数据格式错误', {
      code: ERROR_CODES.INVALID_PARAMS
    })
  }

  const isRedPacket = Boolean(options.isRedPacket)
  const fallbackName = isRedPacket ? '未知红包' : '未知奖品'
  const conditions = Array.isArray(lotteryInfo.conditions) ? lotteryInfo.conditions : []
  if (!lotteryInfo.lottery_id_str && typeof lotteryInfo.lottery_id === 'number' && !Number.isSafeInteger(lotteryInfo.lottery_id)) {
    throw new DouyinBackendError('福袋 ID 数字精度不足，需要字符串标识', { code: ERROR_CODES.INVALID_PARAMS })
  }
  const lotteryId = String(lotteryInfo.lottery_id_str || lotteryInfo.lottery_id || '').trim()

  const normalized = {
    lottery_id: lotteryId,
    anchorId: lotteryInfo.anchor_id ? String(lotteryInfo.anchor_id) : '',
    joinTotal: Number(lotteryInfo.candidate_num) || 0,
    winningTotal: Number(lotteryInfo.lucky_count) || 0,
    lotteryTotal: Number(lotteryInfo.prize_count) || 0,
    lotteryName: lotteryInfo.prize_info?.name || fallbackName,
    prize_name: lotteryInfo.prize_info?.name || fallbackName,
    prizeType:
      lotteryInfo.prize_type ||
      lotteryInfo.prize_info?.type ||
      lotteryInfo.prize_info?.prize_type ||
      0,
    prizeInfo: lotteryInfo.prize_info && typeof lotteryInfo.prize_info === 'object'
      ? lotteryInfo.prize_info
      : {},
    total_amount:
      Number(lotteryInfo.total_amount) ||
      Number(lotteryInfo.prize_info?.total_amount) ||
      0,
    start_time: Number(lotteryInfo.start_time) || 0,
    end_time: Number(lotteryInfo.draw_time || lotteryInfo.end_time) || 0,
    conditions
  }

  if (isRedPacket) {
    normalized.redPacketOnly = true
  }

  return normalized
}

/**
 * 归一化参与福袋响应
 *
 * @param {object} json 接口原始响应
 * @returns {object} 归一化参与结果
 */
function normalizeAttendResponse(json) {
  if (!json || typeof json !== 'object') {
    return {
      success: false,
      data: null,
      extra: null,
      status: -1,
      statusCode: -1,
      error: '响应内容为空或格式错误',
      code: ERROR_CODES.INVALID_PARAMS,
      retryable: false
    }
  }

  const status = json?.data?.status
  const statusCode = json?.status_code
  const errorMsg = extractErrorMessage(json)
  const success = isAttendSuccess(status, statusCode)

  let code = ERROR_CODES.BUSINESS_ERROR
  let retryable = false

  if (success) {
    code = 'OK'
  } else {
    const textToCheck = `${statusCode} ${status} ${errorMsg}`.toLowerCase()
    if (statusCode === 403 || textToCheck.includes('风控') || textToCheck.includes('频繁') || textToCheck.includes('限制') || textToCheck.includes('风险')) {
      code = ERROR_CODES.RATE_LIMITED_OR_RISK
      retryable = false
    } else if (statusCode === 401 || textToCheck.includes('登录') || textToCheck.includes('未登录') || textToCheck.includes('session') || textToCheck.includes('token expired')) {
      code = ERROR_CODES.AUTHENTICATION_REQUIRED
      retryable = false
    } else if (textToCheck.includes('ticket') || textToCheck.includes('ticketguard') || textToCheck.includes('sign')) {
      code = ERROR_CODES.ANDROID_TICKET_GUARD_UNAVAILABLE
      retryable = false
    } else if (textToCheck.includes('timeout') || textToCheck.includes('econnreset') || textToCheck.includes('econnrefused') || textToCheck.includes('network')) {
      code = ERROR_CODES.NETWORK_ERROR
      retryable = true
    }
  }

  return {
    success,
    data: json?.data || null,
    extra: json?.extra || null,
    status,
    statusCode,
    error: errorMsg,
    code,
    retryable
  }
}

// ==================== 直播间与分类解析辅助 ====================

function normalizeRoomBenefitData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value
}

function flattenRoomBenefitValue(value, depth = 0) {
  if (depth > 2 || value === null || value === undefined) return []
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)]
  }
  if (Array.isArray(value)) {
    return value.slice(0, 6).flatMap((item) => flattenRoomBenefitValue(item, depth + 1))
  }
  if (typeof value !== 'object') return []
  const out = []
  Object.entries(value)
    .slice(0, 12)
    .forEach(([key, item]) => {
      out.push(String(key || ''))
      out.push(...flattenRoomBenefitValue(item, depth + 1))
    })
  return out
}

function extractRoomBenefitHints(rawBenefitData) {
  const roomBenefitData = normalizeRoomBenefitData(rawBenefitData)
  const compactText = flattenRoomBenefitValue(roomBenefitData)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const lowerText = compactText.toLowerCase()
  const lowerKeys = Object.keys(roomBenefitData).map((key) => String(key || '').toLowerCase())

  const hasExplicitFlag = [
    roomBenefitData.has_ongoing_luckybox,
    roomBenefitData.has_luckybox,
    roomBenefitData.has_redpacket,
    roomBenefitData.has_red_packet,
    roomBenefitData.has_ongoing_redpacket,
    roomBenefitData.has_ongoing_red_packet,
    roomBenefitData.redpacket,
    roomBenefitData.red_packet,
    roomBenefitData.luckybox
  ].some((value) => value === true || Number(value) === 1)

  const hasHintByKey = lowerKeys.some((key) => /red.?packet|luckybox|packet|snatch/.test(key))
  const hasHintByText = /(红包|人气红包|口令红包|福袋红包)/.test(compactText) || /red.?packet|luckybox|snatch/.test(lowerText)
  const hasRoomRedPacketHint = hasExplicitFlag || hasHintByKey || hasHintByText

  return {
    roomBenefitData,
    hasRoomRedPacketHint,
    roomRedPacketHintText: compactText ? compactText.slice(0, 160) : ''
  }
}

/**
 * 解析推荐流数据 (/webcast/feed/)
 */
function parseFeedResponse(json) {
  if (!json || typeof json !== 'object') {
    return { success: false, error: '响应为空', code: ERROR_CODES.INVALID_PARAMS }
  }

  if (json.status_code !== undefined && json.status_code !== 0) {
    const errorMsg = extractErrorMessage(json) || '未知接口错误'
    return {
      success: false,
      error: `API错误(${json.status_code}): ${errorMsg}`,
      code: ERROR_CODES.BUSINESS_ERROR,
      statusCode: json.status_code
    }
  }

  if (!json.data || !Array.isArray(json.data)) {
    return {
      success: false,
      error: '数据格式错误，未包含 feed 数组',
      code: ERROR_CODES.INVALID_PARAMS
    }
  }

  const mappedRooms = json.data
    .map((room) => {
      const roomData = room?.data || room || {}
      const roomId = String(roomData?.id_str || roomData?.id || '')
      if (!roomId) return null
      const benefitHints = extractRoomBenefitHints(roomData?.others?.web_enter_benefit_point_data)
      return {
        webRid: room?.web_rid || roomId,
        roomId,
        roomTitle: roomData?.title || '',
        authorNickname: roomData?.owner?.nickname || '',
        authorSecUid: roomData?.owner?.sec_uid || '',
        onlineTotal: roomData?.user_count || 0,
        hasLotteryHint: Boolean(roomData?.others?.web_enter_benefit_point_data?.has_ongoing_lottery),
        ...benefitHints
      }
    })
    .filter(Boolean)

  const hasMore = Boolean(json?.extra?.has_more)
  const nextMaxTime = Number(json?.extra?.max_time || 0)

  return {
    success: true,
    roomInfoList: mappedRooms,
    data: json.data,
    hasMore,
    nextMaxTime: nextMaxTime > 0 ? nextMaxTime : null,
    rawCount: json.data.length,
    extra: json.extra || null
  }
}

module.exports = {
  extractErrorMessage,
  isAttendSuccess,
  normalizeLotteryInfo,
  normalizeAttendResponse,
  normalizeRoomBenefitData,
  flattenRoomBenefitValue,
  extractRoomBenefitHints,
  parseFeedResponse
}
