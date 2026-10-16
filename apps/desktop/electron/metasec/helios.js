const crypto = require('node:crypto')
const { encryptSpeckPadded } = require('./speck')

/**
 * Full value construction for official module 0x43eb90/F0.
 * contextText is the C string at request-context +32; secret is its byte string
 * at +184. Their SDK initialization must be resolved by the caller, not guessed.
 * Native 18bb2c selects aid from the associated SDK context.
 */
function createHeliosValue({ timestampSeconds, contextText, aid, secret, nonce = crypto.randomBytes(4) }) {
  if (!Number.isInteger(timestampSeconds) || timestampSeconds < 0 || timestampSeconds > 0xffffffff) {
    throw new RangeError('timestampSeconds must be uint32')
  }
  if ([contextText, aid].some(value => typeof value !== 'string' || value.includes('\0'))) {
    throw new TypeError('SDK context text and aid must be C strings without embedded NUL')
  }
  if (!(secret instanceof Uint8Array)) throw new TypeError('SDK secret must be bytes')
  if (!(nonce instanceof Uint8Array) || nonce.byteLength !== 4) throw new TypeError('nonce must contain four bytes')
  const prefix = Buffer.from(nonce)
  const material = Buffer.concat([prefix, secret])
  // 2835f8 -> 283224 -> 26e878 + 1ab5d0: standard MD5, lower-case hex.
  // The 32 ASCII bytes of the hex are the key, not the 16 raw digest bytes.
  const key = Buffer.from(crypto.createHash('md5').update(material).digest('hex'), 'ascii')
  material.fill(0)
  const plain = Buffer.from(`${timestampSeconds}-${contextText}-${aid}`, 'utf8')
  const ciphertext = encryptSpeckPadded(plain, key)
  key.fill(0)
  plain.fill(0)
  return Buffer.concat([prefix, ciphertext]).toString('base64')
}

module.exports = { createHeliosValue }
