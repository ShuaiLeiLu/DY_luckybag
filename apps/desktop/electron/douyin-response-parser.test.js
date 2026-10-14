import { describe, it, expect } from 'vitest'
const {
  normalizeLotteryInfo,
  normalizeAttendResponse,
  parseFeedResponse,
  parsePartitionResponse
} = require('./douyin-response-parser')
const { ERROR_CODES } = require('./douyin-request-models')

describe('douyin-response-parser', () => {
  describe('normalizeLotteryInfo', () => {
    it('normalizes standard lottery_info correctly', () => {
      const mockRaw = {
        lottery_id_str: '71234567890',
        anchor_id: '987654321',
        candidate_num: 150,
        lucky_count: 5,
        prize_count: 10,
        prize_info: {
          name: '手机一部',
          type: 1
        },
        total_amount: 100,
        start_time: 1700000000,
        draw_time: 1700000600,
        conditions: [{ type: 1 }]
      }

      const result = normalizeLotteryInfo(mockRaw)

      expect(result.lottery_id).toBe('71234567890')
      expect(result.anchorId).toBe('987654321')
      expect(result.joinTotal).toBe(150)
      expect(result.winningTotal).toBe(5)
      expect(result.lotteryTotal).toBe(10)
      expect(result.lotteryName).toBe('手机一部')
      expect(result.prize_name).toBe('手机一部')
      expect(result.prizeType).toBe(1)
      expect(result.start_time).toBe(1700000000)
      expect(result.end_time).toBe(1700000600)
      expect(result.conditions).toEqual([{ type: 1 }])
      expect(result.redPacketOnly).toBeUndefined()
    })

    it('handles redPacket flag and fallback names', () => {
      const mockRaw = {
        lottery_id: 1234567,
        candidate_num: 0
      }

      const result = normalizeLotteryInfo(mockRaw, { isRedPacket: true })

      expect(result.lottery_id).toBe('1234567')
      expect(result.lotteryName).toBe('未知红包')
      expect(result.redPacketOnly).toBe(true)
    })

    it('throws DouyinBackendError on invalid data', () => {
      expect(() => normalizeLotteryInfo(null)).toThrow('福袋信息数据格式错误')
      expect(() => normalizeLotteryInfo('not an object')).toThrow()
    })
  })

  describe('normalizeAttendResponse', () => {
    it('recognizes data.status = 0 as success', () => {
      const res = normalizeAttendResponse({
        data: { status: 0 }
      })
      expect(res.success).toBe(true)
      expect(res.code).toBe('OK')
    })

    it('recognizes status_code = 0 as success when status is undefined', () => {
      const res = normalizeAttendResponse({
        status_code: 0,
        data: {}
      })
      expect(res.success).toBe(true)
    })

    it('categorizes risk control error properly', () => {
      const res = normalizeAttendResponse({
        status_code: 403,
        extra: { error_msg: '访问过于频繁，触发系统风控' }
      })
      expect(res.success).toBe(false)
      expect(res.code).toBe(ERROR_CODES.RATE_LIMITED_OR_RISK)
      expect(res.retryable).toBe(false)
      expect(res.error).toContain('访问过于频繁')
    })

    it('categorizes login expired error properly', () => {
      const res = normalizeAttendResponse({
        status_code: 401,
        extra: { error_msg: '用户未登录' }
      })
      expect(res.success).toBe(false)
      expect(res.code).toBe(ERROR_CODES.AUTHENTICATION_REQUIRED)
      expect(res.retryable).toBe(false)
    })

    it('categorizes ticket guard error properly', () => {
      const res = normalizeAttendResponse({
        status_code: 1001,
        message: 'ticketguard signature mismatch'
      })
      expect(res.success).toBe(false)
      expect(res.code).toBe(ERROR_CODES.ANDROID_TICKET_GUARD_UNAVAILABLE)
      expect(res.retryable).toBe(false)
    })

    it('handles empty input gracefully', () => {
      const res = normalizeAttendResponse(null)
      expect(res.success).toBe(false)
      expect(res.code).toBe(ERROR_CODES.INVALID_PARAMS)
    })
  })

  describe('parseFeedResponse and parsePartitionResponse', () => {
    it('parses valid feed response', () => {
      const raw = {
        status_code: 0,
        data: [{ room: { id_str: '111' } }, { room: { id_str: '222' } }]
      }
      const parsed = parseFeedResponse(raw)
      expect(parsed.success).toBe(true)
      expect(parsed.data.length).toBe(2)
    })

    it('rejects feed with non-zero status_code', () => {
      const raw = {
        status_code: 500,
        extra: { error_msg: 'Internal server error' }
      }
      const parsed = parseFeedResponse(raw)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('API错误(500)')
    })

    it('parses valid partition response', () => {
      const raw = {
        status_code: 0,
        data: {
          data: [{ room: { id_str: 'room1' } }]
        }
      }
      const parsed = parsePartitionResponse(raw)
      expect(parsed.success).toBe(true)
      expect(parsed.data.length).toBe(1)
    })
  })
})
