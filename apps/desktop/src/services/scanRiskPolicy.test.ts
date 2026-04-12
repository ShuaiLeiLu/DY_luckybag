import { describe, expect, it } from 'vitest'
import {
  calcAdaptiveScanProfile,
  createScanRiskState,
  updateScanRiskState
} from './scanRiskPolicy'

describe('scanRiskPolicy helpers', () => {
  it('builds a level-aware adaptive profile using config bounds', () => {
    const profile = calcAdaptiveScanProfile(
      { level: 2, cooldownUntil: Date.now() + 1000 },
      { countPerPage: 18, pagesPerCategory: 20, allCount: 30 }
    ) as Record<string, number>
    expect(profile.level).toBe(2)
    expect(profile.allCount).toBe(18)
    expect(profile.countPerPage).toBe(16)
    expect(profile.pagesPerCategory).toBeGreaterThanOrEqual(5)
    expect(profile.cooldownRemainMs).toBeGreaterThanOrEqual(0)
  })

  it('creates an initial scan risk state with zeros', () => {
    const state = createScanRiskState() as Record<string, number>
    expect(state.level).toBe(0)
    expect(state.cooldownUntil).toBe(0)
    expect(state.riskScore).toBe(0)
    expect(state.stableScore).toBe(0)
  })

  it('raises level and cooldown when hard risks occur', () => {
    const initial = createScanRiskState()
    const result = updateScanRiskState(initial, { hardRiskCount: 3 }) as {
      raised: boolean
      cooldownMs: number
      state: Record<string, number>
    }
    expect(result.raised).toBe(true)
    expect(result.state.level).toBeGreaterThan(0)
    expect(result.cooldownMs).toBeGreaterThan(0)
    expect(result.state.riskScore).toBe(0)
  })

  it('lower levels after enough stable confirmations', () => {
    const result = updateScanRiskState(
      { level: 2, riskScore: 0, stableScore: 30, cooldownUntil: 0 },
      { successCount: 0, hardRiskCount: 0 }
    ) as {
      lowered: boolean
      state: Record<string, number>
    }
    expect(result.lowered).toBe(true)
    expect(result.state.level).toBe(1)
    expect(result.state.cooldownUntil).toBe(0)
  })
})
