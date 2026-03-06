export function createScanRiskState() {
  return {
    level: 0,
    riskScore: 0,
    stableScore: 0,
    cooldownUntil: 0
  }
}

export function calcAdaptiveScanProfile(state, scanConfig) {
  const safeState = state || createScanRiskState()
  const level = Math.max(0, Number(safeState.level || 0))
  const safeScan = scanConfig || { countPerPage: 20, pagesPerCategory: 12, allCount: 24 }

  return {
    level,
    allTimes: Math.max(4, 16 - level * 3),
    allCount: Math.max(10, Number(safeScan.allCount || 24) - level * 3),
    pagesPerCategory: Math.max(3, Number(safeScan.pagesPerCategory || 12) - level * 2),
    countPerPage: Math.max(10, Number(safeScan.countPerPage || 20) - level * 2),
    detailConcurrency: Math.max(2, 6 - level),
    itemGapMs: 60 + level * 120,
    cycleDelayMinMs: 260 + level * 420,
    cycleDelayMaxMs: 800 + level * 700,
    cooldownRemainMs: Math.max(0, Number(safeState.cooldownUntil || 0) - Date.now())
  }
}

export function updateScanRiskState(state, stats) {
  const next = { ...(state || createScanRiskState()) }
  const hardRiskCount = Number(stats?.hardRiskCount || 0)
  const successCount = Number(stats?.successCount || 0)
  const prevLevel = next.level

  if (hardRiskCount > 0) {
    next.riskScore += hardRiskCount
    next.stableScore = 0
  } else if (successCount > 0) {
    next.stableScore += successCount
    next.riskScore = Math.max(0, next.riskScore - Math.ceil(successCount / 6))
  }

  let cooldownMs = 0
  const upThreshold = 3 + next.level
  if (next.riskScore >= upThreshold && next.level < 3) {
    next.level += 1
    next.riskScore = 0
    cooldownMs = next.level * 15000
    next.cooldownUntil = Date.now() + cooldownMs
  }

  const downThreshold = 20 + next.level * 10
  if (next.stableScore >= downThreshold && next.level > 0) {
    next.level -= 1
    next.riskScore = 0
    next.stableScore = 0
    next.cooldownUntil = 0
    cooldownMs = 0
  }

  return {
    state: next,
    raised: next.level > prevLevel,
    lowered: next.level < prevLevel,
    cooldownMs
  }
}
