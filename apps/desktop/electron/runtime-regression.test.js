import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const { createFeedbackOutbox } = require('./feedback-outbox')
const { normalizeLotteryOutcome } = require('./lottery-outcome')
const { verifyManifest, canonicalJSON, secureResourceURL } = require('./hot-update-trust')
const { createStateStore } = require('./state-store')
const { createHotUpdateService } = require('./hot-update-service')
function temporaryDir(prefix) {
  const root = path.resolve('.tmp')
  fs.mkdirSync(root, { recursive: true })
  return fs.mkdtempSync(path.join(root, prefix))
}

describe('durable feedback delivery', () => {
  it('survives restart, retries and deduplicates an acknowledgement lost in transit', async () => {
    const dir = temporaryDir('dy-outbox-')
    try {
      const filePath = path.join(dir, 'outbox.json')
      const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
      let now = 100
      const outbox = createFeedbackOutbox({ filePath, send, now: () => now })
      const event = { clientId: 'c', accountId: 'a', lotteryId: 'l', event: 'draw_won', remainingSec: 19.8 }
      const id = outbox.enqueue(event)
      expect(outbox.enqueue(event)).toBe(id)
      await outbox.flush(); expect(outbox.size()).toBe(1)
      const restored = createFeedbackOutbox({ filePath, send, now: () => now })
      await restored.flush(); expect(send).toHaveBeenCalledTimes(1)
      now += 5000
      await Promise.all([restored.flush(), restored.flush()])
      expect(send).toHaveBeenCalledTimes(2)
      expect(send.mock.calls[1][0].eventId).toBe(id)
      expect(send.mock.calls[1][0].remainingSec).toBe(19)
      expect(restored.size()).toBe(0)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('result identity and evidence', () => {
  it('does not treat a changed lottery or incomplete draw as a loss', () => {
    expect(normalizeLotteryOutcome({ lottery_id: 'other', finished: true, is_winner: true }, { lotteryId: '1' }).resultStatus).toBe('unknown')
    expect(normalizeLotteryOutcome({ lottery_id: '1', finished: true }, { lotteryId: '1' }).resultStatus).toBe('unknown')
    expect(normalizeLotteryOutcome({ lottery_id: '1', user_id: 'other', finished: true, is_winner: false }, { lotteryId: '1', userId: 'mine' }).resultStatus).toBe('unknown')
  })
  it('accepts explicit final results for the same target', () => {
    expect(normalizeLotteryOutcome({ data: { lottery_id: '1', finished: true, is_winner: true, reward_amount: 5 } }, { lotteryId: '1' })).toMatchObject({ resultStatus: 'won', lotteryId: '1', rewardAmount: 5 })
  })
})

describe('update trust', () => {
  it('revalidates cached resources and ignores old unsigned updates', () => {
    const dir = temporaryDir('dy-update-')
    try {
      const updateDir = path.join(dir, 'hot-update/desktop-renderer')
      const versionDir = path.join(updateDir, 'versions/3.0.3')
      fs.mkdirSync(versionDir, { recursive: true })
      const entry = path.join(versionDir, 'index.html')
      fs.writeFileSync(entry, 'verified page')
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
      const options = { userDataDir: dir, enabled: true, manifestUrl: 'https://updates.example.com/manifest.json', publicKey }
      const state = { currentVersion: '3.0.3', currentEntry: 'index.html' }
      fs.writeFileSync(path.join(updateDir, 'state.json'), JSON.stringify(state))
      expect(createHotUpdateService(options).getAppliedEntryFile()).toBe('')
      const manifest = { version: '3.0.3', entry: 'index.html', files: [{ path: 'index.html', sha256: crypto.createHash('sha256').update('verified page').digest('hex') }] }
      manifest.signature = crypto.sign(null, Buffer.from(canonicalJSON(manifest)), privateKey).toString('base64')
      fs.writeFileSync(path.join(updateDir, 'state.json'), JSON.stringify({ ...state, trustedManifest: manifest }))
      expect(createHotUpdateService(options).getAppliedEntryFile()).toBe(entry)
      expect(createHotUpdateService({ ...options, enabled: false }).getAppliedEntryFile()).toBe('')
      fs.writeFileSync(entry, 'tampered page')
      expect(createHotUpdateService(options).getAppliedEntryFile()).toBe('')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('rejects tampering, traversal versions and external resources', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    const payload = { version: '3.0.3', files: [{ path: 'index.html', sha256: 'abcd' }] }
    const signature = crypto.sign(null, Buffer.from(canonicalJSON(payload)), privateKey).toString('base64')
    expect(verifyManifest({ ...payload, signature }, publicKey, 'https://updates.example.com/manifest.json')).toEqual(payload)
    expect(() => verifyManifest({ ...payload, version: '../escape', signature }, publicKey, 'https://updates.example.com/a')).toThrow()
    expect(() => verifyManifest({ ...payload, files: [], signature }, publicKey, 'https://updates.example.com/a')).toThrow()
    expect(() => secureResourceURL('http://updates.example.com/a')).toThrow()
    expect(() => secureResourceURL('https://other.example.com/a', 'https://updates.example.com/b')).toThrow()
    expect(secureResourceURL('/a', 'http://127.0.0.1:9090/b')).toBe('http://127.0.0.1:9090/a')
  })
})

describe('runtime persistence', () => {
  it('restores pending draws and replaces a pending history row with its outcome', () => {
    const dir = temporaryDir('dy-state-')
    try {
      const state = createStateStore(dir)
      state.saveRuntime({ accountId: 'a', intent: 'running', pendingDraw: { lottery: { lottery_id: '1' }, record: { id: 'r' } } })
      expect(createStateStore(dir).listRuntimes().a.pendingDraw.lottery.lottery_id).toBe('1')
      state.appendHistoryRecord({ id: 'r', accountId: 'a', lotteryId: '1', resultStatus: 'pending', recordType: 'join' })
      state.appendHistoryRecord({ id: 'r', accountId: 'a', lotteryId: '1', resultStatus: 'won', recordType: 'win' })
      expect(state.listHistoryRecords(20).filter(row => row.accountId === 'a')).toHaveLength(1)
      expect(state.listHistoryRecords(20)[0].resultStatus).toBe('won')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
