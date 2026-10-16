import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { ProtocolRuntime } = require('./protocol-runtime')
const { normalizeProtocolSession, createProtocolSessionStore } = require('./protocol-session-store')
const session = { accountId: 'a', userId: '123', cookie: 'sessionid=fixture-secret', userAgent: 'aweme-test', deviceInfo: { device_id: '1', iid: '2' } }
const lottery = { status_code: 0, data: { lottery_info: { lottery_id_str: '456', draw_time: Math.floor(Date.now()/1000)+120, candidate_num: 3, lucky_count: 1, conditions: [] } } }
describe('native protocol verification', () => {
  it('does not send anything without a complete imported session', async () => {
    const factory = vi.fn()
    const runtime = new ProtocolRuntime({ clientFactory: factory })
    expect((await runtime.verify({ accountId: 'a', roomId: '999' })).authentication.status).toBe('not_tested')
    expect((await runtime.call('attendLottery', { accountId: 'a' })).success).toBe(false)
    expect(factory).not.toHaveBeenCalled()
    expect(() => normalizeProtocolSession({ ...session, deviceInfo: {} })).toThrow('device_id')
  })
  it('stops after rejected or ambiguous identity without querying the target or writing', async () => {
    for (const profile of [{ status_code: 0, user: { uid: 'other' } }, { status_code: 0, user: { uid: '124' } }, { status_code: 0, user: { uid: 9999999999999999999 } }, { status_code: 8 }]) {
      const get = vi.fn().mockResolvedValue(profile)
      const post = vi.fn()
      const runtime = new ProtocolRuntime({ getSession: () => session, clientFactory: () => ({ get, post }) })
      const report = await runtime.verify({ accountId: 'a', roomId: '999' })
      expect(report.details.status).toBe('not_tested'); expect(get).toHaveBeenCalledTimes(1)
      expect(runtime.accountReady('a')).toBe(false)
      expect((await runtime.call('attendLottery', { accountId: 'a', roomId: '999', lotteryId: '456' })).code).toBe('PROTOCOL_NOT_VERIFIED')
      expect(post).not.toHaveBeenCalled()
    }
  })
  it('requires identity and a real target, invalidates on credential changes and expiry, never returns cookies', async () => {
    let now = 10
    let current = session
    const get = vi.fn(async p => p.includes('profile/self') ? { status_code: 0, user: { uid: '123' } } : lottery)
    const runtime = new ProtocolRuntime({ getSession: () => current, clientFactory: () => ({ get }), now: () => now })
    const report = await runtime.verify({ accountId: 'a', roomId: '999' })
    expect(report.authentication.status).toBe('verified'); expect(report.details.lotteryId).toBe('456')
    expect(report.signature.status).toBe('accepted_for_read_requests'); expect(runtime.accountReady('a')).toBe(true)
    expect(JSON.stringify(report)).not.toContain('fixture-secret')
    current = { ...session, cookie: 'sessionid=changed' }; expect(runtime.accountReady('a')).toBe(false)
    current = session; now += 600001; expect(runtime.accountReady('a')).toBe(false)
  })
  it('does not interpret status zero without a lottery as verified detail/signature', async () => {
    const get = vi.fn(async p => p.includes('profile/self') ? { status_code: 0, user: { uid: '123' } } : { status_code: 0, data: {} })
    const runtime = new ProtocolRuntime({ getSession: () => session, clientFactory: () => ({ get }) })
    const report = await runtime.verify({ accountId: 'a', roomId: '999' })
    expect(report.details.status).toBe('inconclusive'); expect(report.signature.status).toBe('unverified')
    expect(runtime.accountReady('a')).toBe(false)
  })
})
describe('protocol credential persistence', () => {
  it('encrypts, restores and removes sessions without exposing credential fields in account lists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-protocol-'))
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s).reverse(), decryptString: b => Buffer.from(b).reverse().toString() }
    const options = { filePath: path.join(dir, 'sessions.json'), safeStorage }
    try {
      const store = createProtocolSessionStore(options)
      store.save(session)
      expect(fs.readFileSync(options.filePath, 'utf8')).not.toContain(session.cookie)
      expect(JSON.stringify(store.list())).not.toContain('cookie')
      expect(createProtocolSessionStore(options).get('a').cookie).toBe(session.cookie)
      store.remove('a'); expect(store.list()).toEqual([])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('refuses a plaintext fallback if system encryption is unavailable', () => {
    const store = createProtocolSessionStore({ filePath: path.join(os.tmpdir(), `missing-dy-${Date.now()}.json`), safeStorage: { isEncryptionAvailable: () => false } })
    expect(() => store.save(session)).toThrow('加密')
  })
})
