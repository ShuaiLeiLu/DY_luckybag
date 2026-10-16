import { classifyBackendFailure } from './backendErrors'

export function participationError(manager, accountId, lotteryInfo = null) {
  if (!manager.accounts.has(accountId) || manager.isPaused(accountId)) return { success: false, code: 'ACCOUNT_STOPPED', error: '账号已停止' }
  if (manager.backendCooldownByAccount?.get(accountId) > Date.now()) return { success: false, code: 'RISK_COOLDOWN', error: '账号处于冷却期' }
  const lease = manager.getClaimedTask?.(accountId)?.lease
  if (lease && Number(lease.expiresAt || 0) <= Date.now()) return { success: false, code: 'LEASE_EXPIRED', error: '任务租约已到期' }
  const target = lotteryInfo || manager.participationBudgets?.get(accountId)
  if (target) {
    const end = Number(target.end_time || target.endTime || 0)
    const endMs = end > 1e12 ? end : end * 1000
    if (!endMs || endMs - Date.now() <= 1500) return { success: false, code: 'PARTICIPATION_DEADLINE', error: '福袋参与窗口已结束' }
  }
  return null
}

function requirementsError(detail) {
  const conditions = Array.isArray(detail.conditions) ? detail.conditions : []
  // No UI or payment fallback. Only confirmed free/no-action conditions are executable.
  const unknown = conditions.some(condition => ![0, 6].includes(Number(condition?.type || 0)) ||
    /评论|口令|弹幕|粉丝|加团|关注|观看|点赞|付费|支付|礼物|购买|订阅|会员|等级|专属|铁粉|下单/.test(String(condition?.content || condition?.desc || condition?.description || '')))
  return unknown ? { success: false, code: 'UNSUPPORTED_REQUIREMENT', error: '该目标的参与条件尚无已验收的协议实现' } : null
}

// The historical name is retained for callers; mutating requests are submitted once.
export async function attendLotteryWithRetry(manager, accountId, accountData, lotteryInfo, initialLotteryId) {
  const blocked = participationError(manager, accountId, lotteryInfo)
  if (blocked) return blocked
  const detail = await manager.ipc.invoke('get-lottery-detail', { accountId, roomId: lotteryInfo.roomId })
  if (!detail?.success) {
    await manager.handleBackendFailure?.(accountId, detail || {})
    return { success: false, code: detail?.code || 'DETAIL_FAILED', error: detail?.error || '参与前详情验证失败' }
  }
  const current = detail.lotteryDetail
  if (!current?.lottery_id || String(current.lottery_id) !== String(initialLotteryId)) return { success: false, code: 'LOTTERY_CHANGED', error: '目标福袋已变化，需要重新领取任务' }
  const expired = participationError(manager, accountId, current)
  if (expired) return expired
  const unsupported = requirementsError(current)
  if (unsupported) return unsupported
  const config = accountData?.config || {}
  if (config.secondInspect?.enabled) {
    const probability = Number(current.winningTotal || 0) / Math.max(1, Number(current.joinTotal || 0))
    if (probability < Number(config.secondInspect.value || 0)) return { success: false, code: 'SECOND_INSPECT_REJECT', error: '最新福袋数据不满足筛选条件' }
  }
  const beforeSubmit = participationError(manager, accountId, lotteryInfo)
  if (beforeSubmit) return beforeSubmit
  const result = await manager.ipc.invoke('attend-lottery', { accountId, roomId: lotteryInfo.roomId, lotteryId: String(initialLotteryId) })
    .catch(() => ({ success: false, code: 'ATTEND_OUTCOME_UNKNOWN', error: '参与请求结果未知，不自动重放' }))
  if (!result?.success && classifyBackendFailure(result || {}) !== 'transient') await manager.handleBackendFailure?.(accountId, result || {})
  return { ...result, lotteryId: String(initialLotteryId) }
}

export async function joinLotteryByProtocol(manager, accountId, options = {}) {
  const target = options.lotteryInfo
  if (!target?.lottery_id || !target.roomId) return { success: false, code: 'INVALID_PARAMS', error: '缺少协议目标标识' }
  manager.participationBudgets ||= new Map()
  manager.participationBudgets.set(accountId, target)
  try {
    return await attendLotteryWithRetry(manager, accountId, options.accountData, target, target.lottery_id)
  } finally {
    manager.participationBudgets.delete(accountId)
  }
}
