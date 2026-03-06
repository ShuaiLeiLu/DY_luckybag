function isRiskErrorMessage(message) {
  const text = String(message || '')
  return text.includes('444') || text.includes('NON_JSON') || text.includes('Access Denied')
}

export async function searchLiveByAll(manager, accountId, times = 10, scanProfile = null) {
  const accountData = manager.accounts.get(accountId)
  if (!accountData) return
  if (!manager.ipc) throw new Error('Electron IPC 不可用')

  try {
    for (let i = 0; i < times; i++) {
      if (manager.isPaused(accountId)) break

      try {
        const result = await manager.ipc.invoke('search-live-by-all', {
          accountId,
          customCount: Number(scanProfile?.allCount || scanProfile?.countPerPage || 24)
        })

        if (!result.success) {
          accountData.callbacks.onLog(`第${i + 1}次搜索失败: ${result.error || '未知错误'}`)
          if (isRiskErrorMessage(result.error)) {
            manager.applyScanRiskFeedback(accountId, { hardRiskCount: 1 }, accountData.callbacks.onLog)
          }
          if (result.detail) {
            console.error('[搜索失败详情]', result.detail)
          }
          continue
        }

        if (!result.roomInfoList) {
          accountData.callbacks.onLog(`第${i + 1}次搜索: 返回数据为空`)
          continue
        }

        const roomInfoList = result.roomInfoList
        if (roomInfoList.length === 0) continue

        const detailResult = await getLotteryInfo(manager, roomInfoList, accountId, scanProfile)
        const resList = detailResult.settled
        manager.applyScanRiskFeedback(accountId, detailResult.stats, accountData.callbacks.onLog)
        const validLotteryInfoList = resList
          .filter(item => item.status === 'fulfilled' && item.value)
          .map(item => item.value)

        const filteredList = manager.filterLotteryByConditions(validLotteryInfoList)
        manager.addLotteryInfoWithoutDuplicates(accountId, filteredList)
        manager.calculatePredictedProbabilities(accountId)
        manager.sortLotteriesByProbability(accountId)
        manager.emitLotteryListUpdate(accountData)

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

  const categories = manager.categoryList
  try {
    for (let i = 0; i < categories.length; i++) {
      if (manager.isPaused(accountId)) break

      const category = categories[i]
      try {
        await searchLiveRoomCategory(manager, accountId, {
          category_id: category.id,
          category_name: category.name,
          page: scanProfile?.pagesPerCategory || 10
        }, (batchList) => {
          const filteredList = manager.filterLotteryByConditions(batchList)
          manager.addLotteryInfoWithoutDuplicates(accountId, filteredList)
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

  const totalPages = page || scanProfile?.pagesPerCategory || manager.scanConfig.pagesPerCategory
  const countPerPage = scanProfile?.countPerPage || manager.scanConfig.countPerPage
  const lotteryInfoList = []

  try {
    for (let i = 0; i < totalPages; i++) {
      if (manager.isPaused(accountId)) break

      try {
        const result = await manager.ipc.invoke('search-live-by-category', {
          accountId,
          categoryId: category_id,
          offset: i * countPerPage,
          count: countPerPage
        })

        if (!result.success || !result.roomInfoList) {
          if (!result.success && isRiskErrorMessage(result.error)) {
            manager.applyScanRiskFeedback(accountId, { hardRiskCount: 1 }, accountData.callbacks.onLog)
          }
          continue
        }

        const roomInfoList = result.roomInfoList
        await manager.sleep(Math.max(120, Number(scanProfile?.itemGapMs || 200)))

        const detailResult = await getLotteryInfo(manager, roomInfoList, accountId, scanProfile)
        const resList = detailResult.settled
        manager.applyScanRiskFeedback(accountId, detailResult.stats, accountData.callbacks.onLog)
        const validLotteryInfoList = resList
          .filter(item => item.status === 'fulfilled' && item.value)
          .map(item => item.value)

        lotteryInfoList.push(...validLotteryInfoList)
        if (typeof onBatch === 'function' && validLotteryInfoList.length > 0) {
          onBatch(validLotteryInfoList)
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

  const concurrency = Math.min(Number(scanProfile?.detailConcurrency || 4), roomInfoList.length)
  const settled = new Array(roomInfoList.length)
  const stats = { successCount: 0, hardRiskCount: 0, errorCount: 0 }
  let cursor = 0

  const worker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= roomInfoList.length) break

      try {
        const value = await fetchOne(roomInfoList[index])
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
