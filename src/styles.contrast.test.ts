/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

/** WCAG contrast guard for the design tokens in src/styles.css (light + dark). Fails when a token pair drops below AA. */

function block(selector: string): string {
  const i = css.indexOf(selector)
  if (i < 0) throw new Error(`no block ${selector}`)
  let depth = 0
  for (let j = css.indexOf('{', i); j < css.length; j++) {
    if (css[j] === '{') depth++
    if (css[j] === '}' && --depth === 0) return css.slice(css.indexOf('{', i) + 1, j)
  }
  throw new Error('unbalanced')
}
function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
const light = vars(block(':root {'))
const dark = { ...light, ...vars(block(":root[data-theme='dark']")) }
// the media-query dark block must carry the same values as the explicit dark theme
const media = { ...light, ...vars(block(':root:not([data-theme=\'light\'])')) }

function lum(hex: string): number {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const hex = (t: Record<string, string>, k: string): string => {
  const v = t[k]
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${k} is not a 6-digit hex: ${v}`)
  return v
}

// [foreground token, background token, minimum ratio, what it is]
const PAIRS: [string, string, number, string][] = [
  ['--fg', '--bg', 4.5, 'body text'], ['--fg', '--surface', 4.5, 'text on card'], ['--fg', '--surface-2', 4.5, 'text on subtle fill'],
  ['--muted', '--surface', 4.5, 'secondary text'], ['--muted', '--surface-2', 4.5, 'secondary text on subtle'], ['--muted', '--seg-bg', 4.5, 'count on tab track'],
  ['--muted-2', '--surface', 4.5, 'helper text'], ['--muted-2', '--bg', 4.5, 'helper text on page'],
  ['--primary-fg', '--primary', 4.5, 'primary button / nav badge'], ['--primary-fg', '--primary-hover', 4.5, 'primary hover'],
  ['--link', '--surface', 4.5, 'link'], ['--link', '--bg', 4.5, 'link on page'], ['--link', '--primary-soft', 4.5, 'link on soft fill'],
  ['--ok', '--ok-soft', 4.5, 'success'], ['--err', '--err-soft', 4.5, 'error'], ['--err', '--surface', 4.5, 'error text'],
  ['--on-err', '--err', 4.5, 'count badge on error'], ['--warn', '--surface', 4.5, 'warning'], ['--gold-ink', '--gold-soft', 4.5, 'gold badge'],
  ['--on-gold', '--gold-2', 4.5, 'staff pill'], ['--seg-on-fg', '--seg-on', 4.5, 'active tab'], ['--fg', '--seg-bg', 4.5, 'idle tab'],
  ['--avatar-fg', '--avatar-bg', 4.5, 'avatar initials'],
  ['--border-strong', '--surface', 3, 'control border (non-text 3:1)'], ['--border-strong', '--bg', 3, 'control border on page'],
  ['--ring', '--surface', 3, 'focus ring'], ['--ring', '--bg', 3, 'focus ring on page'],
  ['--gold-ink', '--surface-2', 3, 'progress bar end on track'],
]
// sidebars are dark in both themes: they pin their own focus ring colour and use these fixed pairs
const SIDE: [string, string, number, string][] = [
  ['--ring', '--side', 3, 'focus ring in sidebar'], ['--side-fg-3', '--side', 4.5, 'sidebar group label'], ['--side-fg-2', '--side', 4.5, 'sidebar secondary'],
]

describe.each([['light', light], ['dark', dark], ['dark (prefers-color-scheme block)', media]] as const)('contrast: %s tokens', (_name, t) => {
  it.each(PAIRS)('%s on %s ≥ %s (%s)', (fg, bg, min) => {
    expect(ratio(hex(t, fg), hex(t, bg))).toBeGreaterThanOrEqual(min)
  })
})

describe('contrast: sidebars', () => {
  const ring = css.match(/\.sidenav, \.adm-nav \{ --ring: (#[0-9a-f]{6});/i)?.[1]
  it('pins a gold focus ring inside the dark sidebars', () => expect(ring).toBeTruthy())
  it('ring on sidebar and on the active item ≥ 3', () => {
    expect(ratio(ring!, hex(light, '--side'))).toBeGreaterThanOrEqual(3)
    expect(ratio(ring!, '#173d35')).toBeGreaterThanOrEqual(3) // --side-active composited on --side
  })
  it.each(SIDE.filter(([f]) => f !== '--ring'))('%s on %s ≥ %s (%s)', (fg, bg, min) => {
    expect(ratio(hex(light, fg), hex(light, bg))).toBeGreaterThanOrEqual(min)
  })
})
