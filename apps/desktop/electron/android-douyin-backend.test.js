import { describe, it, expect, vi } from 'vitest'
const { AndroidDouyinBackend } = require('./android-douyin-backend')
const { ERROR_CODES } = require('./douyin-request-models')

describe('AndroidDouyinBackend', () => {
  const createMockClient = () => ({
    getSigner: vi.fn().mockReturnValue({}),
    setSigner: vi.fn(),
    get: vi.fn(),
    post: vi.fn()
  })

  it('fetches and normalizes lottery detail via protocolClient', async () => {
    const mockClient = createMockClient()
    mockClient.get.mockResolvedValueOnce({
      status_code: 0,
      data: {
        lottery_id: '723456789',
        lottery_id_str: '723456789',
        anchor_id: '998877',
        status: 1,
        lucky_count: 5,
        candidate_num: 120,
        prize_count: 10,
        draw_time: 1720000000,
        prize_info: {
          name: '精美手办'
        }
      }
    })

    const backend = new AndroidDouyinBackend({ protocolClient: mockClient })
    const res = await backend.getLotteryDetail({ roomId: '12345' })

    expect(res.success).toBe(true)
    expect(res.lotteryDetail.lottery_id).toBe('723456789')
    expect(res.lotteryDetail.lotteryName).toBe('精美手办')
    expect(res.lotteryDetail.joinTotal).toBe(120)
    expect(res.source).toBe('android')
    expect(mockClient.get).toHaveBeenCalledWith(
      '/webcast/lottery/melon/lottery_info/',
      expect.objectContaining({ room_id: '12345' }),
      expect.any(Object)
    )
  })

  it('submits attendLottery successfully via protocolClient', async () => {
    const mockClient = createMockClient()
    mockClient.post.mockResolvedValueOnce({
      status_code: 0,
      data: {
        status: 0
      }
    })

    const backend = new AndroidDouyinBackend({ protocolClient: mockClient })
    const res = await backend.attendLottery({ roomId: '12345', lotteryId: '723456789' })

    expect(res.success).toBe(true)
    expect(res.source).toBe('android')
    expect(mockClient.post).toHaveBeenCalledWith(
      '/webcast/lottery/melon/',
      expect.objectContaining({ room_id: '12345', lottery_id: '723456789' }),
      expect.any(Object)
    )
  })

  it('executes searchLiveByAll via /webcast/feed/ and parses room list', async () => {
    const mockClient = createMockClient()
    mockClient.get.mockResolvedValueOnce({
      status_code: 0,
      data: [
        {
          data: {
            id_str: 'room_101',
            title: '测试直播间',
            user_count: 50,
            owner: { nickname: '主播A', sec_uid: 'sec_a' },
            others: {
              web_enter_benefit_point_data: {
                has_ongoing_lottery: true
              }
            }
          }
        }
      ],
      extra: {
        has_more: true,
        max_time: 1720001000
      }
    })

    const backend = new AndroidDouyinBackend({ protocolClient: mockClient })
    const res = await backend.searchLiveByAll({ customCount: 20 })

    expect(res.success).toBe(true)
    expect(res.roomInfoList).toHaveLength(1)
    expect(res.roomInfoList[0].roomId).toBe('room_101')
    expect(res.roomInfoList[0].hasLotteryHint).toBe(true)
    expect(res.source).toBe('android')
    expect(mockClient.get).toHaveBeenCalledWith(
      '/webcast/feed/',
      expect.objectContaining({ count: 20, style: 1, channel_id: 21 }),
      expect.any(Object)
    )
  })

  it('does not issue a webpage category request', async () => {
    const client = createMockClient()
    const backend = new AndroidDouyinBackend({ protocolClient: client })
    expect((await backend.searchLiveByCategory({ categoryId: '4_101' })).code).toBe('NOT_IMPLEMENTED')
    expect(client.get).not.toHaveBeenCalled()
  })

  it('handles roomLike and roomChat', async () => {
    const mockClient = createMockClient()
    mockClient.post.mockResolvedValue({
      status_code: 0,
      data: { status: 0 }
    })

    const backend = new AndroidDouyinBackend({ protocolClient: mockClient })
    const likeRes = await backend.roomLike({ roomId: '123', count: 5 })
    expect(likeRes.success).toBe(true)

    const chatRes = await backend.roomChat({ roomId: '123', content: 'hello' })
    expect(chatRes.success).toBe(true)
  })
})
