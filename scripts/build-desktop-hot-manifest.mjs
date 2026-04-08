#!/usr/bin/env node
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

function parseArgs(argv) {
  const args = {
    dist: path.resolve(ROOT, 'apps', 'desktop', 'dist'),
    out: path.resolve(ROOT, 'apps', 'desktop', 'dist', 'hot-manifest.json'),
    baseUrl: '',
    version: '',
    entry: 'index.html',
    minAppVersion: ''
  }
  for (let i = 2; i < argv.length; i += 1) {
    const cur = String(argv[i] || '').trim()
    if (!cur) continue
    const next = String(argv[i + 1] || '').trim()
    if (cur === '--dist' && next) {
      args.dist = path.resolve(process.cwd(), next)
      i += 1
      continue
    }
    if (cur === '--out' && next) {
      args.out = path.resolve(process.cwd(), next)
      i += 1
      continue
    }
    if (cur === '--base-url' && next) {
      args.baseUrl = next
      i += 1
      continue
    }
    if (cur === '--version' && next) {
      args.version = next
      i += 1
      continue
    }
    if (cur === '--entry' && next) {
      args.entry = next
      i += 1
      continue
    }
    if (cur === '--min-app-version' && next) {
      args.minAppVersion = next
      i += 1
      continue
    }
  }
  return args
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function toPosixRelative(base, absFile) {
  return path.relative(base, absFile).split(path.sep).join('/')
}

async function walkFiles(dir) {
  const out = []
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()
    const entries = await fsp.readdir(cur, { withFileTypes: true })
    for (const ent of entries) {
      const absPath = path.join(cur, ent.name)
      if (ent.isDirectory()) {
        stack.push(absPath)
        continue
      }
      if (ent.isFile()) {
        out.push(absPath)
      }
    }
  }
  out.sort()
  return out
}

async function readPackageVersion() {
  try {
    const raw = await fsp.readFile(path.resolve(ROOT, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw)
    return String(pkg.version || '').trim()
  } catch (_) {
    return ''
  }
}

async function main() {
  const args = parseArgs(process.argv)
  if (!fs.existsSync(args.dist)) {
    throw new Error(`dist 目录不存在: ${args.dist}`)
  }
  if (!args.baseUrl) {
    throw new Error('必须提供 --base-url，例如: https://cdn.example.com/dy-fudai/desktop/3.0.0/')
  }
  const distReal = path.resolve(args.dist)
  const outReal = path.resolve(args.out)
  const allFiles = (await walkFiles(distReal))
    .filter((abs) => path.resolve(abs) !== outReal)
    .filter((abs) => !String(abs).endsWith('.map'))
  if (allFiles.length === 0) {
    throw new Error(`dist 目录为空: ${distReal}`)
  }

  const version = args.version || await readPackageVersion() || `web-${Date.now()}`
  const minAppVersion = args.minAppVersion || await readPackageVersion() || '0.0.0'
  const files = []
  for (const abs of allFiles) {
    const buf = await fsp.readFile(abs)
    files.push({
      path: toPosixRelative(distReal, abs),
      size: buf.length,
      sha256: sha256Hex(buf)
    })
  }

  const manifest = {
    version,
    minAppVersion,
    entry: args.entry,
    baseUrl: args.baseUrl,
    files
  }

  await fsp.mkdir(path.dirname(args.out), { recursive: true })
  await fsp.writeFile(args.out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  console.log(`[hot-manifest] dist=${distReal}`)
  console.log(`[hot-manifest] files=${files.length}`)
  console.log(`[hot-manifest] out=${args.out}`)
  console.log(`[hot-manifest] version=${version}`)
}

main().catch((error) => {
  console.error(`[hot-manifest] ${error.message}`)
  process.exit(1)
})
