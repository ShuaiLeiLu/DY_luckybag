import type { AccountSession } from '@shared/models'

type AnyRecord = Record<string, any>

export function normalizeNickname(raw: string) {
  const text = String(raw || '').trim()
  if (!text) return '未命名账号'
  return text.length > 18 ? `${text.slice(0, 18)}…` : text
}

export function createAccountModel(base: Partial<AccountSession> & AnyRecord = {}): AccountSession {
  return {
    id: String(base.id || ''),
    nickname: normalizeNickname(String(base.nickname || '')),
    userId: String(base.userId || base.id || ''),
    state: String(base.state || 'waiting'),
    runtimeState: (base.runtimeState as AccountSession['runtimeState']) || 'ready',
    actionActive: base.actionActive === true,
    currentRoom: String(base.currentRoom || ''),
    token: base.token ?? null,
    scanRole: (base.scanRole as AccountSession['scanRole']) || 'worker',
    currentTaskStage: String(base.currentTaskStage || ''),
    currentTaskLabel: String(base.currentTaskLabel || ''),
    currentTaskAnchor: String(base.currentTaskAnchor || ''),
    currentTaskLotteryName: String(base.currentTaskLotteryName || ''),
    currentTaskLeaseId: String(base.currentTaskLeaseId || ''),
    currentTaskLeaseExpiresAt: Number(base.currentTaskLeaseExpiresAt || 0),
    currentTaskLeaseRemainingSec: Number(base.currentTaskLeaseRemainingSec || 0),
    currentTaskScore: Number(base.currentTaskScore || 0),
    participationCount: Number(base.participationCount || 0),
    todayEarnedDiamonds: Number(base.todayEarnedDiamonds || 0),
    todayLotteryWinCount: Number(base.todayLotteryWinCount || 0),
    todayRedPacketWinCount: Number(base.todayRedPacketWinCount || 0),
    todayLotteryWonDiamonds: Number(base.todayLotteryWonDiamonds || 0),
    todayRedPacketWonDiamonds: Number(base.todayRedPacketWonDiamonds || 0),
    scanUploadSubmitted: Number(base.scanUploadSubmitted || 0),
    scanUploadAccepted: Number(base.scanUploadAccepted || 0),
    scanUploadOk: base.scanUploadOk === true,
    scanUploadSkipped: String(base.scanUploadSkipped || ''),
    scanUploadError: String(base.scanUploadError || ''),
    scanUploadAt: Number(base.scanUploadAt || 0),
    poolActiveCandidates: Number(base.poolActiveCandidates || 0),
    poolValidCandidates: Number(base.poolValidCandidates || 0),
    poolAvailableCandidates: Number(base.poolAvailableCandidates || 0),
    poolSummaryAt: Number(base.poolSummaryAt || 0),
    requestBackend: 'android'
  }
}

export function mergeAccountModel(
  current: Partial<AccountSession> & AnyRecord = {},
  patch: Partial<AccountSession> & AnyRecord = {}
): AccountSession {
  const model = createAccountModel({
    ...current,
    ...patch
  })
  model.runtimeState = deriveRuntimeState(model)
  return model
}

export function deriveRuntimeState(account: AccountSession): AccountSession['runtimeState'] {
  if (account.state === 'paused') return 'paused'
  if (account.state === 'waiting' && !account.actionActive) return 'ready'
  if (!account.actionActive) return 'login_required'
  if (account.currentTaskStage === 'claimed') return 'claiming'
  if (account.currentTaskStage === 'joining') return 'joining'
  if (account.currentTaskStage === 'waiting_draw') return 'waiting_result'
  if (account.currentTaskStage === 'post_draw_stay') return 'cooldown'
  if (account.scanRole === 'scanner') return 'scanning'
  if (account.state === 'running') return 'preheating'
  if (account.state === 'error') return 'error'
  return 'ready'
}

export function statusTone(state: AccountSession['runtimeState']) {
  switch (state) {
    case 'error':
      return 'text-rose-300 border-rose-400/25 bg-rose-500/10'
    case 'ready':
      return 'text-emerald-200 border-emerald-400/20 bg-emerald-500/10'
    case 'scanning':
    case 'claiming':
      return 'text-cyan-200 border-cyan-400/20 bg-cyan-500/10'
    case 'joining':
    case 'preheating':
    case 'waiting_result':
      return 'text-amber-200 border-amber-400/20 bg-amber-500/10'
    case 'cooldown':
      return 'text-violet-200 border-violet-400/20 bg-violet-500/10'
    default:
      return 'text-slate-200 border-slate-400/20 bg-slate-500/10'
  }
}

export function statusText(state: AccountSession['runtimeState']) {
  switch (state) {
    case 'ready':
      return '待命'
    case 'scanning':
      return '扫描'
    case 'claiming':
      return '领单'
    case 'preheating':
      return '预热'
    case 'joining':
      return '参与中'
    case 'waiting_result':
      return '等开奖'
    case 'cooldown':
      return '停留'
    case 'error':
      return '异常'
    case 'paused':
      return '暂停'
    default:
      return '待登录'
  }
}

export function formatRelative(seconds: number) {
  const safe = Math.max(0, Number(seconds || 0))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = Math.floor(safe % 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

export function sortAccounts(accounts: AccountSession[]) {
  return [...accounts].sort((a, b) => a.id.localeCompare(b.id))
}
