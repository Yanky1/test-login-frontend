import { useEffect, useState, type InputHTMLAttributes } from 'react'
import { ApiError } from '../api'
import { Alert, Skeleton } from '../components/ui'
import { deliveryApi, type DeliverySettings, type WindowDto, type ZoneDto } from './api'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const newZone = (): ZoneDto => ({ name: '', country: 'US', originLat: null, originLng: null, radiusKm: null, postcodes: [], feeCents: 0, freeOverCents: null, minOrderCents: 0, priority: 0, active: true })
const newWindow = (): WindowDto => ({ start: '12:00', end: '14:00', capacity: 5, days: [1, 2, 3, 4, 5], active: true })
const cents = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100))
const dollars = (c: number | null) => (c == null ? '' : String(c / 100))
const num = (v: string) => (v.trim() === '' ? null : Number(v))

/**
 * A text input that keeps what the person is typing ("5." or "11201, ") and only commits the parsed value; it re-reads the value only when it changed
 * from outside. (Formatting on every keystroke would eat the decimal point and the commas.)
 */
function Parsed<T>({ label, value, parse, format, onChange, ...rest }: { label: string; value: T; parse: (s: string) => T; format: (v: T) => string; onChange: (v: T) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(format(value))
  useEffect(() => { if (JSON.stringify(parse(text)) !== JSON.stringify(value)) setText(format(value)) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return <label>{label}<input {...rest} value={text} onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)) }} /></label>
}
const moneyIn = (v: string) => cents(v) ?? 0

/** Settings → Local delivery (Owner/Admin edit; others read). */
export default function DeliverySettingsPage({ canEdit = true }: { canEdit?: boolean }) {
  const [s, setS] = useState<DeliverySettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { deliveryApi.settings().then(setS).catch((e) => setError(e instanceof ApiError ? e.message2 : 'Could not load the settings.')) }, [])
  if (!s) return error ? <Alert>{error}</Alert> : <Skeleton lines={5} />
  const set = (p: Partial<DeliverySettings>) => { setS({ ...s, ...p }); setSaved(false) }
  const setZone = (i: number, p: Partial<ZoneDto>) => set({ zones: s.zones.map((z, j) => (j === i ? { ...z, ...p } : z)) })
  const setWin = (i: number, p: Partial<WindowDto>) => set({ windows: s.windows.map((w, j) => (j === i ? { ...w, ...p } : w)) })

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null)
    try { setS(await deliveryApi.saveSettings({ ...s, sameDayCutoff: s.sameDayCutoff || null })); setSaved(true) }
    catch (er) { setError(er instanceof ApiError ? (Object.values(er.fieldErrors())[0] ?? er.message2) : 'Could not save.') }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="stack" aria-label="Local delivery settings">
      <h2>Local delivery</h2>
      <p>Deliver nearby orders with your own drivers. Buyers see "Local delivery" at checkout when their address is inside a zone, and pick a time window.</p>
      {error && <Alert>{error}</Alert>}
      {saved && <Alert kind="success">Saved.</Alert>}
      <fieldset disabled={!canEdit || busy}>
        <label className="check"><input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Offer local delivery</label>
        <div className="grid2">
          <label>Time zone<input value={s.timeZone} onChange={(e) => set({ timeZone: e.target.value })} placeholder="America/New_York" /></label>
          <label>Same-day cutoff<input type="time" value={s.sameDayCutoff ?? ''} onChange={(e) => set({ sameDayCutoff: e.target.value })} aria-describedby="cutoff-h" /><small id="cutoff-h">Leave empty for no same-day delivery.</small></label>
          <label>Minimum lead time (minutes)<input type="number" min={0} max={1440} value={s.minLeadMinutes} onChange={(e) => set({ minLeadMinutes: Number(e.target.value) })} /></label>
          <label>Days ahead buyers can book<input type="number" min={0} max={30} value={s.maxDaysAhead} onChange={(e) => set({ maxDaysAhead: Number(e.target.value) })} /></label>
        </div>

        <h3>Delivery zones</h3>
        {s.zones.map((z, i) => (
          <fieldset key={z.id ?? i} className="zone" aria-label={`Zone ${i + 1}`}>
            <legend>Zone {i + 1}</legend>
            <div className="grid2">
              <label>Name<input value={z.name} onChange={(e) => setZone(i, { name: e.target.value })} /></label>
              <Parsed label="Delivery fee ($)" inputMode="decimal" value={z.feeCents} parse={moneyIn} format={dollars} onChange={(v) => setZone(i, { feeCents: v })} />
              <Parsed label="Free over ($)" inputMode="decimal" value={z.freeOverCents} parse={cents} format={dollars} onChange={(v) => setZone(i, { freeOverCents: v })} />
              <Parsed label="Minimum order ($)" inputMode="decimal" value={z.minOrderCents} parse={moneyIn} format={dollars} onChange={(v) => setZone(i, { minOrderCents: v })} />
              <Parsed label="Postcodes (comma separated, 112* = prefix)" value={z.postcodes} parse={(t) => t.split(',').map((p) => p.trim()).filter(Boolean)} format={(v) => v.join(', ')} onChange={(v) => setZone(i, { postcodes: v })} />
              <Parsed label="Radius (km)" inputMode="decimal" value={z.radiusKm} parse={num} format={(v) => v == null ? '' : String(v)} onChange={(v) => setZone(i, { radiusKm: v })} />
              <Parsed label="Origin latitude" inputMode="decimal" value={z.originLat} parse={num} format={(v) => v == null ? '' : String(v)} onChange={(v) => setZone(i, { originLat: v })} />
              <Parsed label="Origin longitude" inputMode="decimal" value={z.originLng} parse={num} format={(v) => v == null ? '' : String(v)} onChange={(v) => setZone(i, { originLng: v })} />
            </div>
            <button type="button" className="btn" onClick={() => set({ zones: s.zones.filter((_, j) => j !== i) })}>Remove zone {i + 1}</button>
          </fieldset>
        ))}
        <button type="button" className="btn" onClick={() => set({ zones: [...s.zones, newZone()] })}>Add zone</button>

        <h3>Delivery windows</h3>
        {s.windows.map((w, i) => (
          <fieldset key={w.id ?? i} className="zone" aria-label={`Window ${i + 1}`}>
            <legend>Window {i + 1}</legend>
            <div className="grid2">
              <label>From<input type="time" value={w.start} onChange={(e) => setWin(i, { start: e.target.value })} /></label>
              <label>To<input type="time" value={w.end} onChange={(e) => setWin(i, { end: e.target.value })} /></label>
              <label>Deliveries per window<input type="number" min={1} max={500} value={w.capacity} onChange={(e) => setWin(i, { capacity: Number(e.target.value) })} /></label>
            </div>
            <div role="group" aria-label={`Days for window ${i + 1}`} className="days">
              {DAYS.map((d, n) => <label key={d} className="check"><input type="checkbox" checked={w.days.includes(n)} onChange={(e) => setWin(i, { days: e.target.checked ? [...w.days, n] : w.days.filter((x) => x !== n) })} /> {d}</label>)}
            </div>
            <button type="button" className="btn" onClick={() => set({ windows: s.windows.filter((_, j) => j !== i) })}>Remove window {i + 1}</button>
          </fieldset>
        ))}
        <button type="button" className="btn" onClick={() => set({ windows: [...s.windows, newWindow()] })}>Add window</button>
      </fieldset>
      {canEdit && <button type="submit" className="btn primary" disabled={busy}>Save delivery settings</button>}
    </form>
  )
}
