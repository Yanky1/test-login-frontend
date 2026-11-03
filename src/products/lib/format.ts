export const money = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }))
/** '' -> null, otherwise a finite number (or NaN-safe null). */
export const toNum = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null }
export const numStr = (n: number | null | undefined) => (n == null ? '' : String(n))
export const scoreLabel = (s: number) => (s >= 80 ? 'Great' : s >= 50 ? 'Good' : 'Needs work')
export const scoreTone = (s: number) => (s >= 80 ? 'ok' : s >= 50 ? 'warn' : 'bad')
