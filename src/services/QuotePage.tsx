import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button, Skeleton } from '../components/ui'
import { AreaField, PIcon, SelectField, TextField } from '../products/ui'
import { servicesApi } from './api'
import { ReasonDialog, errText, toIso } from './ActionDialogs'
import { LOCATION_LABEL, useProviders } from './shared'
import { addDays, durationLabel, fmtDateTime, localDate, money } from './time'
import type { QuoteDto, ServiceProviderChoice } from './types'
import './services.css'

/** Quote request detail with the quote composer: price, estimated duration, proposed start times, expiry and a note. */
export default function QuotePage() {
  const { id = '' } = useParams()
  const [x, setX] = useState<QuoteDto | null>(null); const [failed, setFailed] = useState<number | null>(null)
  const { tz } = useProviders()
  const load = () => servicesApi.quote(id).then(setX).catch((e) => setFailed(e instanceof ApiError ? e.status : 0))
  useEffect(() => { void load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (failed !== null) return <main className="pwrap"><h1 id="page-title" tabIndex={-1}>{failed === 404 ? 'Quote request not found' : 'Could not load this request'}</h1><Link className="btn" to="/bookings?tab=quotes">Back to quote requests</Link></main>
  if (!x) return <main className="pwrap"><h1 id="page-title" tabIndex={-1}>Quote request</h1><Skeleton lines={5} /></main>
  const open = x.status === 'Requested' || x.status === 'Quoted'
  return (
    <main className="pwrap" aria-labelledby="page-title">
      <header className="cal-bar"><Link to="/bookings?tab=quotes" className="btn link back">← Quote requests</Link><h1 id="page-title" tabIndex={-1} className="grow">Quote for {x.serviceTitle}</h1><span className={`chip ${x.status === 'Requested' ? 'bks-Requested' : x.status === 'Accepted' ? 'bks-Confirmed' : 'bks-Completed'}`}>{x.status}</span></header>
      <div className="bd-grid">
        <section className="pcard" aria-labelledby="q-req"><h2 id="q-req">The request</h2>
          <dl className="kv"><dt>From</dt><dd>{x.buyerName ?? 'Removed'}</dd><dt>Where</dt><dd>{LOCATION_LABEL[x.location]}{x.postalCode ? ` · ${x.postalCode}` : ''}</dd>
            {x.address && <><dt>Address</dt><dd>{[x.address.line1, x.address.city, x.address.postalCode].filter(Boolean).join(', ')}</dd></>}</dl>
          <h3>What they need</h3><p>{x.details ?? 'Removed after the retention period.'}</p>
          {x.preferredTimes && x.preferredTimes.length > 0 && <><h3>Preferred times</h3><ul>{x.preferredTimes.map((t) => <li key={t}>{fmtDateTime(t, tz)}</li>)}</ul></>}
        </section>
        <div>
          {x.quote && <section className="pcard" aria-labelledby="q-sent"><h2 id="q-sent">Your quote</h2>
            <dl className="kv"><dt>Price</dt><dd>{money(x.quote.priceCents)}</dd><dt>Estimated time</dt><dd>{durationLabel(x.quote.durationMinutes)}</dd><dt>Expires</dt><dd>{fmtDateTime(x.quote.expiresAt, tz)}</dd></dl>
            <h3>Proposed times</h3><ul className="slot-list">{x.quote.slots.map((s) => <li key={s}>{fmtDateTime(s, tz)}</li>)}</ul>{x.quote.note && <p>{x.quote.note}</p>}</section>}
          {x.bookingId && <p><Link className="btn primary" to={`/bookings/${x.bookingId}`}>Open the booking</Link></p>}
          {open && <Composer quote={x} onDone={load} />}
        </div>
      </div>
    </main>
  )
}

export function Composer({ quote, onDone }: { quote: QuoteDto; onDone: () => void }) {
  const [team, setTeam] = useState<ServiceProviderChoice[]>([])
  const [provider, setProvider] = useState(quote.quote?.providerId ?? '')
  const [price, setPrice] = useState(quote.quote ? String(quote.quote.priceCents / 100) : ''); const [mins, setMins] = useState(String(quote.quote?.durationMinutes ?? 120))
  const [days, setDays] = useState('7'); const [note, setNote] = useState(quote.quote?.note ?? '')
  const [slots, setSlots] = useState<{ date: string; time: string }[]>([{ date: '', time: '09:00' }])
  const [errs, setErrs] = useState<Record<string, string>>({}); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [decline, setDecline] = useState(false)
  const tzOf = team.find((p) => p.membershipId === provider)?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const { tz: acct } = useProviders()
  const zone = tzOf || acct
  useEffect(() => { servicesApi.serviceProviders(quote.serviceId).then((r) => { const e = r.providers.filter((p) => p.eligible); setTeam(e); setProvider((cur) => cur || e[0]?.membershipId || '') }).catch(() => setMsg('Could not load the team.')) }, [quote.serviceId])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); const er: Record<string, string> = {}
    const p = Number(price); if (price.trim() === '' || Number.isNaN(p) || p < 0 || p > 1_000_000) er.price = 'Enter a price between 0 and 1,000,000.'
    const m = Number(mins); if (!Number.isInteger(m) || m < 5 || m > 1440) er.mins = 'Enter the estimated minutes (5-1440).'
    const d = Number(days); if (!Number.isInteger(d) || d < 1 || d > 60) er.days = 'Choose 1 to 60 days.'
    if (!provider) er.provider = 'Choose who would do the job.'
    const iso = slots.map((s) => toIso(s.date, s.time, zone)).filter((x): x is string => !!x)
    if (iso.length === 0) er.slots = 'Propose at least one start time.'
    else if (new Set(iso).size !== iso.length) er.slots = 'Each proposed time must be different.'
    setErrs(er); if (Object.keys(er).length) return
    setBusy(true); setMsg('')
    try { await servicesApi.sendQuote(quote.id, { price: p, durationMinutes: m, slots: iso, providerId: provider, expiresAt: new Date(Date.now() + d * 86400000).toISOString(), note: note.trim() || undefined, version: quote.version }); onDone() }
    catch (x) { setMsg(x instanceof ApiError && x.status === 422 ? (x.body?.title ?? errText(x)) : errText(x)); setBusy(false) }
  }
  return (
    <section className="pcard" aria-labelledby="q-compose"><h2 id="q-compose">{quote.quote ? 'Send a new quote' : 'Write your quote'}</h2>
      <form onSubmit={submit} noValidate>
        <div className="grid2">
          <TextField id="q-price" label="Price (USD)" inputMode="decimal" value={price} error={errs.price} onChange={(e) => setPrice(e.target.value)} />
          <TextField id="q-mins" label="Estimated time (minutes)" inputMode="numeric" value={mins} error={errs.mins} onChange={(e) => setMins(e.target.value)} />
          <SelectField id="q-prov" label="Who would do it?" value={provider} error={errs.provider} onChange={(e) => setProvider(e.target.value)}>{team.length === 0 && <option value="">No eligible team member</option>}{team.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.email}</option>)}</SelectField>
          <TextField id="q-days" label="Quote valid for (days)" inputMode="numeric" value={days} error={errs.days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <fieldset className="plain"><legend>Times you can start</legend>
          <p className="tz-note">Times are in {zone}. The buyer picks one; it is held for them when they accept.</p>
          {slots.map((s, i) => (
            <div key={i} className="row tight">
              <TextField label={`Proposed date ${i + 1}`} type="date" value={s.date} min={localDate(new Date(), zone)} max={addDays(localDate(new Date(), zone), 60)} onChange={(e) => setSlots(slots.map((x, k) => (k === i ? { ...x, date: e.target.value } : x)))} />
              <TextField label={`Proposed time ${i + 1}`} type="time" value={s.time} onChange={(e) => setSlots(slots.map((x, k) => (k === i ? { ...x, time: e.target.value } : x)))} />
              {slots.length > 1 && <Button type="button" variant="ghost" onClick={() => setSlots(slots.filter((_, k) => k !== i))}><PIcon name="trash" /><span className="sr-only">Remove proposed time {i + 1}</span></Button>}
            </div>
          ))}
          {errs.slots && <div className="field-error" role="alert">{errs.slots}</div>}
          {slots.length < 10 && <Button type="button" onClick={() => setSlots([...slots, { date: '', time: '09:00' }])}><PIcon name="plus" /> Add another time</Button>}
        </fieldset>
        <AreaField id="q-note" label="Note to the buyer" optional rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        <Alert>{msg}</Alert>
        <div className="actions"><Button type="submit" variant="primary" loading={busy}>Send quote</Button><Button type="button" variant="destructive" onClick={() => setDecline(true)}>Decline request…</Button></div>
      </form>
      {decline && <ReasonDialog title="Decline this request" label="Reason for the buyer" confirm="Decline request" destructive onClose={() => setDecline(false)} onSubmit={async (r) => { await servicesApi.declineQuote(quote.id, r); onDone() }} />}
    </section>
  )
}
