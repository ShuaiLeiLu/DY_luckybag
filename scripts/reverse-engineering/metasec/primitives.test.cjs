const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { MedusaDigest, compressMedusaBlock, medusaDigest16, appendMedusaTail, encodeArgusTimeWord } = require('./primitives.cjs')
const { compress: instructionTranslation } = require('./fixtures/medusa-compression-lift.cjs')
const { tail8, tail12 } = require('./fixtures/medusa-tail-lift.cjs')

// Independent structure: 64-round compact implementation vs 663 directly lifted
// arithmetic expressions. This is NOT comparison against a running official SDK.
test('compression matches the static instruction translation for 1,024 reproducible blocks/states', () => {
  for (let index = 0; index < 1024; index += 1) {
    const block = crypto.createHash('sha512').update(`metasec-block-${index}`).digest()
    const stateBytes = crypto.createHash('sha256').update(`metasec-state-${index}`).digest()
    const state = Array.from({ length: 4 }, (_, i) => stateBytes.readUInt32LE(i * 4))
    const original = block.toString('hex')
    assert.deepEqual(compressMedusaBlock(state, block), instructionTranslation(state, block), `case ${index}`)
    assert.equal(block.toString('hex'), original)
  }
})

test('digest initializer, nonstandard padding, and final XOR agree with the instruction-based reference', () => {
  // Constants transcribed from F2/F4, separate from the generated parameter file.
  const init = [0x79e0f2fb, 0xc8b52570, 0xebc2f8cd, 0x7c104d93]
  const finalXor = [0x19be4866, 0xe85986b4, 0xe19b326e, 0x71d1d7d4]
  const padding = Buffer.from('8496779dd4150bf8db6dbcb6d761e93eb5042bbabb5b5dafe1baeee3da211606924b1f0e7b173111bba78cfec0a06d6c85f826e1290e6ad4f30220aac57ff2fd', 'hex')
  for (const length of [0, 1, 3, 55, 56, 59, 60, 61, 63, 64, 65, 119, 120, 123, 124, 127, 128, 129, 1024]) {
    const input = Buffer.from(Array.from({ length }, (_, i) => (i * 131 + 0x80) & 255))
    const lowLength = Buffer.alloc(4)
    lowLength.writeUInt32LE((length * 8) >>> 0)
    const padLength = ((60 - length % 64) + 64) % 64 || 64
    const padded = Buffer.concat([input, padding.subarray(0, padLength), lowLength])
    let state = init.slice()
    for (let offset = 0; offset < padded.length; offset += 64) {
      state = instructionTranslation(state, padded.subarray(offset, offset + 64))
    }
    const expected = Buffer.alloc(16)
    state.forEach((word, i) => expected.writeUInt32LE((word ^ finalXor[i]) >>> 0, i * 4))
    assert.deepEqual(medusaDigest16(input), expected, `length ${length}`)
  }
})

test('recovered Argus path serializes one little-endian 32-bit word', () => {
  assert.equal(encodeArgusTimeWord(0), 'AAAAAA==')
  assert.equal(encodeArgusTimeWord(0x04030201), 'AQIDBA==')
  assert.equal(encodeArgusTimeWord(0xffffffff), '/////w==')
  for (const invalid of [-1, 0x100000000, 1.5, NaN, '1700000000', null]) {
    assert.throws(() => encodeArgusTimeWord(invalid))
  }
})

test('binary views honor offsets and malformed core inputs fail explicitly', () => {
  const storage = Buffer.alloc(80, 0xfe)
  const block = new Uint8Array(storage.buffer, storage.byteOffset + 8, 64)
  assert.deepEqual(compressMedusaBlock([0, 0, 0, 0], block), compressMedusaBlock([0, 0, 0, 0], Buffer.from(block)))
  for (const block of [Buffer.alloc(63), Buffer.alloc(65), 'x']) {
    assert.throws(() => compressMedusaBlock([0, 0, 0, 0], block))
  }
  for (const state of [[0, 0, 0], [0, 0, 0, -1], [0, 0, 0, 1.5]]) {
    assert.throws(() => compressMedusaBlock(state, Buffer.alloc(64)))
  }
  assert.throws(() => medusaDigest16('abc'))
})

test('incremental SDK digest updates preserve bytes across every block and padding boundary', () => {
  const input = crypto.createHash('sha512').update('sdk-stream').digest()
  const bytes = Buffer.concat([input, input, input, input, input])
  const expected = medusaDigest16(bytes)
  for (const size of [1, 3, 59, 60, 61, 63, 64, 65, 127, 128, 129, 1024]) {
    const digest = new MedusaDigest()
    for (let offset = 0; offset < bytes.length; offset += size) {
      const part = Buffer.from(bytes.subarray(offset, offset + size))
      digest.update(part).update(Buffer.alloc(0))
      part.fill(0) // SDK retains a copy of incomplete blocks.
    }
    assert.deepEqual(digest.digest(), expected, `chunk size ${size}`)
    const result = digest.digest()
    result.fill(0)
    assert.deepEqual(digest.digest(), expected)
    assert.throws(() => digest.update(Buffer.alloc(0)))
  }
})

test('both four-byte digest-tail branches match the unrolled native arithmetic', () => {
  for (let index = 0; index < 512; index += 1) {
    const digest = crypto.createHash('md5').update(`sdk-tail-${index}`).digest()
    const original = Buffer.from(digest)
    const eight = appendMedusaTail(digest, 8)
    const twelve = appendMedusaTail(digest, 12)
    assert.deepEqual(eight, tail8(digest))
    assert.deepEqual(twelve, tail12(digest))
    assert.equal(eight[16] & 4, 0)
    assert.equal(twelve[16] & 4, 4)
    assert.deepEqual(digest, original)
  }
  assert.throws(() => appendMedusaTail(Buffer.alloc(15), 8))
  assert.throws(() => appendMedusaTail(Buffer.alloc(16), undefined))
  assert.throws(() => appendMedusaTail(Buffer.alloc(16), 16))
})
