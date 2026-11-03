import { describe, expect, it } from 'vitest'
import { placeEvents } from './layout'
import { addDays, addMonths, dayStartUtc, dowOf, localDate, minutesOfDay, offsetAt, partsIn, startOfWeek, zonedToUtc } from './time'
import { validateIntervals } from './hours'

const NY = 'America/New_York'
describe('time zones and DST', () => {
  it('keeps 09:00 local across the spring-forward week (EST UTC-5 -> EDT UTC-4)', () => {
    expect(zonedToUtc(2026, 3, 6, 9, 0, NY).toISOString()).toBe('2026-03-06T14:00:00.000Z')
    expect(zonedToUtc(2026, 3, 9, 9, 0, NY).toISOString()).toBe('2026-03-09T13:00:00.000Z')
  })
  it('shifts a local time that does not exist (02:30 on 8 March 2026) forward by the gap', () => {
    expect(zonedToUtc(2026, 3, 8, 2, 30, NY).toISOString()).toBe('2026-03-08T07:30:00.000Z') // 03:30 EDT
  })
  it('spring-forward and fall-back days are 23 and 25 hours long', () => {
    expect((dayStartUtc('2026-03-09', NY).getTime() - dayStartUtc('2026-03-08', NY).getTime()) / 3600000).toBe(23)
    expect((dayStartUtc('2026-11-02', NY).getTime() - dayStartUtc('2026-11-01', NY).getTime()) / 3600000).toBe(25)
  })
  it('reads the provider-local date and minute of an instant, also half-hour zones', () => {
    expect(localDate('2026-01-12T03:30:00Z', 'Asia/Kolkata')).toBe('2026-01-12'); expect(minutesOfDay('2026-01-12T03:30:00Z', 'Asia/Kolkata')).toBe(9 * 60)
    expect(localDate('2026-01-12T01:00:00Z', 'America/Los_Angeles')).toBe('2026-01-11')
    expect(partsIn('2026-07-01T12:00:00Z', NY).h).toBe(8); expect(offsetAt(Date.UTC(2026, 6, 1), NY)).toBe(-240)
  })
  it('does calendar-day arithmetic without drifting over DST', () => {
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09'); expect(addDays('2026-12-31', 1)).toBe('2027-01-01'); expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
    expect(dowOf('2026-03-08')).toBe(0); expect(startOfWeek('2026-03-08')).toBe('2026-03-02'); expect(startOfWeek('2026-03-09')).toBe('2026-03-09')
  })
})

describe('event layout', () => {
  it('puts overlapping bookings side by side and lets later ones use the full width again', () => {
    const p = placeEvents([{ id: 'a', start: 540, end: 660 }, { id: 'b', start: 600, end: 720 }, { id: 'c', start: 780, end: 840 }])
    const by = Object.fromEntries(p.map((x) => [x.item.id, x]))
    expect(by.a.lanes).toBe(2); expect(by.b.lanes).toBe(2); expect(by.a.lane).not.toBe(by.b.lane); expect(by.c.lanes).toBe(1); expect(by.c.lane).toBe(0)
  })
})

describe('working-hours validation', () => {
  it('accepts several and touching intervals', () => {
    expect(validateIntervals([{ start: '09:00', end: '12:00' }, { start: '12:00', end: '17:00' }])).toBeNull()
    expect(validateIntervals([])).toBeNull()
  })
  it('rejects overlaps, reversed and malformed times', () => {
    expect(validateIntervals([{ start: '09:00', end: '12:00' }, { start: '11:00', end: '14:00' }])).toMatch(/overlaps/)
    expect(validateIntervals([{ start: '12:00', end: '09:00' }])).toMatch(/end after/)
    expect(validateIntervals([{ start: '9am', end: '5pm' }])).toMatch(/24-hour/)
  })
})
