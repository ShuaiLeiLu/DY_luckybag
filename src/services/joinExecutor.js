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

export async function autoJoinRedPacketLoop(manager, accountId, accountData, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    if (!manager.accounts.has(accountId) || manager.isPaused(accountId)) return
    const result = await joinRedPacketByUI(manager, accountId)
    if (result?.clickedCount > 0) {
      accountData.callbacks.onLog(`🧧 检测到红包入口并尝试领取 ${result.clickedCount} 次`)
    } else if (result?.skippedRestrictedCount > 0) {
      accountData.callbacks.onLog(`🚫 跳过 ${result.skippedRestrictedCount} 个仅会员/粉丝团可参与红包`)
    } else if (i === 0) {
      accountData.callbacks.onLog('🧧 当前直播间未检测到可抢红包入口')
    }
    await manager.sleep(5000)
  }
}

export async function joinRedPacketByUI(manager, accountId) {
  try {
    const res = await manager.ipc.invoke('execute-script', {
      accountId,
      script: `
        (() => {
          let clickedCount = 0;
          let skippedRestrictedCount = 0;
          const restrictedRe = /(粉丝团|粉丝专属|仅粉丝|仅限粉丝|会员|主播会员|团员|加入粉丝团后可参与|会员可参与)/;

          const safeClick = (el) => {
            if (el && typeof el.click === 'function') {
              el.click();
              clickedCount++;
              return true;
            }
            return false;
          };

          const isRestricted = (el) => {
            try {
              const text = (
                el?.innerText ||
                el?.textContent ||
                el?.closest?.('[class*="redpacket"],[class*="packet"],[class*="popup"],[class*="dialog"]')?.innerText ||
                ''
              ).replace(/\\s+/g, ' ');
              return restrictedRe.test(text);
            } catch (_) {
              return false;
            }
          };

          const shortTouch = document.querySelector('.redpacket-short-touch');
          if (shortTouch) {
            if (isRestricted(shortTouch)) {
              skippedRestrictedCount++;
            } else if (safeClick(shortTouch)) {
              return { clickedCount, skippedRestrictedCount, mode: 'short-touch' };
            }
          }

          try {
            const iframeDoc = document.querySelector('.redpacket iframe')?.contentWindow?.document;
            const entry = iframeDoc?.querySelector('lynx-view')?.shadowRoot?.querySelector('.re-leftPart');
            if (entry) {
              if (isRestricted(entry)) skippedRestrictedCount++;
              else safeClick(entry);
            }
          } catch (_) {}

          try {
            const iframeDoc2 = document.querySelector('#short_touch_land_redpacket_land iframe')?.contentWindow?.document;
            const list = iframeDoc2?.querySelector('lynx-view')?.shadowRoot?.querySelectorAll('lynx-wrapper > x-view') || [];
            list.forEach(item => {
              const canJoin = item
                ?.querySelector('raw-text[text="0"]')
                ?.closest('.scale_container')
                ?.querySelector('.snatch_button_icon_container_exp');
              if (canJoin) {
                if (isRestricted(item) || isRestricted(canJoin)) skippedRestrictedCount++;
                else safeClick(canJoin);
              }
            });
          } catch (_) {}

          return {
            clickedCount,
            skippedRestrictedCount,
            mode: clickedCount > 0 ? 'iframe-scan' : (skippedRestrictedCount > 0 ? 'restricted-skip' : 'none')
          };
        })()
      `
    })
    if (res?.success && res?.result) return res.result
    return { clickedCount: 0, skippedRestrictedCount: 0, mode: 'script-failed' }
  } catch (_) {
    return { clickedCount: 0, skippedRestrictedCount: 0, mode: 'exception' }
  }
}

