export type ScanRiskState = {
  level: number
  riskScore: number
  stableScore: number
  cooldownUntil: number
}

export type ScanConfigLike = {
  countPerPage?: number
  pagesPerCategory?: number
  allCount?: number
}

export type AdaptiveScanProfile = {
  level: number
  allTimes: number
  allCount: number
  pagesPerCategory: number
  countPerPage: number
  maxAllRounds: number
  noGrowthBreakRounds: number
  maxCategoryPages: number
  categoryNoGrowthBreakPages: number
  detailConcurrency: number
  detailRoomCap: number
  itemGapMs: number
  cycleDelayMinMs: number
  cycleDelayMaxMs: number
  cooldownRemainMs: number
}

export type ScanRiskStats = {
  successCount?: number
  hardRiskCount?: number
}

export type ScanRiskUpdateResult = {
  state: ScanRiskState
  raised: boolean
  lowered: boolean
  cooldownMs: number
}

export function createScanRiskState(): ScanRiskState {
  return {
    level: 0,
    riskScore: 0,
    stableScore: 0,
    cooldownUntil: 0
  }
}

function clamp(num: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(num || 0)))
}

export function calcAdaptiveScanProfile(
  state?: Partial<ScanRiskState> | null,
  scanConfig?: ScanConfigLike | null
): AdaptiveScanProfile {
  const safeState = state || createScanRiskState()
  const level = Math.max(0, Number(safeState.level || 0))
  const safeScan = scanConfig || { countPerPage: 15, pagesPerCategory: 5, allCount: 24 }
  const baseAllCount = clamp(safeScan.allCount || 24, 12, 24)
  const baseCountPerPage = clamp(safeScan.countPerPage || 15, 10, 20)
  const basePagesPerCategory = clamp(safeScan.pagesPerCategory || 5, 5, 80)

  const levelProfiles: Record<number, Omit<AdaptiveScanProfile, 'level' | 'cooldownRemainMs'>> = {
    0: {
      allTimes: 10,
      allCount: baseAllCount,
      pagesPerCategory: basePagesPerCategory,
      countPerPage: baseCountPerPage,
      maxAllRounds: 48,
      noGrowthBreakRounds: 12,
      maxCategoryPages: 120,
      categoryNoGrowthBreakPages: 8,
      detailConcurrency: 3,
      detailRoomCap: 12,
      itemGapMs: 420,
      cycleDelayMinMs: 1800,
      cycleDelayMaxMs: 3200
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
      detailRoomCap: 10,
      itemGapMs: 620,
      cycleDelayMinMs: 2400,
      cycleDelayMaxMs: 3800
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
      detailRoomCap: 8,
      itemGapMs: 900,
      cycleDelayMinMs: 3400,
      cycleDelayMaxMs: 5200
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
      detailRoomCap: 6,
      itemGapMs: 1300,
      cycleDelayMinMs: 5200,
      cycleDelayMaxMs: 8000
    }
  }
  const profile = levelProfiles[level] || levelProfiles[3]

  return {
    level,
    ...profile,
    cooldownRemainMs: Math.max(0, Number(safeState.cooldownUntil || 0) - Date.now())
  }
}

export function updateScanRiskState(
  state?: Partial<ScanRiskState> | null,
  stats?: ScanRiskStats | null
): ScanRiskUpdateResult {
  const next: ScanRiskState = { ...createScanRiskState(), ...(state || {}) }
  const hardRiskCount = Number(stats?.hardRiskCount || 0)
  const successCount = Number(stats?.successCount || 0)
  const prevLevel = next.level
  const now = Date.now()

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
    next.stableScore = 0
    cooldownMs = [0, 25000, 45000, 70000][next.level] || (next.level * 25000)
    next.cooldownUntil = now + cooldownMs
  }

  if (hardRiskCount > 0) {
    const baseCooldown = 15000
    if (next.cooldownUntil < now + baseCooldown) {
      next.cooldownUntil = now + baseCooldown
      cooldownMs = Math.max(cooldownMs, baseCooldown)
    }
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
