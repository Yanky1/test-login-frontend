import type { TrackingStatus } from './api'

export const TRACK_LABEL: Record<TrackingStatus, string> = {
  pre_transit: 'Label created', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered', available_for_pickup: 'Ready for pickup',
  return_to_sender: 'Returning to sender', failure: 'Delivery problem', unknown: 'No updates yet',
}
export const trackLabel = (s: string) => TRACK_LABEL[s as TrackingStatus] ?? 'No updates yet'
/** Chip tone for a tracking status (colour is never the only signal: the word is always shown). */
export const trackTone = (s: string): 'ok' | 'warn' | 'bad' | '' => s === 'delivered' ? 'ok' : s === 'failure' || s === 'return_to_sender' ? 'bad' : s === 'available_for_pickup' ? 'warn' : ''
/** The order list's one-word summary ('exception' covers failure and return to sender). */
export const summaryLabel = (s: string | null | undefined) => (s === 'exception' ? 'Delivery problem' : s ? trackLabel(s) : '')
export const summaryTone = (s: string | null | undefined) => (s === 'exception' ? 'bad' : s ? trackTone(s) : '')

export const LABEL_STATUS: Record<string, string> = { active: 'Ready', voiding: 'Refund pending', voided: 'Voided', refundfailed: 'Refund refused', purchasing: 'Buying…', failed: 'Failed' }
export const SPEED_LABEL: Record<string, string> = { standard: 'Standard', expedited: 'Expedited', overnight: 'Overnight' }
export const CONTENTS = [['merchandise', 'Merchandise'], ['gift', 'Gift'], ['sample', 'Commercial sample'], ['documents', 'Documents'], ['returned_goods', 'Returned goods'], ['other', 'Other']] as const

export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random())
export const mm = (n: number) => `${n} mm`
export const grams = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 2)} kg` : `${g} g`)

/** Dates in the ACCOUNT's time zone (the one the calendar uses), not the browser's; falls back to the browser zone only when the order carries none. */
const zoned = (tz: string | undefined, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => { if (!tz) return o; try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return { ...o, timeZone: tz } } catch { return o } }
export const dtZ = (iso: string | null | undefined, tz?: string) => (iso ? new Date(iso).toLocaleString(undefined, zoned(tz, { dateStyle: 'medium', timeStyle: 'short' })) : '')
export const dayZ = (iso: string | null | undefined, tz?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, zoned(tz, { dateStyle: 'medium' })) : '')
