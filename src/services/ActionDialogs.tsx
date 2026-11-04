import { useEffect, useState, type ReactNode } from 'react'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { AreaField, Dialog, SelectField, TextField } from '../products/ui'
import { servicesApi } from './api'
import { addDays, dayStartUtc, localDate, minutesOfDay, pad, parseYmd, tzLabel, zonedToUtc } from './time'

export const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : 'Something went wrong. Try again.')

/** Converts a date ("2026-12-09") and a time ("14:30") typed in a zone to a UTC ISO string; null when either is missing/invalid. */
export function toIso(date: string, time: string, tz: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const p = parseYmd(date); const [h, m] = time.split(':').map(Number)
  return zonedToUtc(p.y, p.m, p.d, h, m, tz).toISOString()
}

function Shell({ title, onClose, busy, err, children, confirm, destructive, onConfirm, disabled }: { title: string; onClose: () => void; busy: boolean; err: string; children: ReactNode; confirm: string; destructive?: boolean; onConfirm: () => void; disabled?: boolean }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onConfirm() }} noValidate>
        {children}
        <Alert>{err}</Alert>
        <div className="dialog-actions">
          <Button type="button" onClick={onClose}>Keep as it is</Button>
          <Button type="submit" variant={destructive ? 'destructive' : 'primary'} loading={busy} disabled={disabled}>{confirm}</Button>
        </div>
      </form>
    </Dialog>
  )
}

function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(''); try { await fn(); onClose() } catch (e) { setErr(errText(e)); setBusy(false) } }
  return { busy, err, run, setErr }
}

/** Pick a date and a time in the PROVIDER's zone (the zone is always stated, so there is no guessing). */
export interface SlotQuery { serviceId: string; bookingId: string }

/**
 * The free start times of one local day for moving a booking, from the same engine the marketplace uses; picking one fills the time field (typing a time stays possible).
 * Labels are wall-clock times; on the day the clocks go back two slots share a label, so the zone abbreviation is added to those and the exact instant is what gets picked.
 */
export function SlotChoices({ query, date, tz, selectedIso, onPick }: { query: SlotQuery; date: string; tz: string; selectedIso: string | null; onPick: (iso: string, hhmm: string) => void }) {
  const [state, setState] = useState<{ slots: { iso: string; label: string }[] } | 'loading' | 'failed' | 'nodate'>('loading')
  useEffect(() => {
    let alive = true
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setState('nodate'); return }
    setState('loading')
    servicesApi.slots(query.serviceId, { bookingId: query.bookingId, from: dayStartUtc(date, tz).toISOString(), to: dayStartUtc(addDays(date, 1), tz).toISOString() })
      .then((r) => {
        if (!alive) return
        const wall = r.slots.map((s) => { const m = minutesOfDay(s.startAt, tz); return { iso: new Date(s.startAt).toISOString(), hhmm: `${pad(Math.floor(m / 60))}:${pad(m % 60)}` } })
        const count = new Map<string, number>(); for (const w of wall) count.set(w.hhmm, (count.get(w.hhmm) ?? 0) + 1)
        setState({ slots: wall.map((w) => ({ iso: w.iso, label: (count.get(w.hhmm) ?? 0) > 1 ? `${w.hhmm} ${tzLabel(tz, new Date(w.iso))}` : w.hhmm })) })
      })
      .catch(() => alive && setState('failed'))
    return () => { alive = false }
  }, [query.serviceId, query.bookingId, date, tz])
  if (state === 'nodate') return <p className="hint" role="status">Choose a date to see the free times.</p>
  if (state === 'loading') return <p className="hint" role="status">Looking for free times…</p>
  if (state === 'failed') return <p className="hint" role="status">Couldn't load the free times. You can still type a time.</p>
  if (state.slots.length === 0) return <p className="hint" role="status">No free times on this day. Try another date, or type a time.</p>
  return (
    <div role="group" aria-label="Free start times on this day" className="slot-choices">
      {state.slots.map((s) => <button key={s.iso} type="button" className={`btn${s.iso === selectedIso ? ' primary' : ''}`} aria-pressed={s.iso === selectedIso} onClick={() => onPick(s.iso, s.label.slice(0, 5))}>{s.label}</button>)}
    </div>
  )
}

export function TimeDialog({ title, tz, initial, confirm, hint, slotQuery, onSubmit, onClose }: { title: string; tz: string; initial?: string; confirm: string; hint?: ReactNode; slotQuery?: SlotQuery; onSubmit: (iso: string) => Promise<unknown>; onClose: () => void }) {
  const base = initial ?? new Date(Date.now() + 2 * 86400000).toISOString()
  const [date, setDate] = useState(localDate(base, tz))
  const m = minutesOfDay(base, tz)
  const [time, setTime] = useState(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  const [exact, setExact] = useState<string | null>(null)   // the instant of a picked slot; typing a date or time drops it (an ambiguous clock time is not enough to say which one was meant)
  const s = useSubmit(onClose)
  const iso = exact ?? toIso(date, time, tz)
  return (
    <Shell title={title} onClose={onClose} busy={s.busy} err={s.err} confirm={confirm} disabled={!iso} onConfirm={() => iso && void s.run(() => onSubmit(iso))}>
      <p className="tz-note">Time zone: {tz}</p>
      <div className="grid2">
        <TextField id="td-date" label="Date" type="date" value={date} min={localDate(new Date(), tz)} max={addDays(localDate(new Date(), tz), 400)} onChange={(e) => { setDate(e.target.value); setExact(null) }} />
        <TextField id="td-time" label="Start time" type="time" value={time} step={300} onChange={(e) => { setTime(e.target.value); setExact(null) }} />
      </div>
      {slotQuery && <SlotChoices query={slotQuery} date={date} tz={tz} selectedIso={exact} onPick={(i, hhmm) => { setTime(hhmm); setExact(i) }} />}
      {hint && <p className="hint">{hint}</p>}
    </Shell>
  )
}

/** A question with no input: confirm before something that cannot be undone. */
export function ConfirmDialog({ title, message, confirm, destructive, onSubmit, onClose }: { title: string; message: ReactNode; confirm: string; destructive?: boolean; onSubmit: () => Promise<unknown>; onClose: () => void }) {
  const s = useSubmit(onClose)
  return <Shell title={title} onClose={onClose} busy={s.busy} err={s.err} confirm={confirm} destructive={destructive} onConfirm={() => void s.run(onSubmit)}><p>{message}</p></Shell>
}

export function ReasonDialog({ title, label, required, confirm, destructive, hint, onSubmit, onClose }: { title: string; label: string; required?: boolean; confirm: string; destructive?: boolean; hint?: ReactNode; onSubmit: (reason: string) => Promise<unknown>; onClose: () => void }) {
  const [reason, setReason] = useState(''); const [touched, setTouched] = useState(false)
  const s = useSubmit(onClose)
  const missing = required && !reason.trim()
  return (
    <Shell title={title} onClose={onClose} busy={s.busy} err={s.err} confirm={confirm} destructive={destructive} onConfirm={() => { setTouched(true); if (!missing) void s.run(() => onSubmit(reason.trim())) }}>
      {hint && <p>{hint}</p>}
      <AreaField id="rd-reason" label={label} rows={3} value={reason} maxLength={500} error={touched && missing ? 'Write a short reason.' : undefined} optional={!required} onChange={(e) => setReason(e.target.value)} />
    </Shell>
  )
}

export function CompleteDialog({ hourly, bookedMinutes, increment, onSubmit, onClose }: { hourly: boolean; bookedMinutes: number; increment: number; onSubmit: (actual: number | null) => Promise<unknown>; onClose: () => void }) {
  const [actual, setActual] = useState(String(bookedMinutes)); const [touched, setTouched] = useState(false)
  const s = useSubmit(onClose)
  const n = Number(actual)
  const bad = hourly && (!Number.isInteger(n) || n < 1 || n > 1440)
  const billed = hourly && !bad ? Math.ceil(n / increment) * increment : 0
  return (
    <Shell title="Complete this booking" onClose={onClose} busy={s.busy} err={s.err} confirm="Mark as completed" onConfirm={() => { setTouched(true); if (!bad) void s.run(() => onSubmit(hourly ? n : actual.trim() === '' ? null : n)) }}>
      <TextField id="cd-actual" label={hourly ? 'Time actually worked (minutes)' : 'Time worked (minutes)'} optional={!hourly} inputMode="numeric" value={actual} error={touched && bad ? 'Enter the minutes worked (1-1440).' : undefined} onChange={(e) => setActual(e.target.value)}
        hint={hourly ? `Booked: ${bookedMinutes} minutes. You bill in steps of ${increment} minutes.` : undefined} />
      {hourly && !bad && billed > bookedMinutes && <p className="alert info" role="status">That is {billed - bookedMinutes} minutes more than booked. We'll ask the marketplace to charge the extra time; the booked price doesn't change.</p>}
    </Shell>
  )
}

export function ReassignDialog({ providers, current, onSubmit, onClose }: { providers: { membershipId: string; email: string }[]; current: string; onSubmit: (id: string) => Promise<unknown>; onClose: () => void }) {
  const others = providers.filter((p) => p.membershipId !== current)
  const [id, setId] = useState(others[0]?.membershipId ?? '')
  const s = useSubmit(onClose)
  return (
    <Shell title="Assign to another team member" onClose={onClose} busy={s.busy} err={s.err} confirm="Reassign" disabled={!id} onConfirm={() => void s.run(() => onSubmit(id))}>
      {others.length === 0 ? <p>No other team member can perform this service.</p> : (
        <SelectField id="ra-who" label="Team member" value={id} onChange={(e) => setId(e.target.value)} hint="They must be free at that time.">{others.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.email}</option>)}</SelectField>
      )}
    </Shell>
  )
}
