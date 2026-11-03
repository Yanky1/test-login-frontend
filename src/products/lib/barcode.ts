/** Mirrors the server's Barcode.Check: UPC-A, EAN-8, EAN-13, GTIN-14, ISBN-13, ISBN-10 with check digits. */
export interface BarcodeResult { valid: boolean; normalized: string; type: string | null; error: string | null }

export const stripBarcode = (s: string) => s.replace(/[\s-]/g, '').toUpperCase()

export function gs1Valid(d: string): boolean {
  if (d.length < 8 || /\D/.test(d)) return false
  let sum = 0
  for (let i = 0; i < d.length - 1; i++) sum += Number(d[d.length - 2 - i]) * (i % 2 === 0 ? 3 : 1)
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1])
}

export function isbn10Valid(s: string): boolean {
  if (s.length !== 10) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const c = s[i]
    const v = i === 9 && c === 'X' ? 10 : /\d/.test(c) ? Number(c) : NaN
    if (Number.isNaN(v)) return false
    sum += v * (10 - i)
  }
  return sum % 11 === 0
}

export function checkBarcode(input: string): BarcodeResult {
  const s = stripBarcode(input)
  if (!s) return { valid: false, normalized: '', type: null, error: 'Enter a barcode.' }
  if (s.length === 10) return isbn10Valid(s) ? { valid: true, normalized: s, type: 'ISBN-10', error: null } : { valid: false, normalized: s, type: null, error: 'This ISBN-10 has an invalid check digit.' }
  if (/\D/.test(s)) return { valid: false, normalized: s, type: null, error: 'Barcodes contain digits only.' }
  const type = ({ 8: 'EAN-8', 12: 'UPC-A', 13: /^97[89]/.test(s) ? 'ISBN-13' : 'EAN-13', 14: 'GTIN-14' } as Record<number, string>)[s.length]
  if (!type) return { valid: false, normalized: s, type: null, error: 'Use 8, 10, 12, 13 or 14 digits (EAN-8, ISBN-10, UPC-A, EAN-13/ISBN-13, GTIN-14).' }
  return gs1Valid(s) ? { valid: true, normalized: s, type, error: null } : { valid: false, normalized: s, type, error: `This ${type} has an invalid check digit - please re-check the number.` }
}
