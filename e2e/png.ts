import { deflateSync, crc32 } from 'node:zlib'

/** A valid grayscale PNG (solid light background with a dark square) - real pixels so browsers render it. */
export function makePng(w = 1200, h = 1200): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0
  const rows: Buffer[] = []
  for (let y = 0; y < h; y++) { const r = Buffer.alloc(w + 1, 245); r[0] = 0; if (y > h / 3 && y < (2 * h) / 3) r.fill(60, Math.floor(w / 3) + 1, Math.floor((2 * w) / 3) + 1); rows.push(r) }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
