#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const args = { config: '', dryRun: false }
  for (let i = 2; i < argv.length; i += 1) {
    const cur = String(argv[i] || '').trim()
    if (!cur) continue
    if (cur === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (cur === '--config') {
      args.config = String(argv[i + 1] || '').trim()
      i += 1
      continue
    }
  }
  return args
}

function normalizeConfigPath(inputPath) {
  const candidate = String(inputPath || '').trim()
  if (candidate) return path.resolve(process.cwd(), candidate)
  const local = path.resolve(ROOT, 'config.json')
  if (fs.existsSync(local)) return local
  return path.resolve(ROOT, 'config.json')
}

function readJSON(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(text)
}

function resolveLicenseMysql(config) {
  const root = (config && typeof config === 'object') ? config : {}
  const poolServer = (root.poolServer && typeof root.poolServer === 'object') ? root.poolServer : root
  const license = (poolServer && typeof poolServer === 'object' && poolServer.license && typeof poolServer.license === 'object')
    ? poolServer.license
    : {}
  const env = process.env
  return {
    enabled: env.POOL_LICENSE_ENABLED ? /^(1|true|yes|on)$/i.test(env.POOL_LICENSE_ENABLED) : (license.enabled === true),
    host: String(env.POOL_LICENSE_MYSQL_HOST || license.host || '127.0.0.1').trim(),
    port: Number(env.POOL_LICENSE_MYSQL_PORT || license.port || 3306),
    user: String(env.POOL_LICENSE_MYSQL_USER || license.user || 'root').trim(),
    password: String(env.POOL_LICENSE_MYSQL_PASSWORD || license.password || ''),
    database: String(env.POOL_LICENSE_MYSQL_DATABASE || license.database || 'dy_fudai').trim()
  }
}

function ensureMysqlClient() {
  const probe = spawnSync('mysql', ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    const reason = probe.error ? probe.error.message : (probe.stderr || probe.stdout || 'unknown')
    throw new Error(`未找到 mysql 客户端，请先安装 MySQL Client。原因: ${String(reason).trim()}`)
  }
}

function resolveDatabaseSQLName(database) {
  const name = String(database || '').trim()
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`数据库名不合法: ${database}`)
  }
  return `\`${name}\``
}

function main() {
  const args = parseArgs(process.argv)
  const configPath = normalizeConfigPath(args.config)
  const sqlPath = path.resolve(ROOT, 'apps', 'pool-server', 'sql', 'license.mysql.sql')

  if (!fs.existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}`)
  }
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`初始化 SQL 不存在: ${sqlPath}`)
  }

  const cfg = readJSON(configPath)
  const mysql = resolveLicenseMysql(cfg)
  if (!mysql.host || !mysql.user || !mysql.database) {
    throw new Error('MySQL 配置不完整，请检查 license.host/user/database')
  }

  console.log(`[init-db] config=${configPath}`)
  console.log(`[init-db] sql=${sqlPath}`)
  console.log(`[init-db] mysql=${mysql.user}@${mysql.host}:${mysql.port}/${mysql.database}`)
  if (mysql.enabled !== true) {
    console.log('[init-db] 警告: 当前配置 license.enabled=false（仍会执行初始化）')
  }

  if (args.dryRun) {
    console.log('[init-db] dry-run 完成，未实际执行 SQL')
    return
  }

  ensureMysqlClient()
  const sqlTemplate = fs.readFileSync(sqlPath, 'utf8')
  const dbNameSQL = resolveDatabaseSQLName(mysql.database)
  const sqlText = sqlTemplate.replaceAll('__LICENSE_DB__', dbNameSQL)
  const mysqlArgs = [
    '-h', mysql.host,
    '-P', String(mysql.port),
    '-u', mysql.user
  ]
  if (mysql.password) mysqlArgs.push(`-p${mysql.password}`)

  const run = spawnSync('mysql', mysqlArgs, {
    input: sqlText,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8'
  })
  if (run.error) {
    throw new Error(`执行初始化失败: ${run.error.message}`)
  }
  if (run.status !== 0) {
    throw new Error(`执行初始化失败，退出码: ${run.status}`)
  }
  console.log('[init-db] 授权数据库初始化完成')
}

try {
  main()
} catch (err) {
  console.error(`[init-db] ${err.message}`)
  process.exit(1)
}
