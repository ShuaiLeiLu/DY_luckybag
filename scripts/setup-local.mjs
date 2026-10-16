import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const destination = path.join(root,'config.json')
if (fs.existsSync(destination)) {
  console.log('config.json 已存在，保留现有配置')
} else {
  const config = JSON.parse(fs.readFileSync(path.join(root,'config.example.json'),'utf8'))
  const token = crypto.randomBytes(32).toString('hex')
  config.desktop.poolServerToken = token
  config.poolServer.server.apiToken = token
  config.poolServer.redis.enabled = false
  fs.writeFileSync(destination,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'})
  console.log('已生成本地 config.json 和独立服务访问凭据')
}
