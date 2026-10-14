#!/usr/bin/env node

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEPLOY_SCRIPT = path.join(ROOT, 'scripts', 'deploy-pool-local.sh')
const DEFAULT_DEBOUNCE_MS = 700
const DEFAULT_POLL_MS = 1000

const WATCH_ROOTS = [
  'apps/pool-server',
  'apps/desktop',
  'scripts/build-pool-image.sh',
  'scripts/build-desktop-hot-manifest.mjs',
  'scripts/deploy-pool-local.sh',
  'package.json',
  'package-lock.json',
  'config.json',
  'config.example.json'
]

const IGNORED_RELATIVE_PREFIXES = [
  'apps/pool-server/static/desktop'
]

const IGNORED_PARTS = new Set([
  '.git',
  '.idea',
  'node_modules',
  '.vite',
  '.vite-temp',
  'dist',
  'build',
  'dist-electron',
  'dy-fudai-desktop',
  'runtime-logs',
  'mysql-data-local',
  'redis-data'
])

function printHelp() {
  console.log(`Docker 热启动监听

用法:
  npm run server:docker:watch -- [部署参数]

监听到代码变化后，会自动执行 scripts/deploy-pool-local.sh，重新构建镜像并重启容器。

参数:
  --skip-initial       只监听变化，不在启动时立即部署
  --debounce-ms <n>    变化防抖毫秒数，默认 700
  --poll-ms <n>        不支持递归监听的平台轮询间隔，默认 1000
  其余参数             透传给 deploy-pool-local.sh，例如 --local --port 9091
`)
}

function parseArgs(argv) {
  const deployArgs = []
  let debounceMs = DEFAULT_DEBOUNCE_MS
  let pollMs = DEFAULT_POLL_MS
  let skipInitial = false

  for (let index = 2; index < argv.length; index += 1) {
    const arg = String(argv[index] || '')
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
    if (arg === '--skip-initial') {
      skipInitial = true
      continue
    }
    if (arg === '--debounce-ms' && argv[index + 1]) {
      debounceMs = parsePositiveInteger(argv[++index], DEFAULT_DEBOUNCE_MS)
      continue
    }
    if (arg === '--poll-ms' && argv[index + 1]) {
      pollMs = parsePositiveInteger(argv[++index], DEFAULT_POLL_MS)
      continue
    }
    deployArgs.push(arg)
  }

  return { deployArgs, debounceMs, pollMs, skipInitial }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function absoluteWatchRoots() {
  return WATCH_ROOTS.map((relativePath) => path.join(ROOT, relativePath))
}

function isIgnored(filePath) {
  const relativePath = path.relative(ROOT, filePath)
  if (!relativePath || relativePath.startsWith('..')) return true
  const normalizedPath = relativePath.split(path.sep).join('/')
  if (IGNORED_RELATIVE_PREFIXES.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`))) {
    return true
  }
  return relativePath.split(path.sep).some((part) => IGNORED_PARTS.has(part))
}

function normalizeEventPath(filename, watchRoot) {
  let watchRootStats
  try {
    watchRootStats = fs.statSync(watchRoot)
  } catch (_) {
    watchRootStats = null
  }
  if (!filename || watchRootStats?.isFile()) return watchRoot
  const value = String(filename)
  return path.isAbsolute(value) ? value : path.resolve(watchRoot, value)
}

async function walkFiles(rootPath, output = new Map()) {
  if (isIgnored(rootPath)) return output

  let stats
  try {
    stats = await fsp.stat(rootPath)
  } catch (_) {
    return output
  }

  if (stats.isFile()) {
    output.set(rootPath, `${stats.mtimeMs}:${stats.size}`)
    return output
  }
  if (!stats.isDirectory()) return output

  let entries
  try {
    entries = await fsp.readdir(rootPath, { withFileTypes: true })
  } catch (_) {
    return output
  }

  await Promise.all(entries.map((entry) => walkFiles(path.join(rootPath, entry.name), output)))
  return output
}

async function snapshot() {
  const files = new Map()
  for (const rootPath of absoluteWatchRoots()) {
    await walkFiles(rootPath, files)
  }
  return [...files.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function snapshotsEqual(left, right) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index][0] !== right[index][0] || left[index][1] !== right[index][1]) return false
  }
  return true
}

function deploy(deployArgs) {
  if (shuttingDown) return
  if (activeChild) {
    queuedDeploy = true
    return
  }

  console.log(`\n>>> 检测到代码变化，更新 Docker（${new Date().toLocaleTimeString()}）`)
  activeChild = spawn('bash', [DEPLOY_SCRIPT, ...deployArgs], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit'
  })

  activeChild.on('error', (error) => {
    console.error(`Docker 更新启动失败: ${error.message}`)
  })
  activeChild.on('exit', (code, signal) => {
    activeChild = null
    if (shuttingDown) return
    if (code === 0) {
      console.log('✅ Docker 更新完成，继续监听代码变化')
    } else {
      console.error(`❌ Docker 更新失败（code=${code ?? 'null'}, signal=${signal ?? 'null'}），继续监听`)
    }
    if (queuedDeploy) {
      queuedDeploy = false
      scheduleDeploy('Docker 更新期间又发生了代码变化')
    }
  })
}

function scheduleDeploy(reason) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    if (reason) console.log(`>>> ${reason}`)
    deploy(deployArgs)
  }, debounceMs)
}

function registerNativeWatchers() {
  const watchers = []
  for (const watchRoot of absoluteWatchRoots()) {
    try {
      const watcher = fs.watch(watchRoot, { recursive: true }, (_eventType, filename) => {
        const eventPath = normalizeEventPath(filename, watchRoot)
        if (!isIgnored(eventPath)) scheduleDeploy(`监听到变更: ${path.relative(ROOT, eventPath)}`)
      })
      watchers.push(watcher)
    } catch (error) {
      for (const watcher of watchers) watcher.close()
      return { watchers: [], supported: false, error }
    }
  }
  return { watchers, supported: true }
}

let activeChild = null
let queuedDeploy = false
let timer = null
let debounceMs = DEFAULT_DEBOUNCE_MS
let deployArgs = []
let pollTimer = null
let nativeWatchers = []
let shuttingDown = false
let previousSnapshot = []

async function main() {
  const options = parseArgs(process.argv)
  debounceMs = options.debounceMs
  deployArgs = options.deployArgs

  if (!fs.existsSync(DEPLOY_SCRIPT)) {
    throw new Error(`未找到部署脚本: ${DEPLOY_SCRIPT}`)
  }

  console.log('Docker 热启动监听已启动')
  console.log(`监听目录: ${WATCH_ROOTS.join(', ')}`)
  console.log(`更新防抖: ${debounceMs}ms`)
  console.log(`部署参数: ${deployArgs.length ? deployArgs.join(' ') : '(默认)'}`)

  previousSnapshot = await snapshot()
  const nativeWatch = registerNativeWatchers()
  if (nativeWatch.supported) {
    nativeWatchers = nativeWatch.watchers
    console.log('监听方式: fs.watch')
    for (const watcher of nativeWatchers) watcher.on('error', () => {})
  } else {
    console.log(`监听方式: polling（当前平台不支持递归 fs.watch: ${nativeWatch.error?.message || 'unknown'}）`)
    pollTimer = setInterval(async () => {
      const nextSnapshot = await snapshot()
      if (!snapshotsEqual(previousSnapshot, nextSnapshot)) {
        previousSnapshot = nextSnapshot
        scheduleDeploy('轮询检测到代码变化')
      }
    }, options.pollMs)
  }

  if (!options.skipInitial) {
    deploy(deployArgs)
  } else {
    console.log('已跳过首次 Docker 更新')
  }

  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    if (timer) clearTimeout(timer)
    if (pollTimer) clearInterval(pollTimer)
    for (const watcher of nativeWatchers) watcher.close()
    if (activeChild) activeChild.kill('SIGTERM')
    console.log('\nDocker 热启动监听已停止')
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error(`Docker 热启动监听启动失败: ${error.message}`)
  process.exit(1)
})
