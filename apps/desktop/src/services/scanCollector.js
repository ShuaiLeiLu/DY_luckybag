/**
 * 判断错误文本是否属于风控/拒绝访问类错误。
 * @param {string} message 错误文本
 * @returns {boolean}
 */
function isRiskErrorMessage(message) {
  const text = String(message || '')
  return text.includes('444') || text.includes('NON_JSON') || text.includes('Access Denied')
}

/**
 * 安全数字转换。
 * @param {*} value 原始值
 * @param {number} fallback 兜底值
 * @returns {number}
 */
function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 安全正整数转换。
 * @param {*} value 原始值
 * @param {number} fallback 兜底值
 * @returns {number}
 */
function toPositiveInt(value, fallback = 0) {
  const n = Math.floor(toNumber(value, fallback))
  return n > 0 ? n : fallback
}

/**
 * 判断是否应因风控进入冷却并中断当前扫描轮次。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {Function} onLog 日志回调
 * @returns {boolean}
 */
function shouldBreakForRiskCooldown(manager, accountId, onLog) {
  const profile = manager.getAdaptiveScanProfile(accountId)
  const remainMs = Number(profile?.cooldownRemainMs || 0)
  const level = Number(profile?.level || 0)
  // 仅在高风控等级中断整轮扫描，低等级继续保留一定采集量。
  if (remainMs <= 0 || level < 2) return false
  if (typeof onLog === 'function') {
    const sec = Math.ceil(remainMs / 1000)
    onLog(`🛡️ 命中风控，立即结束当轮扫描，冷却${sec}秒后继续`, 'warning')
  }
  return true
}

/**
 * 控制扫描过程日志输出频率，避免日志刷屏。
 * @param {number} roundIndex 当前轮次索引
 * @param {number} noGrowthRounds 连续无增长轮数
 * @returns {boolean}
 */
function shouldLogScanProgress(roundIndex, noGrowthRounds = 0) {
  if (roundIndex <= 0) return true
  if ((roundIndex + 1) % 10 === 0) return true
  return noGrowthRounds >= 5
}

/**
 * 读取扫描追踪日志开关（localStorage: DY_SCAN_TRACE，默认关闭）。
 * @returns {boolean}
 */
function isScanTraceEnabled() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = String(window.localStorage.getItem('DY_SCAN_TRACE') || '').trim().toLowerCase()
      if (raw) {
        return ['1', 'true', 'on', 'yes'].includes(raw)
      }
    }
  } catch (_) {
    // ignore
  }
  return false
}

/**
 * 输出扫描追踪日志到控制台。
 * @param {...any} args 任意日志参数
 */
function traceScan(...args) {
  if (!isScanTraceEnabled()) return
  console.log('[scan-trace]', ...args)
}

const DEBUG_SAMPLE_SIZE = 6

/**
 * emitScanDebug 方法：将扫描汇总转发到主进程控制台。
 */
function emitScanDebug(manager, payload = {}) {
  if (!isScanTraceEnabled()) return
  try {
    if (!manager?.ipc?.invoke) return
    manager.ipc.invoke('scan-debug-log', payload).catch(() => {})
  } catch (_) {
    // ignore
  }
}

/**
 * emitScanMetric 方法：输出固定结构的扫描指标到渲染控制台，并同步到主进程控制台。
 */
function emitScanMetric(manager, accountId, stage, requestIndex, metric = {}) {
  const safeAccountId = String(accountId || 'unknown')
  const safeStage = String(stage || 'scan')
  const safeRequest = Number(requestIndex || 0)
  const summary = metric && typeof metric === 'object' ? metric : { value: metric }
  try {
    console.log(`[scan-metrics] [${safeAccountId}] [${safeStage}] request=${safeRequest}`, summary)
  } catch (_) {
    // ignore
  }
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

/**
 * formatRoomBrief 方法：格式化直播间候选简要信息。
 */
function formatRoomBrief(item) {
  return {
    roomId: String(item?.roomId || ''),
    webRid: String(item?.webRid || ''),
    author: String(item?.authorNickname || ''),
    title: String(item?.roomTitle || ''),
    hasHint: item?.hasLotteryHint === true
  }
}

/**
 * formatLotteryBrief 方法：格式化福袋简要信息。
 */
function formatLotteryBrief(item) {
  const conditions = Array.isArray(item?.conditions) ? item.conditions : []
  return {
    roomId: String(item?.roomId || ''),
    lotteryId: String(item?.lottery_id || item?.lotteryId || ''),
    author: String(item?.authorNickname || ''),
    lotteryName: String(item?.lotteryName || item?.prize_name || ''),
    joinTotal: Number(item?.joinTotal || 0),
    luckyCount: Number(item?.winningTotal || 0),
    conditionTypes: conditions.map(c => Number(c?.type)).filter(n => Number.isFinite(n)),
    endTime: Number(item?.end_time || 0)
  }
}

/**
 * buildRequestSummary 方法：构造单次请求扫描汇总（含样本）。
 */
function buildRequestSummary(scannedList, qualifiedList, extra = {}) {
  const scanned = Array.isArray(scannedList) ? scannedList.map(formatRoomBrief) : []
  const qualified = Array.isArray(qualifiedList) ? qualifiedList.map(formatLotteryBrief) : []
  return {
    ...extra,
    scannedCount: scanned.length,
    qualifiedCount: qualified.length,
    scannedSample: scanned.slice(0, DEBUG_SAMPLE_SIZE),
    qualifiedSample: qualified.slice(0, DEBUG_SAMPLE_SIZE)
  }
}

/**
 * pickDetailRooms 方法：优先请求带福袋提示的房间详情，非提示房间仅少量补位。
 */
function pickDetailRooms(roomInfoList, scanProfile = null, options = {}) {
  const source = Array.isArray(roomInfoList) ? roomInfoList : []
  if (options?.fullUploadMode === true) {
    return source
  }
  const supermanFirstRound = options?.supermanFirstRound === true
  const forceLotteryHintOnly = options?.forceLotteryHintOnly === true
  const hintRooms = source.filter(item => item?.hasLotteryHint === true)
  const nonHintRooms = source.filter(item => item?.hasLotteryHint !== true)
  const defaultCap = supermanFirstRound ? 8 : 10
  const detailRoomCap = Math.max(1, toPositiveInt(scanProfile?.detailRoomCap, defaultCap))
  const nonHintCap = forceLotteryHintOnly
    ? 0
    : Math.max(0, toPositiveInt(scanProfile?.nonHintDetailCap, 3))
  const prioritized = forceLotteryHintOnly
    ? hintRooms
    : [...hintRooms, ...nonHintRooms.slice(0, nonHintCap)]
  return prioritized.slice(0, detailRoomCap)
}

/**
 * claimLocalDetailRooms 方法：在同一客户端内对详情请求做短期去重，避免多个账号重复抓同一房间。
 */
function claimLocalDetailRooms(manager, accountId, roomInfoList, scanProfile = null) {
  const source = Array.isArray(roomInfoList) ? roomInfoList : []
  if (source.length === 0 || typeof manager?.claimLocalScanRooms !== 'function') {
    return { list: source, skipped: 0 }
  }
  const ttlMs = Math.max(
    8000,
    Number(scanProfile?.localRoomLeaseTTLms || (scanProfile?.deepScan === true ? 9000 : 12000))
  )
  return manager.claimLocalScanRooms(accountId, source, { ttlMs })
}

function releaseLocalDetailRooms(manager, roomInfoList) {
  if (typeof manager?.releaseLocalScanRooms !== 'function') return
  manager.releaseLocalScanRooms(roomInfoList)
}

/**
 * logRequestDetail 方法：输出每次请求的扫描明细和过滤明细。
 */
function logRequestDetail(manager, accountId, stage, requestIndex, scannedList, qualifiedList, extra = {}) {
  if (!isScanTraceEnabled()) return
  const summary = buildRequestSummary(scannedList, qualifiedList, extra)
  traceScan(`[scan-detail] [${accountId}] [${stage}] request=${requestIndex}`, summary)
  emitScanDebug(manager, {
    accountId,
    stage,
    requestIndex,
    type: 'request-summary',
    summary
  })
}

/**
 * requestScanPermit 方法：在真正发请求前先向共享池服务端申请扫描许可证。
 */
async function requestScanPermit(manager, accountId, kind, cost = 1) {
  if (!manager?.isPoolServerEnabled?.()) {
    return { allowed: true, retryAfterMs: 0, reason: 'disabled' }
  }
  if (typeof manager.requestPoolScanPermit !== 'function') {
    return { allowed: true, retryAfterMs: 0, reason: 'missing_manager_method' }
  }
  try {
    const res = await manager.requestPoolScanPermit(accountId, kind, { cost })
    if (!res?.ok) {
      return { allowed: true, retryAfterMs: 0, reason: 'permit_api_error' }
    }
    const permit = res?.data?.permit || {}
    return {
      allowed: permit.allowed !== false,
      retryAfterMs: Math.max(0, Number(permit.retryAfterMs || 0)),
      reason: String(permit.reason || ''),
      detail: permit
    }
  } catch (_) {
    return { allowed: true, retryAfterMs: 0, reason: 'permit_exception' }
  }
}

/**
 * calcDetailPermitCost 方法：将详情批次请求折算成较平滑的 permit 成本，避免整批详情被一次性卡死。
 */
function calcDetailPermitCost(candidateCount, scanProfile = null) {
  const count = Math.max(0, toPositiveInt(candidateCount, 0))
  if (count <= 0) return 1
  const divisor = Math.max(2, toPositiveInt(scanProfile?.detailPermitDivisor, 3))
  return Math.max(1, Math.ceil(count / divisor))
}

/**
 * 通过“全站接口”搜索直播间并补充福袋池。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {number} times 期望扫描轮次
 * @param {object|null} scanProfile 扫描配置
 */
export async function searchLiveByAll(manager, accountId, times = 10, scanProfile = null) {
  const accountData = manager.accounts.get(accountId)
  if (!accountData) return
  if (!manager.ipc) throw new Error('Electron IPC 不可用')
  const config = accountData.config || {}
  const supermanFirstRound = scanProfile?.supermanFirstRound === true
  const fullUploadMode = manager?.isPoolServerEnabled?.() === true
  const forceLotteryHintOnly = !fullUploadMode && (supermanFirstRound || scanProfile?.forceLotteryHintOnly === true)
  const useCursorPagingInFirstRound = supermanFirstRound && scanProfile?.firstRoundUseCursorPaging === true
  const allowCursorPaging = !supermanFirstRound || useCursorPagingInFirstRound

  // 统一构造扫描参数，避免 supermanFirstRound 三元判断散落各处
  const defaultRounds = Math.max(1, toPositiveInt(times, 10))
  const scanParams = supermanFirstRound
    ? {
      allTimes: Math.max(1, toPositiveInt(scanProfile?.allTimes, 10)),
      maxAllRounds: Math.max(1, toPositiveInt(scanProfile?.allTimes, 10)),
      noGrowthBreakRounds: Number.MAX_SAFE_INTEGER,
      allCount: Math.max(8, toPositiveInt(scanProfile?.allCount, 12)),
      sharedAllCursorEnabled: false,
      mode: 'superman-first-round'
    }
    : {
      allTimes: Math.max(1, toPositiveInt(scanProfile?.allTimes, defaultRounds)),
      maxAllRounds: Math.max(
        Math.max(1, toPositiveInt(scanProfile?.allTimes, defaultRounds)),
        toPositiveInt(scanProfile?.maxAllRounds, Math.max(1, toPositiveInt(scanProfile?.allTimes, defaultRounds)))
      ),
      noGrowthBreakRounds: Math.max(4, toPositiveInt(scanProfile?.noGrowthBreakRounds, Math.max(8, Math.ceil(Math.max(1, toPositiveInt(scanProfile?.allTimes, defaultRounds)) / 2)))),
      allCount: Math.max(8, toPositiveInt(scanProfile?.allCount, toPositiveInt(scanProfile?.countPerPage, 24))),
      sharedAllCursorEnabled: manager?.isPoolServerEnabled?.() === true &&
        String(scanProfile?.localScanPlan?.kind || '') === 'all',
      mode: 'normal'
    }
  const { maxAllRounds, noGrowthBreakRounds, allCount, sharedAllCursorEnabled } = scanParams
  const scanMode = scanParams.mode

  // 使用 Manager 级别的跨轮次 TTL 去重（如可用），减少重复拉详情
  const useManagerSeen = !fullUploadMode && typeof manager?.isAllScanRoomSeen === 'function'
  const seenRoomIds = new Set()
  let cursorMaxTime = null
  let noGrowthRounds = 0

  try {
    for (let i = 0; i < maxAllRounds; i++) {
      if (manager.isPaused(accountId)) break
      if (typeof manager?.getTaskStage === 'function' && manager.getTaskStage(accountId) === 'joining') break
      if (toPositiveInt(scanProfile?.deadlineMs, 0) > 0 && Date.now() >= Number(scanProfile.deadlineMs)) break

      const roundSummary = {
        mode: scanMode,
        round: i + 1,
        maxRounds: maxAllRounds,
        requestOk: false,
        rawRooms: 0,
        hintedRooms: 0,
        dedupRooms: 0,
        detailRequested: 0,
        detailSuccess: 0,
        detailRiskCount: 0,
        filterFanClub: config?.filterFanClub?.enabled !== false,
        kept: 0,
        dropType: 0,
        dropMember: 0,
        dropFanClub: 0,
        poolBefore: manager.getAccountLotteryList(accountId).length,
        poolAfter: 0, // 在 emitRoundSummary 中取最终值
        hasMore: false,
        nextCursor: null,
        noGrowthBefore: noGrowthRounds,
        noGrowthAfter: noGrowthRounds,
        breakReason: '',
        error: null
      }
      const emitRoundSummary = () => {
        roundSummary.noGrowthAfter = noGrowthRounds
        roundSummary.poolAfter = manager.getAccountLotteryList(accountId).length
        emitScanMetric(manager, accountId, 'all-request', i + 1, {
          mode: roundSummary.mode,
          requestOk: roundSummary.requestOk === true,
          rawRooms: Number(roundSummary.rawRooms || 0),
          dedupRooms: Number(roundSummary.dedupRooms || 0),
          detailRequested: Number(roundSummary.detailRequested || 0),
          validLotteries: Number(roundSummary.detailSuccess || 0),
          keptLotteries: Number(roundSummary.kept || 0),
          poolBefore: Number(roundSummary.poolBefore || 0),
          poolAfter: Number(roundSummary.poolAfter || 0),
          poolDelta: Number(roundSummary.poolAfter || 0) - Number(roundSummary.poolBefore || 0),
          hasMore: roundSummary.hasMore === true,
          breakReason: String(roundSummary.breakReason || ''),
          error: String(roundSummary.error || '')
        })
        traceScan(`[${accountId}] all-round-summary`, roundSummary)
        emitScanDebug(manager, {
          accountId,
          stage: 'all-round-summary',
          requestIndex: i + 1,
          type: 'round-summary',
          summary: roundSummary
        })
      }

      let sharedCursorLease = null
      try {
        const allPermit = await requestScanPermit(manager, accountId, 'all', 1)
        if (allPermit.allowed !== true) {
          roundSummary.error = `scan_permit_denied:${allPermit.reason || 'rate_limited'}`
          emitRoundSummary()
          await manager.sleep(Math.min(12000, Math.max(600, Number(allPermit.retryAfterMs || 1200))))
          continue
        }

        let sharedCursorMaxTime = null
        if (sharedAllCursorEnabled && typeof manager.claimPoolAllScanCursor === 'function') {
          const claimRes = await manager.claimPoolAllScanCursor(accountId, {
            leaseTtlMs: Number(scanProfile?.allCursorLeaseTtlMs || 18000)
          })
          const cursor = claimRes?.data?.cursor || {}
          if (!claimRes?.ok || cursor?.claimed !== true) {
            roundSummary.error = `all_cursor_unavailable:${cursor?.reason || claimRes?.error || 'unknown'}`
            emitRoundSummary()
            await manager.sleep(Math.min(15000, Math.max(800, Number(cursor?.retryAfterMs || 1800))))
            continue
          }
          sharedCursorLease = cursor
          if (Number(cursor.cursorMaxTime || 0) > 0) {
            sharedCursorMaxTime = Number(cursor.cursorMaxTime)
          }
        }

        const effectiveMaxTime = allowCursorPaging ? Number(sharedCursorMaxTime || cursorMaxTime || 0) : 0
        const requestPayload = {
          accountId,
          customCount: allCount,
          maxTime: effectiveMaxTime > 0 ? effectiveMaxTime : undefined
        }

        const result = await manager.ipc.invoke('search-live-by-all', {
          accountId: requestPayload.accountId,
          customCount: requestPayload.customCount,
          maxTime: requestPayload.maxTime
        })
        roundSummary.requestOk = result?.success === true
        roundSummary.rawRooms = Array.isArray(result?.roomInfoList) ? result.roomInfoList.length : 0

        if (!result.success) {
          if (sharedAllCursorEnabled && sharedCursorLease?.slotId && typeof manager.reportPoolAllScanCursor === 'function') {
            await manager.reportPoolAllScanCursor(accountId, {
              slotId: sharedCursorLease.slotId,
              usedCursorMaxTime: Number(sharedCursorLease.cursorMaxTime || 0),
              nextCursorMaxTime: 0,
              hasMore: false,
              rawRooms: roundSummary.rawRooms,
              hintedRooms: 0,
              qualifiedRooms: 0,
              error: String(result?.error || 'request_failed')
            })
          }
          if (shouldLogScanProgress(i, noGrowthRounds)) {
            accountData.callbacks.onLog(`扫描重试(${i + 1}/${maxAllRounds})：${result.error || '未知错误'}`, 'warning')
          }
          roundSummary.error = result?.error || 'unknown'
          noGrowthRounds += 1
          if (isRiskErrorMessage(result.error)) {
            console.warn(`[scan] [${accountId}] 全站扫描命中风控: ${result.error}`)
            manager.applyScanRiskFeedback(accountId, { hardRiskCount: 1 }, accountData.callbacks.onLog)
            if (shouldBreakForRiskCooldown(manager, accountId, accountData.callbacks.onLog)) {
              roundSummary.breakReason = 'risk_cooldown'
              emitRoundSummary()
              break
            }
          }
          if (result.detail) {
            console.warn('[scan] 搜索失败详情', result.detail)
          }
          if (noGrowthRounds >= noGrowthBreakRounds) {
            roundSummary.breakReason = 'no_growth_break'
            emitRoundSummary()
            break
          }
          emitRoundSummary()
          continue
        }

        if (!Array.isArray(result.roomInfoList)) {
          roundSummary.error = 'invalid_room_list'
          noGrowthRounds += 1
          if (noGrowthRounds >= noGrowthBreakRounds) {
            roundSummary.breakReason = 'invalid_room_list_break'
            emitRoundSummary()
            break
          }
          emitRoundSummary()
          continue
        }

        const roomInfoList = result.roomInfoList.filter(item => {
          if (forceLotteryHintOnly && item?.hasLotteryHint !== true) return false
          const roomId = String(item?.roomId || '')
          if (!roomId || seenRoomIds.has(roomId)) return false
          // 跨轮次去重：如果 Manager 级别已见过该房间且未过期，跳过
          if (useManagerSeen && manager.isAllScanRoomSeen(roomId)) return false
          seenRoomIds.add(roomId)
          if (useManagerSeen) manager.markAllScanRoomSeen(roomId, 30000)
          return true
        })
        roundSummary.hintedRooms = forceLotteryHintOnly
          ? roomInfoList.length
          : result.roomInfoList.filter(item => item?.hasLotteryHint === true).length
        roundSummary.dedupRooms = roomInfoList.length
        if (roomInfoList.length === 0) {
          noGrowthRounds += 1
        } else {
          const beforeCount = manager.getAccountLotteryList(accountId).length
          roundSummary.poolBefore = beforeCount
          const detailRooms = pickDetailRooms(roomInfoList, scanProfile, {
            supermanFirstRound,
            forceLotteryHintOnly,
            fullUploadMode
          })
          const localClaim = claimLocalDetailRooms(manager, accountId, detailRooms, scanProfile)
          roundSummary.detailRequested = localClaim.list.length
          roundSummary.localDedupSkipped = Number(localClaim.skipped || 0)
          let detailResult
          try {
            detailResult = await getLotteryInfo(manager, localClaim.list, accountId, scanProfile)
          } finally {
            releaseLocalDetailRooms(manager, localClaim.list)
          }
          const resList = detailResult.settled
          roundSummary.detailRiskCount = Number(detailResult?.stats?.hardRiskCount || 0)
          if (detailResult.stats.hardRiskCount > 0) {
            console.warn(`[scan] [${accountId}] 详情请求命中风控: hardRisk=${detailResult.stats.hardRiskCount}, error=${detailResult.stats.errorCount}`)
          }
          manager.applyScanRiskFeedback(accountId, detailResult.stats, accountData.callbacks.onLog)
          const shouldBreakByDetailRisk = detailResult.stats.hardRiskCount > 0 &&
            (!supermanFirstRound || detailResult.stats.hardRiskCount >= 2)
          if (shouldBreakByDetailRisk && shouldBreakForRiskCooldown(manager, accountId, accountData.callbacks.onLog)) {
            roundSummary.breakReason = 'detail_risk_cooldown'
            roundSummary.error = 'risk_detected_in_detail'
            emitRoundSummary()
            break
          }
          const validLotteryInfoList = resList
            .filter(item => item.status === 'fulfilled' && item.value)
            .map(item => item.value)
          roundSummary.detailSuccess = validLotteryInfoList.length

          const filteredList = validLotteryInfoList
          const filterStats = {
            total: validLotteryInfoList.length,
            kept: validLotteryInfoList.length,
            dropType: 0,
            dropMember: 0,
            dropFanClub: 0
          }
          roundSummary.kept = Number(filterStats?.kept || 0)
          roundSummary.dropType = Number(filterStats?.dropType || 0)
          roundSummary.dropMember = Number(filterStats?.dropMember || 0)
          roundSummary.dropFanClub = Number(filterStats?.dropFanClub || 0)
          logRequestDetail(
            manager,
            accountId,
            'all',
            i + 1,
            roomInfoList,
            filteredList,
            {
              mode: scanMode,
              detailSuccess: validLotteryInfoList.length,
              filterStats
            }
          )
          manager.addLotteryInfoWithoutDuplicates(accountId, filteredList)
          manager.enqueuePoolCandidatesUpload(accountId, filteredList).catch(() => {})
          manager.calculatePredictedProbabilities(accountId)
          manager.sortLotteriesByProbability(accountId)
          manager.emitLotteryListUpdate(accountData)

          const afterCount = manager.getAccountLotteryList(accountId).length
          if (afterCount > beforeCount) {
            noGrowthRounds = 0
          } else {
            noGrowthRounds += 1
          }
        }

        const nextMaxTime = allowCursorPaging ? toPositiveInt(result?.nextMaxTime, 0) : 0
        const hasMore = allowCursorPaging && result?.hasMore === true && nextMaxTime > 0
        roundSummary.hasMore = hasMore
        roundSummary.nextCursor = hasMore ? nextMaxTime : null
        if (allowCursorPaging) {
          if (!sharedAllCursorEnabled && hasMore && nextMaxTime !== Number(cursorMaxTime || 0)) {
            cursorMaxTime = nextMaxTime
          } else if (!sharedAllCursorEnabled && !hasMore) {
            cursorMaxTime = null
          }
        }
        if (sharedAllCursorEnabled && sharedCursorLease?.slotId && typeof manager.reportPoolAllScanCursor === 'function') {
          await manager.reportPoolAllScanCursor(accountId, {
            slotId: sharedCursorLease.slotId,
            usedCursorMaxTime: Number(sharedCursorLease.cursorMaxTime || 0),
            nextCursorMaxTime: hasMore ? nextMaxTime : 0,
            hasMore,
            rawRooms: roundSummary.rawRooms,
            hintedRooms: roundSummary.hintedRooms,
            qualifiedRooms: roundSummary.kept
          })
        }

        if (!supermanFirstRound && noGrowthRounds >= noGrowthBreakRounds) {
          roundSummary.breakReason = 'no_growth_break'
          emitRoundSummary()
          break
        }

        // 没有更多分页且本轮无新增，提前结束
        const noMoreBreakRounds = supermanFirstRound
          ? Math.max(3, toPositiveInt(scanProfile?.firstRoundNoMoreBreakRounds, 4))
          : Math.max(3, Math.floor(noGrowthBreakRounds / 2))
        if (!hasMore && noGrowthRounds >= noMoreBreakRounds) {
          roundSummary.breakReason = 'no_more_and_no_growth'
          emitRoundSummary()
          break
        }

        emitRoundSummary()
        const minDelay = Number(scanProfile?.cycleDelayMinMs || 500)
        const maxDelay = Number(scanProfile?.cycleDelayMaxMs || 1500)
        const randomDelay = Math.floor(Math.random() * Math.max(0, maxDelay - minDelay + 1)) + minDelay
        await manager.sleep(randomDelay)
      } catch (error) {
        if (sharedAllCursorEnabled && sharedCursorLease?.slotId && typeof manager.reportPoolAllScanCursor === 'function') {
          await manager.reportPoolAllScanCursor(accountId, {
            slotId: sharedCursorLease.slotId,
            usedCursorMaxTime: Number(sharedCursorLease.cursorMaxTime || 0),
            nextCursorMaxTime: 0,
            hasMore: false,
            rawRooms: roundSummary.rawRooms,
            hintedRooms: roundSummary.hintedRooms,
            qualifiedRooms: roundSummary.kept,
            error: String(error?.message || 'all_scan_exception')
          }).catch(() => {})
        }
        roundSummary.error = error?.message || 'unknown'
        emitRoundSummary()
        if (shouldLogScanProgress(i, noGrowthRounds)) {
          accountData.callbacks.onLog(`扫描异常(${i + 1}/${maxAllRounds})：${error.message}`, 'warning')
        }
        console.warn('[scan] 搜索异常', error)
      }
    }
  } catch (error) {
    accountData.callbacks.onLog(`全部搜索异常: ${error.message}`)
    console.warn('[scan] 全部搜索异常', error)
  }
}

/**
 * 按分类批量扫描直播间并补充福袋池。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {object|null} scanProfile 扫描配置
 */
export async function startCollectLive(manager, accountId, scanProfile = null) {
  const accountData = manager.accounts.get(accountId)
  if (!accountData) return
  const config = accountData.config || {}
  const supermanFirstRound = scanProfile?.supermanFirstRound === true

  const categories = Array.isArray(scanProfile?.assignedCategoryPlans) && scanProfile.assignedCategoryPlans.length > 0
    ? scanProfile.assignedCategoryPlans
    : (Array.isArray(scanProfile?.assignedCategories) ? scanProfile.assignedCategories : manager.categoryList)
  if (!Array.isArray(categories) || categories.length === 0) return

  try {
    for (let i = 0; i < categories.length; i++) {
      if (manager.isPaused(accountId)) break
      if (toPositiveInt(scanProfile?.deadlineMs, 0) > 0 && Date.now() >= Number(scanProfile.deadlineMs)) break

      const category = categories[i]
      const profilePages = toNumber(scanProfile?.pagesPerCategory, NaN)
      const managerPages = toNumber(manager.scanConfig?.pagesPerCategory, 10)
      const pageCount = supermanFirstRound
        ? 10
        : Math.max(1, Math.floor(Number(category?.maxPages || (Number.isFinite(profilePages) ? profilePages : managerPages))))
      const categoryRound = {
        mode: supermanFirstRound ? 'superman-first-round' : 'normal',
        categoryId: category.id || category.categoryId,
        categoryName: category.name || category.categoryName || category.categoryId,
        startOffset: Math.max(0, Number(category?.startOffset || 0)),
        offsetStride: Math.max(0, Number(category?.offsetStride || 0)),
        total: 0,
        kept: 0,
        dropType: 0,
        dropMember: 0,
        dropFanClub: 0,
        batches: 0,
        error: null
      }
      try {
        await searchLiveRoomCategory(manager, accountId, {
          category_id: category.id || category.categoryId,
          category_name: category.name || category.categoryName || category.categoryId,
          page: pageCount,
          startOffset: Number(category?.startOffset || 0),
          offsetStride: Number(category?.offsetStride || 0),
          count: Number(category?.count || scanProfile?.countPerPage || manager.scanConfig?.countPerPage || 15)
        }, (batchList) => {
          const filteredList = batchList
          const filterStats = {
            total: batchList.length,
            kept: batchList.length,
            dropType: 0,
            dropMember: 0,
            dropFanClub: 0
          }
          categoryRound.batches += 1
          categoryRound.total += Number(filterStats?.total || 0)
          categoryRound.kept += Number(filterStats?.kept || 0)
          categoryRound.dropType += Number(filterStats?.dropType || 0)
          categoryRound.dropMember += Number(filterStats?.dropMember || 0)
          categoryRound.dropFanClub += Number(filterStats?.dropFanClub || 0)
          logRequestDetail(
            manager,
            accountId,
            `category:${category.name}`,
            categoryRound.batches,
            batchList,
            filteredList,
            {
              mode: supermanFirstRound ? 'superman-first-round' : 'normal',
              stage: 'after-filter',
              filterStats
            }
          )
          manager.addLotteryInfoWithoutDuplicates(accountId, filteredList)
          manager.enqueuePoolCandidatesUpload(accountId, filteredList).catch(() => {})
        }, scanProfile)

        // 每个分类扫完后统一做一次概率计算/排序/UI推送，避免每批都重复计算
        manager.calculatePredictedProbabilities(accountId)
        manager.sortLotteriesByProbability(accountId)
        manager.emitLotteryListUpdate(accountData)

        traceScan(`[${accountId}] category-round-summary`, categoryRound)
        emitScanDebug(manager, {
          accountId,
          stage: 'category-round-summary',
          requestIndex: i + 1,
          type: 'round-summary',
          summary: categoryRound
        })

        const minDelay = Number(scanProfile?.cycleDelayMinMs || 500)
        const maxDelay = Number(scanProfile?.cycleDelayMaxMs || 1500)
        const randomDelay = Math.floor(Math.random() * Math.max(0, maxDelay - minDelay + 1)) + minDelay
        await manager.sleep(randomDelay)
      } catch (error) {
        categoryRound.error = error?.message || 'unknown'
        traceScan(`[${accountId}] category-round-summary`, categoryRound)
        emitScanDebug(manager, {
          accountId,
          stage: 'category-round-summary',
          requestIndex: i + 1,
          type: 'round-summary',
          summary: categoryRound
        })
        console.warn(`[scan] [${accountId}] 分类采集出错: category=${category.name}`, error)
        accountData.callbacks.onLog(`【${category.name}】分类采集出错: ${error.message}`)
      }
    }
  } catch (error) {
    accountData.callbacks.onLog(`分类搜索异常: ${error.message}`)
  }
}

/**
 * 扫描单个分类并可通过 onBatch 回调逐批返回有效福袋。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {{category_id:string, category_name:string, page:number|null}} options 分类参数
 * @param {Function|null} onBatch 批次回调
 * @param {object|null} scanProfile 扫描配置
 * @returns {Promise<Array>}
 */
export async function searchLiveRoomCategory(
  manager,
  accountId,
  { category_id, category_name, page = null, startOffset = 0, offsetStride = 0, count = null },
  onBatch = null,
  scanProfile = null
) {
  const accountData = manager.accounts.get(accountId)
  if (!accountData) return []
  if (!manager.ipc) throw new Error('Electron IPC 不可用')
  const supermanFirstRound = scanProfile?.supermanFirstRound === true
  const fullUploadMode = manager?.isPoolServerEnabled?.() === true
  const forceLotteryHintOnly = !fullUploadMode && (supermanFirstRound || scanProfile?.forceLotteryHintOnly === true)

  const pageNum = toNumber(page, NaN)
  const autoPaging = supermanFirstRound ? false : (!Number.isFinite(pageNum) || pageNum <= 0)
  const totalPages = supermanFirstRound
    ? Math.max(1, Math.floor(Number(pageNum) || 10))
    : (autoPaging ? Math.max(1, toPositiveInt(scanProfile?.maxCategoryPages, 240)) : Math.max(1, Math.floor(pageNum)))
  const countPerPage = supermanFirstRound
    ? 15
    : Math.max(10, toPositiveInt(count, toPositiveInt(scanProfile?.countPerPage, toPositiveInt(manager.scanConfig.countPerPage, 15))))
  const noGrowthBreakPages = supermanFirstRound
    ? Number.MAX_SAFE_INTEGER
    : Math.max(4, toPositiveInt(scanProfile?.categoryNoGrowthBreakPages, 10))
  const lotteryInfoList = []
  const seenRoomIds = new Set()
  const deterministicPaging = !supermanFirstRound && (Number(startOffset || 0) > 0 || Number(offsetStride || 0) > countPerPage)
  const baseOffset = Math.max(0, toPositiveInt(startOffset, 0))
  const pageStride = Math.max(countPerPage, toPositiveInt(offsetStride, countPerPage))
  let offset = supermanFirstRound ? countPerPage : baseOffset
  let noGrowthPages = 0

  try {
    for (let i = 0; i < totalPages; i++) {
      if (manager.isPaused(accountId)) break
      if (typeof manager?.getTaskStage === 'function' && manager.getTaskStage(accountId) === 'joining') break
      if (toPositiveInt(scanProfile?.deadlineMs, 0) > 0 && Date.now() >= Number(scanProfile.deadlineMs)) break

      try {
        const categoryPermit = await requestScanPermit(manager, accountId, 'category', 1)
        if (categoryPermit.allowed !== true) {
          emitScanDebug(manager, {
            accountId,
            stage: `category:${category_name || category_id}`,
            requestIndex: i + 1,
            type: 'permit-denied',
            summary: {
              kind: 'category',
              retryAfterMs: Number(categoryPermit.retryAfterMs || 0),
              reason: categoryPermit.reason || 'rate_limited'
            }
          })
          await manager.sleep(Math.min(12000, Math.max(600, Number(categoryPermit.retryAfterMs || 1200))))
          continue
        }

        const requestOffset = supermanFirstRound
          ? ((i + 1) * countPerPage)
          : (deterministicPaging ? (baseOffset + i * pageStride) : offset)
        const result = await manager.ipc.invoke('search-live-by-category', {
          accountId,
          categoryId: category_id,
          // supermanFirstRound 模式下严格使用 (i+1)*count
          offset: requestOffset,
          count: countPerPage
        })
        const rawRoomCount = Array.isArray(result?.roomInfoList) ? result.roomInfoList.length : 0

        if (!result.success || !result.roomInfoList) {
          noGrowthPages += 1
          if (!result.success && isRiskErrorMessage(result.error)) {
            console.warn(`[scan] [${accountId}] 分类扫描命中风控: ${result.error}, category=${category_id}`)
            manager.applyScanRiskFeedback(accountId, { hardRiskCount: 1 }, accountData.callbacks.onLog)
            if (shouldBreakForRiskCooldown(manager, accountId, accountData.callbacks.onLog)) {
              break
            }
          }
          if (!supermanFirstRound && autoPaging && noGrowthPages >= noGrowthBreakPages) break
          continue
        }

        const roomInfoList = result.roomInfoList.filter(item => {
          if (forceLotteryHintOnly && item?.hasLotteryHint !== true) return false
          const roomId = String(item?.roomId || '')
          if (!roomId || seenRoomIds.has(roomId)) return false
          seenRoomIds.add(roomId)
          return true
        })
        if (roomInfoList.length === 0) {
          noGrowthPages += 1
        } else {
          noGrowthPages = 0
        }
        await manager.sleep(Math.max(240, Number(scanProfile?.itemGapMs || 320)))

        const detailRooms = pickDetailRooms(roomInfoList, scanProfile, {
          supermanFirstRound,
          forceLotteryHintOnly,
          fullUploadMode
        })
        const localClaim = claimLocalDetailRooms(manager, accountId, detailRooms, scanProfile)
        let detailResult
        try {
          detailResult = await getLotteryInfo(manager, localClaim.list, accountId, scanProfile)
        } finally {
          releaseLocalDetailRooms(manager, localClaim.list)
        }
        const resList = detailResult.settled
        if (detailResult.stats.hardRiskCount > 0) {
          console.warn(`[scan] [${accountId}] 分类详情命中风控: hardRisk=${detailResult.stats.hardRiskCount}, error=${detailResult.stats.errorCount}, category=${category_id}`)
        }
        manager.applyScanRiskFeedback(accountId, detailResult.stats, accountData.callbacks.onLog)
        const shouldBreakByDetailRisk = detailResult.stats.hardRiskCount > 0 &&
          (!supermanFirstRound || detailResult.stats.hardRiskCount >= 2)
        if (shouldBreakByDetailRisk && shouldBreakForRiskCooldown(manager, accountId, accountData.callbacks.onLog)) {
          break
        }
        const validLotteryInfoList = resList
          .filter(item => item.status === 'fulfilled' && item.value)
          .map(item => item.value)

        // 每次分类请求先打印“扫到的候选福袋详情”（未经过条件筛选）
        logRequestDetail(
          manager,
          accountId,
          `category:${category_name || category_id}`,
          i + 1,
          roomInfoList,
          validLotteryInfoList,
          {
            mode: supermanFirstRound ? 'superman-first-round' : 'normal',
            stage: 'before-filter',
            localDedupSkipped: Number(localClaim.skipped || 0)
          }
        )

        lotteryInfoList.push(...validLotteryInfoList)
        if (typeof onBatch === 'function' && validLotteryInfoList.length > 0) {
          onBatch(validLotteryInfoList)
        }

        if (!supermanFirstRound && deterministicPaging) {
          offset = requestOffset + pageStride
        } else if (!supermanFirstRound) {
          const nextOffset = toPositiveInt(result?.nextOffset, 0)
          if (nextOffset > offset) {
            offset = nextOffset
          } else {
            offset += countPerPage
          }
        }

        const hasMore = result?.hasMore !== false && toNumber(result?.rawCount, roomInfoList.length) > 0
        if (!supermanFirstRound && autoPaging) {
          if (!hasMore) break
          if (noGrowthPages >= noGrowthBreakPages) break
        }
      } catch (error) {
        emitScanDebug(manager, {
          accountId,
          stage: `category:${category_name || category_id}`,
          requestIndex: i + 1,
          type: 'request-error',
          summary: {
            error: error?.message || 'unknown'
          }
        })
        // 跳过错误页，继续下一页
      }
    }
  } catch (error) {
    accountData.callbacks.onLog(`分类搜索异常: ${error.message}`)
  }

  return lotteryInfoList
}

/**
 * 对直播间列表并发获取福袋详情。
 * @param {object} manager LotteryManager 实例
 * @param {Array} roomInfoList 直播间列表
 * @param {string} accountId 账号ID
 * @param {object|null} scanProfile 扫描配置
 * @returns {Promise<{settled:Array, stats:{successCount:number, hardRiskCount:number, errorCount:number}}>}
 */
export async function getLotteryInfo(manager, roomInfoList, accountId, scanProfile = null) {
  if (!Array.isArray(roomInfoList) || roomInfoList.length === 0) {
    return { settled: [], stats: { successCount: 0, hardRiskCount: 0, errorCount: 0 } }
  }
  if (!manager.ipc) throw new Error('Electron IPC 不可用')

  // 对齐超人逻辑：整批详情，不做小批切片
  const dedup = new Set()
  const candidateList = roomInfoList.filter(item => {
    const roomId = String(item?.roomId || '')
    if (!roomId || dedup.has(roomId)) return false
    dedup.add(roomId)
    return true
  })
  // 优先请求带福袋标记的房间，风控截断时保证先拿高价值目标
  candidateList.sort((a, b) => {
    const aHint = a?.hasLotteryHint === true ? 0 : 1
    const bHint = b?.hasLotteryHint === true ? 0 : 1
    return aHint - bHint
  })
  if (candidateList.length === 0) {
    return { settled: [], stats: { successCount: 0, hardRiskCount: 0, errorCount: 0 } }
  }

  const detailPermitCost = calcDetailPermitCost(candidateList.length, scanProfile)
  let detailPermit = await requestScanPermit(manager, accountId, 'detail', detailPermitCost)
  if (detailPermit.allowed !== true) {
    await manager.sleep(Math.min(9000, Math.max(600, Number(detailPermit.retryAfterMs || 1200))))
    detailPermit = await requestScanPermit(manager, accountId, 'detail', detailPermitCost)
  }
  if (detailPermit.allowed !== true) {
    emitScanDebug(manager, {
      accountId,
      stage: 'detail-batch',
      type: 'permit-denied',
      summary: {
        kind: 'detail',
        requested: candidateList.length,
        cost: detailPermitCost,
        retryAfterMs: Number(detailPermit.retryAfterMs || 0),
        reason: detailPermit.reason || 'rate_limited'
      }
    })
    await manager.sleep(Math.min(12000, Math.max(800, Number(detailPermit.retryAfterMs || 1500))))
    return { settled: [], stats: { successCount: 0, hardRiskCount: 0, errorCount: 0, permitDenied: 1 } }
  }

  /**
   * fetchOne 方法：抓取单个直播间的福袋详情并返回标准化结果。
   */
  const fetchOne = async (roomInfo) => {
    const result = await manager.ipc.invoke('get-lottery-detail', {
      roomId: roomInfo.roomId,
      webRid: roomInfo.webRid,
      accountId
    })

    if (!result.success || !result.lotteryDetail) {
      const errMsg = String(result?.error || '')
      const isHardRisk = result?.code === 'NON_JSON_RESPONSE' && isRiskErrorMessage(errMsg)
      if (result.code === 'NON_JSON_RESPONSE' && !isHardRisk) {
        await manager.sleep(300)
        const retry = await manager.ipc.invoke('get-lottery-detail', {
          roomId: roomInfo.roomId,
          webRid: roomInfo.webRid,
          accountId
        })
        if (retry.success && retry.lotteryDetail) {
          return {
            ...roomInfo,
            ...retry.lotteryDetail,
            fetchedAt: Date.now()
          }
        }
      }
      const err = new Error(result.error || '福袋信息获取失败')
      err.code = result.code || 'DETAIL_FAILED'
      err.statusCode = Number(result?.statusCode || 0)
      if (isHardRisk) {
        console.warn(`[scan] [${accountId}] 详情接口风控: roomId=${roomInfo.roomId}, code=${err.code}, status=${err.statusCode}`)
      }
      throw err
    }

    return {
      ...roomInfo,
      ...result.lotteryDetail,
      fetchedAt: Date.now()
    }
  }

  const concurrency = Math.min(Math.max(1, Number(scanProfile?.detailConcurrency || 2)), candidateList.length)
  const settled = new Array(candidateList.length)
  const stats = { successCount: 0, hardRiskCount: 0, errorCount: 0 }

  /**
   * worker 方法：预分配索引，每个 worker 按固定步长处理自己的分片，避免共享游标。
   */
  const worker = async (startIndex) => {
    for (let index = startIndex; index < candidateList.length; index += concurrency) {
      if (typeof manager?.getTaskStage === 'function' && manager.getTaskStage(accountId) === 'joining') break

      try {
        const value = await fetchOne(candidateList[index])
        settled[index] = { status: 'fulfilled', value }
        stats.successCount += 1
      } catch (reason) {
        settled[index] = { status: 'rejected', reason }
        stats.errorCount += 1
        const code = String(reason?.code || '')
        const message = String(reason?.message || '')
        if (code === 'NON_JSON_RESPONSE' || message.includes('444') || message.includes('Access Denied')) {
          stats.hardRiskCount += 1
        }
      }

      const baseGap = Number(scanProfile?.itemGapMs || 200)
      await manager.sleep(baseGap + Math.floor(Math.random() * 120))
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)))
  return { settled, stats }
}



