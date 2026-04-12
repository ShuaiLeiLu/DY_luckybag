const fs = require('fs')
const path = require('path')

function getBundledDesktopIndexFile() {
  return path.join(__dirname, '../dist/index.html')
}

function buildDesktopFailureHtml(message = '', detail = '') {
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>抖娃福袋工作台</title>
      <style>
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(160deg, #05111f, #0d1b2a 48%, #091625 100%);
          color: #ecf4ff;
          font-family: "IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        body {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          box-sizing: border-box;
        }
        .panel {
          width: min(720px, 100%);
          padding: 28px;
          border-radius: 28px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: linear-gradient(180deg, rgba(15, 29, 46, 0.92), rgba(8, 18, 30, 0.78));
          box-shadow: 0 18px 60px rgba(3, 10, 18, 0.42);
        }
        h1 {
          margin: 0 0 12px;
          font-size: 24px;
        }
        p {
          margin: 0;
          line-height: 1.7;
          color: #b8c6db;
        }
        pre {
          margin: 18px 0 0;
          white-space: pre-wrap;
          word-break: break-word;
          padding: 16px;
          border-radius: 18px;
          background: rgba(2, 6, 23, 0.45);
          color: #dbeafe;
          font-size: 13px;
          line-height: 1.6;
        }
      </style>
    </head>
    <body>
      <div class="panel">
        <h1>桌面端启动失败</h1>
        <p>${escapeHtml(message || '前端页面未能正常加载。')}</p>
        ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ''}
      </div>
    </body>
  </html>`
}

function attachMainWindowDiagnostics(windowRef, logger) {
  if (!windowRef || windowRef.isDestroyed()) return

  windowRef.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const normalized = String(message || '').trim()
    if (!normalized) return
    logger.warn(`[desktop-console:${level}] ${normalized} (${sourceId || 'unknown'}:${line || 0})`)
  })

  windowRef.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`[desktop] render-process-gone: ${details?.reason || 'unknown'}`)
  })

  windowRef.webContents.on('unresponsive', () => {
    logger.error('[desktop] window became unresponsive')
  })

  windowRef.webContents.on('did-finish-load', () => {
    logger.info('[desktop] did-finish-load')
  })

  windowRef.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    logger.error(`[desktop] did-fail-load code=${errorCode} url=${validatedURL || ''} error=${errorDescription || 'unknown'}`)
  })

  windowRef.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger.error(`[desktop] preload-error: ${preloadPath} ${error?.message || error}`)
  })
}

function getDesktopEntryFile(getHotUpdateEntry) {
  const hotEntry = typeof getHotUpdateEntry === 'function' ? String(getHotUpdateEntry() || '').trim() : ''
  if (hotEntry && fs.existsSync(hotEntry)) {
    return hotEntry
  }
  return getBundledDesktopIndexFile()
}

async function renderFailurePage(windowRef, message, detail) {
  if (!windowRef || windowRef.isDestroyed()) return
  await windowRef.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDesktopFailureHtml(message, detail))}`)
}

function createDesktopWindow(options = {}) {
  const {
    BrowserWindow,
    app,
    logger,
    DESKTOP_DEV_SERVER_URL,
    getHotUpdateEntry,
    preloadPath = path.join(__dirname, 'preload.js')
  } = options

  if (!BrowserWindow || !app) {
    throw new Error('BrowserWindow and app are required to construct the main window')
  }

  const mainWindow = new BrowserWindow({
    width: 1720,
    height: 1060,
    minWidth: 1360,
    minHeight: 860,
    backgroundColor: '#081320',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: preloadPath,
      backgroundThrottling: false
    }
  })

  attachMainWindowDiagnostics(mainWindow, logger)

  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL(DESKTOP_DEV_SERVER_URL).catch(async (error) => {
      logger.error(`[desktop] dev server load failed: ${error?.message || error}`)
      const fallbackFile = getBundledDesktopIndexFile()
      if (fs.existsSync(fallbackFile)) {
        await mainWindow.loadFile(fallbackFile).catch(async (fallbackError) => {
          await renderFailurePage(
            mainWindow,
            '开发服务器未能加载，本地兜底页面也加载失败。',
            `${error?.message || error}\n${fallbackError?.message || fallbackError}`
          )
        })
        return
      }
      await renderFailurePage(mainWindow, '开发服务器未能加载。', error?.message || error)
    })
    // mainWindow.webContents.openDevTools() // 已禁用：不需要自动打开控制台
  } else {
    const desktopIndexFile = getDesktopEntryFile(getHotUpdateEntry)
    mainWindow.loadFile(desktopIndexFile).catch(async (error) => {
      logger.error(`[desktop] loadFile failed: ${desktopIndexFile} ${error?.message || error}`)
      await renderFailurePage(mainWindow, '本地桌面页面未能加载。', `${desktopIndexFile}\n${error?.message || error}`)
    })
  }

  return mainWindow
}

module.exports = {
  createDesktopWindow
}
