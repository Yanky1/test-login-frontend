import { toMin } from './time'

export interface IntervalInput { start: string; end: string }
const T = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/

/** Validates one day's opening intervals; returns a plain-language problem or null. Touching intervals (12:00-14:00 then 14:00-16:00) are fine. */
export function validateIntervals(list: IntervalInput[]): string | null {
  if (list.length > 8) return 'At most 8 intervals per day.'
  for (const i of list) {
    if (!T.test(i.start) || !T.test(i.end) || i.start === '24:00') return 'Enter times like 09:00 (24-hour).'
    if (toMin(i.end) <= toMin(i.start)) return 'Each interval must end after it starts.'
  }
  const s = [...list].sort((a, b) => toMin(a.start) - toMin(b.start))
  for (let k = 1; k < s.length; k++) if (toMin(s[k].start) < toMin(s[k - 1].end)) return `${s[k - 1].start}–${s[k - 1].end} overlaps ${s[k].start}–${s[k].end}.`
  return null
}
export const DAYS = [{ d: 1, n: 'Monday' }, { d: 2, n: 'Tuesday' }, { d: 3, n: 'Wednesday' }, { d: 4, n: 'Thursday' }, { d: 5, n: 'Friday' }, { d: 6, n: 'Saturday' }, { d: 0, n: 'Sunday' }]
