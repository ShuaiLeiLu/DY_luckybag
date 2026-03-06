function isRiskErrorMessage(message) {
  const text = String(message || '')
  return text.includes('444') || text.includes('NON_JSON') || text.includes('Access Denied')
}

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toPositiveInt(value, fallback = 0) {
  const n = Math.floor(toNumber(value, fallback))
  return n > 0 ? n : fallback
}

function shouldBreakForRiskCooldown(manager, accountId, onLog) {
  const profile = manager.getAdaptiveScanProfile(accountId)
  const remainMs = Number(profile?.cooldownRemainMs || 0)
  const level = Number(profile?.level || 0)
  // 仅在高风控等级才中断本轮，避免低等级时扫描过少
  if (remainMs <= 0 || level < 2) return false
  if (typeof onLog === 'function') {
    const sec = Math.ceil(remainMs / 1000)
    onLog(`🛡️ 命中风控，立即结束当轮扫描，冷却${sec}秒后继续`, 'warning')
  }
  return true
}

export async function searchLiveByAll(manager, accountId, times = 10, scanProfile = null) {
  const accountData = manager.accounts.get(accountId)
  if (!accountData) return
  if (!manager.ipc) throw new Error('Electron IPC 不可用')
  const config = accountData.config || {}
  const defaultRounds = Math.max(1, toPositiveInt(times, 10))
  const allTimes = Math.max(1, toPositiveInt(scanProfile?.allTimes, defaultRounds))
  const maxAllRounds = Math.max(allTimes, toPositiveInt(scanProfile?.maxAllRounds, allTimes))
  const noGrowthBreakRounds = Math.max(4, toPositiveInt(scanProfile?.noGrowthBreakRounds, Math.max(8, Math.ceil(allTimes / 2))))
  const allCount = Math.max(8, toPositiveInt(scanProfile?.allCount, toPositiveInt(scanProfile?.countPerPage, 24)))
  const seenRoomIds = new Set()
  let cursorMaxTime = null
  let noGrowthRounds = 0

  try {
    for (let i = 0; i < maxAllRounds; i++) {
      if (manager.isPaused(accountId)) break
      if (toPositiveInt(scanProfile?.deadlineMs, 0) > 0 && Date.now() >= Number(scanProfile.deadlineMs)) break

      try {
        const result = await manager.ipc.invoke('search-live-by-all', {
          accountId,
          customCount: allCount,
          maxTime: Number(cursorMaxTime || 0) > 0 ? Number(cursorMaxTime) : undefined
        })

        if (!result.success) {
          accountData.callbacks.onLog(`第${i + 1}次搜索失败: ${result.error || '未知错误'}`)
          noGrowthRounds += 1
          if (isRiskErrorMessage(result.error)) {
            manager.applyScanRiskFeedback(accountId, { hardRiskCount: 1 }, accountData.callbacks.onLog)
            if (shouldBreakForRiskCooldown(manager, accountId, accountData.callbacks.onLog)) {
              break
            }
          }
          if (result.detail) {
            console.error('[搜索失败详情]', result.detail)
          }
          if (noGrowthRounds >= noGrowthBreakRounds) break
          continue
        }

        if (!Array.isArray(result.roomInfoList)) {
          accountData.callbacks.onLog(`第${i + 1}次搜索: 返回数据为空`)
          noGrowthRounds += 1
          if (noGrowthRounds >= noGrowthBreakRounds) break
          continue
        }

        const roomInfoList = result.roomInfoList.filter(item => {
          const roomId = String(item?.roomId || '')
          if (!roomId || seenRoomIds.has(roomId)) return false
          seenRoomIds.add(roomId)
          return true
        })
        if (roomInfoList.length === 0) {
          noGrowthRounds += 1
        } else {
          const beforeCount = manager.getAccountLotteryList(accountId).length
          const detailResult = await getLotteryInfo(manager, roomInfoList, accountId, scanProfile)
          const resList = detailResult.settled
          manager.applyScanRiskFeedback(accountId, detailResult.stats, accountData.callbacks.onLog)
          if (detailResult.stats.hardRiskCount > 0 && shouldBreakForRiskCooldown(manager, accountId, accountData.callbacks.onLog)) {
            break
          }
          const validLotteryInfoList = resList
            .filter(item => item.status === 'fulfilled' && item.value)
            .map(item => item.value)

          const filteredList = manager.filterLotteryByConditions(validLotteryInfoList, config)
          manager.addLotteryInfoWithoutDuplicates(accountId, filteredList)
          await manager.syncServerPoolCandidates(accountId, filteredList)
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

        const nextMaxTime = toPositiveInt(result?.nextMaxTime, 0)
        const hasMore = result?.hasMore === true && nextMaxTime > 0
        if (hasMore && nextMaxTime !== Number(cursorMaxTime || 0)) {
          cursorMaxTime = nextMaxTime
        } else if (!hasMore) {
          cursorMaxTime = null
        }

        if (noGrowthRounds >= noGrowthBreakRounds) {
          break
        }

        // 没有更多分页且本轮无新增，提前结束
        if (!hasMore && noGrowthRounds >= Math.max(3, Math.floor(noGrowthBreakRounds / 2))) {
          break
        }

        const minDelay = Number(scanProfile?.cycleDelayMinMs || 500)
        const maxDelay = Number(scanProfile?.cycleDelayMaxMs || 1500)
        const randomDelay = Math.floor(Math.random() * Math.max(0, maxDelay - minDelay + 1)) + minDelay
        await manager.sleep(randomDelay)
      } catch (error) {
        accountData.callbacks.onLog(`第${i + 1}次搜索出错: ${error.message}`)
        console.error('[搜索异常]', error)
      }
    }
  } catch (error) {
    accountData.callbacks.onLog(`全部搜索异常: ${error.message}`)
    console.error('[全部搜索异常]', error)
  }
}

export async function startCollectLive(manager, accountId, scanProfile = null) {
  const accountData = manager.accounts.get(accountId)
  if (!accountData) return
  const config = accountData.config || {}

  const categories = manager.categoryList
  if (!Array.isArray(categories) || categories.length === 0) return

  try {
    for (let i = 0; i < categories.length; i++) {
      if (manager.isPaused(accountId)) break
      if (toPositiveInt(scanProfile?.deadlineMs, 0) > 0 && Date.now() >= Number(scanProfile.deadlineMs)) break

      const category = categories[i]
      const profilePages = toNumber(scanProfile?.pagesPerCategory, NaN)
      const managerPages = toNumber(manager.scanConfig?.pagesPerCategory, 10)
      const pageCount = Number.isFinite(profilePages) ? profilePages : managerPages
      try {
        await searchLiveRoomCategory(manager, accountId, {
          category_id: category.id,
          category_name: category.name,
          page: pageCount
        }, (batchList) => {
          const filteredList = manager.filterLotteryByConditions(batchList, config)
          manager.addLotteryInfoWithoutDuplicates(accountId, filteredList)
          manager.syncServerPoolCandidates(accountId, filteredList).catch(() => {})
          manager.calculatePredictedProbabilities(accountId)
          manager.sortLotteriesByProbability(accountId)
          manager.emitLotteryListUpdate(accountData)
        }, scanProfile)

        const minDelay = Number(scanProfile?.cycleDelayMinMs || 500)
        const maxDelay = Number(scanProfile?.cycleDelayMaxMs || 1500)
        const randomDelay = Math.floor(Math.random() * Math.max(0, maxDelay - minDelay + 1)) + minDelay
        await manager.sleep(randomDelay)
      } catch (error) {
        accountData.callbacks.onLog(`【${category.name}】分类采集出错: ${error.message}`)
      }
    }
  } catch (error) {
    accountData.callbacks.onLog(`分类搜索异常: ${error.message}`)
  }
}

export async function searchLiveRoomCategory(
  manager,
  accountId,
  { category_id, category_name, page = null },
  onBatch = null,
  scanProfile = null
) {
  const accountData = manager.accounts.get(accountId)
  if (!accountData) return []
  if (!manager.ipc) throw new Error('Electron IPC 不可用')

  const pageNum = toNumber(page, NaN)
  const autoPaging = !Number.isFinite(pageNum) || pageNum <= 0
  const totalPages = autoPaging ? Math.max(1, toPositiveInt(scanProfile?.maxCategoryPages, 240)) : Math.max(1, Math.floor(pageNum))
  const countPerPage = Math.max(10, toPositiveInt(scanProfile?.countPerPage, toPositiveInt(manager.scanConfig.countPerPage, 15)))
  const noGrowthBreakPages = Math.max(4, toPositiveInt(scanProfile?.categoryNoGrowthBreakPages, 10))
  const lotteryInfoList = []
  const seenRoomIds = new Set()
  let offset = countPerPage
  let noGrowthPages = 0

  try {
    for (let i = 0; i < totalPages; i++) {
      if (manager.isPaused(accountId)) break
      if (toPositiveInt(scanProfile?.deadlineMs, 0) > 0 && Date.now() >= Number(scanProfile.deadlineMs)) break

      try {
        const result = await manager.ipc.invoke('search-live-by-category', {
          accountId,
          categoryId: category_id,
          // 沿用超人偏移习惯：从第2页起拉取，减少首页重复
          offset,
          count: countPerPage
        })

        if (!result.success || !result.roomInfoList) {
          noGrowthPages += 1
          if (!result.success && isRiskErrorMessage(result.error)) {
            manager.applyScanRiskFeedback(accountId, { hardRiskCount: 1 }, accountData.callbacks.onLog)
            if (shouldBreakForRiskCooldown(manager, accountId, accountData.callbacks.onLog)) {
              break
            }
          }
          if (autoPaging && noGrowthPages >= noGrowthBreakPages) break
          continue
        }

        const roomInfoList = result.roomInfoList.filter(item => {
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
        await manager.sleep(Math.max(120, Number(scanProfile?.itemGapMs || 200)))

        const detailResult = await getLotteryInfo(manager, roomInfoList, accountId, scanProfile)
        const resList = detailResult.settled
        manager.applyScanRiskFeedback(accountId, detailResult.stats, accountData.callbacks.onLog)
        if (detailResult.stats.hardRiskCount > 0 && shouldBreakForRiskCooldown(manager, accountId, accountData.callbacks.onLog)) {
          break
        }
        const validLotteryInfoList = resList
          .filter(item => item.status === 'fulfilled' && item.value)
          .map(item => item.value)

        lotteryInfoList.push(...validLotteryInfoList)
        if (typeof onBatch === 'function' && validLotteryInfoList.length > 0) {
          onBatch(validLotteryInfoList)
        }

        const nextOffset = toPositiveInt(result?.nextOffset, 0)
        if (nextOffset > offset) {
          offset = nextOffset
        } else {
          offset += countPerPage
        }

        const hasMore = result?.hasMore !== false && toNumber(result?.rawCount, roomInfoList.length) > 0
        if (autoPaging) {
          if (!hasMore) break
          if (noGrowthPages >= noGrowthBreakPages) break
        }
      } catch (_) {
        // 跳过错误页，继续下一页
      }
    }
  } catch (error) {
    accountData.callbacks.onLog(`分类搜索异常: ${error.message}`)
  }

  return lotteryInfoList
}

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
  if (candidateList.length === 0) {
    return { settled: [], stats: { successCount: 0, hardRiskCount: 0, errorCount: 0 } }
  }

  const fetchOne = async (roomInfo) => {
    const result = await manager.ipc.invoke('get-lottery-detail', {
      roomId: roomInfo.roomId,
      webRid: roomInfo.webRid,
      accountId
    })

    if (!result.success || !result.lotteryDetail) {
      if (result.code === 'NON_JSON_RESPONSE') {
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
      throw err
    }

    return {
      ...roomInfo,
      ...result.lotteryDetail,
      fetchedAt: Date.now()
    }
  }

  const concurrency = Math.min(Number(scanProfile?.detailConcurrency || 6), candidateList.length)
  const settled = new Array(candidateList.length)
  const stats = { successCount: 0, hardRiskCount: 0, errorCount: 0 }
  let cursor = 0

  const worker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= candidateList.length) break

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

      const baseGap = Number(scanProfile?.itemGapMs || 80)
      await manager.sleep(baseGap + Math.floor(Math.random() * 120))
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return { settled, stats }
}
