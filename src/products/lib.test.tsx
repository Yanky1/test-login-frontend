import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { checkBarcode, stripBarcode } from './lib/barcode'
import { comboKey, combos, syncVariants } from './lib/variants'
import { Markdown } from './lib/markdown'
import { money, toNum } from './lib/format'

describe('barcode check digits (mirrors the server)', () => {
  it.each([
    ['036000291452', true, 'UPC-A'], ['036000291453', false, 'UPC-A'], ['0-36000-29145-2', true, 'UPC-A'],
    ['4006381333931', true, 'EAN-13'], ['4006381333932', false, 'EAN-13'], ['10012345678902', true, 'GTIN-14'], ['10012345678903', false, 'GTIN-14'],
    ['978-0-306-40615-7', true, 'ISBN-13'], ['9780306406158', false, 'ISBN-13'], ['0306406152', true, 'ISBN-10'], ['0306406153', false, null], ['96385074', true, 'EAN-8'],
    ['12345', false, null], ['12345678901A', false, null], ['', false, null],
  ])('%s -> valid=%s %s', (input, valid, type) => {
    const r = checkBarcode(input)
    expect(r.valid).toBe(valid)
    if (valid) expect(r.type).toBe(type); else expect(r.error).toBeTruthy()
  })
  it('ignores spaces and hyphens and upper-cases X', () => { expect(stripBarcode('0-30 6406-15x')).toBe('030640615X') })
})

describe('variations', () => {
  const opts = [{ name: 'Size', values: ['S', 'M'] }, { name: 'Color', values: ['Red', 'Blue', 'Green'] }]
  it('generates the cartesian product in option order', () => {
    const c = combos(opts)
    expect(c).toHaveLength(6); expect(c[0]).toEqual(['S', 'Red']); expect(c[1]).toEqual(['S', 'Blue']); expect(c[5]).toEqual(['M', 'Green'])
    expect(combos([])).toEqual([]); expect(combos([{ name: 'Size', values: [] }])).toEqual([])
  })
  it('keeps what the seller typed for combinations that survive an edit', () => {
    const grid = syncVariants(opts, [])
    grid[0] = { ...grid[0], sku: 'KEEP', price: 9, quantity: 4 }
    const next = syncVariants([{ name: 'Size', values: ['S', 'L'] }, opts[1]], grid)
    expect(next).toHaveLength(6)
    expect(next.find((v) => comboKey(v.values) === 's|red')).toMatchObject({ sku: 'KEEP', price: 9, quantity: 4 })
    expect(next.some((v) => v.values[0] === 'M')).toBe(false)
  })
})

describe('safe markdown preview', () => {
  it('renders formatting but never raw HTML or script links', () => {
    const { container } = render(<Markdown source={'# Title\n**bold** <script>alert(1)</script> <img src=x onerror=alert(1)> [bad](javascript:alert(1)) [ok](https://example.com)\n\n- one\n- two'} />)
    expect(container.querySelector('script, img')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: 'ok' })).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })
})

describe('format helpers', () => {
  it('parses and formats', () => { expect(toNum('')).toBeNull(); expect(toNum('12.5')).toBe(12.5); expect(toNum('abc')).toBeNull(); expect(money(19.9)).toBe('$19.90') })
})
