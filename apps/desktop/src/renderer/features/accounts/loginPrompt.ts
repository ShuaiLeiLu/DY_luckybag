/**
 * 抖音登录页引导脚本：优先点击“登录/扫码登录”并切换到二维码页签。
 * 该脚本在 BrowserWindow 内执行，因此保持纯字符串导出。
 */
export const DOUYIN_LOGIN_PROMPT_SCRIPT = String.raw`
(() => {
  const normalize = (value) => String(value || '').replace(/\s+/g, '').trim();
  const textOf = (node) => normalize(
    node?.innerText
    || node?.textContent
    || node?.getAttribute?.('aria-label')
    || node?.getAttribute?.('title')
    || ''
  );
  const isVisible = (node) => {
    if (!node || typeof node.getBoundingClientRect !== 'function') return false;
    const style = window.getComputedStyle(node);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
    const rect = node.getBoundingClientRect();
    return rect.width >= 18 && rect.height >= 18 && rect.bottom >= 0 && rect.right >= 0;
  };
  const clickNode = (node) => {
    if (!node) return false;
    try { node.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    try { node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window })); } catch (_) {}
    try { node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })); } catch (_) {}
    try { node.click(); } catch (_) {}
    try { node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })); } catch (_) {}
    return true;
  };

  const bodyText = normalize(document.body?.innerText || '');
  const hasQr = /扫码登录|二维码登录|打开抖音扫码登录|请使用抖音扫码/.test(bodyText)
    || !!document.querySelector('img[src*="qrcode"], img[alt*="二维码"], [class*="qrcode"] img, [class*="qr"] canvas');

  const nodes = Array.from(document.querySelectorAll('button,a,[role="button"],div,span')).filter(isVisible);
  const pickNode = (patterns, options = {}) => {
    let best = null;
    let bestScore = -Infinity;
    nodes.forEach((node) => {
      const text = textOf(node);
      if (!text) return;
      if (!patterns.some((pattern) => pattern.test(text))) return;
      const rect = node.getBoundingClientRect();
      let score = rect.width * rect.height;
      if (options.preferTopRight) {
        score += Math.max(0, window.innerWidth - rect.left) * 0.6;
        score += Math.max(0, 220 - rect.top);
      }
      if (options.preferCentered) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        score -= Math.abs(window.innerWidth / 2 - cx) * 0.2;
        score -= Math.abs(window.innerHeight / 2 - cy) * 0.15;
      }
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    });
    return best;
  };

  const qrTab = pickNode([/扫码登录/, /二维码登录/, /^扫码$/], { preferCentered: true });
  if (hasQr) {
    if (qrTab) clickNode(qrTab);
    return { ok: true, state: 'qr_ready', text: qrTab ? textOf(qrTab) : '' };
  }

  if (qrTab) {
    clickNode(qrTab);
    return { ok: true, state: 'qr_tab_clicked', text: textOf(qrTab) };
  }

  const loginNode = pickNode([/^登录$/, /立即登录/, /去登录/, /账号登录/, /手机号登录/], { preferTopRight: true })
    || pickNode([/登录/], { preferTopRight: true });

  if (loginNode) {
    clickNode(loginNode);
    return { ok: true, state: 'login_clicked', text: textOf(loginNode) };
  }

  return {
    ok: false,
    state: 'login_not_found',
    text: bodyText.slice(0, 120)
  };
})()
`
