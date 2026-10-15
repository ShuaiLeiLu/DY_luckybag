import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimPoolTask, fetchDesktopNotice, fetchPoolTop } from './poolClient'

describe('pool client requests', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn((key: string) => key === 'DY_POOL_CLIENT_ID' ? 'client-test' : 'unused'),
        setItem: vi.fn()
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, items: [], markdown: '# 公告' })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('only sends the content type and stable pool client ID headers', async () => {
    const result = await fetchPoolTop('http://localhost:9090/', 5)
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:9090/pool/top?limit=5', expect.objectContaining({
      headers: { 'content-type': 'application/json', 'x-pool-client-id': 'client-test' }
    }))
    expect(window.localStorage.getItem).toHaveBeenCalledTimes(1)
  })

  it('preserves the client and account IDs used to isolate task leases', async () => {
    const result = await claimPoolTask('http://localhost:9090', {
      clientId: 'client-test', accountId: 'account-1', leaseSec: 45
    })
    expect(result.ok).toBe(true)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:9090/task/claim')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toMatchObject({
      clientId: 'client-test', accountId: 'account-1', leaseSec: 45
    })
  })

  it('continues to retrieve desktop announcements', async () => {
    const result = await fetchDesktopNotice('http://localhost:9090')
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ markdown: '# 公告' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9090/desktop/notice')
  })
})
