
      window.__desktopBootFallback = function (title, message, detail) {
        var titleEl = document.getElementById('boot-fallback-title')
        var messageEl = document.getElementById('boot-fallback-message')
        var detailEl = document.getElementById('boot-fallback-detail')
        if (titleEl) titleEl.textContent = title || '桌面端启动中'
        if (messageEl) messageEl.textContent = message || '正在加载页面资源，请稍候。'
        if (detailEl) {
          var safeDetail = String(detail || '').trim()
          detailEl.textContent = safeDetail
          detailEl.style.display = safeDetail ? 'block' : 'none'
        }
      }

      window.addEventListener('error', function (event) {
        var detail = event && event.error
          ? (event.error.stack || event.error.message || String(event.error))
          : (event && event.message) || 'unknown error'
        window.__desktopBootFallback('桌面端启动失败', '渲染层初始化时报错。', detail)
      })

      window.addEventListener('unhandledrejection', function (event) {
        var reason = event && event.reason
        var detail = reason && reason.stack
          ? reason.stack
          : (reason && reason.message) || String(reason || 'unknown rejection')
        window.__desktopBootFallback('桌面端启动失败', '启动阶段出现未处理的异步异常。', detail)
      })
    