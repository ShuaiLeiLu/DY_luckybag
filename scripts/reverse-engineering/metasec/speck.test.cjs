const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { expandSpeckKey, encryptSpeckBlock, encryptSpeckPadded } = require('../../../apps/desktop/electron/metasec/speck')
const { encrypt: instructionTranslation } = require('./fixtures/speck-block-lift.cjs')
const { createHeliosValue } = require('../../../apps/desktop/electron/metasec/helios')

test('Helios block and expanded keys match the cipher authors\' published Speck128/256 vector', () => {
  // NSA Implementation Guide 1.1, PDF pages 6 and 35.
  // https://nsacyber.github.io/simon-speck/implementations/ImplementationGuide1.1.pdf
  // This is a published cipher vector, not a complete Douyin SDK signature.
  const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index))
  const plain = Buffer.from('706f6f6e65722e20496e2074686f7365', 'hex')
  const keys = expandSpeckKey(key)
  assert.deepEqual(keys.slice(0, 8).map(value => value.toString(16).padStart(16, '0')), [
    '0706050403020100', '37253b31171d0309', 'fe1588ce93d80d52', 'e698e09f31334dfe',
    'db60f14bcbd834fd', '2dafa7c34cc2c2f8', 'fbb8e2705e64a1db', 'db6f99e4e383eaef'
  ])
  assert.equal(encryptSpeckBlock(plain, keys).toString('hex'), '438f189c8db4ee4e3ef5c00504010941')
  assert.equal(instructionTranslation(plain, keys).toString('hex'), '438f189c8db4ee4e3ef5c00504010941')
})

test('34-round desktop block encryption matches the directly lifted SDK arithmetic', () => {
  const mask = (1n << 64n) - 1n
  const rotateRight = (value, shift) => ((value >> shift) | (value << (64n - shift))) & mask
  for (let index = 0; index < 256; index += 1) {
    const key = crypto.createHash('sha256').update(`helios-key-${index}`).digest()
    const block = crypto.createHash('md5').update(`helios-block-${index}`).digest()
    // Separate structure: four-word register rotation from native 0x2dc840..870.
    let state = Array.from({ length: 4 }, (_, i) => key.readBigUInt64LE(i * 8))
    const expectedKeys = []
    for (let round = 0; round < 34; round += 1) {
      expectedKeys.push(state[0])
      const next = ((rotateRight(state[1], 8n) + state[0]) & mask) ^ BigInt(round)
      state = [rotateRight(state[0], 61n) ^ next, state[2], state[3], next]
    }
    const keys = expandSpeckKey(key)
    assert.deepEqual(keys, expectedKeys)
    assert.deepEqual(encryptSpeckBlock(block, keys), instructionTranslation(block, expectedKeys))
  }
})

test('native padding adds a complete block at aligned lengths and handles byte views', () => {
  const key = Buffer.alloc(32, 0xff)
  const keys = expandSpeckKey(key)
  for (const length of [0, 1, 15, 16, 17, 31, 32, 33, 63, 64]) {
    const storage = Buffer.alloc(length + 12, 0xfe)
    const plain = new Uint8Array(storage.buffer, storage.byteOffset + 4, length)
    const padding = 16 - length % 16
    const padded = Buffer.concat([Buffer.from(plain), Buffer.alloc(padding, padding)])
    const expected = Buffer.concat(Array.from({ length: padded.length / 16 }, (_, index) =>
      instructionTranslation(padded.subarray(index * 16, index * 16 + 16), keys)))
    assert.deepEqual(encryptSpeckPadded(plain, key), expected, `length ${length}`)
    assert.equal(storage.every(byte => byte === 0xfe), true)
  }
  assert.throws(() => expandSpeckKey(Buffer.alloc(31)))
  assert.throws(() => encryptSpeckBlock(Buffer.alloc(15), keys))
  assert.throws(() => encryptSpeckBlock(Buffer.alloc(16), [0n]))
})

test('complete Helios value preserves the nonce and derives an ASCII hex key from the SDK secret', () => {
  const nonce = Buffer.from('01234567', 'hex')
  const secret = Buffer.from([0xff, 0, 0xc3, 0x28])
  const value = createHeliosValue({ timestampSeconds: 1700000000, contextText: 'synthetic-context', aid: '1128', secret, nonce })
  const decoded = Buffer.from(value, 'base64')
  assert.deepEqual(decoded.subarray(0, 4), nonce)
  const key = Buffer.from(crypto.createHash('md5').update(nonce).update(secret).digest('hex'))
  const keys = expandSpeckKey(key)
  const plain = Buffer.from('1700000000-synthetic-context-1128')
  const padding = 16 - plain.length % 16
  const padded = Buffer.concat([plain, Buffer.alloc(padding, padding)])
  const expected = Buffer.concat(Array.from({ length: padded.length / 16 }, (_, index) =>
    instructionTranslation(padded.subarray(index * 16, index * 16 + 16), keys)))
  assert.deepEqual(decoded.subarray(4), expected)
  assert.deepEqual(secret, Buffer.from([0xff, 0, 0xc3, 0x28]))
  assert.notEqual(createHeliosValue({ timestampSeconds: 1700000000, contextText: 'synthetic-context', aid: '1128', secret,
    nonce: Buffer.from('01234568', 'hex') }), value)
  assert.throws(() => createHeliosValue({ timestampSeconds: 1700000000, contextText: 'x', aid: '1128', secret: 'guessed' }))
})
