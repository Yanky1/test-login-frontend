import { createHmac } from 'node:crypto'

/** RFC 6238 (SHA-1, 30 s, 6 digits) for a base32 key: the same code an authenticator app shows. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, acc = 0; const bytes: number[] = []
  for (const ch of secret.replace(/[ =]/g, '').toUpperCase()) { acc = (acc << 5) | alphabet.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((acc >> (bits - 8)) & 0xff); bits -= 8 } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const o = h[h.length - 1] & 0x0f
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}
