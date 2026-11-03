/** Time-zone aware helpers (no library): every calendar screen shows the PROVIDER's zone, and DST changes move the UTC instants. */

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function dtf(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }); fmtCache.set(tz, f) }
  return f
}
export interface Parts { y: number; m: number; d: number; h: number; min: number; dow: number }
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function partsIn(date: Date | string | number, tz: string): Parts {
  const o: Record<string, string> = {}
  for (const p of dtf(tz).formatToParts(new Date(date))) o[p.type] = p.value
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, dow: DOW[o.weekday] ?? 0 }
}

/** Offset (minutes) of the zone from UTC at an instant. */
export function offsetAt(ms: number, tz: string): number {
  const p = partsIn(ms, tz)
  return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / 60000) * 60000) / 60000
}

/** The UTC instant of a wall-clock time in a zone. A time inside a spring-forward gap moves forward by the gap (02:30 -> 03:30). */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min)
  // An ambiguous time (fall back, 01:30 shows twice) resolves to STANDARD time, the later instant, like the backend's slot engine.
  const offs = new Set([offsetAt(guess - 86400000, tz), offsetAt(guess + 86400000, tz)])
  const valid: number[] = []
  for (const o of offs) { const t = guess - o * 60000; const b = partsIn(t, tz); if (b.h === h && b.min === min && b.d === d) valid.push(t) }
  if (valid.length) return new Date(Math.max(...valid))
  // nonexistent local time (spring-forward gap): shift forward by the size of the gap (02:30 -> 03:30)
  let t = guess - offsetAt(guess, tz) * 60000
  t = guess - offsetAt(t, tz) * 60000
  const back = partsIn(t, tz)
  if (back.h !== h || back.min !== min) t += (h * 60 + min - (back.h * 60 + back.min)) * 60000
  return new Date(t)
}

export const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (p: { y: number; m: number; d: number }) => `${p.y}-${pad(p.m)}-${pad(p.d)}`
export const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d } }
/** Calendar-date arithmetic in the zone's own days (no DST drift). */
export function addDays(s: string, n: number): string { const { y, m, d } = parseYmd(s); const x = new Date(Date.UTC(y, m - 1, d + n)); return ymd({ y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }) }
export const dowOf = (s: string) => { const { y, m, d } = parseYmd(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
export const startOfWeek = (s: string, weekStart = 1) => addDays(s, -((dowOf(s) - weekStart + 7) % 7))
export const startOfMonth = (s: string) => { const { y, m } = parseYmd(s); return ymd({ y, m, d: 1 }) }
export function addMonths(s: string, n: number): string { const { y, m } = parseYmd(s); const x = new Date(Date.UTC(y, m - 1 + n, 1)); return ymd({ y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: 1 }) }
export const daysInMonth = (s: string) => { const { y, m } = parseYmd(s); return new Date(Date.UTC(y, m, 0)).getUTCDate() }

export const localDate = (iso: string | Date, tz: string) => ymd(partsIn(iso, tz))
export const dayStartUtc = (s: string, tz: string) => { const p = parseYmd(s); return zonedToUtc(p.y, p.m, p.d, 0, 0, tz) }
/** Minutes (wall clock) from local midnight of day `d` where an interval starts and ends on that day; clamps to the day. DST days are 23/25 h long but the grid keeps 24 wall-clock rows, like the labels. */
export function spanOnDay(startAt: string | Date, endAt: string | Date, d: string, tz: string): { start: number; end: number } {
  const startsToday = localDate(startAt, tz) === d
  const endsToday = localDate(new Date(new Date(endAt).getTime() - 1), tz) === d
  return { start: startsToday ? minutesOfDay(startAt, tz) : 0, end: endsToday ? minutesOfDay(new Date(new Date(endAt).getTime() - 1), tz) + 1 : 1440 }
}
export const minutesOfDay = (iso: string | Date, tz: string) => { const p = partsIn(iso, tz); return p.h * 60 + p.min }

export const fmtTime = (iso: string | Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
export const fmtDate = (iso: string | Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))
export const fmtDateTime = (iso: string | Date, tz: string) => `${fmtDate(iso, tz)}, ${fmtTime(iso, tz)}`
export const fmtYmd = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) => { const p = parseYmd(s); return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(p.y, p.m - 1, p.d))) }
export const tzLabel = (tz: string, at: Date = new Date()) => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? tz

export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
export const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
export const toMin = (s: string) => { const [h, mm] = s.split(':').map(Number); return h * 60 + mm }
export const durationLabel = (min: number) => min % 60 === 0 ? `${min / 60} h` : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
