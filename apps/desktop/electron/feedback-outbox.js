const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function createFeedbackOutbox({ filePath, send, now = Date.now }) {
  let items = []
  if (fs.existsSync(filePath)) items = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!Array.isArray(items)) throw new Error('反馈队列文件格式错误')
  let flushing = null
  const persist = () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tmp = filePath + '.tmp'
    const fd = fs.openSync(tmp, 'w', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify(items)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(tmp, filePath)
  }
  const enqueue = payload => {
    payload = { ...payload }
    for (const key of ['remainingSec', 'endTime', 'startTime', 'joinedAt']) {
      const value = Number(payload[key] || 0)
      payload[key] = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
    }
    const eventId = payload.eventId || crypto.createHash('sha256').update([payload.clientId,payload.accountId,payload.lotteryId,payload.event].join('|')).digest('hex')
    if (!items.some(item => item.payload.eventId === eventId)) {
      items.push({ payload: { ...payload, eventId }, attempts: 0, nextAt: 0 })
      persist()
    }
    return eventId
  }
  const flush = () => {
    if (flushing) return flushing
    flushing = (async () => {
      for (const item of [...items]) {
        if (item.nextAt > now()) continue
        try {
          await send(item.payload)
          items = items.filter(current => current !== item)
        } catch {
          item.attempts++
          item.nextAt = now() + Math.min(300_000, 1000 * 2 ** Math.min(item.attempts, 8))
        }
        persist()
      }
    })().finally(() => { flushing = null })
    return flushing
  }
  return { enqueue, flush, size: () => items.length }
}
module.exports = { createFeedbackOutbox }
