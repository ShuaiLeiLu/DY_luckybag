import { describe, expect, it } from 'vitest'
import type { AccountSession } from '@shared/models'
import {
  createAccountModel,
  deriveRuntimeState,
  formatRelative,
  mergeAccountModel
} from './runtime'

function createAccount(overrides: Partial<AccountSession> = {}): AccountSession {
  return {
    id: 'acc-1',
    nickname: '测试账号',
    userId: 'user-1',
    state: 'waiting',
    runtimeState: 'ready',
    actionActive: false,
    currentRoom: '',
    token: null,
    scanRole: 'worker',
    currentTaskStage: '',
    currentTaskLabel: '',
    currentTaskAnchor: '',
    currentTaskLotteryName: '',
    currentTaskLeaseId: '',
    currentTaskLeaseExpiresAt: 0,
    currentTaskLeaseRemainingSec: 0,
    currentTaskScore: 0,
    participationCount: 0,
    todayEarnedDiamonds: 0,
    todayLotteryWinCount: 0,
    todayRedPacketWinCount: 0,
    todayLotteryWonDiamonds: 0,
    todayRedPacketWonDiamonds: 0,
    scanUploadSubmitted: 0,
    scanUploadAccepted: 0,
    scanUploadOk: false,
    scanUploadSkipped: '',
    scanUploadError: '',
    scanUploadAt: 0,
    poolActiveCandidates: 0,
    poolValidCandidates: 0,
    poolAvailableCandidates: 0,
    poolSummaryAt: 0,
    ...overrides
  }
}

describe('runtime helpers', () => {
  it.each([
    [{ state: 'waiting', actionActive: false }, 'ready'],
    [{ state: 'paused', actionActive: false }, 'paused'],
    [{ state: 'opened', actionActive: false }, 'login_required'],
    [{ state: 'running', actionActive: true }, 'preheating'],
    [{ state: 'running', actionActive: true, currentTaskStage: 'claimed' }, 'claiming'],
    [{ state: 'running', actionActive: true, currentTaskStage: 'joining' }, 'joining'],
    [{ state: 'running', actionActive: true, currentTaskStage: 'waiting_draw' }, 'waiting_result'],
    [{ state: 'running', actionActive: true, currentTaskStage: 'post_draw_stay' }, 'cooldown']
  ] as const)('derives account state from its current activity: %j', (patch, expected) => {
    const model = mergeAccountModel(createAccount(), patch)
    expect(model.runtimeState).toBe(expected)
  })

  it('derives scanner runtime state when account is active', () => {
    const account = createAccount({
      actionActive: true,
      scanRole: 'scanner',
      state: 'running'
    })

    expect(deriveRuntimeState(account)).toBe('scanning')
  })

  it('creates account model with defaults and trimmed nickname', () => {
    const model = createAccountModel({
      id: 'abc',
      nickname: '   这是一个非常非常长的账号昵称用于截断展示   '
    })

    expect(model.id).toBe('abc')
    expect(model.nickname.endsWith('…')).toBe(true)
    expect(model.scanRole).toBe('worker')
  })

  it('merges account patch with existing runtime data for immediate actions', () => {
    const model = mergeAccountModel(createAccount({
      id: 'account_3',
      nickname: '账号3',
      token: 'session-token',
      state: 'waiting',
      actionActive: false
    }), {
      state: 'opened',
      actionActive: true
    })

    expect(model.id).toBe('account_3')
    expect(model.nickname).toBe('账号3')
    expect(model.token).toBe('session-token')
    expect(model.state).toBe('opened')
    expect(model.actionActive).toBe(true)
    expect(model.runtimeState).toBe('ready')
  })

  it('formats relative seconds for dashboard chips', () => {
    expect(formatRelative(59)).toBe('59s')
    expect(formatRelative(90)).toBe('1m 30s')
    expect(formatRelative(7260)).toBe('2h 1m')
  })
})
