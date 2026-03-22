const { app } = require('electron')

let autoUpdater = null
try {
  autoUpdater = require('electron-updater').autoUpdater
} catch (_) {
  autoUpdater = null
}

function createUpdateService(options = {}) {
  const feedUrl = String(options.feedUrl || '').trim()
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {}
  let snapshot = {
    status: autoUpdater ? 'idle' : 'disabled',
    currentVersion: app.getVersion(),
    latestVersion: '',
    progress: 0,
    message: feedUrl ? '等待检查更新' : '未配置更新源',
    feedUrl,
    checkedAt: 0
  }

  const emit = (patch = {}) => {
    snapshot = {
      ...snapshot,
      ...patch
    }
    onChange(snapshot)
    return snapshot
  }

  if (autoUpdater && feedUrl) {
    try {
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
    } catch (error) {
      emit({
        status: 'error',
        message: `更新源初始化失败: ${error.message}`
      })
    }

    autoUpdater.on('checking-for-update', () => {
      emit({
        status: 'checking',
        message: '正在检查更新...',
        checkedAt: Date.now()
      })
    })
    autoUpdater.on('update-available', (info) => {
      emit({
        status: 'available',
        latestVersion: String(info?.version || ''),
        message: '发现新版本，可下载更新',
        checkedAt: Date.now()
      })
    })
    autoUpdater.on('update-not-available', () => {
      emit({
        status: 'idle',
        latestVersion: '',
        message: '当前已是最新版本',
        checkedAt: Date.now()
      })
    })
    autoUpdater.on('download-progress', (progress) => {
      emit({
        status: 'downloading',
        progress: Number(progress?.percent || 0),
        message: `正在下载更新 ${Number(progress?.percent || 0).toFixed(1)}%`
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      emit({
        status: 'downloaded',
        latestVersion: String(info?.version || snapshot.latestVersion || ''),
        progress: 100,
        message: '更新已下载，准备安装'
      })
    })
    autoUpdater.on('error', (error) => {
      emit({
        status: 'error',
        message: error?.message || '更新失败',
        checkedAt: Date.now()
      })
    })
  }

  return {
    getSnapshot() {
      return snapshot
    },
    async check() {
      if (!autoUpdater || !feedUrl) {
        return emit({
          status: 'disabled',
          message: '未配置更新源'
        })
      }
      try {
        await autoUpdater.checkForUpdates()
      } catch (error) {
        emit({
          status: 'error',
          message: error?.message || '检查更新失败',
          checkedAt: Date.now()
        })
      }
      return snapshot
    },
    async download() {
      if (!autoUpdater) return snapshot
      try {
        await autoUpdater.downloadUpdate()
      } catch (error) {
        emit({
          status: 'error',
          message: error?.message || '下载更新失败',
          checkedAt: Date.now()
        })
      }
      return snapshot
    },
    install() {
      if (!autoUpdater) return false
      try {
        autoUpdater.quitAndInstall()
        return true
      } catch (_) {
        return false
      }
    }
  }
}

module.exports = {
  createUpdateService
}
