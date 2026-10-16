/**
 * Pure protocol arithmetic reconstructed from the pinned Douyin 40.7 ELF.
 * Digest component for the pure protocol SDK. Not a complete header signer.
 * See docs/reverse-engineering/native-qr-login-2026-10-15.md, section 12.
 */
const parameters = require('./digest-parameters.json')
const constants = parameters.round_constants.slice()
const schedule = parameters.message_schedule.slice()
const shifts = parameters.left_rotations.slice()
const initialState = parameters.initial_state.slice()
const finalXor = parameters.final_xor.slice()
const padding = Buffer.from(parameters.padding_hex, 'hex')

function requireBytes(value, name) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be bytes`)
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}

/** Module 0x4420f0, exported F7: 64 rounds, custom constants AND word order. */
function compressMedusaBlock(state, input) {
  if ((!Array.isArray(state) && !(state instanceof Uint32Array)) || state.length !== 4 ||
      Array.from(state).some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
    throw new TypeError('state must contain four uint32 words')
  }
  const block = requireBytes(input, 'block')
  if (block.length !== 64) throw new RangeError('block must contain exactly 64 bytes')
  let [a, b, c, d] = state
  for (let round = 0; round < 64; round += 1) {
    let mix
    if (round < 16) mix = (b & c) | (~b & d)
    else if (round < 32) mix = (d & b) | (~d & c)
    else if (round < 48) mix = b ^ c ^ d
    else mix = c ^ (b | ~d)
    const sum = (a + mix + constants[round] + block.readUInt32LE(schedule[round] * 4)) | 0
    const shift = shifts[round]
    const next = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0
    a = d
    d = c
    c = b
    b = next
  }
  return [a, b, c, d].map((word, index) => (word + state[index]) >>> 0)
}

/**
 * Exported F2 -> F3 -> F4 arithmetic, before F1 adds four state-dependent bytes.
 * This returns 16 bytes, NOT the complete 20-byte value used by the caller.
 * Native F4 pads to byte 60 and appends only the low 32 bits of the bit length.
 */
function medusaDigest16(input) {
  return new MedusaDigest().update(input).digest()
}

/** F2/F3/F4 context. The byte count is retained across update calls. */
class MedusaDigest {
  #state = initialState.slice()
  #pending = Buffer.alloc(64)
  #pendingLength = 0
  #byteCount = 0n
  #result = null

  update(input) {
    if (this.#result) throw new Error('Digest has already been finalized')
    const bytes = requireBytes(input, 'input')
    this.#byteCount += BigInt(bytes.length)
    let offset = 0
    if (this.#pendingLength) {
      const take = Math.min(64 - this.#pendingLength, bytes.length)
      bytes.copy(this.#pending, this.#pendingLength, 0, take)
      offset = take
      this.#pendingLength += take
      if (this.#pendingLength === 64) {
        this.#state = compressMedusaBlock(this.#state, this.#pending)
        this.#pendingLength = 0
      }
    }
    while (offset + 64 <= bytes.length) {
      this.#state = compressMedusaBlock(this.#state, bytes.subarray(offset, offset + 64))
      offset += 64
    }
    if (offset < bytes.length) {
      bytes.copy(this.#pending, 0, offset)
      this.#pendingLength = bytes.length - offset
    }
    return this
  }

  digest() {
    if (!this.#result) {
      const remaining = this.#pendingLength
      const padLength = (remaining < 60 ? 60 : 124) - remaining
      const tail = Buffer.alloc(remaining + padLength + 4)
      this.#pending.copy(tail, 0, 0, remaining)
      padding.copy(tail, remaining, 0, padLength)
      tail.writeUInt32LE(Number((this.#byteCount * 8n) & 0xffffffffn), tail.length - 4)
      for (let offset = 0; offset < tail.length; offset += 64) {
        this.#state = compressMedusaBlock(this.#state, tail.subarray(offset, offset + 64))
      }
      this.#result = Buffer.alloc(16)
      this.#state.forEach((word, index) => this.#result.writeUInt32LE((word ^ finalXor[index]) >>> 0, index * 4))
      this.#pending.fill(0)
      tail.fill(0)
    }
    return Buffer.from(this.#result)
  }
}

/**
 * Export F5/F6, bodies 6/5: append the four-byte checksum and set bit 2.
 * The caller must select the recovered 8- or 12-byte branch explicitly.
 * F1's later SDK-dependent bit 5 and F0's bit 7 are not set by this component.
 */
function appendMedusaTail(input, tailLength) {
  const digest = requireBytes(input, 'digest')
  if (digest.length !== 16) throw new RangeError('digest must contain exactly 16 bytes')
  if (tailLength !== 8 && tailLength !== 12) throw new RangeError('tailLength must be 8 or 12')
  let checksum = 0x20220420
  for (let index = 0; index < tailLength; index += 1) {
    if (index & 1) checksum = ~((checksum ^ (checksum >>> 5)) ^ ((checksum << 11) | digest[index]))
    else checksum ^= (checksum << 7) ^ (checksum >>> 3) ^ digest[index]
  }
  const result = Buffer.alloc(20)
  digest.copy(result)
  result.writeUInt32LE(checksum >>> 0, 16)
  if (tailLength === 12) result[16] |= 4
  else result[16] &= 0xfb
  return result
}

/** The X-Argus value in the recovered header-assembly path, not a universal signer. */
function encodeArgusTimeWord(timeWord) {
  if (!Number.isInteger(timeWord) || timeWord < 0 || timeWord > 0xffffffff) {
    throw new RangeError('timeWord must be uint32')
  }
  const value = Buffer.alloc(4)
  value.writeUInt32LE(timeWord)
  return value.toString('base64')
}

module.exports = { MedusaDigest, compressMedusaBlock, medusaDigest16, appendMedusaTail, encodeArgusTimeWord }
