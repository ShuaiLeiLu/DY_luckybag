export function createScanRiskState() {
  return {
    level: 0,
    riskScore: 0,
    stableScore: 0,
    cooldownUntil: 0
  }
}

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, Number(num || 0)))
}

export function calcAdaptiveScanProfile(state, scanConfig) {
  const safeState = state || createScanRiskState()
  const level = Math.max(0, Number(safeState.level || 0))
  const safeScan = scanConfig || { countPerPage: 15, pagesPerCategory: 12, allCount: 24 }
  const baseAllCount = clamp(safeScan.allCount || 24, 12, 24)
  const baseCountPerPage = clamp(safeScan.countPerPage || 15, 10, 20)
  const basePagesPerCategory = clamp(safeScan.pagesPerCategory || 12, 6, 80)

  const levelProfiles = {
    0: {
      allTimes: 14,
      allCount: baseAllCount,
      pagesPerCategory: basePagesPerCategory,
      countPerPage: baseCountPerPage,
      maxAllRounds: 48,
      noGrowthBreakRounds: 12,
      maxCategoryPages: 120,
      categoryNoGrowthBreakPages: 8,
      detailConcurrency: 3,
      itemGapMs: 220,
      cycleDelayMinMs: 1200,
      cycleDelayMaxMs: 2200
    },
    1: {
      allTimes: 10,
      allCount: Math.max(14, baseAllCount - 2),
      pagesPerCategory: basePagesPerCategory,
      countPerPage: baseCountPerPage,
      maxAllRounds: 36,
      noGrowthBreakRounds: 9,
      maxCategoryPages: 80,
      categoryNoGrowthBreakPages: 6,
      detailConcurrency: 2,
      itemGapMs: 320,
      cycleDelayMinMs: 1800,
      cycleDelayMaxMs: 3000
    },
    2: {
      allTimes: 8,
      allCount: Math.max(12, baseAllCount - 6),
      pagesPerCategory: basePagesPerCategory,
      countPerPage: Math.max(12, baseCountPerPage - 2),
      maxAllRounds: 24,
      noGrowthBreakRounds: 7,
      maxCategoryPages: 48,
      categoryNoGrowthBreakPages: 5,
      detailConcurrency: 2,
      itemGapMs: 480,
      cycleDelayMinMs: 2800,
      cycleDelayMaxMs: 4200
    },
    3: {
      allTimes: 6,
      allCount: 12,
      pagesPerCategory: basePagesPerCategory,
      countPerPage: 10,
      maxAllRounds: 12,
      noGrowthBreakRounds: 5,
      maxCategoryPages: 24,
      categoryNoGrowthBreakPages: 4,
      detailConcurrency: 1,
      itemGapMs: 700,
      cycleDelayMinMs: 4500,
      cycleDelayMaxMs: 7000
    }
  }
  const profile = levelProfiles[level] || levelProfiles[3]

  return {
    level,
    allTimes: profile.allTimes,
    allCount: profile.allCount,
    pagesPerCategory: profile.pagesPerCategory,
    countPerPage: profile.countPerPage,
    maxAllRounds: profile.maxAllRounds,
    noGrowthBreakRounds: profile.noGrowthBreakRounds,
    maxCategoryPages: profile.maxCategoryPages,
    categoryNoGrowthBreakPages: profile.categoryNoGrowthBreakPages,
    detailConcurrency: profile.detailConcurrency,
    itemGapMs: profile.itemGapMs,
    cycleDelayMinMs: profile.cycleDelayMinMs,
    cycleDelayMaxMs: profile.cycleDelayMaxMs,
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
    cooldownMs = [0, 25000, 45000, 70000][next.level] || (next.level * 25000)
    next.cooldownUntil = Date.now() + cooldownMs
  }

  const downThreshold = 14 + next.level * 8
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
