class AccountRuntimeContext {
  constructor(accountId) {
    this.accountId = String(accountId || '').trim()
    this.claimedTask = null
    this.taskStage = ''
    this.executionRoomId = ''
    this.scanRole = ''
    this.poolNoTaskStreak = 0
    this.poolUploadQueue = null
    this.deferredWaitUpload = new Map()
    this.executionTurns = 0
    this.lastJoinAt = 0
  }

  clearStage() {
    this.taskStage = ''
    this.executionRoomId = ''
  }

  getDeferredBucket() {
    if (!this.deferredWaitUpload) {
      this.deferredWaitUpload = new Map()
    }
    return this.deferredWaitUpload
  }
}

export function createAccountRuntimeManager() {
  const contexts = new Map()

  function normalize(id) {
    return String(id || '').trim()
  }

  function ensureRuntime(accountId) {
    const normalized = normalize(accountId)
    if (!normalized) return null
    let ctx = contexts.get(normalized)
    if (!ctx) {
      ctx = new AccountRuntimeContext(normalized)
      contexts.set(normalized, ctx)
    }
    return ctx
  }

  function getRuntime(accountId) {
    return contexts.get(normalize(accountId)) || null
  }

  function deleteRuntime(accountId) {
    contexts.delete(normalize(accountId))
  }

  function hasRuntime(accountId) {
    return contexts.has(normalize(accountId))
  }

  function mutateRuntime(accountId, mutator) {
    const ctx = ensureRuntime(accountId)
    if (!ctx) return null
    if (typeof mutator === 'function') {
      mutator(ctx)
    }
    return ctx
  }

  function setClaimedTaskValue(accountId, task) {
    const ctx = mutateRuntime(accountId, (context) => {
      context.claimedTask = task && typeof task === 'object' ? task : null
    })
    return ctx?.claimedTask || null
  }

  function getClaimedTaskValue(accountId) {
    return getRuntime(accountId)?.claimedTask || null
  }

  function setTaskStageValue(accountId, stage = '') {
    const ctx = mutateRuntime(accountId, (context) => {
      const normalizedStage = String(stage || '').trim()
      if (normalizedStage) {
        context.taskStage = normalizedStage
      } else {
        context.clearStage()
      }
    })
    return ctx?.taskStage || ''
  }

  function getTaskStageValue(accountId) {
    return String(getRuntime(accountId)?.taskStage || '')
  }

  function setExecutionRoomIdValue(accountId, roomId = '') {
    const ctx = mutateRuntime(accountId, (context) => {
      context.executionRoomId = String(roomId || '').trim()
    })
    return ctx?.executionRoomId || ''
  }

  function getExecutionRoomIdValue(accountId) {
    return String(getRuntime(accountId)?.executionRoomId || '').trim()
  }

  function setScanRoleValue(accountId, role = '') {
    const ctx = mutateRuntime(accountId, (context) => {
      context.scanRole = String(role || '').trim()
    })
    return ctx?.scanRole || ''
  }

  function getScanRoleValue(accountId) {
    return String(getRuntime(accountId)?.scanRole || '')
  }

  function getPoolNoTaskStreakValue(accountId) {
    return Math.max(0, Number(getRuntime(accountId)?.poolNoTaskStreak || 0))
  }

  function resetPoolNoTaskStreakValue(accountId) {
    const ctx = mutateRuntime(accountId, (context) => {
      context.poolNoTaskStreak = 0
    })
    return Math.max(0, Number(ctx?.poolNoTaskStreak || 0))
  }

  function bumpPoolNoTaskStreakValue(accountId) {
    const ctx = mutateRuntime(accountId, (context) => {
      context.poolNoTaskStreak = Math.max(0, Number(context.poolNoTaskStreak || 0)) + 1
    })
    return Math.max(0, Number(ctx?.poolNoTaskStreak || 0))
  }

  function getExecutionTurnsValue(accountId) {
    return Math.max(0, Number(getRuntime(accountId)?.executionTurns || 0))
  }

  function bumpExecutionTurnsValue(accountId) {
    const ctx = mutateRuntime(accountId, (context) => {
      context.executionTurns = Math.max(0, Number(context.executionTurns || 0)) + 1
    })
    return Math.max(0, Number(ctx?.executionTurns || 0))
  }

  function getLastJoinAtValue(accountId) {
    return Math.max(0, Number(getRuntime(accountId)?.lastJoinAt || 0))
  }

  function setLastJoinAtValue(accountId, value = 0) {
    const ctx = mutateRuntime(accountId, (context) => {
      context.lastJoinAt = Math.max(0, Number(value || 0))
    })
    return Math.max(0, Number(ctx?.lastJoinAt || 0))
  }

  function getPoolUploadQueueValue(accountId) {
    return getRuntime(accountId)?.poolUploadQueue || null
  }

  function setPoolUploadQueueValue(accountId, queue = null) {
    const ctx = mutateRuntime(accountId, (context) => {
      context.poolUploadQueue = queue || null
    })
    return ctx?.poolUploadQueue || null
  }

  function clearPoolUploadQueueValue(accountId, expectedQueue = null) {
    const ctx = getRuntime(accountId)
    if (!ctx) return null
    if (expectedQueue && ctx.poolUploadQueue !== expectedQueue) {
      return ctx.poolUploadQueue
    }
    ctx.poolUploadQueue = null
    return null
  }

  function getDeferredWaitUploadValue(accountId) {
    return getRuntime(accountId)?.deferredWaitUpload || null
  }

  function getDeferredWaitUploadBucket(accountId) {
    const ctx = ensureRuntime(accountId)
    return ctx ? ctx.getDeferredBucket() : null
  }

  function clearDeferredWaitUploadValue(accountId) {
    const ctx = getRuntime(accountId)
    if (!ctx) return null
    const current = ctx.deferredWaitUpload || null
    ctx.deferredWaitUpload = null
    return current
  }

  function resetRuntime(accountId) {
    const ctx = getRuntime(accountId)
    if (!ctx) return
    ctx.poolUploadQueue = null
    ctx.deferredWaitUpload = null
    ctx.poolNoTaskStreak = 0
    ctx.scanRole = ''
    ctx.clearStage()
    ctx.claimedTask = null
  }

  return {
    ensure: ensureRuntime,
    get: getRuntime,
    delete: deleteRuntime,
    has: hasRuntime,
    entries: () => contexts.entries(),
    values: () => contexts.values(),
    clear: () => contexts.clear(),
    getClaimedTask: getClaimedTaskValue,
    setClaimedTask: setClaimedTaskValue,
    getTaskStage: getTaskStageValue,
    setTaskStage: setTaskStageValue,
    getExecutionRoomId: getExecutionRoomIdValue,
    setExecutionRoomId: setExecutionRoomIdValue,
    getScanRole: getScanRoleValue,
    setScanRole: setScanRoleValue,
    getPoolNoTaskStreak: getPoolNoTaskStreakValue,
    resetPoolNoTaskStreak: resetPoolNoTaskStreakValue,
    bumpPoolNoTaskStreak: bumpPoolNoTaskStreakValue,
    getExecutionTurns: getExecutionTurnsValue,
    bumpExecutionTurns: bumpExecutionTurnsValue,
    getLastJoinAt: getLastJoinAtValue,
    setLastJoinAt: setLastJoinAtValue,
    getPoolUploadQueue: getPoolUploadQueueValue,
    setPoolUploadQueue: setPoolUploadQueueValue,
    clearPoolUploadQueue: clearPoolUploadQueueValue,
    getDeferredWaitUpload: getDeferredWaitUploadValue,
    getDeferredWaitUploadBucket,
    clearDeferredWaitUpload: clearDeferredWaitUploadValue,
    reset: resetRuntime
  }
}
