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

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function sleep(manager, ms) {
  const delay = Math.max(0, Number(ms || 0))
  if (typeof manager?.sleep === 'function') {
    return manager.sleep(delay)
  }
  return new Promise((resolve) => setTimeout(resolve, delay))
}

function randomDelay(minMs = 500, maxMs = 1500) {
  const min = Math.max(0, Number(minMs || 0))
  const max = Math.max(min, Number(maxMs || min))
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const DEFAULT_FULL_SCAN_TIMES = 10
const DEFAULT_CATEGORY_SCAN_PAGES = 5
const FULL_SCAN_REQUEST_GAP_MS = Object.freeze({ min: 1800, max: 3200 })
const CATEGORY_SWITCH_GAP_MS = Object.freeze({ min: 1800, max: 3200 })
const CATEGORY_PAGE_GAP_MS = Object.freeze({ min: 1500, max: 2600 })
const CATEGORY_DETAIL_GAP_MS = Object.freeze({ min: 800, max: 1400 })
const SILENT_SCAN_PROGRESS_LOG = true

function normalizeScannedLotteries(lotteryList) {
  if (!Array.isArray(lotteryList)) return []
  // 扫描阶段不在前端做条件过滤，交由服务端按前端配置统一判定。
  return lotteryList.filter(Boolean)
}

function applyLotteryFilters(config, lotteryInfo) {
  // 扫描阶段不做本地条件过滤，统一交给服务端+前端配置判定。
  void config
  void lotteryInfo
  return true
}

function safeOnLog(accountData, text, level = 'info') {
  try {
    if (typeof accountData?.callbacks?.onLog === 'function') {
      accountData.callbacks.onLog(String(text || ''), level)
    }
  } catch (_) {
    // ignore
  }
}

function safeOnScanProgressLog(accountData, text, level = 'info') {
  if (SILENT_SCAN_PROGRESS_LOG) return
  safeOnLog(accountData, text, level)
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

function normalizeCategoryList(manager, scanProfile = null) {
  const plans = Array.isArray(scanProfile?.assignedCategoryPlans) ? scanProfile.assignedCategoryPlans : []
  if (plans.length > 0) return plans
  const categories = Array.isArray(scanProfile?.assignedCategories) ? scanProfile.assignedCategories : []
  if (categories.length > 0) return categories
  return Array.isArray(manager?.categoryList) ? manager.categoryList : []
}

/**
 * 搜索直播间-【全部】（照抄超人福袋流程）
 */
export async function searchLiveByAll(manager, accountId, times = 10, scanProfile = null, runtimeOptions = {}) {
  const accountData = manager?.accounts?.get(accountId)
  if (!accountData || !manager?.ipc) return
  const totalTimes = Math.max(1, Math.floor(toNumber(times, DEFAULT_FULL_SCAN_TIMES)))
  const roundUploadCandidates = []
  const deadlineMs = Number(runtimeOptions?.deadlineMs || 0)
  const hitDeadline = () => deadlineMs > 0 && Date.now() >= deadlineMs

  safeOnScanProgressLog(accountData, `开始执行全部直播间搜索，共${totalTimes}次`)

  for (let i = 0; i < totalTimes; i++) {
    if (manager.isPaused(accountId)) break
    if (hitDeadline()) {
      safeOnScanProgressLog(accountData, `全站扫描命中阶段截止时间，提前结束（${i}/${totalTimes}）`, 'info')
      break
    }

    safeOnScanProgressLog(accountData, `正在执行直播间第${i + 1}/${totalTimes}次搜索...`)

    try {
      const result = await manager.ipc.invoke('search-live-by-all', {
        accountId,
        customCount: 8
      })

      if (!result?.success || !Array.isArray(result?.roomInfoList)) {
        safeOnScanProgressLog(accountData, `第${i + 1}次搜索响应数据格式错误`, 'warning')
        emitScanMetric(manager, accountId, 'all-request', i + 1, {
          requestOk: false,
          rawRooms: Array.isArray(result?.roomInfoList) ? result.roomInfoList.length : 0,
          hintedRooms: 0,
          detailRequested: 0,
          validLotteries: 0,
          keptLotteries: 0
        })
        await sleep(manager, randomDelay(FULL_SCAN_REQUEST_GAP_MS.min, FULL_SCAN_REQUEST_GAP_MS.max))
        continue
      }

      emitScanMetric(manager, accountId, 'all-start', i + 1, {
        rawRooms: result.roomInfoList.length
      })

      const roomInfoList = result.roomInfoList
        .filter((item) => item?.hasLotteryHint === true)
        .map((item) => ({
          webRid: item?.webRid,
          roomId: item?.roomId,
          roomTitle: item?.roomTitle,
          authorNickname: item?.authorNickname,
          authorSecUid: item?.authorSecUid,
          onlineTotal: item?.onlineTotal
        }))

      emitScanMetric(manager, accountId, 'all-detail-start', i + 1, {
        rawRooms: result.roomInfoList.length,
        hintedRooms: roomInfoList.length,
        detailRequested: roomInfoList.length
      })
      safeOnLog(accountData, `🔍 第${i + 1}/${totalTimes}轮开始扫描福袋（候选${roomInfoList.length}）`)

      const detailResult = await getLotteryInfo(manager, roomInfoList, accountId, scanProfile)
      const settled = Array.isArray(detailResult?.settled) ? detailResult.settled : []
      const stats = detailResult?.stats || {}
      const validLotteryInfoList = settled
        .filter((item) => item?.status === 'fulfilled' && item.value)
        .map((item) => item.value)

      const scannedLotteries = normalizeScannedLotteries(validLotteryInfoList)
      safeOnScanProgressLog(accountData, `第${i + 1}次搜索: 发现${roomInfoList.length}个有福袋的直播间, 详情成功${scannedLotteries.length}个`)

      const poolBefore = manager.getAccountLotteryList(accountId).length
      manager.addLotteryInfoWithoutDuplicates(accountId, scannedLotteries)
      const poolAfter = manager.getAccountLotteryList(accountId).length

      emitScanMetric(manager, accountId, 'all-request', i + 1, {
        requestOk: true,
        rawRooms: result.roomInfoList.length,
        hintedRooms: roomInfoList.length,
        detailRequested: roomInfoList.length,
        validLotteries: validLotteryInfoList.length,
        detailError: Number(stats?.errorCount || 0),
        detailHardRisk: Number(stats?.hardRiskCount || 0),
        keptLotteries: scannedLotteries.length,
        poolBefore,
        poolAfter,
        poolDelta: poolAfter - poolBefore
      })
      emitScanMetric(manager, accountId, 'all-batch-add', i + 1, {
        detailRequested: roomInfoList.length,
        detailSucceeded: scannedLotteries.length,
        detailError: Number(stats?.errorCount || 0),
        detailHardRisk: Number(stats?.hardRiskCount || 0),
        detailErrorSamples: Array.isArray(stats?.errorSamples) ? stats.errorSamples.slice(0, 3) : [],
        poolBefore,
        poolAfter,
        poolDelta: poolAfter - poolBefore
      })
      if (Number(stats?.errorCount || 0) > 0) {
        const detailErrorSamples = Array.isArray(stats?.errorSamples) ? stats.errorSamples : []
        const sampleText = detailErrorSamples
          .slice(0, 3)
          .map((item) => {
            const code = String(item?.code || 'UNKNOWN')
            const status = Number(item?.statusCode || 0)
            const message = String(item?.message || '')
            const statusText = status > 0 ? `/${status}` : ''
            return `${code}${statusText}:${message}`
          })
          .join(' | ')
        safeOnScanProgressLog(
          accountData,
          `第${i + 1}次详情请求: 成功${scannedLotteries.length} 失败${Number(stats?.errorCount || 0)} 风控失败${Number(stats?.hardRiskCount || 0)}${sampleText ? `，样例=${sampleText}` : ''}`,
          'warning'
        )
      }

      roundUploadCandidates.push(...scannedLotteries)
      manager.calculatePredictedProbabilities(accountId)
      manager.sortLotteriesByProbability(accountId)
      manager.emitLotteryListUpdate(accountData)

      if (hitDeadline()) {
        safeOnScanProgressLog(accountData, `全站扫描命中阶段截止时间，提前收尾上报（${i + 1}/${totalTimes}）`, 'info')
        break
      }
      await sleep(manager, randomDelay(FULL_SCAN_REQUEST_GAP_MS.min, FULL_SCAN_REQUEST_GAP_MS.max))
    } catch (error) {
      safeOnScanProgressLog(accountData, `第${i + 1}次搜索出错: ${error?.message || error}`, 'warning')
      if (hitDeadline()) {
        break
      }
      await sleep(manager, randomDelay(FULL_SCAN_REQUEST_GAP_MS.min, FULL_SCAN_REQUEST_GAP_MS.max))
    }
  }

  const uploadMap = new Map()
  roundUploadCandidates.forEach((item) => {
    const roomId = String(item?.roomId || '').trim()
    const lotteryId = String(item?.lottery_id || item?.lotteryId || '').trim()
    const fallback = `${String(item?.webRid || '').trim()}:${String(item?.end_time || 0)}`
    const key = roomId && lotteryId ? `${roomId}:${lotteryId}` : fallback
    if (!key) return
    uploadMap.set(key, item)
  })
  const uploadList = Array.from(uploadMap.values())
  const uploadAt = Date.now()
  const uploadAfterScan = runtimeOptions?.uploadAfterScan !== false

  if (uploadList.length <= 0) {
    safeOnLog(accountData, '本轮扫描结束，无可提交的福袋详情')
    emitScanMetric(manager, accountId, 'all-round-upload', totalTimes, {
      ok: true,
      uploaded: 0,
      accepted: 0,
      skipped: 'empty_upload_list'
    })
    safeOnStatus(accountData, {
      scanUploadSubmitted: 0,
      scanUploadAccepted: 0,
      scanUploadOk: true,
      scanUploadSkipped: 'empty_upload_list',
      scanUploadError: '',
      scanUploadAt: uploadAt
    })
    return {
      uploaded: 0,
      accepted: 0,
      uploadOk: true,
      skipped: 'empty_upload_list',
      eligibleCount: 0,
      eligibleLotteries: [],
      claimedTask: null,
      deferredUploadCandidates: []
    }
  }

  if (!uploadAfterScan) {
    safeOnLog(accountData, `本轮扫描结束，已缓存${uploadList.length}个福袋，等待阶段结束后统一上传服务端`)
    return {
      uploaded: 0,
      accepted: 0,
      uploadOk: true,
      skipped: 'deferred_waiting_draw_upload',
      eligibleCount: 0,
      eligibleLotteries: [],
      claimedTask: null,
      deferredUploadCandidates: uploadList
    }
  }

  const claimAfterScan = runtimeOptions?.claimAfterScan !== false
  const excludeKeys = typeof manager?.getActiveSkipLotteryKeys === 'function'
    ? manager.getActiveSkipLotteryKeys(accountId)
    : []
  const uploadRes = await manager.enqueuePoolCandidatesUpload(accountId, uploadList, {
    claimTask: claimAfterScan,
    topLimit: 5,
    excludeKeys
  })
    .catch((error) => ({ ok: false, accepted: 0, total: uploadList.length, error: error?.message || String(error || 'unknown') }))
  const accepted = Math.max(0, Number(uploadRes?.accepted || 0))
  const eligibleCount = Math.max(0, Number(uploadRes?.eligibleCount || 0))
  const claimClaimed = uploadRes?.claimClaimed === true
  const claimReason = String(uploadRes?.claimReason || '')
  emitScanMetric(manager, accountId, 'all-round-upload', totalTimes, {
    ok: uploadRes?.ok === true,
    uploaded: uploadList.length,
    accepted,
    eligibleCount,
    claimClaimed,
    claimReason,
    skipped: String(uploadRes?.skipped || ''),
    status: Number(uploadRes?.status || 0),
    error: uploadRes?.ok ? '' : String(uploadRes?.error || 'unknown')
  })

  const baseStatusPatch = {
    scanUploadSubmitted: uploadList.length,
    scanUploadAccepted: accepted,
    scanUploadOk: uploadRes?.ok === true,
    scanUploadSkipped: String(uploadRes?.skipped || ''),
    scanUploadError: uploadRes?.ok ? '' : String(uploadRes?.error || 'unknown'),
    scanUploadAt: uploadAt,
    poolActiveCandidates: Math.max(0, Number(uploadRes?.activeCandidates || 0)),
    poolValidCandidates: Math.max(0, Number(uploadRes?.validCandidates || 0)),
    poolAvailableCandidates: Math.max(0, Number(uploadRes?.availableCandidates || 0)),
    poolSummaryAt: Number(uploadRes?.summaryAt || uploadAt)
  }
  safeOnStatus(accountData, baseStatusPatch)

  if (uploadRes?.ok && uploadRes?.skipped === 'pool_server_disabled') {
    safeOnLog(accountData, `本轮扫描结束，已整理${uploadList.length}个福袋，但服务端候选池未启用，未执行上报`, 'warning')
    return {
      uploaded: uploadList.length,
      accepted,
      uploadOk: true,
      skipped: 'pool_server_disabled',
      eligibleCount,
      eligibleLotteries: Array.isArray(uploadRes?.eligibleLotteries) ? uploadRes.eligibleLotteries : [],
      claimedTask: uploadRes?.claimedTask || null
    }
  }
  if (uploadRes?.ok && uploadRes?.skipped === 'invalid_candidates') {
    safeOnLog(accountData, `本轮扫描结束，已整理${uploadList.length}个福袋，但字段不完整导致未能上报服务端`, 'warning')
    return {
      uploaded: uploadList.length,
      accepted,
      uploadOk: true,
      skipped: 'invalid_candidates',
      eligibleCount,
      eligibleLotteries: Array.isArray(uploadRes?.eligibleLotteries) ? uploadRes.eligibleLotteries : [],
      claimedTask: uploadRes?.claimedTask || null
    }
  }
  if (uploadRes?.ok) {
    safeOnLog(accountData, `本轮扫描结束，已向服务端提交${uploadList.length}个福袋候选，服务端接收${accepted}个，可参与${eligibleCount}个`, 'success')
  } else {
    safeOnLog(accountData, `本轮扫描结束，候选上报失败：${uploadRes?.error || 'unknown'}`, 'warning')
  }
  return {
    uploaded: uploadList.length,
    accepted,
    uploadOk: uploadRes?.ok === true,
    skipped: String(uploadRes?.skipped || ''),
    eligibleCount,
    eligibleLotteries: Array.isArray(uploadRes?.eligibleLotteries) ? uploadRes.eligibleLotteries : [],
    claimedTask: uploadRes?.claimedTask || null
  }
}

/**
 * 搜索直播间-【分类】（照抄超人福袋流程）
 */
export async function startCollectLive(manager, accountId, scanProfile = null) {
  const accountData = manager?.accounts?.get(accountId)
  if (!accountData || !manager?.ipc) return

  const categories = normalizeCategoryList(manager, scanProfile)
  if (!Array.isArray(categories) || categories.length === 0) return
  const desiredPages = Math.floor(toNumber(
    scanProfile?.pagesPerCategory,
    manager?.scanConfig?.pagesPerCategory || DEFAULT_CATEGORY_SCAN_PAGES
  ))
  const categoryPages = Math.max(1, Math.min(DEFAULT_CATEGORY_SCAN_PAGES, desiredPages || DEFAULT_CATEGORY_SCAN_PAGES))

  safeOnScanProgressLog(accountData, `开始按分类采集直播间，共${categories.length}个分类`)

  for (let i = 0; i < categories.length; i++) {
    if (manager.isPaused(accountId)) break
    const category = categories[i] || {}
    const categoryId = category.id || category.categoryId
    const categoryName = category.name || category.categoryName || String(categoryId || '未知分类')
    safeOnScanProgressLog(accountData, `正在采集【${categoryName}】分类的直播间...`)

    try {
      const res = await searchLiveRoomCategory(
        manager,
        accountId,
        { category_id: categoryId, category_name: categoryName, page: categoryPages },
        null,
        scanProfile
      )
      const scannedLotteries = normalizeScannedLotteries(res)
      safeOnScanProgressLog(accountData, `【${categoryName}】分类: 发现${res.length}个有福袋的直播间, 详情成功${scannedLotteries.length}个`)

      const poolBefore = manager.getAccountLotteryList(accountId).length
      manager.addLotteryInfoWithoutDuplicates(accountId, scannedLotteries)
      const poolAfter = manager.getAccountLotteryList(accountId).length

      emitScanMetric(manager, accountId, `category-summary:${categoryName}`, i + 1, {
        categoryId: String(categoryId || ''),
        categoryName: String(categoryName || ''),
        validLotteries: res.length,
        keptLotteries: scannedLotteries.length,
        poolBefore,
        poolAfter,
        poolDelta: poolAfter - poolBefore
      })

      manager.enqueuePoolCandidatesUpload(accountId, scannedLotteries).catch(() => {})
      manager.calculatePredictedProbabilities(accountId)
      manager.sortLotteriesByProbability(accountId)
      manager.emitLotteryListUpdate(accountData)

      await sleep(manager, randomDelay(CATEGORY_SWITCH_GAP_MS.min, CATEGORY_SWITCH_GAP_MS.max))
    } catch (error) {
      safeOnScanProgressLog(accountData, `【${categoryName}】分类采集出错: ${error?.message || error}`, 'warning')
      await sleep(manager, randomDelay(CATEGORY_SWITCH_GAP_MS.min, CATEGORY_SWITCH_GAP_MS.max))
    }
  }
}

/**
 * 采集直播间-【每个分类】（照抄超人福袋流程）
 */
export async function searchLiveRoomCategory(
  manager,
  accountId,
  { category_id, category_name, page = DEFAULT_CATEGORY_SCAN_PAGES },
  onBatch = null,
  scanProfile = null
) {
  const accountData = manager?.accounts?.get(accountId)
  if (!accountData || !manager?.ipc) return []
  const totalPages = Math.max(1, Math.floor(toNumber(page, 10)))
  const lotteryInfoList = []

  safeOnScanProgressLog(accountData, `正在搜索【${category_name || '未知分类'}】分类的直播间，共${totalPages}次`)

  for (let i = 0; i < totalPages; i++) {
    if (manager.isPaused(accountId)) break

    try {
      const result = await manager.ipc.invoke('search-live-by-category', {
        accountId,
        categoryId: category_id,
        offset: (i + 1) * 15,
        count: 15
      })

      if (!result?.success || !Array.isArray(result?.roomInfoList)) {
        safeOnScanProgressLog(accountData, `第${i + 1}页数据格式错误`, 'warning')
        emitScanMetric(manager, accountId, `category:${category_name || category_id}`, i + 1, {
          requestOk: false,
          categoryId: String(category_id || ''),
          categoryName: String(category_name || ''),
          rawRooms: Array.isArray(result?.roomInfoList) ? result.roomInfoList.length : 0,
          dedupRooms: 0,
          detailRequested: 0,
          validLotteries: 0,
          hasMore: false
        })
        await sleep(manager, randomDelay(CATEGORY_PAGE_GAP_MS.min, CATEGORY_PAGE_GAP_MS.max))
        continue
      }

      const roomInfoList = result.roomInfoList
        .filter((item) => item?.hasLotteryHint === true)
        .map((item) => ({
          webRid: item?.webRid,
          roomId: item?.roomId,
          roomTitle: item?.roomTitle,
          authorNickname: item?.authorNickname,
          authorSecUid: item?.authorSecUid,
          onlineTotal: item?.onlineTotal
        }))

      emitScanMetric(manager, accountId, `category-detail-start:${category_name || category_id}`, i + 1, {
        categoryId: String(category_id || ''),
        categoryName: String(category_name || ''),
        rawRooms: result.roomInfoList.length,
        dedupRooms: roomInfoList.length,
        detailRequested: roomInfoList.length
      })

      await sleep(manager, randomDelay(CATEGORY_DETAIL_GAP_MS.min, CATEGORY_DETAIL_GAP_MS.max))

      const detailResult = await getLotteryInfo(manager, roomInfoList, accountId, scanProfile)
      const settled = Array.isArray(detailResult?.settled) ? detailResult.settled : []
      const validLotteryInfoList = settled
        .filter((item) => item?.status === 'fulfilled' && item.value)
        .map((item) => item.value)

      lotteryInfoList.push(...validLotteryInfoList)
      if (typeof onBatch === 'function' && validLotteryInfoList.length > 0) {
        onBatch(validLotteryInfoList)
      }

      emitScanMetric(manager, accountId, `category:${category_name || category_id}`, i + 1, {
        requestOk: true,
        categoryId: String(category_id || ''),
        categoryName: String(category_name || ''),
        rawRooms: result.roomInfoList.length,
        dedupRooms: roomInfoList.length,
        detailRequested: roomInfoList.length,
        validLotteries: validLotteryInfoList.length,
        hasMore: result?.hasMore !== false
      })
      await sleep(manager, randomDelay(CATEGORY_PAGE_GAP_MS.min, CATEGORY_PAGE_GAP_MS.max))
    } catch (_) {
      // 超人原逻辑：分类页失败直接跳过
      await sleep(manager, randomDelay(CATEGORY_PAGE_GAP_MS.min, CATEGORY_PAGE_GAP_MS.max))
    }
  }

  manager.calculatePredictedProbabilities(accountId)
  manager.sortLotteriesByProbability(accountId)
  manager.emitLotteryListUpdate(accountData)
  return lotteryInfoList
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
  const promises = roomInfoList.map(async (roomInfo) => {
    const result = await manager.ipc.invoke('get-lottery-detail', {
      roomId: roomInfo?.roomId,
      webRid: roomInfo?.webRid,
      accountId
    })

    if (!result?.success || !result?.lotteryDetail) {
      const err = new Error(result?.error || '福袋信息数据格式错误')
      err.code = result?.code || 'DETAIL_FAILED'
      err.statusCode = Number(result?.statusCode || 0)
      throw err
    }

    const lotteryInfo = {
      ...roomInfo,
      ...result.lotteryDetail,
      fetchedAt: Date.now()
    }

    return applyLotteryFilters(config, lotteryInfo) ? lotteryInfo : null
  })

  const settled = await Promise.allSettled(promises)
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
    if (code === 'NON_JSON_RESPONSE' || status === 444) {
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
