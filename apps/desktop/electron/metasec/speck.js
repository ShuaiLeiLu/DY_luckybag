/**
 * X-Helios block encryption recovered from the pinned 40.7 SDK:
 * key schedule 0x2dc758, block module 0x43eb90/F1, padding 0x2dc510.
 * This component does not choose the SDK key or construct the complete header.
 */
const MASK = (1n << 64n) - 1n
const word = value => value & MASK
const ror = (value, bits) => word((value >> bits) | (value << (64n - bits)))

function bytes(value, length, name) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be bytes`)
  if (length !== null && value.byteLength !== length) throw new RangeError(`${name} must contain ${length} bytes`)
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}

function expandSpeckKey(input) {
  const key = bytes(input, 32, 'key')
  let a = key.readBigUInt64LE(0)
  const queue = [key.readBigUInt64LE(8), key.readBigUInt64LE(16), key.readBigUInt64LE(24)]
  const result = [a]
  for (let round = 0; round < 33; round += 1) {
    const next = word(ror(queue[round], 8n) + a) ^ BigInt(round)
    queue.push(next)
    a = ror(a, 61n) ^ next
    result.push(a)
  }
  return Object.freeze(result)
}

function requireRoundKeys(keys) {
  if (!Array.isArray(keys) || keys.length !== 34 || keys.some(key => typeof key !== 'bigint' || key < 0n || key > MASK)) {
    throw new TypeError('Expected 34 unsigned 64-bit round keys')
  }
}

function encryptBlock(block, keys) {
  let y = block.readBigUInt64LE(0)
  let x = block.readBigUInt64LE(8)
  for (const key of keys) {
    x = word(ror(x, 8n) + y) ^ key
    y = ror(y, 61n) ^ x
  }
  const result = Buffer.alloc(16)
  result.writeBigUInt64LE(y, 0)
  result.writeBigUInt64LE(x, 8)
  return result
}

function encryptSpeckBlock(input, roundKeys) {
  const block = bytes(input, 16, 'block')
  requireRoundKeys(roundKeys)
  return encryptBlock(block, roundKeys)
}

/** Native 0x2dc5fc..0x2dc6cc: PKCS#7 and independent 16-byte blocks. */
function encryptSpeckPadded(input, key) {
  const plain = bytes(input, null, 'input')
  const keys = expandSpeckKey(key)
  const padding = 16 - plain.length % 16
  const padded = Buffer.alloc(plain.length + padding, padding)
  plain.copy(padded)
  const result = Buffer.alloc(padded.length)
  for (let offset = 0; offset < padded.length; offset += 16) {
    encryptBlock(padded.subarray(offset, offset + 16), keys).copy(result, offset)
  }
  padded.fill(0)
  return result
}

module.exports = { expandSpeckKey, encryptSpeckBlock, encryptSpeckPadded }
