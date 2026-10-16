const { secureResourceURL, verifyManifest } = require('./hot-update-trust')
const crypto = require('crypto')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

function normalizeVersionParts(raw) {
  return String(raw || '')
    .trim()
    .split(/[^0-9]+/g)
    .filter(Boolean)
    .map((x) => Number(x))
}

function compareVersions(a, b) {
  const pa = normalizeVersionParts(a)
  const pb = normalizeVersionParts(b)
  const maxLen = Math.max(pa.length, pb.length)
  for (let i = 0; i < maxLen; i += 1) {
    const va = Number(pa[i] || 0)
    const vb = Number(pb[i] || 0)
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

function safeRelativeFilePath(rawPath) {
  const normalized = String(rawPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
  if (!normalized) {
    throw new Error('manifest file path is empty')
  }
  if (normalized.includes('\0')) {
    throw new Error(`manifest file path contains null byte: ${rawPath}`)
  }
  const segments = normalized.split('/')
  if (segments.some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new Error(`manifest file path is invalid: ${rawPath}`)
  }
  return segments.join('/')
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true })
}

async function readJSON(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (_) {
    return fallback
  }
}

async function writeJSONAtomic(filePath, payload) {
  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await ensureDir(path.dirname(filePath))
  await fsp.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8')
  await fsp.rename(tempPath, filePath)
}

async function fetchJSON(url) {
  const res = await fetch(secureResourceURL(url), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    throw new Error(`request failed: ${res.status} ${res.statusText}`)
  }
  const text = await res.text()
  if (Buffer.byteLength(text)>1048576) throw new Error('更新清单过大')
  return JSON.parse(text)
}

async function fetchBuffer(url) {
  const res = await fetch(secureResourceURL(url), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    throw new Error(`request failed: ${res.status} ${res.statusText}`)
  }
  if (Number(res.headers.get('content-length') || 0)>32*1024*1024) throw new Error('更新文件过大')
  const ab = await res.arrayBuffer()
  if (ab.byteLength>32*1024*1024) throw new Error('更新文件过大')
  return Buffer.from(ab)
}

function rewriteManifestBaseUrlIfNeeded(baseUrl, manifestUrl) { return secureResourceURL(baseUrl, manifestUrl) }

function createHotUpdateService(options = {}) {
  const enabled = options.enabled === true
  const manifestUrl = String(options.manifestUrl || '').trim()
  const reloadOnApply = options.reloadOnApply === true
  const userDataDir = String(options.userDataDir || '').trim()
  const appVersion = String(options.appVersion || '').trim()
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {}

  const rootDir = path.join(userDataDir, 'hot-update', 'desktop-renderer')
  const versionsDir = path.join(rootDir, 'versions')
  const stagingDir = path.join(rootDir, 'staging')
  const statePath = path.join(rootDir, 'state.json')
  const defaultState = {
    currentVersion: '',
    currentEntry: 'index.html',
    appliedAt: 0,
    lastCheckedAt: 0
  }
  let persistedState = defaultState
  let checkInFlight = null
  let snapshot = {
    status: enabled && manifestUrl ? 'idle' : 'disabled',
    enabled,
    manifestUrl,
    reloadOnApply,
    currentVersion: '',
    latestVersion: '',
    message: enabled ? (manifestUrl ? '等待检查热更新' : '未配置热更新地址') : '热更新未启用',
    checkedAt: 0,
    appliedEntryFile: ''
  }

  const emit = (patch = {}) => {
    snapshot = { ...snapshot, ...patch }
    onChange(snapshot)
    return snapshot
  }

  const getAppliedEntryFile = () => {
    try {
      if (!enabled || !options.publicKey) return ''
      const currentVersion = String(persistedState.currentVersion || '').trim()
      const currentEntry = safeRelativeFilePath(persistedState.currentEntry || 'index.html')
      if (!currentVersion) return ''
      const signed = verifyManifest(persistedState.trustedManifest, options.publicKey, manifestUrl)
      if (signed.version !== currentVersion || safeRelativeFilePath(signed.entry || 'index.html') !== currentEntry) return ''
      if (!Array.isArray(signed.files) || !signed.files.some(file => file.path === currentEntry)) return ''
      for (const file of signed.files) {
        const relative = safeRelativeFilePath(file.path)
        const filePath = path.resolve(versionsDir, currentVersion, ...relative.split('/'))
        if (!filePath.startsWith(path.resolve(versionsDir, currentVersion) + path.sep)) return ''
        if (sha256Hex(fs.readFileSync(filePath)) !== file.sha256) return ''
      }
      const entryFile = path.join(versionsDir, currentVersion, ...currentEntry.split('/'))
      if (!fs.existsSync(entryFile)) return ''
      return entryFile
    } catch (_) {
      return ''
    }
  }

  const loadState = async () => {
    persistedState = {
      ...defaultState,
      ...(await readJSON(statePath, defaultState))
    }
    const entry = getAppliedEntryFile()
    emit({
      currentVersion: String(persistedState.currentVersion || ''),
      appliedEntryFile: entry
    })
  }

  function loadStateSync() {
    try {
      if (!fs.existsSync(statePath)) return
      const raw = fs.readFileSync(statePath, 'utf8')
      persistedState = {
        ...defaultState,
        ...(JSON.parse(raw))
      }
    } catch (_) {
      persistedState = { ...defaultState }
    }
  }

  const validateManifest = (rawManifest) => {
    const manifest = verifyManifest(rawManifest, options.publicKey, manifestUrl)
    const version = String(manifest.version || '').trim()
    if (!version) {
      throw new Error('manifest.version is required')
    }
    const entry = safeRelativeFilePath(manifest.entry || 'index.html')
    const files = Array.isArray(manifest.files) ? manifest.files : []
    if (files.length === 0) {
      throw new Error('manifest.files is required')
    }
    const minAppVersion = String(manifest.minAppVersion || '').trim()
    if (minAppVersion && compareVersions(appVersion, minAppVersion) < 0) {
      throw new Error(`当前客户端版本(${appVersion})低于热更新要求(${minAppVersion})`)
    }
    const resolvedBaseURLRaw = String(manifest.baseUrl || '').trim()
      ? new URL(String(manifest.baseUrl || '').trim(), manifestUrl).toString()
      : new URL('./', manifestUrl).toString()
    const resolvedBaseURL = rewriteManifestBaseUrlIfNeeded(resolvedBaseURLRaw, manifestUrl)
    const normalizedFiles = files.map((raw) => {
      const item = raw && typeof raw === 'object' ? raw : {}
      const relPath = safeRelativeFilePath(item.path)
      if (!/^[a-f0-9]{64}$/i.test(item.sha256 || '')) throw new Error('更新文件必须包含 SHA256')
      return {
        path: relPath,
        sha256: String(item.sha256 || '').trim().toLowerCase(),
        size: Number(item.size || 0),
        url: String(item.url || '').trim()
      }
    })
    if (!normalizedFiles.some(file=>file.path===entry)) throw new Error('清单缺少入口文件')
    if (compareVersions(version,snapshot.currentVersion || appVersion)<0) throw new Error('拒绝版本回退')
    return {
      version,
      entry,
      files: normalizedFiles,
      baseUrl: resolvedBaseURL,
      signed: rawManifest
    }
  }

  const pruneOtherVersions = async (keepVersion) => {
    try {
      const entries = await fsp.readdir(versionsDir, { withFileTypes: true })
      const previous = entries.filter(ent=>ent.isDirectory() && ent.name!==keepVersion).map(ent=>ent.name).sort((a,b)=>compareVersions(b,a))[0]
      for (const ent of entries) {
        if (!ent.isDirectory()) continue
        if (ent.name === keepVersion || ent.name === previous) continue
        await fsp.rm(path.join(versionsDir, ent.name), { recursive: true, force: true })
      }
    } catch (_) {
      // ignore prune failures
    }
  }

  const applyManifest = async (manifest) => {
    const version = manifest.version
    const targetVersionDir = path.join(versionsDir, version)
    const tempDir = path.join(stagingDir, `${version}-${Date.now()}`)
    await ensureDir(tempDir)
    for (const file of manifest.files) {
      const fileUrl = file.url
        ? secureResourceURL(file.url, manifestUrl)
        : secureResourceURL(new URL(file.path, manifest.baseUrl).toString(),manifestUrl)
      const bytes = await fetchBuffer(fileUrl)
      if (file.size > 0 && bytes.length !== file.size) {
        throw new Error(`文件大小校验失败: ${file.path}`)
      }
      if (file.sha256) {
        const actual = sha256Hex(bytes)
        if (actual !== file.sha256) {
          throw new Error(`文件哈希校验失败: ${file.path}`)
        }
      }
      const outputPath = path.join(tempDir, ...file.path.split('/'))
      await ensureDir(path.dirname(outputPath))
      await fsp.writeFile(outputPath, bytes)
    }

    await ensureDir(versionsDir)
    if (!path.resolve(targetVersionDir).startsWith(path.resolve(versionsDir)+path.sep)) throw new Error('更新目标越界')
    await fsp.rm(targetVersionDir, { recursive: true, force: true })
    await fsp.rename(tempDir, targetVersionDir)

    persistedState = {
      ...persistedState,
      currentVersion: version,
      currentEntry: manifest.entry,
      trustedManifest: manifest.signed,
      appliedAt: Date.now(),
      lastCheckedAt: Date.now()
    }
    await writeJSONAtomic(statePath, persistedState)
    await pruneOtherVersions(version)
    return getAppliedEntryFile()
  }

  const check = async () => {
    if (checkInFlight) return checkInFlight
    checkInFlight = (async () => {
      if (!enabled || !manifestUrl) {
        return emit({
          status: 'disabled',
          checkedAt: Date.now(),
          message: enabled ? '未配置热更新地址' : '热更新未启用'
        })
      }
      emit({
        status: 'checking',
        checkedAt: Date.now(),
        message: '正在检查前端热更新...'
      })
      try {
        const rawManifest = await fetchJSON(manifestUrl)
        const manifest = validateManifest(rawManifest)
        const currentVersion = String(persistedState.currentVersion || '').trim()
        if (manifest.version === currentVersion && getAppliedEntryFile()) {
          persistedState = {
            ...persistedState,
            lastCheckedAt: Date.now()
          }
          await writeJSONAtomic(statePath, persistedState)
          return emit({
            status: 'idle',
            latestVersion: manifest.version,
            currentVersion,
            checkedAt: Date.now(),
            message: '当前已是最新前端资源'
          })
        }

        emit({
          status: 'downloading',
          latestVersion: manifest.version,
          message: `正在下载前端热更新 ${manifest.version}...`,
          checkedAt: Date.now()
        })
        const appliedEntryFile = await applyManifest(manifest)
        return emit({
          status: 'applied',
          latestVersion: manifest.version,
          currentVersion: manifest.version,
          checkedAt: Date.now(),
          appliedEntryFile,
          message: '前端热更新已就绪'
        })
      } catch (error) {
        return emit({
          status: 'error',
          checkedAt: Date.now(),
          message: `前端热更新失败: ${error?.message || error}`
        })
      } finally {
        checkInFlight = null
      }
    })()
    return checkInFlight
  }

  const init = async () => {
    await ensureDir(rootDir)
    await ensureDir(versionsDir)
    await ensureDir(stagingDir)
    await loadState()
  }

  loadStateSync()
  snapshot = {
    ...snapshot,
    currentVersion: String(persistedState.currentVersion || ''),
    appliedEntryFile: getAppliedEntryFile()
  }

  return {
    async init() {
      await init()
      return snapshot
    },
    publicKey: String(options.publicKey || ''),
    getSnapshot() {
      return snapshot
    },
    getAppliedEntryFile,
    async check() {
      return check()
    }
  }
}

module.exports = {
  createHotUpdateService
}
