import { describe, expect, it } from 'vitest'
import type { AccountSession, LicenseSnapshot } from '@shared/models'
import {
  createAccountModel,
  deriveRuntimeState,
  formatRelative,
  mergeAccountModel,
  normalizeLicenseSnapshot,
  statusText
} from './runtime'

function createLicense(overrides: Partial<LicenseSnapshot> = {}): LicenseSnapshot {
  return {
    enabled: true,
    available: true,
    authorized: true,
    unrestricted: false,
    state: 'licensed',
    message: '',
    accessMode: 'licensed',
    trialState: 'none',
    trialExpireAt: 0,
    trialRemainingSec: 0,
    requiresActivation: false,
    licensePlan: 'pro',
    features: {},
    featureFlags: {},
    checkedAt: 0,
    ...overrides
  }
}

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
    ...overrides
  }
}

describe('runtime helpers', () => {
  it('normalizes license snapshot fields', () => {
    const result = normalizeLicenseSnapshot({
      enabled: true,
      available: true,
      authorized: false,
      accessMode: 'locked',
      trialState: 'expired',
      trialRemainingSec: 0,
      requiresActivation: true,
      licensePlan: 'trial-3d',
      featureFlags: { dispatch: true }
    })

    expect(result.accessMode).toBe('locked')
    expect(result.requiresActivation).toBe(true)
    expect(result.featureFlags.dispatch).toBe(true)
  })

  it('derives locked runtime state from license gate', () => {
    const account = createAccount({ actionActive: true, state: 'running' })
    const runtimeState = deriveRuntimeState(account, createLicense({
      authorized: false,
      accessMode: 'locked',
      requiresActivation: true
    }))

    expect(runtimeState).toBe('locked')
    expect(statusText(runtimeState)).toBe('已锁定')
  })

  it('derives scanner runtime state when account is active', () => {
    const account = createAccount({
      actionActive: true,
      scanRole: 'scanner',
      state: 'running'
    })

    expect(deriveRuntimeState(account, createLicense())).toBe('scanning')
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
    }, createLicense())

    expect(model.id).toBe('account_3')
    expect(model.nickname).toBe('账号3')
    expect(model.token).toBe('session-token')
    expect(model.state).toBe('opened')
    expect(model.actionActive).toBe(true)
  })

  it('formats relative seconds for dashboard chips', () => {
    expect(formatRelative(59)).toBe('59s')
    expect(formatRelative(90)).toBe('1m 30s')
    expect(formatRelative(7260)).toBe('2h 1m')
  })
})
