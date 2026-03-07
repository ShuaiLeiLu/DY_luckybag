/**
 * 等待直播间页面可用（域名、readyState、body）后再执行后续动作。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {number} timeoutMs 超时时间
 * @returns {Promise<boolean>}
 */
export async function waitForLiveRoomReady(manager, accountId, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = await manager.ipc.invoke('execute-script', {
      accountId,
      script: `
        (() => {
          const hrefOk = location.href.includes('live.douyin.com');
          const stateOk = document.readyState === 'interactive' || document.readyState === 'complete';
          const hasMain = !!document.querySelector('body');
          return hrefOk && stateOk && hasMain;
        })()
      `
    })
    if (result?.success && result?.result === true) {
      return true
    }
    await manager.sleep(350)
  }
  return false
}

/**
 * 预热福袋入口：提前点击可能的入口，降低后续参与按钮找不到的概率。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 */
export async function warmupLotteryEntry(manager, accountId) {
  try {
    await manager.ipc.invoke('execute-script', {
      accountId,
      script: `
        (() => {
          const selectors = [
            '#lottery_close_cotainer div[role="button"]',
            '[data-e2e*="lottery"]',
            '[class*="lottery"] [role="button"]',
            '[class*="benefit"] [role="button"]'
          ];
          for (const s of selectors) {
            const el = document.querySelector(s);
            if (el && typeof el.click === 'function') {
              el.click();
              return { clicked: true, selector: s };
            }
          }
          return { clicked: false };
        })()
      `
    })
  } catch (_) {
    // ignore
  }
}

/**
 * 关闭直播画面渲染，降低CPU/GPU压力并减少后台冻结风险。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @returns {Promise<object>}
 */
export async function closeLiveStreamRendering(manager, accountId) {
  try {
    const res = await manager.ipc.invoke('execute-script', {
      accountId,
      script: `
        (() => {
          try {
            const medias = document.querySelectorAll('video, audio');
            medias.forEach(m => {
              try {
                m.muted = true;
                m.volume = 0;
                if (typeof m.pause === 'function') m.pause();
              } catch (_) {}
            });

            const btns = Array.from(document.querySelectorAll('button, div[role="button"], span'));
            const hit = btns.find(el => {
              const t = (el?.innerText || el?.textContent || '').trim();
              return /(关闭画面|仅听声音|关闭直播流|省流模式)/.test(t);
            });
            if (hit && typeof hit.click === 'function') {
              hit.click();
            }

            const styleId = '__dy_hide_live_stream_style__';
            if (!document.getElementById(styleId)) {
              const style = document.createElement('style');
              style.id = styleId;
              style.textContent = [
                'video { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }',
                '[class*="player"] video, [class*="live-player"] video, [id*="player"] video { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }',
                'canvas[class*="video"], [class*="video-canvas"], canvas[id*="video"] { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }',
                '[class*="player"][class*="container"], [class*="live-player"][class*="container"] { background: #111 !important; }'
              ].join('\\n');
              document.head.appendChild(style);
            }

            const anyVideo = !!document.querySelector('video, canvas[class*="video"], canvas[id*="video"]');
            return { ok: true, anyVideo };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        })()
      `
    })
    return res?.success ? res.result : { ok: false }
  } catch (_) {
    return { ok: false }
  }
}

/**
 * 多次尝试确保直播画面关闭完成。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @returns {Promise<boolean>}
 */
export async function ensureCloseLiveStreamRendering(manager, accountId) {
  for (let i = 0; i < 8; i++) {
    const r = await closeLiveStreamRendering(manager, accountId)
    if (r?.ok && !r?.anyVideo) {
      return true
    }
    await manager.sleep(450)
  }
  return false
}

/**
 * 通过 UI 流程参与福袋（等待入口 -> 点击参与 -> 检查参与态）。
 * @param {object} manager LotteryManager 实例
 * @param {string} accountId 账号ID
 * @param {number} remainingTime 剩余开奖时间（秒）
 * @returns {Promise<{success:boolean, confirmed?:boolean, error?:string}>}
 */
export async function joinLotteryByUI(manager, accountId, remainingTime = 30) {
  const maxEntryWaitMs = Math.max(4000, Math.min(20000, (Number(remainingTime) - 6) * 1000))
  const waitEntryStart = Date.now()
  while (Date.now() - waitEntryStart < maxEntryWaitMs) {
    const res = await manager.ipc.invoke('execute-script', {
      accountId,
      script: `
        (() => {
          const selectors = [
            '.dVxrjT_h',
            '[data-e2e*="lottery"]',
            '#lottery_close_cotainer',
            '[class*="lottery"]'
          ];
          let entry = null;
          let selector = '';
          for (const s of selectors) {
            const el = document.querySelector(s);
            if (el) {
              entry = el;
              selector = s;
              break;
            }
          }
          if (!entry) return { ok: false, step: 'wait-entry' };
          if (typeof entry.click === 'function') entry.click();
          return { ok: true, step: 'entry-ready', selector };
        })()
      `
    })
    if (res?.success && res?.result?.ok) break
    await manager.sleep(500)
  }

  await manager.sleep(1600)

  const waitJoinStart = Date.now()
  while (Date.now() - waitJoinStart < 10000) {
    const joinRes = await manager.ipc.invoke('execute-script', {
      accountId,
      script: `
        (() => {
          const btn = document.querySelector('#lottery_close_cotainer div[role="button"]');
          if (!btn) return { ok: false, step: 'wait-join-btn', text: '' };
          const text = (btn.innerText || btn.textContent || '').trim();
          if (typeof btn.click === 'function') {
            btn.click();
            return { ok: true, step: 'clicked-join-btn', text };
          }
          return { ok: false, step: 'join-btn-not-clickable', text };
        })()
      `
    })
    if (joinRes?.success && joinRes?.result?.ok) {
      await manager.sleep(800)
      const confirmRes = await manager.ipc.invoke('execute-script', {
        accountId,
        script: `
          (() => {
            const panel = document.querySelector('#lottery_close_cotainer') || document.body;
            const txt = (panel?.innerText || '').replace(/\\s+/g, ' ');
            const joined = /已参与|等待开奖|参与成功|已成功参与/.test(txt);
            return { joined, sample: txt.slice(0, 160) };
          })()
        `
      })
      if (confirmRes?.success && confirmRes?.result?.joined) {
        return { success: true, confirmed: true }
      }
      return { success: false, error: '已点击参与按钮但未检测到已参与状态' }
    }
    await manager.sleep(400)
  }
  return { success: false, error: '未找到或无法点击参与按钮' }
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
    if (manager.isPaused(accountId)) break
    if (delays[i] > 0) {
      accountData.callbacks.onLog(`🔁 接口参与重试(${i + 1}/${delays.length})，等待${delays[i]}ms...`)
      await manager.sleep(delays[i])
    }

    if (i > 0) {
      const retryDetail = await manager.ipc.invoke('get-lottery-detail', {
        roomId: lotteryInfo.roomId,
        webRid: lotteryInfo.webRid,
        accountId
      })
      if (retryDetail?.success && retryDetail?.lotteryDetail?.lottery_id) {
        currentLotteryId = retryDetail.lotteryDetail.lottery_id
      }
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
      return { success: true, message: msg, raw: result }
    }

    if (Number(result?.statusCode) === 10001) {
      accountData.callbacks.onLog('⚠️ 接口返回10001（上下文或ID未就绪），继续重试...')
    }
  }

  return lastResult || { success: false, error: '参与失败' }
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
    const openPanelRes = await manager.ipc.invoke('execute-script', {
      accountId,
      script: `
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
      `
    })

    const openResult = (openPanelRes?.success && openPanelRes?.result) ? openPanelRes.result : { clickedCount: 0, skippedRestrictedCount: 0, openedPanel: false }

    if (openResult.openedPanel || openResult.clickedCount > 0) {
      await manager.sleep(900)
    }

    const joinButtonsRes = await manager.ipc.invoke('execute-script', {
      accountId,
      script: `
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
      `
    })

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
