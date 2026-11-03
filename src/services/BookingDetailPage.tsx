import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button, Skeleton } from '../components/ui'
import { AreaField } from '../products/ui'
import { servicesApi } from './api'
import { CompleteDialog, ReasonDialog, ReassignDialog, TimeDialog, errText } from './ActionDialogs'
import { BookingStatusChip, LOCATION_LABEL } from './shared'
import { durationLabel, fmtDateTime, money } from './time'
import type { BookingDetail, BookingMessage } from './types'
import './services.css'

type Dlg = 'decline' | 'propose' | 'reschedule' | 'cancel' | 'complete' | 'reassign' | 'noshow' | 'decide-no' | null

export default function BookingDetailPage() {
  const { id = '' } = useParams()
  const [b, setB] = useState<BookingDetail | null>(null); const [failed, setFailed] = useState<number | null>(null)
  const [dlg, setDlg] = useState<Dlg>(null); const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null); const [busy, setBusy] = useState('')
  const [team, setTeam] = useState<{ membershipId: string; email: string }[]>([])
  const load = useCallback(() => servicesApi.booking(id).then(setB).catch((e) => setFailed(e instanceof ApiError ? e.status : 0)), [id])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (b?.actions.reassign) servicesApi.serviceProviders(b.serviceId).then((r) => setTeam(r.providers.filter((p) => p.eligible))).catch(() => undefined) }, [b?.actions.reassign, b?.serviceId])
  useEffect(() => { if (b) document.title = `${b.number} - Solvelt` }, [b])
  if (failed !== null) return <main className="pwrap"><h1 id="page-title" tabIndex={-1}>{failed === 404 ? 'Booking not found' : 'Could not load this booking'}</h1><p>{failed === 404 ? "It may belong to another team member or brand, or it doesn't exist." : 'Check your connection and try again.'}</p><Link className="btn" to="/bookings">Back to bookings</Link></main>
  if (!b) return <main className="pwrap"><h1 id="page-title" tabIndex={-1}>Booking</h1><Skeleton lines={6} /></main>
  const tz = b.providerTimeZone
  const act = async (action: string, body: Record<string, unknown> = {}, ok = 'Done.') => { const d = await servicesApi.act(b.id, action, { ...body, version: b.version }); if ('id' in d) setB(d); else await load(); setMsg({ kind: 'success', text: ok }) }
  const quick = async (action: string, ok: string) => { setBusy(action); setMsg(null); try { await act(action, {}, ok) } catch (e) { setMsg({ kind: 'error', text: errText(e) }) } finally { setBusy('') } }
  const hourly = b.pricing.model === 'hourly'
  const a = b.actions
  return (
    <main className="pwrap" aria-labelledby="page-title">
      <header className="cal-bar">
        <Link to="/bookings" className="btn link back">← Bookings</Link>
        <h1 id="page-title" tabIndex={-1} className="grow">{b.serviceTitle} <span className="meta">{b.number}</span></h1>
        <BookingStatusChip status={b.status} />
      </header>
      <Alert kind={msg?.kind}>{msg?.text}</Alert>
      {b.status === 'Requested' && b.approvalDeadline && <Alert kind="info">This request needs your answer by {fmtDateTime(b.approvalDeadline, tz)}, or it is declined automatically.</Alert>}
      {b.proposedStartAt && <Alert kind="info">You proposed {fmtDateTime(b.proposedStartAt, tz)}. Waiting for the buyer.</Alert>}
      {b.rescheduleRequestedStartAt && <div className="alert info" role="status"><p>The buyer asked to move this booking to {fmtDateTime(b.rescheduleRequestedStartAt, tz)}.</p>
        {a.decideReschedule && <div className="actions"><Button variant="primary" loading={busy === 'approve-reschedule'} onClick={() => void quick('approve-reschedule', 'New time accepted.')}>Accept new time</Button><Button onClick={() => setDlg('decide-no')}>Decline…</Button></div>}</div>}
      <div className="actions" role="group" aria-label="Actions">
        {a.approve && <Button variant="primary" loading={busy === 'approve'} onClick={() => void quick('approve', 'Booking confirmed.')}>Approve</Button>}
        {a.decline && <Button onClick={() => setDlg('decline')}>Decline…</Button>}
        {a.propose && <Button onClick={() => setDlg('propose')}>Propose another time…</Button>}
        {a.start && <Button variant="primary" loading={busy === 'start'} onClick={() => void quick('start', 'Marked as started.')}>Start job</Button>}
        {a.complete && <Button variant="primary" onClick={() => setDlg('complete')}>Complete…</Button>}
        {a.reschedule && <Button onClick={() => setDlg('reschedule')}>Reschedule…</Button>}
        {a.reassign && <Button onClick={() => setDlg('reassign')}>Reassign…</Button>}
        {a.noShow && <Button onClick={() => setDlg('noshow')}>No-show…</Button>}
        {a.cancel && <Button variant="destructive" onClick={() => setDlg('cancel')}>Cancel booking…</Button>}
      </div>
      <div className="bd-grid">
        <div>
          <section className="pcard" aria-labelledby="bd-when"><h2 id="bd-when">When and where</h2>
            <dl className="kv"><dt>Starts</dt><dd>{fmtDateTime(b.startAt, tz)} – {fmtDateTime(b.endAt, tz).split(', ').pop()}</dd><dt>Duration</dt><dd>{durationLabel(b.durationMinutes)}</dd><dt>Time zone</dt><dd>{tz} (the provider's)</dd>
              <dt>Where</dt><dd>{LOCATION_LABEL[b.location]}{b.location === 'seller' && b.sellerAddress ? `: ${b.sellerAddress}` : ''}</dd>
              {b.location === 'online' && b.onlineInstructions && <><dt>Meeting</dt><dd>{b.onlineInstructions}</dd></>}
              <dt>Provider</dt><dd>{b.providerEmail}{b.isMine ? ' (you)' : ''}</dd></dl>
            {b.requirements && <p className="hint">The buyer was asked to: {b.requirements}</p>}
          </section>
          <section className="pcard" aria-labelledby="bd-cust"><h2 id="bd-cust">Customer</h2>
            {b.customer.redacted ? <p>Customer details were removed after the retention period.</p> : b.customer.visible ? (
              <dl className="kv"><dt>Name</dt><dd>{b.customer.name}</dd>{b.customer.phone && <><dt>Phone</dt><dd><a href={`tel:${b.customer.phone}`}>{b.customer.phone}</a></dd></>}
                {b.customer.address && <><dt>Address</dt><dd>{[b.customer.address.line1, b.customer.address.line2, [b.customer.address.city, b.customer.address.region, b.customer.address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</dd></>}</dl>
            ) : <><p>{b.customer.name ? `${b.customer.name}${b.customer.postalCode ? ` · ${b.customer.postalCode}` : ''}` : 'Hidden'}</p><p className="hint">The customer's phone and address are shown to the assigned provider and to Owners and Admins, from the moment the booking is confirmed.</p></>}
            {b.intake.filter((i) => i.answer).length > 0 && <><h3>Their answers</h3><dl className="kv">{b.intake.filter((i) => i.answer).map((i) => <><dt key={`${i.id}-q`}>{i.question}</dt><dd key={`${i.id}-a`}>{i.answer}</dd></>)}</dl></>}
          </section>
          <Thread id={b.id} canWrite={a.cancel || a.approve || a.start || a.complete || b.isMine} />
        </div>
        <div>
          <section className="pcard" aria-labelledby="bd-price"><h2 id="bd-price">Price and policy</h2>
            <dl className="kv"><dt>{hourly ? `Rate (${money(b.pricing.rateCents)}/h)` : 'Price'}</dt><dd>{money(b.pricing.priceCents)}</dd>
              {b.addOns.map((x) => <><dt key={x.id}>{x.name}</dt><dd key={`${x.id}-p`}>{money(x.priceCents)}</dd></>)}
              {b.pricing.travelFeeCents > 0 && <><dt>Travel fee</dt><dd>{money(b.pricing.travelFeeCents)}</dd></>}
              <dt><strong>Total</strong></dt><dd><strong>{money(b.pricing.totalCents)}</strong></dd>
              {b.pricing.actualMinutes != null && <><dt>Time worked</dt><dd>{durationLabel(b.pricing.actualMinutes)}</dd></>}
              {b.pricing.additionalChargeCents > 0 && <><dt>Extra time requested</dt><dd>{money(b.pricing.additionalChargeCents)}</dd></>}
              {b.pricing.cancellationFeeCents > 0 && <><dt>Fee recorded</dt><dd>{money(b.pricing.cancellationFeeCents)}</dd></>}</dl>
            {b.policy && <p className="hint">Free cancellation until {b.policy.cancelFreeHours} h before, then {b.policy.cancelFeePercent}%. {b.policy.maxReschedules} reschedule{b.policy.maxReschedules === 1 ? '' : 's'} allowed ({b.rescheduleCount} used). No-show: {b.policy.noShowFeePercent}%. The marketplace handles the money.</p>}
          </section>
          <section className="pcard" aria-labelledby="bd-tl"><h2 id="bd-tl">Timeline</h2>
            <ol className="timeline">{b.timeline.map((t, i) => <li key={i}><div className="when">{fmtDateTime(t.at, tz)} · {t.actor}</div><div>{t.type.replace('booking.', '').replace(/_/g, ' ')}{t.text ? `: ${t.text}` : ''}</div></li>)}</ol>
          </section>
        </div>
      </div>
      {dlg === 'decline' && <ReasonDialog title="Decline this request" label="Reason for the buyer" confirm="Decline request" destructive onClose={() => setDlg(null)} onSubmit={(r) => act('decline', { reason: r }, 'Request declined.')} />}
      {dlg === 'cancel' && <ReasonDialog title="Cancel this booking" label="Reason (the buyer will see it)" required confirm="Cancel booking" destructive hint="Cancelling is free for the buyer. This can't be undone." onClose={() => setDlg(null)} onSubmit={(r) => act('cancel', { reason: r }, 'Booking cancelled.')} />}
      {dlg === 'decide-no' && <ReasonDialog title="Decline the new time" label="Note for the buyer" confirm="Keep the current time" onClose={() => setDlg(null)} onSubmit={(r) => act('decline-reschedule', { note: r }, 'The booking stays at its current time.')} />}
      {dlg === 'noshow' && <ReasonDialog title="Mark as no-show" label="Note (optional)" confirm="Mark no-show" destructive hint={`The customer didn't turn up. A fee of ${b.policy?.noShowFeePercent ?? 0}% is recorded and sent to the marketplace.`} onClose={() => setDlg(null)} onSubmit={() => act('no-show', {}, 'Marked as no-show.')} />}
      {dlg === 'propose' && <TimeDialog title="Propose another time" tz={tz} initial={b.startAt} confirm="Send proposal" hint="The buyer can accept or decline. The time is not reserved until they accept." onClose={() => setDlg(null)} onSubmit={(iso) => act('propose', { start: iso }, 'Proposal sent.')} />}
      {dlg === 'reschedule' && <TimeDialog title="Reschedule booking" tz={tz} initial={b.startAt} confirm="Move booking" hint="The buyer is told about the new time and may cancel without a fee." onClose={() => setDlg(null)} onSubmit={(iso) => act('reschedule', { start: iso }, 'Booking moved.')} />}
      {dlg === 'complete' && <CompleteDialog hourly={hourly} bookedMinutes={b.durationMinutes} increment={b.policy?.incrementMinutes ?? 60} onClose={() => setDlg(null)} onSubmit={(m) => act('complete', { actualMinutes: m }, 'Booking completed.')} />}
      {dlg === 'reassign' && <ReassignDialog providers={team} current={b.providerId} onClose={() => setDlg(null)} onSubmit={(p) => act('reassign', { providerId: p }, 'Booking reassigned.')} />}
    </main>
  )
}

function Thread({ id, canWrite }: { id: string; canWrite: boolean }) {
  const [list, setList] = useState<BookingMessage[] | null>(null); const [text, setText] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const load = useCallback(() => servicesApi.messages(id).then((r) => setList(r.messages)).catch(() => setErr('Could not load messages.')), [id])
  useEffect(() => { void load() }, [load])
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (!text.trim()) return; setBusy(true); setErr(''); try { await servicesApi.sendMessage(id, text.trim()); setText(''); await load() } catch (x) { setErr(errText(x)) } finally { setBusy(false) } }
  return (
    <section className="pcard" aria-labelledby="bd-msg"><h2 id="bd-msg">Messages</h2>
      {list && list.length === 0 && <p>No messages yet.</p>}
      {list && list.length > 0 && <ul className="thread" aria-label="Conversation">{list.map((m) => <li key={m.id} className={m.mine || m.direction === 'seller' ? 'mine' : ''}><div className="who">{m.direction === 'buyer' ? 'Buyer' : 'Your team'} · {fmtDateTime(m.createdAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}</div>{m.text}</li>)}</ul>}
      <Alert>{err}</Alert>
      {canWrite && <form onSubmit={send}><AreaField id="msg-text" label="Reply to the buyer" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} /><Button type="submit" variant="primary" loading={busy} disabled={!text.trim()}>Send message</Button></form>}
    </section>
  )
}
