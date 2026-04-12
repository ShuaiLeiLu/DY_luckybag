function listVisibleAccountWindows(browserViews, excludeAccountId = '') {
  return Array.from(browserViews.entries())
    .filter(([accountId, browserData]) => {
      if (excludeAccountId && accountId === excludeAccountId) return false
      if (!browserData?.window || browserData.window.isDestroyed()) return false
      return browserData.window.isVisible()
    })
    .sort((a, b) => Number(a[1]?.lastShownAt || 0) - Number(b[1]?.lastShownAt || 0))
}

function enforceVisibleWindowLimit(browserViews, options = {}) {
  const {
    maxVisibleAccountWindows = 4,
    excludeAccountId = '',
    appendRuntimeEvent = () => {}
  } = options

  const visibleEntries = listVisibleAccountWindows(browserViews, excludeAccountId)
  while (visibleEntries.length >= maxVisibleAccountWindows) {
    const [accountId, browserData] = visibleEntries.shift() || []
    if (!browserData?.window || browserData.window.isDestroyed()) continue
    browserData.window.hide()
    browserData.lastHiddenAt = Date.now()
    browserData.requestedVisible = false
    appendRuntimeEvent('info', `预览位已满，自动隐藏账号 ${accountId}`, 'preview')
  }
}

function revealAccountWindow(browserViews, accountId, options = {}) {
  const {
    maxVisibleAccountWindows = 4,
    appendRuntimeEvent = () => {}
  } = options

  const browserData = browserViews.get(accountId)
  if (!browserData || !browserData.window || browserData.window.isDestroyed()) {
    return { success: false, error: 'browser_window_not_found' }
  }
  enforceVisibleWindowLimit(browserViews, { maxVisibleAccountWindows, excludeAccountId: accountId, appendRuntimeEvent })
  if (browserData.window.isMinimized()) {
    browserData.window.restore()
  }
  browserData.window.setSkipTaskbar(false)
  browserData.requestedVisible = true
  browserData.lastShownAt = Date.now()
  browserData.window.show()
  if (typeof browserData.window.moveTop === 'function') {
    browserData.window.moveTop()
  }
  browserData.window.focus()
  if (typeof browserData.window.moveTop === 'function') {
    browserData.window.moveTop()
  }
  return {
    success: true,
    visible: browserData.window.isVisible(),
    focused: browserData.window.isFocused()
  }
}

function concealAccountWindow(browserViews, accountId) {
  const browserData = browserViews.get(accountId)
  if (!browserData || !browserData.window || browserData.window.isDestroyed()) {
    return { success: false, error: 'browser_window_not_found' }
  }
  browserData.requestedVisible = false
  browserData.lastHiddenAt = Date.now()
  browserData.window.hide()
  return {
    success: true,
    visible: browserData.window.isVisible()
  }
}

module.exports = {
  enforceVisibleWindowLimit,
  revealAccountWindow,
  concealAccountWindow
}
