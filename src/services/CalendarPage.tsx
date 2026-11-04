import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button, Skeleton } from '../components/ui'
import { useBrands } from '../pages/teams/BrandContext'
import { productsApi } from '../products/api'
import { Dialog, PIcon, SelectField } from '../products/ui'
import { servicesApi } from './api'
import { TimeDialog } from './ActionDialogs'
import { BlockDetail, BlockDialog } from './BlockDialog'
import { placeEvents } from './layout'
import { BookingStatusChip, LOCATION_LABEL, statusLabel, useProviders } from './shared'
import { addDays, addMonths, dayStartUtc, daysInMonth, fmtTime, fmtYmd, localDate, minutesOfDay, parseYmd, spanOnDay, startOfMonth, startOfWeek, tzLabel, ymd } from './time'
import type { BlockDto, CalendarBooking, CalendarData } from './types'
import './services.css'

export type View = 'day' | 'week' | 'month' | 'agenda'
const VIEWS: { id: View; label: string }[] = [{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'agenda', label: 'List' }]
const HH = 48

/** Visible date range of a view (inclusive first day, exclusive last day), in the display zone's calendar days. */
export function rangeOf(view: View, anchor: string): { first: string; last: string; days: string[] } {
  let first = anchor; let n = 1
  if (view === 'week') { first = startOfWeek(anchor); n = 7 }
  else if (view === 'month') { first = startOfWeek(startOfMonth(anchor)); n = 42 }
  else if (view === 'agenda') { first = anchor; n = 14 }
  return { first, last: addDays(first, n), days: Array.from({ length: n }, (_, i) => addDays(first, i)) }
}
export function stepAnchor(view: View, anchor: string, dir: -1 | 1): string {
  if (view === 'day') return addDays(anchor, dir)
  if (view === 'week') return addDays(anchor, 7 * dir)
  if (view === 'agenda') return addDays(anchor, 14 * dir)
  return addMonths(anchor, dir)
}

export default function CalendarPage() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const { data: provs, tz: acctTz } = useProviders()
  const { selected: brandSel } = useBrands()
  const small = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 759px)').matches
  const view = (sp.get('view') as View) || (small ? 'agenda' : 'week')
  const providerId = sp.get('provider') ?? ''; const serviceId = sp.get('service') ?? ''
  const brandId = brandSel === 'all' ? '' : brandSel
  const [services, setServices] = useState<{ id: string; title: string }[]>([])
  const [data, setData] = useState<CalendarData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<CalendarBooking | null>(null)
  const [blockSel, setBlockSel] = useState<BlockDto | null>(null)
  const [blocking, setBlocking] = useState<string | null>(null)
  const [moving, setMoving] = useState<CalendarBooking | null>(null)
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(() => new Date())
  const reqId = useRef(0)

  const filterProvider = provs?.providers.find((p) => p.membershipId === providerId)
  const tz = filterProvider?.effectiveTimeZone ?? (provs?.providers.length === 1 && !provs.providers[0].isMe ? provs.providers[0].effectiveTimeZone : provs?.providers.find((p) => p.isMe && p.isProvider && !providerId && provs.providers.length === 1)?.effectiveTimeZone) ?? acctTz
  const today = localDate(now, tz)
  const anchor = sp.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date')!) ? sp.get('date')! : today
  const range = useMemo(() => rangeOf(view, anchor), [view, anchor])

  useEffect(() => { document.title = 'Calendar - Solvelt' }, [])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  useEffect(() => { productsApi.list({ type: 'service', pageSize: 100 }).then((r) => setServices(r.items.map((i) => ({ id: i.id, title: i.title })))).catch(() => undefined) }, [])

  const load = useCallback(async () => {
    if (!provs) return
    const my = ++reqId.current
    setLoading(true); setError('')
    try {
      const d = await servicesApi.calendar({ from: dayStartUtc(range.first, tz).toISOString(), to: dayStartUtc(range.last, tz).toISOString(), providerId: providerId || undefined, brandId: brandId || undefined, serviceId: serviceId || undefined })
      if (my === reqId.current) setData(d)
    } catch (e) { if (my === reqId.current) setError(e instanceof ApiError ? e.message2 : 'Could not load the calendar.') }
    finally { if (my === reqId.current) setLoading(false) }
  }, [provs, range, tz, providerId, brandId, serviceId])
  useEffect(() => { void load() }, [load])

  const update = (o: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(o)) { if (v) n.set(k, v); else n.delete(k) }; setSp(n, { replace: true }) }
  const go = (a: string) => update({ date: a === today ? '' : a })
  const providersForBlock = (provs?.providers ?? []).filter((p) => p.isProvider).map((p) => ({ membershipId: p.membershipId, email: p.email, timeZone: p.effectiveTimeZone }))
  const myProvider = provs?.providers.find((p) => p.isMe && p.isProvider)
  const bookingsByDay = useMemo(() => {
    const m = new Map<string, CalendarBooking[]>()
    for (const b of data?.bookings ?? []) {
      const s = localDate(b.startAt, tz); const e = localDate(new Date(new Date(b.endAt).getTime() - 1), tz)
      for (let d = s; d <= e; d = addDays(d, 1)) (m.get(d) ?? m.set(d, []).get(d)!).push(b)
    }
    for (const l of m.values()) l.sort((a, b) => a.startAt.localeCompare(b.startAt))
    return m
  }, [data, tz])

  const title = view === 'month' ? fmtYmd(startOfMonth(anchor), { month: 'long', year: 'numeric' }) : view === 'day' ? fmtYmd(anchor) : `${fmtYmd(range.first, { month: 'short', day: 'numeric' })} – ${fmtYmd(addDays(range.last, -1), { month: 'short', day: 'numeric', year: 'numeric' })}`
  const providerName = (id: string) => data?.providers.find((p) => p.membershipId === id)?.email ?? ''

  return (
    <main className="pwrap" aria-labelledby="page-title">
      <header className="cal-bar">
        <h1 id="page-title" tabIndex={-1} className="grow">Calendar</h1>
        {providersForBlock.length > 0 && <Button onClick={() => setBlocking(providerId || myProvider?.membershipId || providersForBlock[0].membershipId)}><PIcon name="plus" /> Block time</Button>}
        <Link className="btn" to="/settings/availability">Availability</Link>
      </header>
      <div className="cal-bar" role="toolbar" aria-label="Calendar navigation">
        <Button onClick={() => go(stepAnchor(view, anchor, -1))} aria-label="Previous"><PIcon name="left" /><span className="sr-only">Previous {view === 'month' ? 'month' : view}</span></Button>
        <Button onClick={() => go(today)}>Today</Button>
        <Button onClick={() => go(stepAnchor(view, anchor, 1))}><PIcon name="right" /><span className="sr-only">Next {view === 'month' ? 'month' : view}</span></Button>
        <h2 className="cal-title" aria-live="polite">{title}</h2>
        <div className="grow" />
        <div className="seg" role="group" aria-label="Calendar view">
          {VIEWS.map((v) => <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => update({ view: v.id })}>{v.label}</button>)}
        </div>
      </div>
      <div className="cal-filters">
        {provs && provs.providers.length > 1 && <SelectField id="cal-prov" label="Team member" value={providerId} onChange={(e) => update({ provider: e.target.value })}><option value="">Everyone (combined)</option>{provs.providers.filter((p) => p.isProvider).map((p) => <option key={p.membershipId} value={p.membershipId}>{p.email}</option>)}</SelectField>}
        {services.length > 0 && <SelectField id="cal-svc" label="Service" value={serviceId} onChange={(e) => update({ service: e.target.value })}><option value="">All services</option>{services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</SelectField>}
      </div>
      <p className="tz-note" id="cal-tz">Times are shown in {tz} ({tzLabel(tz, now)}){filterProvider ? ` – ${filterProvider.email}'s time zone` : ''}.</p>
      <Alert>{error}</Alert>
      <Alert kind="info">{notice}</Alert>
      {(loading && !data) || !provs ? <Skeleton lines={8} /> : (
        <div aria-busy={loading || undefined}>
          {view === 'month' && <MonthGrid anchor={anchor} today={today} days={range.days} byDay={bookingsByDay} onPick={(d) => update({ view: 'day', date: d })} onMonth={(d) => go(d)} />}
          {(view === 'week' || view === 'day') && <TimeGrid days={range.days} today={today} tz={tz} now={now} data={data} byDay={bookingsByDay} single={!!providerId || (provs.providers.length === 1)} onBooking={setSel} onBlock={setBlockSel} />}
          {view === 'agenda' && <Agenda days={range.days} tz={tz} byDay={bookingsByDay} data={data} providerName={providerName} onBooking={setSel} onBlock={setBlockSel} />}
        </div>
      )}
      {view !== 'agenda' && <p className="hint">Prefer a list? <button className="btn link" type="button" onClick={() => update({ view: 'agenda' })}>Switch to the list view</button> – it shows the same bookings as plain text.</p>}
      {sel && <BookingPopup b={sel} tz={tz} onClose={() => setSel(null)} onReschedule={() => { setMoving(sel); setSel(null) }} onOpen={() => nav(`/bookings/${sel.id}`)} />}
      {moving && <TimeDialog title="Reschedule booking" tz={data?.providers.find((p) => p.membershipId === moving.providerId)?.timeZone ?? tz} initial={moving.startAt} confirm="Move booking" slotQuery={moving.location === 'customer' ? undefined : { serviceId: moving.serviceId, providerId: moving.providerId, location: moving.location, minutes: Math.round((new Date(moving.endAt).getTime() - new Date(moving.startAt).getTime()) / 60000) }}
        hint="The buyer is told about the new time and may cancel without a fee." onSubmit={async (iso) => { await servicesApi.act(moving.id, 'reschedule', { start: iso }); setNotice('Booking moved.'); void load() }} onClose={() => setMoving(null)} />}
      {blockSel && <BlockDetail block={blockSel} tz={tz} canDelete={!!provs?.providers.some((p) => p.membershipId === blockSel.providerId)} onClose={() => setBlockSel(null)} onDeleted={() => void load()} />}
      {blocking && <BlockDialog providers={providersForBlock} defaultProvider={blocking} tz={tz} defaultDate={anchor} onClose={() => setBlocking(null)} onSaved={(n) => { setNotice(n > 0 ? `Time blocked. ${n} booking${n === 1 ? ' falls' : 's fall'} inside it: reschedule or cancel ${n === 1 ? 'it' : 'them'}.` : 'Time blocked.'); void load() }} />}
    </main>
  )
}

export function TimeGrid({ days, today, tz, now, data, byDay, single, onBooking, onBlock }: { days: string[]; today: string; tz: string; now: Date; data: CalendarData | null; byDay: Map<string, CalendarBooking[]>; single: boolean; onBooking: (b: CalendarBooking) => void; onBlock: (b: BlockDto) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo?.({ top: 7.5 * HH }) }, [days[0]])
  return (
    <div className="tgrid" ref={ref} role="region" aria-label="Schedule grid" tabIndex={0} style={{ ['--hh' as string]: `${HH}px` }}>
      <div className="tgrid-hours" aria-hidden="true"><div style={{ height: 36 }} />{Array.from({ length: 24 }, (_, h) => <div key={h}>{h === 0 ? '' : `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`}</div>)}</div>
      <div className="tgrid-days" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(150px, 1fr))` }}>
        {days.map((d) => {
          const bs = (byDay.get(d) ?? []).map((b) => {
            const { start: s, end: e } = spanOnDay(b.startAt, b.endAt, d, tz)
            return { id: b.id, start: s, end: Math.max(e, s + 20), b }
          })
          const placed = placeEvents(bs)
          const blocks = (data?.blocks ?? []).filter((x) => localDate(x.startAt, tz) <= d && localDate(new Date(new Date(x.endAt).getTime() - 1), tz) >= d)
          const work = single ? (data?.workingHours ?? []).filter((w) => localDate(w.start, tz) === d) : []
          const isToday = d === today
          return (
            <section key={d} className={`tday${isToday ? ' today' : ''}`} aria-label={fmtYmd(d)}>
              <h3>{fmtYmd(d, { weekday: 'short', day: 'numeric', month: 'short' })}{isToday && <span className="sr-only"> (today)</span>}</h3>
              <div className="body">
                {work.map((w, i) => { const top = minutesOfDay(w.start, tz); const bottom = minutesOfDay(new Date(new Date(w.end).getTime() - 1), tz) + 1; return <div key={i} className="work" aria-hidden="true" style={{ top: top / 60 * HH, height: Math.max(0, bottom - top) / 60 * HH }} /> })}
                <ul aria-label={`Bookings on ${fmtYmd(d)}`}>
                  {placed.map(({ item, start, end, lane, lanes }) => (
                    <li key={item.id} style={{ position: 'absolute', top: start / 60 * HH, height: Math.max(24, (end - start) / 60 * HH), left: `${lane / lanes * 100}%`, width: `${100 / lanes}%`, padding: '0 3px', boxSizing: 'border-box' }}>
                      <button type="button" className={`bk ev s-${item.b.status}`} style={{ position: 'static', width: '100%', height: '100%' }} onClick={() => onBooking(item.b)}>
                        <span className="st">{statusLabel(item.b.status)}</span><br />{fmtTime(item.b.startAt, tz)} {item.b.title}<span className="sr-only"> until {fmtTime(item.b.endAt, tz)}{item.b.buyerName ? `, for ${item.b.buyerName}` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {blocks.map((x) => {
                  const { start: s, end: e } = spanOnDay(x.startAt, x.endAt, d, tz)
                  return <button key={x.id} type="button" className="blk" style={{ top: s / 60 * HH, height: Math.max(24, (e - s) / 60 * HH) }} onClick={() => onBlock(x)}>{x.kind === 'timeoff' ? 'Time off' : 'Busy'}{x.note ? ` · ${x.note}` : ''}<span className="sr-only">, {fmtTime(x.startAt, tz)} to {fmtTime(x.endAt, tz)}</span></button>
                })}
                {isToday && <div className="now-line" aria-hidden="true" data-testid="now-line" style={{ top: minutesOfDay(now, tz) / 60 * HH }} />}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Month grid with roving tabindex: arrows move by day/week, Home/End to the week's ends, PageUp/PageDown by month, Enter opens the day. */
export function MonthGrid({ anchor, today, days, byDay, onPick, onMonth }: { anchor: string; today: string; days: string[]; byDay: Map<string, CalendarBooking[]>; onPick: (d: string) => void; onMonth: (d: string) => void }) {
  const [focus, setFocus] = useState(anchor)
  useEffect(() => setFocus(anchor), [anchor])
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const month = parseYmd(startOfMonth(anchor)).m
  const move = (d: string) => {
    if (!days.includes(d)) { onMonth(d); setFocus(d); setTimeout(() => refs.current[d]?.focus(), 80); return }
    setFocus(d); refs.current[d]?.focus()
  }
  const key = (e: React.KeyboardEvent, d: string) => {
    const k = e.key; let t: string | null = null
    if (k === 'ArrowLeft') t = addDays(d, -1); else if (k === 'ArrowRight') t = addDays(d, 1); else if (k === 'ArrowUp') t = addDays(d, -7); else if (k === 'ArrowDown') t = addDays(d, 7)
    else if (k === 'Home') t = startOfWeek(d); else if (k === 'End') t = addDays(startOfWeek(d), 6)
    else if (k === 'PageUp') t = addMonths(d, -1); else if (k === 'PageDown') t = addMonths(d, 1)
    if (t) { e.preventDefault(); const mDays = daysInMonth(t); const p = parseYmd(t); void mDays; move(ymd({ y: p.y, m: p.m, d: Math.min(p.d, daysInMonth(t)) })) }
  }
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7))
  return (
    <table className="mgrid" role="grid" aria-label={`Month of ${fmtYmd(startOfMonth(anchor), { month: 'long', year: 'numeric' })}`}>
      <thead><tr>{weeks[0].map((d) => <th key={d} scope="col" role="columnheader"><span aria-hidden="true">{fmtYmd(d, { weekday: 'short' })}</span><span className="sr-only">{fmtYmd(d, { weekday: 'long' })}</span></th>)}</tr></thead>
      <tbody>
        {weeks.map((w) => (
          <tr key={w[0]}>
            {w.map((d) => {
              const bs = byDay.get(d) ?? []; const p = parseYmd(d)
              return (
                <td key={d} role="gridcell" className={p.m === month ? '' : 'out'} aria-selected={d === focus}>
                  <button ref={(el) => { refs.current[d] = el }} type="button" className={`mcell${d === today ? ' today' : ''}`} tabIndex={d === focus ? 0 : -1} onFocus={() => setFocus(d)} onKeyDown={(e) => key(e, d)} onClick={() => onPick(d)}
                    aria-label={`${p.d}${bs.length ? ` ${bs.length} booking${bs.length === 1 ? '' : 's'}` : ''}, ${fmtYmd(d)}${d === today ? ', today' : ''}`}>   {/* starts with exactly the visible text (WCAG 2.5.3) */}
                    <span className="n">{p.d}</span>
                    {bs.length > 0 && <>{' '}<span className="c">{bs.length} booking{bs.length === 1 ? '' : 's'}</span></>}
                  </button>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Agenda({ days, tz, byDay, data, providerName, onBooking, onBlock }: { days: string[]; tz: string; byDay: Map<string, CalendarBooking[]>; data: CalendarData | null; providerName: (id: string) => string; onBooking: (b: CalendarBooking) => void; onBlock: (b: BlockDto) => void }) {
  const any = days.some((d) => (byDay.get(d)?.length ?? 0) > 0) || (data?.blocks.length ?? 0) > 0
  if (!any) return <p className="pempty">Nothing scheduled in these two weeks.</p>
  return (
    <ol className="agenda" aria-label="Schedule as a list">
      {days.map((d) => {
        const bs = byDay.get(d) ?? []; const bl = (data?.blocks ?? []).filter((x) => localDate(x.startAt, tz) <= d && localDate(new Date(new Date(x.endAt).getTime() - 1), tz) >= d)
        if (!bs.length && !bl.length) return null
        return (
          <li key={d}>
            <h3>{fmtYmd(d)}</h3>
            <ul>
              {bs.map((b) => (
                <li key={b.id}><button type="button" className={`bk s-${b.status}`} onClick={() => onBooking(b)}>
                  <strong>{fmtTime(b.startAt, tz)}–{fmtTime(b.endAt, tz)} · {b.title}</strong>
                  <span className="meta">{statusLabel(b.status)} · {LOCATION_LABEL[b.location]}{b.buyerName ? ` · ${b.buyerName}` : ''}{providerName(b.providerId) ? ` · ${providerName(b.providerId)}` : ''}</span>
                </button></li>
              ))}
              {bl.map((x) => <li key={x.id}><button type="button" className="bk" onClick={() => onBlock(x)}><strong>{x.kind === 'timeoff' ? 'Time off' : 'Busy'}</strong><span className="meta">{x.allDay ? 'All day' : `${fmtTime(x.startAt, tz)}–${fmtTime(x.endAt, tz)}`}{x.note ? ` · ${x.note}` : ''}</span></button></li>)}
            </ul>
          </li>
        )
      })}
    </ol>
  )
}

function BookingPopup({ b, tz, onClose, onReschedule, onOpen }: { b: CalendarBooking; tz: string; onClose: () => void; onReschedule: () => void; onOpen: () => void }) {
  return (
    <Dialog title={b.title} onClose={onClose}>
      <p><BookingStatusChip status={b.status} /> <span className="meta">{b.number}</span></p>
      <dl className="kv">
        <dt>When</dt><dd>{fmtYmd(localDate(b.startAt, tz))}, {fmtTime(b.startAt, tz)}–{fmtTime(b.endAt, tz)} ({tz})</dd>
        <dt>Where</dt><dd>{LOCATION_LABEL[b.location]}</dd>
        {b.buyerName && <><dt>Customer</dt><dd>{b.buyerName}</dd></>}
      </dl>
      <div className="dialog-actions">
        <Button onClick={onClose}>Close</Button>
        {b.canAct && (b.status === 'Confirmed' || b.status === 'Rescheduled') && <Button onClick={onReschedule}>Reschedule…</Button>}
        <Button variant="primary" onClick={onOpen}>Open booking</Button>
      </div>
    </Dialog>
  )
}
