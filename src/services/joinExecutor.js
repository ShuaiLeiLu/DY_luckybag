/**
 * 判断脚本执行结果是否表示浏览器实例已关闭。
 * @param {object} result 执行结果
 * @returns {boolean}
 */
function isBrowserGoneResult(result) {
  return result?.success === false && (
    result?.code === 'BROWSER_NOT_FOUND' ||
    String(result?.error || '').includes('浏览器实例不存在')
  )
}

/**
 * executeScriptSafely 方法：在账号仍可运行时执行页面脚本，遇到浏览器关闭立即返回特定错误。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {string} script 页面脚本
 * @returns {Promise<object>}
 */
async function executeScriptSafely(manager, accountId, script, timeoutMs = 4500) {
  if (!manager?.accounts?.has(accountId) || manager.isPaused(accountId)) {
    return { success: false, error: '账号已停止', code: 'ACCOUNT_STOPPED' }
  }
  try {
    const result = await manager.ipc.invoke('execute-script', {
      accountId,
      script,
      timeoutMs: Math.max(1200, Number(timeoutMs || 4500))
    })
    if (isBrowserGoneResult(result)) {
      return { success: false, error: '浏览器实例不存在', code: 'BROWSER_NOT_FOUND' }
    }
    return result || { success: false, error: '执行脚本失败', code: 'EMPTY_RESULT' }
  } catch (error) {
    const message = String(error?.message || error || '执行脚本失败')
    if (message.includes('浏览器实例不存在')) {
      return { success: false, error: '浏览器实例不存在', code: 'BROWSER_NOT_FOUND' }
    }
    if (message.includes('执行脚本超时')) {
      return { success: false, error: '执行脚本超时', code: 'EXECUTE_TIMEOUT' }
    }
    return { success: false, error: message, code: error?.code || 'EXECUTE_SCRIPT_FAILED' }
  }
}

function formatPercent(value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return '0.00%'
  return `${(num * 100).toFixed(2)}%`
}

/**
 * buildWaitForVisibleSelectorScript 方法：在页面内等待 selector 对应元素可见。
 * @param {string} selector CSS 选择器
 * @param {number} timeoutMs 超时时间
 * @returns {string}
 */
function buildWaitForVisibleSelectorScript(selector, timeoutMs = 20000) {
  return `
    (() => new Promise((resolve) => {
      const selector = ${JSON.stringify(String(selector || ''))};
      const timeoutMs = ${Math.max(1200, Number(timeoutMs || 20000))};
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el || typeof el.getBoundingClientRect !== 'function') return false;
        const style = window.getComputedStyle(el);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') <= 0.02) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width >= 8 && rect.height >= 8;
      };
      const describe = (el) => ({
        text: normalize(el?.innerText || el?.textContent || '').slice(0, 80),
        tag: String(el?.tagName || '').toLowerCase(),
        id: String(el?.id || ''),
        className: String(el?.className || '').slice(0, 120)
      });
      const start = Date.now();
      const tick = () => {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          resolve({
            ok: true,
            selector,
            node: describe(el)
          });
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve({
            ok: false,
            selector,
            sample: normalize(document.body?.innerText || '').slice(0, 160)
          });
          return;
        }
        setTimeout(tick, 200);
      };
      tick();
    }))()
  `
}

/**
 * buildClickVisibleSelectorScript 方法：等待 selector 可见后执行点击。
 * @param {string} selector CSS 选择器
 * @param {number} timeoutMs 超时时间
 * @returns {string}
 */
function buildClickVisibleSelectorScript(selector, timeoutMs = 10000) {
  return `
    (() => new Promise((resolve) => {
      const selector = ${JSON.stringify(String(selector || ''))};
      const timeoutMs = ${Math.max(1200, Number(timeoutMs || 10000))};
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el || typeof el.getBoundingClientRect !== 'function') return false;
        const style = window.getComputedStyle(el);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') <= 0.02) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width >= 8 && rect.height >= 8;
      };
      const describe = (el) => ({
        text: normalize(el?.innerText || el?.textContent || '').slice(0, 80),
        tag: String(el?.tagName || '').toLowerCase(),
        id: String(el?.id || ''),
        className: String(el?.className || '').slice(0, 120)
      });
      const start = Date.now();
      const tick = () => {
        const el = document.querySelector(selector);
        if (el && isVisible(el) && typeof el.click === 'function') {
          el.click();
          resolve({
            ok: true,
            selector,
            node: describe(el)
          });
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve({
            ok: false,
            selector,
            sample: normalize(document.body?.innerText || '').slice(0, 180)
          });
          return;
        }
        setTimeout(tick, 200);
      };
      tick();
    }))()
  `
}

async function readLotteryJoinedState(manager, accountId, timeoutMs = 5000) {
  const res = await executeScriptSafely(manager, accountId, `
    (() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const text = normalize((document.querySelector('#lottery_close_cotainer') || document.body)?.innerText || '');
      return {
        joined: /(已参与|等待开奖|参与成功|已成功参与|已报名)/.test(text),
        sample: text.slice(0, 180)
      };
    })()
  `, timeoutMs)
  if (isBrowserGoneResult(res)) {
    return { success: false, error: '浏览器已关闭，停止参与', code: 'BROWSER_NOT_FOUND' }
  }
  if (res?.code === 'EXECUTE_TIMEOUT') {
    return { success: false, error: '页面脚本超时', code: 'EXECUTE_TIMEOUT' }
  }
  if (!res?.success || !res?.result || typeof res.result !== 'object') {
    return { success: false, error: '读取福袋面板状态失败', code: 'READ_PANEL_FAILED' }
  }
  return { success: true, ...res.result }
}

async function waitForVisibleSelector(manager, accountId, selector, timeoutMs) {
  const res = await executeScriptSafely(manager, accountId, buildWaitForVisibleSelectorScript(selector, timeoutMs), timeoutMs + 1500)
  if (isBrowserGoneResult(res)) {
    return { success: false, error: '浏览器已关闭，停止参与', code: 'BROWSER_NOT_FOUND' }
  }
  if (res?.code === 'EXECUTE_TIMEOUT') {
    return { success: false, error: '页面脚本超时', code: 'EXECUTE_TIMEOUT' }
  }
  if (!res?.success || !res?.result || typeof res.result !== 'object') {
    return { success: false, error: '执行脚本失败', code: 'WAIT_SELECTOR_FAILED' }
  }
  if (res.result.ok !== true) {
    return {
      success: false,
      error: '福袋元素未找到',
      code: 'SELECTOR_NOT_FOUND',
      sample: String(res.result.sample || '')
    }
  }
  return { success: true, ...res.result }
}

async function clickVisibleSelector(manager, accountId, selector, timeoutMs) {
  const res = await executeScriptSafely(manager, accountId, buildClickVisibleSelectorScript(selector, timeoutMs), timeoutMs + 1500)
  if (isBrowserGoneResult(res)) {
    return { success: false, error: '浏览器已关闭，停止参与', code: 'BROWSER_NOT_FOUND' }
  }
  if (res?.code === 'EXECUTE_TIMEOUT') {
    return { success: false, error: '页面脚本超时', code: 'EXECUTE_TIMEOUT' }
  }
  if (!res?.success || !res?.result || typeof res.result !== 'object') {
    return { success: false, error: '执行脚本失败', code: 'CLICK_SELECTOR_FAILED' }
  }
  if (res.result.ok !== true) {
    return {
      success: false,
      error: '点击参与福袋失败',
      code: 'SELECTOR_CLICK_FAILED',
      sample: String(res.result.sample || '')
    }
  }
  return { success: true, ...res.result }
}

async function runSecondInspect(manager, accountId, lotteryInfo, config = {}) {
  if (config?.secondInspect?.enabled !== true || !lotteryInfo) {
    return { passed: true }
  }

  const threshold = Number(config?.secondInspect?.value || 0)
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return { passed: true }
  }

  const log = manager.accounts.get(accountId)?.callbacks?.onLog
  log?.(`🧮 等待最新参与人数后执行二次检查（阈值 ${formatPercent(threshold)}）`)
  await manager.sleep(2000)

  try {
    const snapshot = manager.getLiveLotterySnapshot(accountId, lotteryInfo) || lotteryInfo
    const joinTotal = Number(snapshot?.joinTotal || 0)
    const winningTotal = Number(snapshot?.winningTotal || snapshot?.luckyCount || 0)
    const probability = winningTotal / joinTotal
    if (probability >= threshold) {
      log?.(`✅ 二次检查通过：${formatPercent(probability)}`)
      return { passed: true, snapshot }
    }
    return {
      passed: false,
      error: '二次检查概率不满足',
      code: 'SECOND_INSPECT_REJECT',
      snapshot
    }
  } catch (_) {
    return {
      passed: false,
      error: '检查二次概率失败',
      code: 'SECOND_INSPECT_REJECT'
    }
  }
}

/**
 * 等待直播间页面真正渲染完成后再执行后续动作；疑似白板时自动重载一次当前直播间。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {number} timeoutMs 超时时间
 * @returns {Promise<boolean>}
 */
export async function waitForLiveRoomReady(manager, accountId, timeoutMs = 10000) {
  const start = Date.now()
  let reloadedOnce = false

  while (Date.now() - start < timeoutMs) {
    if (!manager.accounts.has(accountId) || manager.isPaused(accountId)) return false
    const result = await executeScriptSafely(manager, accountId, `
      (() => {
        const href = String(location.href || '');
        const hrefOk = href.includes('live.douyin.com');
        const stateOk = document.readyState === 'interactive' || document.readyState === 'complete';
        const body = document.body;
        const style = body ? window.getComputedStyle(body) : null;
        const visible = !!body && style && style.display !== 'none' && style.visibility !== 'hidden';
        const text = String(body?.innerText || '').replace(/\\s+/g, '');
        const elementCount = document.querySelectorAll('body *').length;
        const interactiveCount = document.querySelectorAll('button, a, input, textarea, [role="button"]').length;
        const errorLike = /(服务器开小差了|点击刷新重试|加载失败|刷新重试|请稍后重试|网络错误|页面走丢了|服务异常)/.test(text);
        const liveMarker = /(直播|福袋|关注|聊天|弹幕|在线|说点什么)/.test(text);
        const ready = hrefOk && stateOk && visible && !errorLike && (
          liveMarker ||
          text.length >= 80 ||
          (elementCount >= 40 && interactiveCount >= 3)
        );
        const blankLike = hrefOk && stateOk && visible && text.length < 20 && elementCount <= 8 && interactiveCount <= 1;
        return {
          ready,
          blankLike,
          errorLike,
          href,
          sample: text.slice(0, 120),
          textLength: text.length,
          elementCount,
          interactiveCount
        };
      })()
    `)
    if (isBrowserGoneResult(result)) {
      return false
    }

    const snapshot = result?.success && result?.result && typeof result.result === 'object'
      ? result.result
      : null
    if (snapshot?.ready === true) {
      return true
    }

    if (
      !reloadedOnce &&
      (snapshot?.blankLike === true || snapshot?.errorLike === true) &&
      Date.now() - start >= Math.min(3500, Math.floor(timeoutMs * 0.35))
    ) {
      reloadedOnce = true
      try {
        manager.accounts.get(accountId)?.callbacks?.onLog?.(
          snapshot?.errorLike === true
            ? '⚠️ 直播页加载异常，自动重载一次...'
            : '⚠️ 直播页疑似白板，自动重载一次...',
          'warning'
        )
      } catch (_) {
        // ignore
      }
      const targetUrl = String(snapshot?.href || '').includes('live.douyin.com')
        ? String(snapshot.href)
        : 'https://live.douyin.com'
      try {
        await manager.ipc.invoke('navigate-to', { accountId, url: targetUrl })
      } catch (_) {
        // ignore
      }
      await manager.sleep(900)
      continue
    }

    await manager.sleep(snapshot?.blankLike || snapshot?.errorLike ? 520 : 350)
  }
  return false
}

/**
 * 关闭直播画面渲染，使用最保守的静音/暂停策略，避免切房后页面进入白板态。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @returns {Promise<object>}
 */
export async function closeLiveStreamRendering(manager, accountId) {
  return { ok: true, disabled: true }
}

/**
 * 恢复直播画面渲染，重新请求播放当前页面里的媒体元素。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @returns {Promise<object>}
 */
export async function openLiveStreamRendering(manager, accountId) {
  return { ok: true, disabled: true }
}

/**
 * 多次尝试确保直播画面关闭完成。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @returns {Promise<boolean>}
 */
export async function ensureCloseLiveStreamRendering(manager, accountId) {
  return true
}

/**
 * 通过 UI 流程参与福袋（等待入口 -> 点击参与 -> 检查参与态）。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {number} remainingTime 剩余开奖时间（秒）
 * @returns {Promise<{success:boolean, confirmed?:boolean, error?:string, code?:string}>}
 */
export async function joinLotteryByUI(manager, accountId, remainingTime = 30, options = {}) {
  const waitEntryResult = await waitForVisibleSelector(manager, accountId, '.dVxrjT_h', 20000)
  if (!waitEntryResult?.success) {
    if (waitEntryResult?.code === 'ACCOUNT_STOPPED' || waitEntryResult?.code === 'BROWSER_NOT_FOUND') {
      return { success: false, error: waitEntryResult.error, code: waitEntryResult.code }
    }
    const suffix = waitEntryResult?.sample ? `（面板采样: ${String(waitEntryResult.sample).slice(0, 80)}）` : ''
    return {
      success: false,
      error: `${waitEntryResult.error || '等待福袋出现失败'}${suffix}`,
      code: 'LOTTERY_ENTRY_NOT_FOUND'
    }
  }
  const clickEntryResult = await clickVisibleSelector(manager, accountId, '.dVxrjT_h', 10000)
  if (!clickEntryResult?.success) {
    if (clickEntryResult?.code === 'ACCOUNT_STOPPED' || clickEntryResult?.code === 'BROWSER_NOT_FOUND') {
      return { success: false, error: clickEntryResult.error, code: clickEntryResult.code }
    }
    const suffix = clickEntryResult?.sample ? `（面板采样: ${String(clickEntryResult.sample).slice(0, 80)}）` : ''
    return {
      success: false,
      error: `${clickEntryResult.error || '等待福袋出现失败'}${suffix}`,
      code: 'LOTTERY_ENTRY_CLICK_FAILED'
    }
  }

  const secondInspect = await runSecondInspect(
    manager,
    accountId,
    options?.lotteryInfo || null,
    options?.config || {}
  )
  if (!secondInspect?.passed) {
    return {
      success: false,
      error: secondInspect.error || '二次检查未通过',
      code: secondInspect.code || 'SECOND_INSPECT_REJECT'
    }
  }

  const clickJoinResult = await clickVisibleSelector(manager, accountId, '#lottery_close_cotainer div[role="button"]', 10000)
  if (!clickJoinResult?.success) {
    const suffix = clickJoinResult?.sample ? `（面板采样: ${String(clickJoinResult.sample).slice(0, 80)}）` : ''
    return {
      success: false,
      error: `点击参与福袋失败${suffix}`,
      code: clickJoinResult.code || 'JOIN_BUTTON_NOT_FOUND'
    }
  }
  return {
    success: true,
    confirmed: false,
    lotteryId: String(secondInspect?.snapshot?.lottery_id || secondInspect?.snapshot?.lotteryId || options?.lotteryInfo?.lottery_id || '')
  }
}

/**
 * 判断接口返回是否可视为“已参与成功”。
 * @param {object} result 接口响应
 * @returns {boolean}
 */
export function isAttendSuccessLike(result) {
  if (!result) return false
  if (result.success === true) return true
  const text = [
    result?.error,
    result?.extra?.error_msg,
    result?.data?.toast,
    result?.data?.prompt
  ].filter(Boolean).join(' ')
  return /已参与|已经参与|重复参与|请勿重复/.test(text)
}

/**
 * 接口参与福袋（含重试与 lottery_id 刷新）。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {object} accountData 账号运行态
 * @param {object} lotteryInfo 福袋信息
 * @param {string} initialLotteryId 初始福袋ID
 * @returns {Promise<object>}
 */
export async function attendLotteryWithRetry(manager, accountId, accountData, lotteryInfo, initialLotteryId) {
  let currentLotteryId = initialLotteryId
  let lastResult = null
  const delays = [0, 1200, 2200]

  for (let i = 0; i < delays.length; i++) {
    if (!manager.accounts.has(accountId) || manager.isPaused(accountId)) break
    if (delays[i] > 0) {
      accountData.callbacks.onLog(`🔁 接口参与重试(${i + 1}/${delays.length})，等待${delays[i]}ms...`)
      await manager.sleep(delays[i])
    }

    if (!manager.accounts.has(accountId) || manager.isPaused(accountId)) break
    const waitEntryResult = await waitForVisibleSelector(manager, accountId, '.dVxrjT_h', 1800)
    if (waitEntryResult?.success) {
      const joinedState = await readLotteryJoinedState(manager, accountId, 3000)
      if (joinedState?.success && joinedState?.joined) {
        return { success: true, message: '🎁 UI参与成功（面板已确认）', raw: joinedState, lotteryId: currentLotteryId }
      }
    }

    const retryDetail = await manager.ipc.invoke('get-lottery-detail', {
      roomId: lotteryInfo.roomId,
      webRid: lotteryInfo.webRid,
      accountId
    })
    if (retryDetail?.success && retryDetail?.lotteryDetail?.lottery_id) {
      currentLotteryId = retryDetail.lotteryDetail.lottery_id
    }

    const result = await manager.ipc.invoke('attend-lottery', {
      roomId: lotteryInfo.roomId,
      lotteryId: currentLotteryId,
      webRid: lotteryInfo.webRid,
      accountId
    })
    lastResult = result

    if (isAttendSuccessLike(result)) {
      const msg = i === 0 ? '🎁 接口参与成功' : `🎁 接口重试后参与成功(第${i + 1}次)`
      return { success: true, message: msg, raw: result, lotteryId: currentLotteryId }
    }

    if (Number(result?.statusCode) === 10001) {
      accountData.callbacks.onLog('⚠️ 接口返回10001（上下文或ID未就绪），继续重试...')
    }
  }

  return lastResult
    ? { ...lastResult, lotteryId: currentLotteryId }
    : { success: false, error: '参与失败', lotteryId: currentLotteryId }
}

/**
 * 自动红包循环：在房间内多轮检测并尝试领取红包。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {object} accountData 账号运行态
 * @param {number} rounds 轮次数
 * @returns {Promise<{clickedCount:number, skippedRestrictedCount:number}|undefined>}
 */
export async function autoJoinRedPacketLoop(manager, accountId, accountData, rounds = 4) {
  const totalRounds = Math.max(1, Number(rounds) || 4)
  let totalClicked = 0
  let totalSkippedRestricted = 0
  let loggedNoEntry = false

  for (let i = 0; i < totalRounds; i++) {
    if (!manager.accounts.has(accountId) || manager.isPaused(accountId)) return
    const result = await joinRedPacketByUI(manager, accountId)
    if (result?.mode === 'browser-closed' || result?.mode === 'account-stopped') {
      return { clickedCount: totalClicked, skippedRestrictedCount: totalSkippedRestricted }
    }
    const clickedCount = Number(result?.clickedCount || 0)
    const skippedRestrictedCount = Number(result?.skippedRestrictedCount || 0)
    totalClicked += clickedCount
    totalSkippedRestricted += skippedRestrictedCount

    if (clickedCount > 0) {
      accountData.callbacks.onLog(`🧧 检测到红包入口并尝试领取 ${clickedCount} 次`)
    } else if (skippedRestrictedCount > 0 && i === 0) {
      accountData.callbacks.onLog(`🚫 跳过 ${skippedRestrictedCount} 个仅会员/粉丝团可参与红包`)
    } else if (!loggedNoEntry && i === 0) {
      accountData.callbacks.onLog('🧧 当前直播间未检测到可抢红包入口')
      loggedNoEntry = true
    }

    if (i < totalRounds - 1) {
      const jitter = Math.floor(Math.random() * 700)
      const delay = Math.min(5600, 1900 + i * 600 + jitter)
      await manager.sleep(delay)
    }
  }

  return { clickedCount: totalClicked, skippedRestrictedCount: totalSkippedRestricted }
}

/**
 * 通过 UI 两阶段领取红包（先开面板，再点领取按钮），并过滤会员/粉丝团红包。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @returns {Promise<{clickedCount:number, skippedRestrictedCount:number, mode:string}>}
 */
export async function joinRedPacketByUI(manager, accountId) {
  const restrictedRe = '(粉丝团|粉丝专属|仅粉丝|仅限粉丝|铁粉|铁粉专属|团员|加团|加入粉丝团|加入团|会员|仅会员|会员专属|会员可参与|主播会员|VIP|vip|订阅后可参与|需订阅)'

  try {
    if (!manager.accounts.has(accountId) || manager.isPaused(accountId)) {
      return { clickedCount: 0, skippedRestrictedCount: 0, mode: 'account-stopped' }
    }

    const openPanelRes = await executeScriptSafely(manager, accountId, `
        (() => {
          let clickedCount = 0
          let skippedRestrictedCount = 0
          let openedPanel = false
          const restrictedRe = new RegExp('${restrictedRe}', 'i')

          // safeText 方法：清洗文本并压缩空白，降低文案匹配误差。
          const safeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
          // extractText 方法：提取元素及其上下文文本，用于规则匹配。
          const extractText = (el) => {
            if (!el) return ''
            return safeText([
              el.innerText,
              el.textContent,
              el.getAttribute && el.getAttribute('title'),
              el.getAttribute && el.getAttribute('aria-label'),
              el.dataset ? Object.values(el.dataset).join(' ') : '',
              el.closest && el.closest('[class*="redpacket"],[class*="packet"],[class*="dialog"],[class*="popup"]')?.innerText
            ].filter(Boolean).join(' '))
          }
          // isRestricted 方法：判断元素是否命中会员/粉丝团等受限规则。
          const isRestricted = (el) => restrictedRe.test(extractText(el))
          // safeClick 方法：以 click/事件回退方式安全触发点击操作。
          const safeClick = (el) => {
            if (!el) return false
            try {
              if (typeof el.click === 'function') el.click()
              else {
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
                el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
              }
              clickedCount++
              return true
            } catch (_) {
              return false
            }
          }

          const shortTouch = document.querySelector('.redpacket-short-touch')
          if (shortTouch) {
            if (isRestricted(shortTouch)) skippedRestrictedCount++
            else openedPanel = safeClick(shortTouch) || openedPanel
          }

          try {
            const iframeDoc = document.querySelector('.redpacket iframe')?.contentWindow?.document
            const entry = iframeDoc?.querySelector('lynx-view')?.shadowRoot?.querySelector('.re-leftPart')
            if (entry) {
              if (isRestricted(entry)) skippedRestrictedCount++
              else openedPanel = safeClick(entry) || openedPanel
            }
          } catch (_) {}

          return { clickedCount, skippedRestrictedCount, openedPanel, mode: openedPanel ? 'entry-opened' : 'none' }
        })()
      `)
    if (isBrowserGoneResult(openPanelRes)) {
      return { clickedCount: 0, skippedRestrictedCount: 0, mode: 'browser-closed' }
    }

    const openResult = (openPanelRes?.success && openPanelRes?.result) ? openPanelRes.result : { clickedCount: 0, skippedRestrictedCount: 0, openedPanel: false }

    if (openResult.openedPanel || openResult.clickedCount > 0) {
      await manager.sleep(900)
    }

    if (!manager.accounts.has(accountId) || manager.isPaused(accountId)) {
      return { clickedCount: 0, skippedRestrictedCount: 0, mode: 'account-stopped' }
    }

    const joinButtonsRes = await executeScriptSafely(manager, accountId, `
        (() => {
          let clickedCount = 0
          let skippedRestrictedCount = 0
          const restrictedRe = new RegExp('${restrictedRe}', 'i')
          const actionRe = /(抢|领取|领|开|参与|立即|马上)/

          // safeText 方法：清洗文本并压缩空白，降低文案匹配误差。
          const safeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
          // extractText 方法：提取元素及其上下文文本，用于规则匹配。
          const extractText = (el) => {
            if (!el) return ''
            return safeText([
              el.innerText,
              el.textContent,
              el.getAttribute && el.getAttribute('title'),
              el.getAttribute && el.getAttribute('aria-label'),
              el.dataset ? Object.values(el.dataset).join(' ') : '',
              el.outerHTML ? String(el.outerHTML).slice(0, 300) : '',
              el.closest && el.closest('[class*="redpacket"],[class*="packet"],[class*="dialog"],[class*="popup"]')?.innerText
            ].filter(Boolean).join(' '))
          }
          // isRestricted 方法：判断元素是否命中会员/粉丝团等受限规则。
          const isRestricted = (el) => restrictedRe.test(extractText(el))
          // safeClick 方法：以 click/事件回退方式安全触发点击操作。
          const safeClick = (el) => {
            if (!el) return false
            try {
              if (typeof el.click === 'function') el.click()
              else {
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
                el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
              }
              clickedCount++
              return true
            } catch (_) {
              return false
            }
          }

          // collectFromRoot 方法：在指定根节点收集可领取红包入口并执行过滤点击。
          const collectFromRoot = (root) => {
            if (!root || !root.querySelectorAll) return
            const nodes = root.querySelectorAll('.snatch_button_icon_container_exp, .snatch_button_icon_container, [class*="snatch_button"], [class*="redpacket"] [role="button"], [class*="packet"] [role="button"], [class*="redpacket"] button, [class*="packet"] button')
            nodes.forEach((node) => {
              const text = extractText(node)
              if (!actionRe.test(text) && !/snatch_button/i.test(String(node.className || ''))) return
              const parent = node.closest && node.closest('x-view, div, section, article')
              if (isRestricted(node) || isRestricted(parent)) {
                skippedRestrictedCount++
                return
              }
              safeClick(node)
            })
          }

          try {
            const iframeDoc2 = document.querySelector('#short_touch_land_redpacket_land iframe')?.contentWindow?.document
            const shadowRoot = iframeDoc2?.querySelector('lynx-view')?.shadowRoot
            const list = shadowRoot?.querySelectorAll('lynx-wrapper > x-view') || []
            list.forEach((item) => {
              const canJoin = item
                ?.querySelector('raw-text[text="0"]')
                ?.closest('.scale_container')
                ?.querySelector('.snatch_button_icon_container_exp')
              if (!canJoin) return
              if (isRestricted(item) || isRestricted(canJoin)) {
                skippedRestrictedCount++
              } else {
                safeClick(canJoin)
              }
            })
            collectFromRoot(shadowRoot)
          } catch (_) {}

          collectFromRoot(document)
          return { clickedCount, skippedRestrictedCount, mode: clickedCount > 0 ? 'joined' : (skippedRestrictedCount > 0 ? 'restricted-skip' : 'none') }
        })()
      `)
    if (isBrowserGoneResult(joinButtonsRes)) {
      return { clickedCount: 0, skippedRestrictedCount: 0, mode: 'browser-closed' }
    }

    const joinResult = (joinButtonsRes?.success && joinButtonsRes?.result) ? joinButtonsRes.result : { clickedCount: 0, skippedRestrictedCount: 0, mode: 'join-script-failed' }
    const clickedCount = Number(openResult.clickedCount || 0) + Number(joinResult.clickedCount || 0)
    const skippedRestrictedCount = Number(openResult.skippedRestrictedCount || 0) + Number(joinResult.skippedRestrictedCount || 0)
    const mode = clickedCount > 0
      ? 'joined'
      : (skippedRestrictedCount > 0 ? 'restricted-skip' : (joinResult.mode || openResult.mode || 'none'))

    return { clickedCount, skippedRestrictedCount, mode }
  } catch (_) {
    return { clickedCount: 0, skippedRestrictedCount: 0, mode: 'exception' }
  }
}
