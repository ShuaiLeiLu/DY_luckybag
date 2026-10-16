import { classifyBackendFailure } from './backendErrors'
/**
 * emitScanMetric 方法：把扫描摘要转发给主进程控制台。
 */
function emitScanMetric(manager, accountId, stage, requestIndex, metric = {}) {
  const safeAccountId = String(accountId || 'unknown')
  const safeStage = String(stage || 'scan')
  const safeRequest = Number(requestIndex || 0)
  const summary = metric && typeof metric === 'object' ? metric : { value: metric }
  try {
    if (!manager?.ipc?.invoke) return
    manager.ipc.invoke('scan-debug-log', {
      accountId: safeAccountId,
      stage: `metric:${safeStage}`,
      requestIndex: safeRequest,
      type: 'request-metric',
      summary
    }).catch(() => {})
  } catch (_) {
    // ignore
  }
}

function sleep(manager, ms) {
  const delay = Math.max(0, Number(ms || 0))
  if (typeof manager?.sleep === 'function') {
    return manager.sleep(delay)
  }
  return new Promise((resolve) => setTimeout(resolve, delay))
}

function safeOnStatus(accountData, patch = {}) {
  try {
    if (typeof accountData?.callbacks?.onStatusUpdate !== 'function') return
    const accountId = String(accountData?.id || patch?.id || '').trim()
    if (!accountId) return
    accountData.callbacks.onStatusUpdate({
      id: accountId,
      ...(patch && typeof patch === 'object' ? patch : {})
    })
  } catch (_) {
    // ignore
  }
}

/**
 * 搜索直播间-【全部】（照抄超人福袋流程）
 */
async function acquirePermit(manager, accountId, kind, deadlineMs = 0) {
  if (!manager.requestPoolScanPermit) return true
  for (let attempt = 0; attempt < 8; attempt++) {
    if (manager.isPaused(accountId) || (deadlineMs && Date.now() >= deadlineMs)) return false
    const result = await manager.requestPoolScanPermit(accountId, kind)
    if (!result?.ok) return false
    if (result.data?.allowed === true) return true
    const delay = Math.max(100, Math.min(5000, Number(result.data?.retryAfterMs || 1000)))
    if (deadlineMs && Date.now() + delay >= deadlineMs) return false
    await sleep(manager, delay)
  }
  return false
}

export async function searchLiveByAll(manager, accountId, times = 10, scanProfile = {}, runtimeOptions = {}) {
  const account = manager.accounts.get(accountId)
  if (!account || !manager.ipc) return
  const deadlineMs = Number(runtimeOptions.deadlineMs || scanProfile?.deadlineMs || 0)
  const totalTimes = Math.max(1, Math.min(48, Number(times) || 10))
  const all = new Map()
  const seen = new Set()
  let cursor = 0
  let accepted = 0
  let claimedTask = null
  let uploadOk = true
  const upload = runtimeOptions.uploadAfterScan !== false
  const claim = runtimeOptions.claimAfterScan !== false
  for (let i = 0; i < totalTimes; i++) {
    if (manager.isPaused(accountId) || (deadlineMs && Date.now() >= deadlineMs)) break
    let slot = null
    if (manager.claimPoolAllScanCursor) {
      const lease = await manager.claimPoolAllScanCursor(accountId)
      if (!lease?.ok || !lease.data?.claimed) break
      slot = lease.data
      cursor = Number(slot.cursorMaxTime || 0)
    }
    let result
    try {
      if (!await acquirePermit(manager, accountId, 'all', deadlineMs)) break
      result = await manager.ipc.invoke('search-live-by-all', {
        accountId, customCount: Math.max(1, Math.min(24, Number(scanProfile?.allCount || manager.scanConfig?.allCount || 24))),
        maxTime: cursor || undefined
      })
      if (!result?.success || !Array.isArray(result.roomInfoList)) {
        await manager.handleBackendFailure?.(accountId, result || {})
        if (classifyBackendFailure(result) !== 'transient') break
        continue
      }
      const rooms = result.roomInfoList.filter(room => {
        const id = String(room.roomId || room.webRid || '')
        if (!id || seen.has(id)) return false
        seen.add(id)
        return account.config?.onlyRedPacketMode?.enabled ? room.hasRoomRedPacketHint === true : room.hasLotteryHint !== false
      })
      const detail = await getLotteryInfo(manager, rooms, accountId, { ...scanProfile, deadlineMs })
      manager.applyScanRiskFeedback?.(accountId, detail.stats, account.callbacks?.onLog)
      const batch = detail.settled.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value)
        .filter(item => Number(item.end_time || 0) * 1000 > Date.now() + 8000)
      for (const item of batch) all.set(String(item.roomId) + ':' + String(item.lottery_id), item)
      manager.addLotteryInfoWithoutDuplicates(accountId, batch)
      manager.calculatePredictedProbabilities(accountId)
      manager.sortLotteriesByProbability(accountId)
      manager.emitLotteryListUpdate(account)
      if (upload && batch.length) {
        const response = await manager.enqueuePoolCandidatesUpload(accountId, batch, { claimTask: claim, topLimit: 5 })
        uploadOk = uploadOk && response?.ok === true
        accepted += Number(response?.accepted || 0)
        claimedTask = response?.claimedTask || null
      }
      emitScanMetric(manager, accountId, 'all-request', i + 1, { rawRooms: result.roomInfoList.length, detailRequested: rooms.length, keptLotteries: batch.length, ...detail.stats })
    } finally {
      if (slot) await manager.reportPoolAllScanCursor?.(accountId, {
        slotId: slot.slotId, usedCursorMaxTime: cursor, nextCursorMaxTime: Number(result?.nextMaxTime || 0),
        hasMore: result?.hasMore === true, rawRooms: result?.rawCount || 0, error: result?.success ? '' : String(result?.error || 'scan_interrupted')
      }).catch(() => {})
    }
    if (claimedTask || manager.isPaused(accountId)) break
    const next = Number(result?.nextMaxTime || 0)
    if (result?.hasMore === false || !next || next === cursor) break
    cursor = next
    await sleep(manager, Math.max(300, Number(scanProfile?.itemGapMs || 1800)))
  }
  safeOnStatus(account, { scanUploadSubmitted: all.size, scanUploadAccepted: accepted, scanUploadOk: uploadOk, scanUploadAt: Date.now() })
  return { uploaded: upload ? all.size : 0, accepted, uploadOk, claimedTask, eligibleLotteries: [], eligibleCount: claimedTask ? 1 : 0,
    deferredUploadCandidates: upload ? [] : [...all.values()] }
}

/**
 * 根据直播间信息获取福袋信息（照抄超人福袋逻辑）
 */
export async function getLotteryInfo(manager, roomInfoList, accountId, scanProfile = null) {
  if (!Array.isArray(roomInfoList) || roomInfoList.length === 0 || !manager?.ipc) {
    return { settled: [], stats: { successCount: 0, hardRiskCount: 0, errorCount: 0, errorSamples: [] } }
  }

  const accountData = manager?.accounts?.get(accountId)
  const config = accountData?.config || {}
  const detailChannel = config?.onlyRedPacketMode?.enabled === true ? 'get-redpacket-detail' : 'get-lottery-detail'
  const cap = Math.max(1, Math.min(50, Number(scanProfile?.detailRoomCap || 12)))
  const rooms = roomInfoList.slice(0, cap)
  const concurrency = Math.max(1, Math.min(8, Number(scanProfile?.detailConcurrency || 3)))
  const settled = new Array(rooms.length)
  let index = 0
  let halted = false
  let nextAllowedAt = 0
  const worker = async () => {
    while (index < rooms.length && !halted && !manager.isPaused?.(accountId)) {
      const current = index++
      const room = rooms[current]
      try {
        const deadline = Number(scanProfile?.deadlineMs || 0)
        if (deadline && Date.now() >= deadline) { halted = true; break }
        const startAt = Math.max(Date.now(), nextAllowedAt)
        nextAllowedAt = startAt + Math.max(0, Number(scanProfile?.itemGapMs ?? 420))
        if (startAt > Date.now()) await sleep(manager, startAt - Date.now())
        if (halted || manager.isPaused?.(accountId) || (deadline && Date.now() >= deadline)) break
        if (!await acquirePermit(manager, accountId, 'detail', deadline)) { halted = true; break }
        const result = await manager.ipc.invoke(detailChannel, { roomId: room.roomId, webRid: room.webRid, accountId })
        if (!result?.success || !result.lotteryDetail) {
          const kind = classifyBackendFailure(result)
          if (kind !== 'transient') { halted = true; await manager.handleBackendFailure?.(accountId, result || {}) }
          throw Object.assign(new Error(result?.error || '详情失败'), { code: result?.code, statusCode: result?.statusCode })
        }
        settled[current] = { status: 'fulfilled', value: { ...room, ...result.lotteryDetail, fetchedAt: Date.now() } }
      } catch (reason) { settled[current] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rooms.length) }, worker))
  for (let i = 0; i < settled.length; i++) settled[i] ||= { status: 'fulfilled', value: null }
  let successCount = 0
  let hardRiskCount = 0
  let errorCount = 0
  const errorSamples = []

  settled.forEach((item) => {
    if (item?.status === 'fulfilled') {
      if (item.value) successCount += 1
      return
    }
    errorCount += 1
    const code = String(item?.reason?.code || '')
    const status = Number(item?.reason?.statusCode || 0)
    if (classifyBackendFailure({ code, statusCode: status }) === 'risk') {
      hardRiskCount += 1
    }
    if (errorSamples.length < 6) {
      errorSamples.push({
        code: code || 'UNKNOWN',
        statusCode: status || 0,
        message: String(item?.reason?.message || item?.reason || 'unknown').replace(/\s+/g, ' ').slice(0, 140)
      })
    }
  })

  return {
    settled,
    stats: { successCount, hardRiskCount, errorCount, errorSamples }
  }
}
