import { describe, it, expect, vi } from 'vitest'
import { getLotteryInfo as getDetails, searchLiveByAll } from './scanCollector'
import { participationError as checkParticipation, attendLotteryWithRetry as attend, joinLotteryByProtocol } from './joinExecutor'
const getLotteryInfo: any = getDetails
const participationError: any = checkParticipation
const attendLotteryWithRetry: any = attend

function scanManager(invoke: any) {
  const account = { id: 'a', config: {}, callbacks: { onLog: vi.fn(), onStatusUpdate: vi.fn() } }
  return { accounts: new Map([['a', account]]), isPaused: () => false, ipc: { invoke }, sleep: async () => {},
    addLotteryInfoWithoutDuplicates: vi.fn(), calculatePredictedProbabilities: vi.fn(), sortLotteriesByProbability: vi.fn(), emitLotteryListUpdate: vi.fn(),
    enqueuePoolCandidatesUpload: vi.fn().mockResolvedValue({ ok: true, accepted: 1 }), handleBackendFailure: vi.fn() }
}

describe('bounded scanning', () => {
  it('enforces detail concurrency and room cap', async () => {
    let active = 0, maximum = 0
    const invoke = vi.fn(async () => {
      active++; maximum = Math.max(active, maximum)
      await new Promise(resolve => setTimeout(resolve, 4)); active--
      return { success: true, lotteryDetail: { lottery_id: '1' } }
    })
    const result = await getLotteryInfo(scanManager(invoke), Array.from({ length: 12 }, (_, i) => ({ roomId: String(i) })), 'a', { detailConcurrency: 1, detailRoomCap: 5, itemGapMs: 0 })
    expect(maximum).toBe(1); expect(invoke).toHaveBeenCalledTimes(5); expect(result.stats.successCount).toBe(5)
  })
  it('halts the remaining queue on HTTP 403', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: false, statusCode: 403, code: 'RATE_LIMITED_OR_RISK' })
    const manager = scanManager(invoke)
    const result = await getLotteryInfo(manager, Array.from({ length: 12 }, (_, i) => ({ roomId: String(i) })), 'a', { detailConcurrency: 1, detailRoomCap: 12, itemGapMs: 0 })
    expect(invoke).toHaveBeenCalledTimes(1); expect(result.stats.hardRiskCount).toBe(1); expect(manager.handleBackendFailure).toHaveBeenCalled()
  })
  it('follows max_time and uploads the first batch before requesting the next page', async () => {
    let pages = 0
    const invoke = vi.fn(async (channel: string, input: any) => {
      if (channel === 'search-live-by-all') {
        pages++
        if (pages === 2) { expect(input.maxTime).toBe(90); expect(manager.enqueuePoolCandidatesUpload).toHaveBeenCalledTimes(1) }
        return { success: true, roomInfoList: [{ roomId: String(pages) }], nextMaxTime: 90, hasMore: pages < 2 }
      }
      if (channel === 'get-lottery-detail') return { success: true, lotteryDetail: { lottery_id: String(pages), end_time: Date.now()/1000 + 60 } }
      return {}
    })
    const manager = scanManager(invoke)
    await searchLiveByAll(manager, 'a', 3, { itemGapMs: 0 })
    expect(pages).toBe(2); expect(manager.enqueuePoolCandidatesUpload).toHaveBeenCalledTimes(2)
  })
})

describe('participation deadline and identity', () => {
  it('clears the previous target deadline after failed participation so the next round is usable', async () => {
    const manager: any = scanManager(vi.fn(async () => ({ success: false, code: 'BUSINESS_ERROR' })))
    const target = { roomId: '123', lottery_id: '456', end_time: Date.now()/1000+90 }
    await joinLotteryByProtocol(manager, 'a', { lotteryInfo: target, accountData: manager.accounts.get('a') })
    expect(manager.participationBudgets.has('a')).toBe(false)
    expect(participationError(manager, 'a')).toBeNull()
  })
  it('does not replay a participation request when its acknowledgement is lost', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'get-lottery-detail') return { success: true, lotteryDetail: { lottery_id: '456', end_time: Date.now()/1000+90, conditions: [] } }
      throw new Error('lost acknowledgement')
    })
    const manager: any = scanManager(invoke)
    const result = await attendLotteryWithRetry(manager, 'a', manager.accounts.get('a'), { roomId: '123', lottery_id: '456', end_time: Date.now()/1000+90 }, '456')
    expect(result.code).toBe('ATTEND_OUTCOME_UNKNOWN')
    expect(invoke.mock.calls.filter(call => call[0] === 'attend-lottery')).toHaveLength(1)
  })
  it('skips unverified membership conditions without submitting a request', async () => {
    const invoke = vi.fn(async (_channel: string) => ({ success: true, lotteryDetail: { lottery_id: '456', end_time: Date.now()/1000+90,
      conditions: [{ type: 0, content: '会员专属' }] } }))
    const manager: any = scanManager(invoke)
    const result = await attendLotteryWithRetry(manager, 'a', manager.accounts.get('a'), { roomId: '123', lottery_id: '456', end_time: Date.now()/1000+90 }, '456')
    expect(result.code).toBe('UNSUPPORTED_REQUIREMENT')
    expect(invoke.mock.calls.some(call => call[0] === 'attend-lottery')).toBe(false)
  })
  it('refuses expired targets and expired leases', () => {
    const manager = scanManager(vi.fn())
    expect(participationError(manager, 'a', { end_time: Date.now()/1000 - 1 })?.code).toBe('PARTICIPATION_DEADLINE')
    expect(participationError({ ...manager, getClaimedTask: () => ({ lease: { expiresAt: Date.now() - 1 } }) }, 'a')?.code).toBe('LEASE_EXPIRED')
  })
  it('does not submit when refreshed details point to a new lottery', async () => {
    const invoke = vi.fn(async (channel: string) => channel === 'get-lottery-detail'
      ? { success: true, lotteryDetail: { lottery_id: 'new', end_time: Date.now()/1000 + 90 } }
      : { success: false })
    const manager = scanManager(invoke)
    const result = await attendLotteryWithRetry(manager, 'a', manager.accounts.get('a'), { roomId: '123', lottery_id: 'old', end_time: Date.now()/1000 + 90 }, 'old')
    expect(result.code).toBe('LOTTERY_CHANGED')
    expect(invoke.mock.calls.some(call => call[0] === 'attend-lottery')).toBe(false)
  })
})
