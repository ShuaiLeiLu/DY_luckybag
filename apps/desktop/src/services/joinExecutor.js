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
async function executeScriptSafely(manager, accountId, script, timeoutMs = 4500, label = '') {
  if (!manager?.accounts?.has(accountId) || manager.isPaused(accountId)) {
    return { success: false, error: '账号已停止', code: 'ACCOUNT_STOPPED' }
  }
  try {
    const result = await manager.ipc.invoke('execute-script', {
      accountId,
      script,
      timeoutMs: Math.max(1200, Number(timeoutMs || 4500)),
      label: String(label || '')
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
    if (message.includes('页面上下文切换中')) {
      return { success: false, error: '页面上下文切换中', code: 'EXECUTE_CONTEXT_LOST' }
    }
    return { success: false, error: message, code: error?.code || 'EXECUTE_SCRIPT_FAILED' }
  }
}

function formatPercent(value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return '0.00%'
  return `${(num * 100).toFixed(2)}%`
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function extractRequiredCommentText(raw) {
  const text = normalizeText(raw)
  if (!text) return ''
  const normalizeCandidate = (value) => {
    const cleaned = normalizeText(String(value || '').replace(/^[：:;；,，.。!！?？]+|[：:;；,，.。!！?？]+$/g, ''))
    if (!cleaned) return ''
    if (/^(口令|评论|弹幕|发言)$/i.test(cleaned)) return ''
    if (cleaned.length > 24) return cleaned.slice(0, 24)
    return cleaned
  }

  const quotedMatch = text.match(/[“"【\[]([^"”】\]]{1,24})[”"】\]]/)
  if (quotedMatch?.[1]) {
    return normalizeCandidate(quotedMatch[1])
  }

  const keywordMatch = text.match(/(?:评论|弹幕|发言|发送|口令)\s*[:：]?\s*([^\s，,。！？!?;；]{1,24})/i)
  if (keywordMatch?.[1]) {
    return normalizeCandidate(keywordMatch[1])
  }

  if (text.length <= 20 && !/[，,。！？!?\s]/.test(text)) {
    return normalizeCandidate(text)
  }

  return ''
}

function hasFanClubKeyword(text = '') {
  const safe = normalizeText(text)
  if (!safe) return false
  const lower = safe.toLowerCase()
  return (
    /粉丝团|粉丝牌|加团|团员|铁粉/.test(safe) ||
    lower.includes('fanclub') ||
    lower.includes('fans club') ||
    lower.includes('fan club')
  )
}

function hasCommentKeyword(text = '') {
  const safe = normalizeText(text)
  if (!safe) return false
  const lower = safe.toLowerCase()
  return (
    /评论|弹幕|发言|口令|发送口令|发送评论|输入口令/.test(safe) ||
    lower.includes('comment') ||
    lower.includes('chat')
  )
}

function resolveJoinRequirements(lotteryInfo = null) {
  const conditions = Array.isArray(lotteryInfo?.conditions) ? lotteryInfo.conditions : []
  let needFanClub = false
  let needComment = false
  let commentText = ''

  for (const condition of conditions) {
    const typeNum = Number(condition?.type || 0)
    const text = normalizeText([
      condition?.content,
      condition?.desc,
      condition?.description,
      condition?.title,
      condition?.text,
      condition?.name
    ].filter(Boolean).join(' '))
    const isTypeFanClub = typeNum === 2
    const isTypeComment = typeNum === 8 || typeNum === 3

    if (isTypeFanClub || hasFanClubKeyword(text)) {
      needFanClub = true
    }

    // 粉丝团条件文案中经常包含“点亮”等词，容易被误识别成评论口令。
    // 只有明确评论类型，或明确出现评论/口令关键词时才触发评论动作。
    const shouldTreatAsComment =
      isTypeComment ||
      (!isTypeFanClub && hasCommentKeyword(text))
    if (shouldTreatAsComment) {
      needComment = true
      if (!commentText) {
        commentText = extractRequiredCommentText(text)
      }
    }
  }

  return {
    needFanClub,
    needComment,
    commentText: commentText || '666'
  }
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
  `, timeoutMs, 'join.read_joined_state')
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
  const res = await executeScriptSafely(
    manager,
    accountId,
    buildWaitForVisibleSelectorScript(selector, timeoutMs),
    timeoutMs + 1500,
    `join.wait_selector:${selector}`
  )
  if (isBrowserGoneResult(res)) {
    return { success: false, error: '浏览器已关闭，停止参与', code: 'BROWSER_NOT_FOUND' }
  }
  if (res?.code === 'EXECUTE_TIMEOUT') {
    return { success: false, error: '页面脚本超时', code: 'EXECUTE_TIMEOUT' }
  }
  if (res?.code === 'EXECUTE_CONTEXT_LOST') {
    return { success: false, error: '页面上下文切换中', code: 'EXECUTE_CONTEXT_LOST' }
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
  const res = await executeScriptSafely(
    manager,
    accountId,
    buildClickVisibleSelectorScript(selector, timeoutMs),
    timeoutMs + 1500,
    `join.click_selector:${selector}`
  )
  if (isBrowserGoneResult(res)) {
    return { success: false, error: '浏览器已关闭，停止参与', code: 'BROWSER_NOT_FOUND' }
  }
  if (res?.code === 'EXECUTE_TIMEOUT') {
    return { success: false, error: '页面脚本超时', code: 'EXECUTE_TIMEOUT' }
  }
  if (res?.code === 'EXECUTE_CONTEXT_LOST') {
    return { success: false, error: '页面上下文切换中', code: 'EXECUTE_CONTEXT_LOST' }
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

async function clickLotteryEntryFallback(manager, accountId, timeoutMs = 12000) {
  const res = await executeScriptSafely(manager, accountId, `
    (() => new Promise((resolve) => {
      const timeoutMs = ${Math.max(1200, Number(timeoutMs || 12000))};
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el || typeof el.getBoundingClientRect !== 'function') return false;
        const style = window.getComputedStyle(el);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') <= 0.02) return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= 10 && rect.height >= 10;
      };
      const clickNode = (el) => {
        if (!el) return false;
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
        try { if (typeof el.click === 'function') el.click(); } catch (_) {}
        return true;
      };
      const start = Date.now();
      const tick = () => {
        const bySelectors = [
          '.dVxrjT_h',
          '[class*="lottery"]',
          '[class*="benefit"]',
          '[data-e2e*="lottery"]',
          '[data-e2e*="benefit"]'
        ].flatMap((selector) => Array.from(document.querySelectorAll(selector)));
        const byText = Array.from(document.querySelectorAll('button,a,[role="button"],div,span'));
        const candidates = [];
        const seen = new Set();
        [...bySelectors, ...byText].forEach((node) => {
          if (!isVisible(node)) return;
          if (seen.has(node)) return;
          seen.add(node);
          const text = normalize(node.innerText || node.textContent || node.getAttribute?.('aria-label') || node.getAttribute?.('title') || '');
          const className = String(node.className || '');
          const hitText = /(福袋|红包|福利|抽奖|开箱|宝箱|口令)/.test(text);
          const hitClass = /(lottery|benefit|melon|packet)/i.test(className);
          if (!hitText && !hitClass) return;
          const rect = node.getBoundingClientRect();
          const nearTopLeft = rect.top <= 280 && rect.left <= 320;
          const score = (hitText ? 5 : 0) + (hitClass ? 3 : 0) + (nearTopLeft ? 4 : 0) + Math.min(2, (rect.width * rect.height) / 5000);
          candidates.push({ node, text, className, score });
        });

        candidates.sort((a, b) => b.score - a.score);
        const picked = candidates[0];
        if (picked && clickNode(picked.node)) {
          resolve({ ok: true, text: picked.text.slice(0, 60), className: picked.className.slice(0, 120) });
          return;
        }

        if (Date.now() - start >= timeoutMs) {
          resolve({ ok: false, sample: normalize(document.body?.innerText || '').slice(0, 180) });
          return;
        }
        setTimeout(tick, 220);
      };
      tick();
    }))()
  `, timeoutMs + 1800, 'join.click_lottery_entry_fallback')

  if (isBrowserGoneResult(res)) {
    return { success: false, error: '浏览器已关闭，停止参与', code: 'BROWSER_NOT_FOUND' }
  }
  if (res?.code === 'EXECUTE_TIMEOUT') {
    return { success: false, error: '页面脚本超时', code: 'EXECUTE_TIMEOUT' }
  }
  if (res?.code === 'EXECUTE_CONTEXT_LOST') {
    return { success: false, error: '页面上下文切换中', code: 'EXECUTE_CONTEXT_LOST' }
  }
  if (!res?.success || !res?.result || typeof res.result !== 'object') {
    return { success: false, error: '执行脚本失败', code: 'FALLBACK_ENTRY_FAILED' }
  }
  if (res.result.ok !== true) {
    return {
      success: false,
      error: '未找到福袋入口',
      code: 'LOTTERY_ENTRY_NOT_FOUND',
      sample: String(res.result.sample || '')
    }
  }
  return { success: true, ...res.result }
}

async function clickLotteryJoinFallback(manager, accountId, timeoutMs = 10000) {
  const res = await executeScriptSafely(manager, accountId, `
    (() => new Promise((resolve) => {
      const timeoutMs = ${Math.max(1200, Number(timeoutMs || 10000))};
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el || typeof el.getBoundingClientRect !== 'function') return false;
        const style = window.getComputedStyle(el);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') <= 0.02) return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= 10 && rect.height >= 10;
      };
      const clickNode = (el) => {
        if (!el) return false;
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
        try { if (typeof el.click === 'function') el.click(); } catch (_) {}
        return true;
      };
      const actionRe = /(立即参与|参与抽奖|参与福袋|马上参与|点击参与|去参与|报名)/;
      const rejectRe = /(粉丝团|会员|等级|专属|仅限|门槛)/;
      const start = Date.now();
      const tick = () => {
        const root = document.querySelector('#lottery_close_cotainer') || document;
        const nodes = Array.from(root.querySelectorAll('button,[role="button"],a,div,span')).filter(isVisible);
        const candidates = nodes
          .map((node) => {
            const text = normalize(node.innerText || node.textContent || node.getAttribute?.('aria-label') || '');
            if (!actionRe.test(text) || rejectRe.test(text)) return null;
            const rect = node.getBoundingClientRect();
            const score = (root !== document ? 4 : 0) + Math.min(2, (rect.width * rect.height) / 5000);
            return { node, text, score };
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score);

        if (candidates.length > 0 && clickNode(candidates[0].node)) {
          resolve({ ok: true, text: candidates[0].text.slice(0, 60) });
          return;
        }

        if (Date.now() - start >= timeoutMs) {
          resolve({ ok: false, sample: normalize(document.body?.innerText || '').slice(0, 180) });
          return;
        }
        setTimeout(tick, 220);
      };
      tick();
    }))()
  `, timeoutMs + 1800, 'join.click_lottery_join_fallback')

  if (isBrowserGoneResult(res)) {
    return { success: false, error: '浏览器已关闭，停止参与', code: 'BROWSER_NOT_FOUND' }
  }
  if (res?.code === 'EXECUTE_TIMEOUT') {
    return { success: false, error: '页面脚本超时', code: 'EXECUTE_TIMEOUT' }
  }
  if (res?.code === 'EXECUTE_CONTEXT_LOST') {
    return { success: false, error: '页面上下文切换中', code: 'EXECUTE_CONTEXT_LOST' }
  }
  if (!res?.success || !res?.result || typeof res.result !== 'object') {
    return { success: false, error: '执行脚本失败', code: 'FALLBACK_JOIN_FAILED' }
  }
  if (res.result.ok !== true) {
    return {
      success: false,
      error: '未找到参与按钮',
      code: 'JOIN_BUTTON_NOT_FOUND',
      sample: String(res.result.sample || '')
    }
  }
  return { success: true, ...res.result }
}

async function clickCommentJoinShortcut(manager, accountId, timeoutMs = 10000) {
  const res = await executeScriptSafely(manager, accountId, `
    (() => new Promise((resolve) => {
      const timeoutMs = ${Math.max(1200, Number(timeoutMs || 10000))};
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el || typeof el.getBoundingClientRect !== 'function') return false;
        const style = window.getComputedStyle(el);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') <= 0.02) return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= 10 && rect.height >= 10;
      };
      const clickNode = (el) => {
        if (!el) return false;
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
        try {
          if (typeof el.click === 'function') el.click();
          else {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
          return true;
        } catch (_) {
          return false;
        }
      };
      const actionRe = /(一键评论参与福袋|一键评论参与|评论参与福袋|评论参与|发送评论并参与|发送口令并参与|一键口令参与|口令参与|评论后参与|发言后参与)/;
      const start = Date.now();
      const tick = () => {
        const root = document.querySelector('#lottery_close_cotainer') || document;
        const nodes = Array.from(root.querySelectorAll('button,[role="button"],a,div,span')).filter(isVisible);
        const candidates = nodes
          .map((node) => {
            const text = normalize(node.innerText || node.textContent || node.getAttribute?.('aria-label') || '');
            if (!actionRe.test(text)) return null;
            const rect = node.getBoundingClientRect();
            const score = (root !== document ? 4 : 0) + Math.min(3, (rect.width * rect.height) / 5000);
            return { node, text, score };
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score);
        if (candidates.length > 0 && clickNode(candidates[0].node)) {
          resolve({ ok: true, text: candidates[0].text.slice(0, 80) });
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve({ ok: false, sample: normalize(document.body?.innerText || '').slice(0, 180) });
          return;
        }
        setTimeout(tick, 220);
      };
      tick();
    }))()
  `, timeoutMs + 1800, 'join.click_comment_join_shortcut')

  if (isBrowserGoneResult(res)) {
    return { success: false, error: '浏览器已关闭，停止参与', code: 'BROWSER_NOT_FOUND' }
  }
  if (res?.code === 'EXECUTE_TIMEOUT') {
    return { success: false, error: '页面脚本超时', code: 'EXECUTE_TIMEOUT' }
  }
  if (res?.code === 'EXECUTE_CONTEXT_LOST') {
    return { success: false, error: '页面上下文切换中', code: 'EXECUTE_CONTEXT_LOST' }
  }
  if (!res?.success || !res?.result || typeof res.result !== 'object') {
    return { success: false, error: '执行脚本失败', code: 'COMMENT_JOIN_CLICK_FAILED' }
  }
  if (res.result.ok !== true) {
    return {
      success: false,
      error: '未找到评论参与按钮',
      code: 'COMMENT_JOIN_BUTTON_NOT_FOUND',
      sample: String(res.result.sample || '')
    }
  }
  return { success: true, ...res.result }
}

async function joinFanClubByUI(manager, accountId, timeoutMs = 12000) {
  const res = await executeScriptSafely(manager, accountId, `
    (() => new Promise((resolve) => {
      const timeoutMs = ${Math.max(1200, Number(timeoutMs || 12000))};
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el || typeof el.getBoundingClientRect !== 'function') return false;
        const style = window.getComputedStyle(el);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') <= 0.02) return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= 8 && rect.height >= 8;
      };
      const clickNode = (el) => {
        if (!el) return false;
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
        try {
          if (typeof el.click === 'function') {
            el.click();
          } else {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
          return true;
        } catch (_) {
          return false;
        }
      };

      const joinRe = /(加入粉丝团|加入团|去加团|加团|点亮粉丝牌|加入粉丝牌|成为团员|加入粉丝|去点亮|点亮粉丝团)/;
      const fanHintRe = /(粉丝团|粉丝牌|团员|铁粉|点亮)/;
      const genericTaskRe = /(去完成|去达成|去解锁|立即完成|前往完成)/;
      const alreadyRe = /(已加入|已是团员|团员已加入|已点亮|你已加入|已在粉丝团|粉丝团已加入)/;
      const denyRe = /(会员|VIP|vip|订阅|开通)/;

      const readPanelText = () => {
        const root = document.querySelector('#lottery_close_cotainer') || document.body;
        return normalize(root?.innerText || '');
      };

      const initialText = readPanelText();
      if (alreadyRe.test(initialText)) {
        resolve({ ok: true, already: true, sample: initialText.slice(0, 120) });
        return;
      }

      const start = Date.now();
      const tick = () => {
        const root = document.querySelector('#lottery_close_cotainer') || document;
        const nodes = Array.from(root.querySelectorAll('button,[role="button"],a,div,span')).filter(isVisible);
        const candidates = nodes
          .map((node) => {
            const text = normalize(node.innerText || node.textContent || node.getAttribute?.('aria-label') || node.getAttribute?.('title') || '');
            const containerText = normalize(node.parentElement?.innerText || '');
            const directFanTarget = joinRe.test(text);
            const indirectFanTarget = genericTaskRe.test(text) && fanHintRe.test(containerText);
            if (!directFanTarget && !indirectFanTarget) return null;
            if (denyRe.test(text)) return null;
            const rect = node.getBoundingClientRect();
            const score = (root !== document ? 4 : 0)
              + (directFanTarget ? 4 : 1)
              + (fanHintRe.test(containerText) ? 2 : 0)
              + Math.min(3, (rect.width * rect.height) / 5000);
            return { node, text, score };
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score);

        if (candidates.length > 0) {
          const picked = candidates[0];
          if (clickNode(picked.node)) {
            setTimeout(() => {
              const latestText = readPanelText();
              resolve({
                ok: true,
                already: alreadyRe.test(latestText),
                clickedText: picked.text.slice(0, 80),
                sample: latestText.slice(0, 140)
              });
            }, 320);
            return;
          }
        }

        if (Date.now() - start >= timeoutMs) {
          resolve({
            ok: false,
            sample: readPanelText().slice(0, 140)
          });
          return;
        }
        setTimeout(tick, 220);
      };

      tick();
    }))()
  `, timeoutMs + 1500, 'join.join_fanclub')

  if (isBrowserGoneResult(res)) {
    return { success: false, error: '浏览器已关闭，停止参与', code: 'BROWSER_NOT_FOUND' }
  }
  if (res?.code === 'EXECUTE_TIMEOUT') {
    return { success: false, error: '页面脚本超时', code: 'EXECUTE_TIMEOUT' }
  }
  if (res?.code === 'EXECUTE_CONTEXT_LOST') {
    return { success: false, error: '页面上下文切换中', code: 'EXECUTE_CONTEXT_LOST' }
  }
  if (!res?.success || !res?.result || typeof res.result !== 'object') {
    return { success: false, error: '执行加粉丝团脚本失败', code: 'FANCLUB_JOIN_EXEC_FAILED' }
  }
  if (res.result.ok !== true) {
    return {
      success: false,
      error: '未找到加入粉丝团入口',
      code: 'FANCLUB_JOIN_NOT_FOUND',
      sample: String(res.result.sample || '')
    }
  }
  return { success: true, ...res.result }
}

async function sendRequiredComment(manager, accountId, roomId, content, retryDelays = [0, 600, 1200]) {
  const safeRoomId = String(roomId || '').trim()
  const safeContent = normalizeText(content).slice(0, 24)
  if (!safeRoomId) {
    return { success: false, error: 'room_id 缺失，无法发送评论', code: 'COMMENT_ROOM_ID_EMPTY' }
  }
  if (!safeContent) {
    return { success: false, error: '评论内容为空', code: 'COMMENT_CONTENT_EMPTY' }
  }

  let lastError = ''
  for (let i = 0; i < retryDelays.length; i++) {
    if (!manager?.accounts?.has(accountId) || manager.isPaused(accountId)) {
      return { success: false, error: '账号已停止', code: 'ACCOUNT_STOPPED' }
    }
    const delay = Number(retryDelays[i] || 0)
    if (delay > 0) {
      await manager.sleep(delay)
    }
    try {
      const res = await manager.ipc.invoke('room-chat', {
        roomId: safeRoomId,
        content: safeContent,
        accountId
      })
      if (res?.success) {
        return { success: true, content: safeContent, raw: res }
      }
      lastError = String(res?.error || 'room-chat failed')
    } catch (error) {
      lastError = String(error?.message || error || 'room-chat invoke failed')
    }
  }
  return { success: false, error: lastError || '发送评论失败', code: 'COMMENT_SEND_FAILED' }
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
  log?.(`等待最新参与人数后执行二次检查（阈值 ${formatPercent(threshold)}）`)
  await manager.sleep(2000)

  try {
    const snapshot = manager.getLiveLotterySnapshot(accountId, lotteryInfo) || lotteryInfo
    const joinTotal = Number(snapshot?.joinTotal || 0)
    const winningTotal = Number(snapshot?.winningTotal || snapshot?.luckyCount || 0)
    const probability = winningTotal / joinTotal
    if (probability >= threshold) {
      log?.(`二次检查通过：${formatPercent(probability)}`)
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
export async function waitForLiveRoomReady(manager, accountId, timeoutMs = 20000, _options = {}) {
  if (!manager?.accounts?.has(accountId) || manager.isPaused(accountId)) return false

  let waitResult = await waitForVisibleSelector(manager, accountId, '.dVxrjT_h', Math.max(1200, Number(timeoutMs || 20000)))
  if (waitResult?.code === 'EXECUTE_CONTEXT_LOST') {
    await manager.sleep(1200)
    waitResult = await waitForVisibleSelector(manager, accountId, '.dVxrjT_h', Math.max(1200, Number(timeoutMs || 20000)))
  }
  return waitResult?.success === true
}

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
  const currentLotteryId = String(options?.lotteryInfo?.lottery_id || options?.lotteryInfo?.lotteryId || '')
  const accountData = options?.accountData || null
  const onLog = accountData?.callbacks?.onLog

  let waitEntryResult = await waitForVisibleSelector(manager, accountId, '.dVxrjT_h', 20000)
  if (waitEntryResult?.code === 'EXECUTE_CONTEXT_LOST') {
    await manager.sleep(1200)
    waitEntryResult = await waitForVisibleSelector(manager, accountId, '.dVxrjT_h', 20000)
  }
  if (!waitEntryResult?.success) {
    const fallbackEntry = await clickLotteryEntryFallback(manager, accountId, 12000)
    if (!fallbackEntry?.success) {
      return {
        success: false,
        error: waitEntryResult?.error || fallbackEntry?.error || '福袋元素未找到',
        code: waitEntryResult?.code || fallbackEntry?.code || 'LOTTERY_ENTRY_NOT_FOUND'
      }
    }
  }

  let clickEntryResult = await clickVisibleSelector(manager, accountId, '.dVxrjT_h', 20000)
  if (clickEntryResult?.code === 'EXECUTE_CONTEXT_LOST') {
    await manager.sleep(1200)
    clickEntryResult = await clickVisibleSelector(manager, accountId, '.dVxrjT_h', 20000)
  }
  if (!clickEntryResult?.success) {
    const fallbackEntry = await clickLotteryEntryFallback(manager, accountId, 12000)
    if (!fallbackEntry?.success) {
      return {
        success: false,
        error: clickEntryResult?.error || fallbackEntry?.error || '等待福袋出现失败',
        code: clickEntryResult?.code || fallbackEntry?.code || 'LOTTERY_ENTRY_CLICK_FAILED'
      }
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

  const requirements = resolveJoinRequirements(options?.lotteryInfo || null)
  if (requirements.needFanClub || requirements.needComment) {
    onLog?.('🧩 命中福袋前置条件，准备先执行加团/评论')
  }

  if (requirements.needFanClub) {
    onLog?.('👥 检测到粉丝团门槛，尝试先加入粉丝团...')
    const fanJoinResult = await joinFanClubByUI(manager, accountId, 12000)
    if (!fanJoinResult?.success) {
      return {
        success: false,
        error: fanJoinResult?.error || '加入粉丝团失败',
        code: fanJoinResult?.code || 'FANCLUB_JOIN_FAILED'
      }
    }
    if (fanJoinResult?.already) {
      onLog?.('👥 已在粉丝团，跳过加团')
    } else {
      onLog?.('加入粉丝团完成')
    }
    await manager.sleep(360)
  }

  // 先点通用“参与福袋”，评论类门槛会在下一步出现“一键评论参与福袋”之类的确认按钮。
  let clickJoinResult = await clickLotteryJoinFallback(manager, accountId, 10000)
  if (clickJoinResult?.code === 'EXECUTE_CONTEXT_LOST') {
    await manager.sleep(1200)
    clickJoinResult = await clickLotteryJoinFallback(manager, accountId, 10000)
  }
  if (!clickJoinResult?.success) {
    const fallbackJoin = await clickVisibleSelector(manager, accountId, '#lottery_close_cotainer div[role="button"]', 10000)
    if (!fallbackJoin?.success) {
      return {
        success: false,
        error: clickJoinResult?.error || fallbackJoin?.error || '点击参与福袋失败',
        code: clickJoinResult?.code || fallbackJoin?.code || 'JOIN_BUTTON_NOT_FOUND'
      }
    }
  }

  let commentShortcutResult = null
  if (requirements.needComment) {
    await manager.sleep(360)
    commentShortcutResult = await clickCommentJoinShortcut(manager, accountId, 6000)
    if (commentShortcutResult?.success) {
      onLog?.(`已执行评论参与动作：${String(commentShortcutResult?.text || '一键评论参与福袋')}`)
      await manager.sleep(420)
    } else {
      const roomId = String(
        options?.lotteryInfo?.roomId
        || options?.lotteryInfo?.room_id
        || options?.lotteryInfo?.roomIdStr
        || options?.lotteryInfo?.webRid
        || ''
      ).trim()
      const commentText = String(requirements.commentText || '666')
      onLog?.(`未找到一键评论参与按钮，尝试先发送评论：${commentText}`, 'warning')
      const chatResult = await sendRequiredComment(manager, accountId, roomId, commentText)
      if (!chatResult?.success) {
        const errorText = String(chatResult?.error || '评论发送失败')
        onLog?.(`评论发送失败，继续尝试点击评论参与：${errorText}`, 'warning')
      } else {
        onLog?.('评论发送成功')
        await manager.sleep(320)
      }

      commentShortcutResult = await clickCommentJoinShortcut(manager, accountId, 4500)
      if (commentShortcutResult?.success) {
        onLog?.(`已执行评论参与动作：${String(commentShortcutResult?.text || '一键评论参与福袋')}`)
        await manager.sleep(420)
      } else {
        return {
          success: false,
          error: commentShortcutResult?.error || '一键评论参与福袋未执行成功',
          code: commentShortcutResult?.code || 'COMMENT_JOIN_BUTTON_NOT_FOUND'
        }
      }
    }
  }

  if (options?.config?.enableRedPacket?.enabled === true) {
    await joinRedPacketByUI(manager, accountId)
  }

  let confirmJoined = false
  let lastSample = ''
  for (let i = 0; i < 3; i++) {
    if (i > 0) {
      await manager.sleep(650)
    }
    let joinedState = await readLotteryJoinedState(manager, accountId, 4200)
    if (joinedState?.code === 'EXECUTE_CONTEXT_LOST') {
      await manager.sleep(900)
      joinedState = await readLotteryJoinedState(manager, accountId, 4200)
    }
    if (joinedState?.success && joinedState?.joined) {
      confirmJoined = true
      break
    }
    lastSample = String(joinedState?.sample || '')
  }

  if (!confirmJoined && accountData && options?.lotteryInfo) {
    onLog?.('UI未确认参与，继续补一次执行请求...', 'warning')
    const attendResult = await attendLotteryWithRetry(
      manager,
      accountId,
      accountData,
      options.lotteryInfo,
      String(secondInspect?.snapshot?.lottery_id || secondInspect?.snapshot?.lotteryId || currentLotteryId)
    )
    if (attendResult?.success) {
      return {
        success: true,
        confirmed: true,
        lotteryId: String(attendResult?.lotteryId || currentLotteryId),
        sample: String(attendResult?.message || lastSample || ''),
        mode: 'api'
      }
    }
    lastSample = String(attendResult?.error || attendResult?.message || lastSample || '')
    return {
      success: false,
      error: lastSample || '参与失败',
      code: String(attendResult?.code || attendResult?.statusCode || 'ATTEND_FALLBACK_FAILED'),
      lotteryId: String(attendResult?.lotteryId || currentLotteryId),
      sample: lastSample
    }
  }

  return {
    success: true,
    confirmed: confirmJoined,
    lotteryId: String(secondInspect?.snapshot?.lottery_id || secondInspect?.snapshot?.lotteryId || currentLotteryId),
    sample: lastSample,
    mode: 'ui'
  }
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
      accountData.callbacks.onLog('接口返回10001（上下文或ID未就绪），继续重试...')
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
      accountData.callbacks.onLog(`检测到红包入口并尝试领取 ${clickedCount} 次`)
    } else if (skippedRestrictedCount > 0 && i === 0) {
      accountData.callbacks.onLog(`🚫 跳过 ${skippedRestrictedCount} 个仅会员/粉丝团可参与红包`)
    } else if (!loggedNoEntry && i === 0) {
      accountData.callbacks.onLog('当前直播间未检测到可抢红包入口')
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
