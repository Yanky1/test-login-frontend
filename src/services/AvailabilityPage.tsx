import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api'
import { useAuth } from '../auth'
import { Alert, Button, Skeleton } from '../components/ui'
import { PIcon, SelectField, TextField, Toggle } from '../products/ui'
import { servicesApi } from './api'
import { BlockDialog } from './BlockDialog'
import { DAYS, validateIntervals, type IntervalInput } from './hours'
import { useProviders } from './shared'
import { fmtDateTime, tzLabel } from './time'
import type { BlockDto, ProviderRow } from './types'
import './services.css'

type Week = Record<number, IntervalInput[]>
/** A sensible new interval: 9-17 for an empty day, otherwise the hour after the last one closes. */
export function nextInterval(list: IntervalInput[]): IntervalInput {
  if (!list.length) return { start: '09:00', end: '17:00' }
  const last = list[list.length - 1].end
  const m = last === '24:00' ? 1380 : Math.min(1380, Number(last.slice(0, 2)) * 60 + Number(last.slice(3)))
  const e = Math.min(1439, m + 60); const f = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
  return { start: f(m), end: f(e) }
}
type Overrides = { date: string; intervals: IntervalInput[] }[]
const zones = (() => { try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [] } catch { return [] } })()

/** Settings -> Availability: working hours, date overrides, time off, time zone and calendar feed of one provider. */
export default function AvailabilityPage({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth()
  const { data: provs, failed } = useProviders()
  const [pid, setPid] = useState('')
  const admin = user?.role === 'Owner' || user?.role === 'Admin' || user?.role == null
  useEffect(() => { if (provs && !pid) setPid((provs.providers.find((p) => p.isMe) ?? provs.providers[0])?.membershipId ?? '') }, [provs, pid])
  const row = provs?.providers.find((p) => p.membershipId === pid)
  const H = embedded ? 'h2' : 'h1'
  return (
    <main className={embedded ? '' : 'pwrap'} aria-labelledby="page-title">
      <H id="page-title" tabIndex={-1}>Availability</H>
      <p className="lead">When each team member can take bookings. Buyers only see times that are inside these hours and free.</p>
      <Alert>{failed ? 'Could not load your team.' : ''}</Alert>
      {!provs ? <Skeleton lines={6} /> : (
        <>
          {provs.providers.length > 1 && <SelectField id="av-who" label="Team member" value={pid} onChange={(e) => setPid(e.target.value)}>{provs.providers.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.email}{p.isMe ? ' (you)' : ''}{p.isProvider ? '' : ' - not a provider'}</option>)}</SelectField>}
          {row && <ProviderPanel key={row.membershipId} row={row} admin={admin} accountTz={provs.accountTimeZone} />}
        </>
      )}
    </main>
  )
}

function ProviderPanel({ row, admin, accountTz }: { row: ProviderRow; admin: boolean; accountTz: string }) {
  const [isProvider, setIsProvider] = useState(row.isProvider)
  const [tz, setTz] = useState(row.timeZone ?? '')
  const [dayRem, setDayRem] = useState(row.reminderDayBefore); const [hourRem, setHourRem] = useState(row.reminderHourBefore)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const savePrefs = async (patch: Parameters<typeof servicesApi.updateProvider>[1], ok: string) => {
    try { await servicesApi.updateProvider(row.membershipId, patch); setMsg({ kind: 'success', text: ok }) } catch (e) { setMsg({ kind: 'error', text: e instanceof ApiError ? e.message2 : 'Could not save.' }); throw e }
  }
  return (
    <>
      <Alert kind={msg?.kind}>{msg?.text}</Alert>
      <section className="pcard" aria-labelledby="av-prov-h">
        <h2 id="av-prov-h">Provider settings</h2>
        {admin ? <Toggle id="av-isprov" label="Takes bookings (is a service provider)" checked={isProvider} onChange={(v) => { setIsProvider(v); void savePrefs({ isProvider: v }, v ? 'Now a service provider.' : 'No longer a service provider.').catch(() => setIsProvider(!v)) }} hint="Only Owners and Admins can change this." />
          : <p>{isProvider ? 'You take bookings.' : 'You are not set up as a service provider. Ask an Owner or Admin.'}</p>}
        {isProvider && (
          <>
            <div className="row tight">
              <div className="field"><label htmlFor="av-tz">Time zone</label>
                <input id="av-tz" list="tz-list" value={tz} placeholder={accountTz} onChange={(e) => setTz(e.target.value)} />
                <datalist id="tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
                <div className="hint">Working hours are in this zone. Empty = the account's zone ({accountTz}, {tzLabel(accountTz)}).</div></div>
              <Button onClick={() => void savePrefs({ timeZone: tz }, 'Time zone saved.').catch(() => undefined)}>Save time zone</Button>
            </div>
            <Toggle id="av-rem-day" label="Email me the day before an appointment" checked={dayRem} onChange={(v) => { setDayRem(v); void savePrefs({ reminderDayBefore: v }, 'Reminder preference saved.').catch(() => setDayRem(!v)) }} />
            <Toggle id="av-rem-hour" label="Email me an hour before an appointment" checked={hourRem} onChange={(v) => { setHourRem(v); void savePrefs({ reminderHourBefore: v }, 'Reminder preference saved.').catch(() => setHourRem(!v)) }} />
          </>
        )}
      </section>
      {isProvider && <><Hours id={row.membershipId} /><TimeOff id={row.membershipId} tz={row.effectiveTimeZone} /><Feed id={row.membershipId} active={row.icsActive} /></>}
      {!isProvider && <p>Turn on "Takes bookings" to set working hours.</p>}
      <p className="hint">Services list who can perform them in the service editor (<Link to="/products?type=service">your services</Link>).</p>
    </>
  )
}

export function Hours({ id }: { id: string }) {
  const [week, setWeek] = useState<Week | null>(null); const [overrides, setOverrides] = useState<Overrides>([])
  const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false)
  useEffect(() => {
    let alive = true
    servicesApi.availability(id).then((a) => { if (!alive) return; const w: Week = {}; for (const d of a.weekly) w[d.day] = d.intervals; setWeek(w); setOverrides(a.overrides) }).catch(() => alive && setMsg({ kind: 'error', text: 'Could not load working hours.' }))
    return () => { alive = false }
  }, [id])
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h) }, [dirty])
  const setDay = (d: number, list: IntervalInput[]) => { setWeek((w) => ({ ...w, [d]: list })); setDirty(true); setErrors((e) => { const n = { ...e }; delete n[`d${d}`]; return n }) }
  const validate = () => {
    const e: Record<string, string> = {}
    for (const { d, n } of DAYS) { const m = validateIntervals(week?.[d] ?? []); if (m) e[`d${d}`] = `${n}: ${m}` }
    overrides.forEach((o, i) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) e[`o${i}`] = 'Choose a date.'; else { const m = validateIntervals(o.intervals); if (m) e[`o${i}`] = `${o.date}: ${m}` } })
    if (new Set(overrides.map((o) => o.date)).size !== overrides.length) e.dup = 'Each date can only appear once.'
    setErrors(e); return Object.keys(e).length === 0
  }
  const save = async () => {
    if (!validate()) { setMsg({ kind: 'error', text: 'Fix the highlighted hours first. Nothing was saved.' }); return }
    setBusy(true); setMsg(null)
    try {
      await servicesApi.saveAvailability(id, { weekly: DAYS.map(({ d }) => ({ day: d, intervals: week?.[d] ?? [] })).filter((x) => x.intervals.length), overrides })
      setDirty(false); setMsg({ kind: 'success', text: 'Working hours saved.' })
    } catch (e) { setMsg({ kind: 'error', text: e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : 'Could not save.' }) } finally { setBusy(false) }
  }
  if (!week) return <section className="pcard"><h2>Weekly hours</h2>{msg ? <Alert>{msg.text}</Alert> : <Skeleton lines={4} />}</section>
  return (
    <section className="pcard" aria-labelledby="av-week-h">
      <h2 id="av-week-h">Weekly hours</h2>
      <Alert kind={msg?.kind}>{msg?.text}</Alert>
      <div className="wk">
        {DAYS.map(({ d, n }) => {
          const list = week[d] ?? []
          return (
            <fieldset key={d} className="wk-row plain">
              <legend className="sr-only">{n}</legend>
              <strong aria-hidden="true">{n}</strong>
              <div className="ivs">
                {list.length === 0 && <div className="closed-note">Closed</div>}
                {list.map((iv, i) => (
                  <div key={i} className="iv">
                    <TextField label={`${n} opens`} type="time" value={iv.start} onChange={(e) => setDay(d, list.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} />
                    <TextField label={`${n} closes`} type="time" value={iv.end === '24:00' ? '23:59' : iv.end} onChange={(e) => setDay(d, list.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)))} />
                    <Button type="button" variant="ghost" onClick={() => setDay(d, list.filter((_, k) => k !== i))}><PIcon name="trash" /><span className="sr-only">Remove this {n} interval</span></Button>
                  </div>
                ))}
                <div className="row tight">
                  <Button type="button" onClick={() => setDay(d, [...list, nextInterval(list)])}><PIcon name="plus" /> Add hours<span className="sr-only"> for {n}</span></Button>
                  {d === 1 && list.length > 0 && <Button type="button" variant="ghost" onClick={() => { for (const x of [2, 3, 4, 5]) setDay(x, list.map((i) => ({ ...i }))) }}>Copy Monday to Tue–Fri</Button>}
                </div>
                {errors[`d${d}`] && <div className="field-error" role="alert">{errors[`d${d}`]}</div>}
              </div>
            </fieldset>
          )
        })}
      </div>
      <h3>Different hours on a date</h3>
      <p className="hint">Use this for a holiday with shorter hours, or to open a day you are normally closed. Leave a date with no hours to close it.</p>
      {overrides.map((o, i) => (
        <fieldset key={i} className="wk-row plain">
          <legend className="sr-only">Special date {i + 1}</legend>
          <TextField label={`Date ${i + 1}`} type="date" value={o.date} onChange={(e) => { setOverrides(overrides.map((x, k) => (k === i ? { ...x, date: e.target.value } : x))); setDirty(true) }} />
          <div className="ivs">
            {o.intervals.length === 0 && <div className="closed-note">Closed all day</div>}
            {o.intervals.map((iv, j) => (
              <div key={j} className="iv">
                <TextField label={`Date ${i + 1} opens`} type="time" value={iv.start} onChange={(e) => { setOverrides(overrides.map((x, k) => (k === i ? { ...x, intervals: x.intervals.map((y, m) => (m === j ? { ...y, start: e.target.value } : y)) } : x))); setDirty(true) }} />
                <TextField label={`Date ${i + 1} closes`} type="time" value={iv.end === '24:00' ? '23:59' : iv.end} onChange={(e) => { setOverrides(overrides.map((x, k) => (k === i ? { ...x, intervals: x.intervals.map((y, m) => (m === j ? { ...y, end: e.target.value } : y)) } : x))); setDirty(true) }} />
                <Button type="button" variant="ghost" onClick={() => { setOverrides(overrides.map((x, k) => (k === i ? { ...x, intervals: x.intervals.filter((_, m) => m !== j) } : x))); setDirty(true) }}><PIcon name="trash" /><span className="sr-only">Remove interval</span></Button>
              </div>
            ))}
            <div className="row tight">
              <Button type="button" onClick={() => { setOverrides(overrides.map((x, k) => (k === i ? { ...x, intervals: [...x.intervals, { start: '09:00', end: '13:00' }] } : x))); setDirty(true) }}><PIcon name="plus" /> Add hours</Button>
              <Button type="button" variant="ghost" onClick={() => { setOverrides(overrides.filter((_, k) => k !== i)); setDirty(true) }}>Remove this date<span className="sr-only"> {i + 1}</span></Button>
            </div>
            {errors[`o${i}`] && <div className="field-error" role="alert">{errors[`o${i}`]}</div>}
          </div>
        </fieldset>
      ))}
      {errors.dup && <div className="field-error" role="alert">{errors.dup}</div>}
      <div className="actions">
        <Button type="button" onClick={() => { setOverrides([...overrides, { date: '', intervals: [] }]); setDirty(true) }}><PIcon name="plus" /> Add a date</Button>
        <Button type="button" variant="primary" loading={busy} onClick={() => void save()}>Save working hours</Button>
        {dirty && <span role="status" className="hint">Unsaved changes</span>}
      </div>
    </section>
  )
}

function TimeOff({ id, tz }: { id: string; tz: string }) {
  const [blocks, setBlocks] = useState<BlockDto[] | null>(null); const [adding, setAdding] = useState(false); const [err, setErr] = useState(''); const [note, setNote] = useState('')
  const load = useCallback(() => servicesApi.blocks(id).then((r) => setBlocks(r.blocks)).catch(() => setErr('Could not load time off.')), [id])
  useEffect(() => { void load() }, [load])
  const upcoming = useMemo(() => (blocks ?? []).filter((b) => new Date(b.endAt) > new Date()), [blocks])
  return (
    <section className="pcard" aria-labelledby="av-off-h">
      <h2 id="av-off-h">Time off and blocks</h2>
      <Alert>{err}</Alert><Alert kind="info">{note}</Alert>
      {blocks && upcoming.length === 0 && <p>No time off planned.</p>}
      <ul className="plainlist">
        {upcoming.map((b) => (
          <li key={b.id} className="row tight"><span><strong>{b.kind === 'timeoff' ? 'Time off' : 'Busy'}</strong> · {b.allDay ? `${fmtDateTime(b.startAt, tz).split(',')[0]} – ${fmtDateTime(new Date(new Date(b.endAt).getTime() - 1), tz).split(',')[0]}` : `${fmtDateTime(b.startAt, tz)} – ${fmtDateTime(b.endAt, tz)}`}{b.note ? ` · ${b.note}` : ''}</span>
            <Button variant="ghost" onClick={() => void servicesApi.deleteBlock(id, b.id).then(load).catch(() => setErr('Could not remove it.'))}>Remove<span className="sr-only"> {b.kind === 'timeoff' ? 'time off' : 'block'} {b.note ?? ''}</span></Button></li>
        ))}
      </ul>
      <Button onClick={() => setAdding(true)}><PIcon name="plus" /> Add time off</Button>
      {adding && <BlockDialog providers={[{ membershipId: id, email: 'you', timeZone: tz }]} defaultProvider={id} tz={tz} onClose={() => setAdding(false)} onSaved={(n) => { setNote(n > 0 ? `${n} booking${n === 1 ? ' falls' : 's fall'} inside this time: reschedule or cancel ${n === 1 ? 'it' : 'them'}.` : ''); void load() }} />}
    </section>
  )
}

function Feed({ id, active }: { id: string; active: boolean }) {
  const [token, setToken] = useState<string | null>(null); const [on, setOn] = useState(active); const [err, setErr] = useState(''); const [copied, setCopied] = useState(false)
  const url = token ? `${location.origin}/api/calendar/feeds/${token}.ics` : ''
  const create = async () => { setErr(''); try { const r = await servicesApi.createIcs(id); setToken(r.token); setOn(true); setCopied(false) } catch { setErr('Could not create the link.') } }
  const revoke = async () => { if (!window.confirm('Stop sharing this calendar? Apps using the current link will stop updating.')) return; try { await servicesApi.revokeIcs(id); setToken(null); setOn(false) } catch { setErr('Could not stop sharing.') } }
  return (
    <section className="pcard ics-box" aria-labelledby="av-ics-h">
      <h2 id="av-ics-h">Calendar feed</h2>
      <p>Add your bookings to Google, Apple or Outlook Calendar with a private link. It is read-only and shows only the service, the time and the kind of location - never the customer's details. Anyone with the link can see it, so keep it private.</p>
      <Alert>{err}</Alert>
      {token && <><p role="status">Copy this link now: it is shown only once.</p><code data-testid="ics-url">{url}</code><Button onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy link'}</Button></>}
      <div className="actions">
        <Button onClick={() => void create()}>{on ? 'Generate a new link (the old one stops working)' : 'Create a private link'}</Button>
        {on && <Button variant="destructive" onClick={() => void revoke()}>Stop sharing</Button>}
      </div>
    </section>
  )
}
