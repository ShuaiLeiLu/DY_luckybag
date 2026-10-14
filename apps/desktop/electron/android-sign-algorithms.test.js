import { describe, it, expect } from 'vitest'
const s = require('./android-sign-algorithms')

describe('android-sign-algorithms', () => {
  it('encodes params as protobuf-like bytes with sorted keys', () => {
    expect(s.buildProtobufLikeBytes({ aid: '1128', room_id: '12345' })).toEqual([
      0, 3, 97, 105, 100, 1, 4, 49, 49, 50, 56,
      2, 7, 114, 111, 111, 109, 95, 105, 100, 3, 5, 49, 50, 51, 52, 53
    ])
  })

  it('pads protobuf bytes to 16 after dropping the first element', () => {
    const pb = s.buildProtobufLikeBytes({ aid: '1128', room_id: '12345' })
    const packed = s.packTo16(pb)
    expect(packed.length).toBe(16)
    expect([...packed].slice(0, 4)).toEqual([3, 97, 105, 100])
  })

  it('produces deterministic x-ladon and x-argus for the same input', () => {
    const pb = s.buildProtobufLikeBytes({ aid: '1128', room_id: '12345' })
    expect(s.getXLadon(pb)).toBe('PovjqOPcQhyiB3Tu2Pw0Ug==')
    expect(s.getXArgus(pb)).toBe('3e8be3a8e3dc421ca20774eed8fc3452')
    // hex 串长度固定 32，Base64 长度固定 24
    expect(s.getXArgus(pb)).toHaveLength(32)
    expect(s.getXLadon(pb)).toHaveLength(24)
  })

  it('handles empty protobuf input', () => {
    expect(s.getXLadon([])).toBe('XALXsI+RbwoRrnBs25hUfg==')
    expect(s.getXArgus([])).toBe('5c02d7b08f916f0a11ae706cdb98547e')
  })

  it('builds x-gorgon parts from khronos nibbles plus query/body digests', () => {
    expect(s.getYGorgonParts('1700000000', 'aid=1128&room_id=12345', 'lottery_id=678')).toEqual([
      2, 4, 9, 2, 167, 89, 133, 5
    ])
    expect(s.getXGorgon('1700000000', 'aid=1128&room_id=12345', 'lottery_id=678')).toBe('004-01306452')
  })

  it('x-gorgon drops trailing odd index and keeps the 004- prefix', () => {
    const onlyKhronos = s.getXGorgon('1700000000')
    expect(onlyKhronos.startsWith('004-')).toBe(true)
    expect(onlyKhronos).toBe('004-0120')
    expect(s.getXGorgon('')).toBe('004-2102')
    expect(s.getXGorgon(undefined, '', '')).toBe('004-1210')
  })

  it('x-ss-stub is uppercase md5 hex of the body', () => {
    expect(s.getXSsStub('lottery_id=678')).toBe('058526BDD7299957CCE9A3418B9D45F1')
    expect(s.getXSsStub('')).toBe('')
  })

  it('x-khronos is a 10-digit second-level timestamp', () => {
    const value = s.getXKhronos()
    expect(/^\d{10}$/.test(value)).toBe(true)
  })

  it('signAndroidHeaders returns the full Android header set', () => {
    const headers = s.signAndroidHeaders({
      query: 'aid=1128&device_platform=android&room_id=12345',
      body: ''
    })
    expect(Object.keys(headers).sort()).toEqual(['x-argus', 'x-gorgon', 'x-khronos', 'x-ladon'])
    expect(headers['x-ss-stub']).toBeUndefined()

    const withBody = s.signAndroidHeaders({
      query: 'aid=1128',
      body: 'room_id=12345&lottery_id=678'
    })
    expect(withBody['x-ss-stub']).toBe('C9F7BC755E9CA88184C007A8266B5C13')
    expect(withBody['x-gorgon']).toHaveLength('004-'.length + 8)
  })

  it('parses a query string back into a params dict', () => {
    expect(s.parseQueryToParams('aid=1128&room_id=12345')).toEqual({ aid: '1128', room_id: '12345' })
    expect(s.parseQueryToParams('')).toEqual({})
  })

  it('leftRotate32 rotates within 32 bits', () => {
    expect(s.leftRotate32(0x80000001, 1)).toBe(0x00000003)
  })
})
