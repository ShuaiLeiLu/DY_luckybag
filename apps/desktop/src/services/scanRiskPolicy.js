/**
 * 创建扫描风控状态对象。
 * @returns {{level:number,riskScore:number,stableScore:number,cooldownUntil:number}}
 */
export function createScanRiskState() {
  return {
    level: 0,
    riskScore: 0,
    stableScore: 0,
    cooldownUntil: 0
  }
}

/**
 * 将数字约束在指定区间内。
 * @param {number} num 原始值
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @returns {number}
 */
function clamp(num, min, max) {
  return Math.min(max, Math.max(min, Number(num || 0)))
}

/**
 * 根据当前风控等级计算本轮扫描参数。
 * @param {object} state 风控状态
 * @param {object} scanConfig 基础扫描配置
 * @returns {object} 自适应扫描配置
 */
export function calcAdaptiveScanProfile(state, scanConfig) {
  const safeState = state || createScanRiskState()
  const level = Math.max(0, Number(safeState.level || 0))
  const safeScan = scanConfig || { countPerPage: 15, pagesPerCategory: 5, allCount: 24 }
  const baseAllCount = clamp(safeScan.allCount || 24, 12, 24)
  const baseCountPerPage = clamp(safeScan.countPerPage || 15, 10, 20)
  const basePagesPerCategory = clamp(safeScan.pagesPerCategory || 5, 5, 80)

  const levelProfiles = {
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
    allTimes: profile.allTimes,
    allCount: profile.allCount,
    pagesPerCategory: profile.pagesPerCategory,
    countPerPage: profile.countPerPage,
    maxAllRounds: profile.maxAllRounds,
    noGrowthBreakRounds: profile.noGrowthBreakRounds,
    maxCategoryPages: profile.maxCategoryPages,
    categoryNoGrowthBreakPages: profile.categoryNoGrowthBreakPages,
    detailConcurrency: profile.detailConcurrency,
    detailRoomCap: profile.detailRoomCap,
    itemGapMs: profile.itemGapMs,
    cycleDelayMinMs: profile.cycleDelayMinMs,
    cycleDelayMaxMs: profile.cycleDelayMaxMs,
    cooldownRemainMs: Math.max(0, Number(safeState.cooldownUntil || 0) - Date.now())
  }
}

/**
 * 根据本轮扫描结果更新风控状态，并给出是否升降级。
 * @param {object} state 当前风控状态
 * @param {object} stats 本轮统计（successCount / hardRiskCount）
 * @returns {{state: object, raised: boolean, lowered: boolean, cooldownMs: number}}
 */
export function updateScanRiskState(state, stats) {
  const next = { ...(state || createScanRiskState()) }
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
    next.stableScore = 0 // 升级时同步重置，防止累积的 stableScore 导致立即触发降级
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
