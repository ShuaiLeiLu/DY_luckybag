import { describe, it, expect, vi } from 'vitest'
const { DouyinBackendManager } = require('./douyin-backend-manager')
const { ERROR_CODES } = require('./douyin-request-models')

describe('DouyinBackendManager', () => {
  const createMockBackend = () => ({
    getSigner: vi.fn().mockReturnValue({
      setSignerHook: vi.fn()
    }),
    getLotteryDetail: vi.fn().mockResolvedValue({ success: true, source: 'android', lotteryDetail: { id: '1' } }),
    getRedpacketDetail: vi.fn().mockResolvedValue({ success: true, source: 'android', redpacketDetail: { id: '2' } }),
    attendLottery: vi.fn().mockResolvedValue({ success: true, source: 'android' }),
    searchLiveByAll: vi.fn().mockResolvedValue({ success: true, source: 'android', roomInfoList: [] }),
    searchLiveByCategory: vi.fn().mockResolvedValue({ success: true, source: 'android', roomInfoList: [] }),
    roomLike: vi.fn().mockResolvedValue({ success: true, source: 'android' }),
    roomChat: vi.fn().mockResolvedValue({ success: true, source: 'android' })
  })

  it('delegates getLotteryDetail to android backend', async () => {
    const mockBackend = createMockBackend()
    const manager = new DouyinBackendManager({ androidBackend: mockBackend })

    const res = await manager.getLotteryDetail({ roomId: '123' })
    expect(res.success).toBe(true)
    expect(res.source).toBe('android')
    expect(mockBackend.getLotteryDetail).toHaveBeenCalledWith({ roomId: '123' })
  })

  it('delegates attendLottery to android backend', async () => {
    const mockBackend = createMockBackend()
    const manager = new DouyinBackendManager({ androidBackend: mockBackend })

    const res = await manager.attendLottery({ roomId: '123', lotteryId: '456' })
    expect(res.success).toBe(true)
    expect(res.source).toBe('android')
    expect(mockBackend.attendLottery).toHaveBeenCalledWith({ roomId: '123', lotteryId: '456' })
  })

  it('delegates searchLiveByAll and searchLiveByCategory to android backend', async () => {
    const mockBackend = createMockBackend()
    const manager = new DouyinBackendManager({ androidBackend: mockBackend })

    const allRes = await manager.searchLiveByAll({ customCount: 24 })
    expect(allRes.success).toBe(true)
    expect(mockBackend.searchLiveByAll).toHaveBeenCalledWith({ customCount: 24 })

    const catRes = await manager.searchLiveByCategory({ categoryId: '4_101' })
    expect(catRes.success).toBe(true)
    expect(mockBackend.searchLiveByCategory).toHaveBeenCalledWith({ categoryId: '4_101' })
  })

  it('catches backend exceptions and normalizes error format', async () => {
    const mockBackend = createMockBackend()
    mockBackend.getLotteryDetail.mockRejectedValueOnce(new Error('Network timeout'))

    const manager = new DouyinBackendManager({ androidBackend: mockBackend })
    const res = await manager.getLotteryDetail({ roomId: '123' })

    expect(res.success).toBe(false)
    expect(res.error).toBe('Network timeout')
    expect(res.code).toBe(ERROR_CODES.UNKNOWN)
    expect(res.source).toBe('android')
  })

  it('forwards signer and signer hook configuration', () => {
    const mockBackend = createMockBackend()
    const manager = new DouyinBackendManager({ androidBackend: mockBackend })

    const signer = manager.getSigner()
    expect(signer).toBeDefined()

    const hook = vi.fn()
    manager.setSignerHook(hook)
    expect(signer.setSignerHook).toHaveBeenCalledWith(hook)
  })
})
