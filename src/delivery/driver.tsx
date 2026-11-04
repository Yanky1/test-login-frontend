import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api'
import { useAuth } from '../auth'
import { Alert, Skeleton } from '../components/ui'
import { driverApi, FAIL_REASONS, STATUS_LABEL, timeRange, type DriverMe, type DriverRoute, type LocalStatus, type StopDto } from './api'
import { browserBlobs, DriverQueue, type BlobStore } from './queue'
import './driver.css'

/** The driver's phone app (`/driver`): installable PWA, big touch targets, works offline through the queue. */
export default function DriverApp({ queueOverride }: { queueOverride?: DriverQueue } = {}) {
  const { user } = useAuth()
  const blobs = useMemo<BlobStore>(() => browserBlobs(), [])
  const queue = useMemo(() => queueOverride ?? new DriverQueue(localStorage, blobs, undefined, user?.email ?? 'anon'), [queueOverride, blobs, user?.email])
  const [me, setMe] = useState<DriverMe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pending, setPending] = useState(queue.pending())
  const [failures, setFailures] = useState(queue.failures())
  const [open, setOpen] = useState<string | null>(null)
  const [optimistic, setOptimistic] = useState<Record<string, LocalStatus>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setMe(await driverApi.me()); setError(null); setOptimistic({}) }
    catch (e) { if (!(e instanceof ApiError)) setError('You are offline. Showing the last loaded route.'); else setError(e.message2) }
  }, [])

  const sync = useCallback(async () => {
    if (queue.pending() === 0) return
    const r = await queue.flush()
    setPending(queue.pending()); setFailures(queue.failures())
    if (r.sent > 0) await load()
  }, [queue, load])

  useEffect(() => queue.subscribe(() => { setPending(queue.pending()); setFailures(queue.failures()) }), [queue])
  useEffect(() => { void load().then(sync) }, [load, sync])
  useEffect(() => {
    const on = () => { setOnline(true); void sync() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    const t = setInterval(() => { if (navigator.onLine) void sync().then(load) }, 30_000)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t) }
  }, [sync, load])
  useEffect(() => {   // installable PWA: manifest + service worker for the shell
    const link = document.createElement('link'); link.rel = 'manifest'; link.href = '/driver.webmanifest'; document.head.appendChild(link)
    if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/driver-sw.js', { scope: '/driver' }).catch(() => undefined)
    return () => { link.remove() }
  }, [])

  const active = me?.routes.find((r) => r.status === 'Active')
  useLocationSharing(!!me?.consented && !me.paused && !!active)

  const stops = me?.routes.flatMap((r) => r.stops.map((s) => ({ ...s, status: optimistic[s.id] ?? s.status, route: r }))) ?? []
  const current = stops.find((s) => s.id === open)

  const startRoute = async (r: DriverRoute) => {
    setBusy(true)
    try { await driverApi.start(r.id); await load() }
    catch (e) {
      if (e instanceof ApiError) setError(e.message2)
      else { queue.enqueueStart(r.id); setError('You are offline. The route will start when you are back online.') }
    } finally { setBusy(false) }
  }

  const setConsent = async (consented?: boolean, paused?: boolean) => { try { const c = await driverApi.consent(consented, paused); setMe((m) => (m ? { ...m, ...c } : m)) } catch { setError('Could not save your choice. Try again.') } }

  return (
    <main className="driver" aria-labelledby="page-title">
      <header className="driver-head">
        <h1 id="page-title" tabIndex={-1}>{current ? `Stop ${current.seq}` : 'My deliveries'}</h1>
        <span className={`dr-pill ${online ? 'ok' : 'off'}`} role="status">{online ? 'Online' : 'Offline'}{pending > 0 ? ` · ${pending} waiting to send` : ''}</span>
      </header>
      {error && <Alert kind={online ? 'error' : 'info'}>{error}</Alert>}
      {failures.length > 0 && (
        <Alert>
          {failures.length} update{failures.length > 1 ? 's' : ''} could not be saved: {failures.map((f) => f.message).join('; ')}. Tell your dispatcher.{' '}
          <button type="button" className="linklike" onClick={() => { queue.dismissFailures(); setFailures([]) }}>Dismiss</button>
        </Alert>
      )}
      {!me ? <Skeleton lines={4} /> : current ? (
        <StopView stop={current} queue={queue} onBack={() => setOpen(null)}
          onDone={(status) => { setOptimistic((o) => ({ ...o, [current.id]: status })); setOpen(null); void sync() }} />
      ) : (
        <>
          <ConsentCard me={me} onChange={setConsent} />
          {me.routes.length === 0 && <p className="dr-empty">No deliveries assigned to you right now.</p>}
          {me.routes.map((r) => (
            <section key={r.id} className="dr-route" aria-label={`Route ${r.date}`}>
              <h2>{new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} <span className="dr-chip">{r.status === 'Planned' ? 'Not started' : r.status}</span></h2>
              {r.status === 'Planned' && <button type="button" className="dr-big primary" disabled={busy} onClick={() => void startRoute(r)}>Start route</button>}
              <ol className="dr-stops">
                {r.stops.map((s) => {
                  const st = optimistic[s.id] ?? s.status
                  return (
                    <li key={s.id}>
                      <button type="button" className="dr-stop" onClick={() => setOpen(s.id)}>
                        <span className="dr-seq" aria-hidden="true">{s.seq}</span>
                        <span className="dr-stop-main">
                          <strong><span className="sr-only">Stop {s.seq}: </span>{s.to ? s.to.line1 : 'Finished stop'}</strong>
                          <span>{s.to ? `${s.to.city} ${s.to.postalCode} · ` : ''}{timeRange(s.window.start, s.window.end)}</span>
                        </span>
                        <span className={`dr-chip st-${st}`}>{STATUS_LABEL[st]}{queue.pendingFor(s.id) > 0 ? ' ⟳' : ''}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
        </>
      )}
    </main>
  )
}

function ConsentCard({ me, onChange }: { me: DriverMe; onChange: (c?: boolean, p?: boolean) => void }) {
  if (!me.consented) {
    return (
      <section className="dr-card" aria-label="Location sharing">
        <h2>Share your location?</h2>
        <p>Buyers can see roughly when you will arrive. Your position is shared only while a route is started, only as an area of about 100 m, only for the stop that is next, and deleted after 24 hours. You can pause or stop at any time.</p>
        <div className="dr-row"><button type="button" className="dr-big" onClick={() => onChange(true)}>Allow sharing</button></div>
      </section>
    )
  }
  return (
    <section className="dr-card slim" aria-label="Location sharing">
      <span>{me.paused ? 'Location sharing is paused' : 'Sharing your approximate location while on a route'}</span>
      <div className="dr-row">
        <button type="button" className="dr-small" onClick={() => onChange(undefined, !me.paused)}>{me.paused ? 'Resume' : 'Pause'}</button>
        <button type="button" className="dr-small" onClick={() => onChange(false)}>Stop sharing</button>
      </div>
    </section>
  )
}

type S = StopDto & { route: DriverRoute }

function StopView({ stop, queue, onBack, onDone }: { stop: S; queue: DriverQueue; onBack: () => void; onDone: (s: LocalStatus) => void }) {
  const [form, setForm] = useState<null | 'deliver' | 'fail'>(null)
  const active = stop.route.status === 'Active'
  const simple = (type: 'out_for_delivery' | 'reattempt' | 'return_to_store', next: LocalStatus) => { queue.enqueueEvent(stop.id, { type }); onDone(next) }
  return (
    <div className="dr-stop-view">
      <button type="button" className="dr-small back" onClick={onBack}>← All stops</button>
      <p className="dr-window">Window {timeRange(stop.window.start, stop.window.end)} · <span className={`dr-chip st-${stop.status}`}>{STATUS_LABEL[stop.status]}</span></p>
      {stop.detailsVisible && stop.to ? (
        <section className="dr-card" aria-label="Address">
          <address>
            <strong>{stop.to.name}</strong><br />{stop.to.line1}{stop.to.line2 ? <>, {stop.to.line2}</> : null}<br />{stop.to.city}{stop.to.region ? `, ${stop.to.region}` : ''} {stop.to.postalCode}
          </address>
          <div className="dr-row">
            {stop.navigateUrl && <a className="dr-big" href={stop.navigateUrl} target="_blank" rel="noreferrer">Navigate</a>}
            {stop.contact?.call && <a className="dr-big" href={stop.contact.call}>Call {stop.contact.firstName}</a>}
            {stop.contact?.sms && <a className="dr-big" href={stop.contact.sms}>Text</a>}
          </div>
        </section>
      ) : <p className="dr-empty">This stop is finished. The address and contact details are no longer shown.</p>}
      {active && form === null && (
        <div className="dr-actions">
          {stop.status === 'InTransit' && <button type="button" className="dr-big" onClick={() => simple('out_for_delivery', 'OutForDelivery')}>Out for delivery</button>}
          {(stop.status === 'InTransit' || stop.status === 'OutForDelivery') && (
            <>
              <button type="button" className="dr-big primary" onClick={() => setForm('deliver')}>Delivered</button>
              <button type="button" className="dr-big danger" onClick={() => setForm('fail')}>Failed attempt</button>
            </>
          )}
          {stop.status === 'Failed' && (
            <>
              <button type="button" className="dr-big primary" onClick={() => simple('reattempt', 'InTransit')}>Try again</button>
              <button type="button" className="dr-big danger" onClick={() => simple('return_to_store', 'Returned')}>Return to store</button>
            </>
          )}
        </div>
      )}
      {form === 'deliver' && <DeliverForm stop={stop} queue={queue} onCancel={() => setForm(null)} onDone={() => onDone('Delivered')} />}
      {form === 'fail' && <FailForm stop={stop} queue={queue} onCancel={() => setForm(null)} onDone={() => onDone('Failed')} />}
    </div>
  )
}

/** Shrinks a phone photo (they are often 8-12 MB) and drops its metadata by redrawing it; falls back to the original file where canvas isn't available. */
export async function shrinkImage(file: Blob, max = 1600): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== 'function') return file
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height)
    const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.82))
    return out ?? file
  } catch { return file }
}

function PhotoInput({ label, required, onFile }: { label: string; required?: boolean; onFile: (f: File | null) => void }) {
  return (
    <label className="dr-field">{label}{required ? ' (required)' : ''}
      <input type="file" accept="image/*" capture="environment" required={required} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  )
}

function DeliverForm({ stop, queue, onCancel, onDone }: { stop: S; queue: DriverQueue; onCancel: () => void; onDone: () => void }) {
  const [placement, setPlacement] = useState<'left_at_door' | 'handed_to'>('handed_to')
  const [recipient, setRecipient] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const pad = useRef<SignaturePadHandle>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!photo) { setErr('Take a photo of the delivery first.'); return }
    const ids = [await queue.enqueueProof(stop.id, 'photo', await shrinkImage(photo))]
    const sig = await pad.current?.toBlob()
    if (sig) ids.push(await queue.enqueueProof(stop.id, 'signature', sig))
    const pos = await position()
    queue.enqueueEvent(stop.id, { type: 'delivered', placement, recipientName: recipient.trim() || undefined, ...pos }, ids)
    onDone()
  }
  return (
    <form className="dr-card" onSubmit={(e) => void submit(e)} aria-label="Proof of delivery" noValidate>
      <h2>Proof of delivery</h2>
      <fieldset className="dr-choice"><legend>How was it delivered?</legend>
        <label><input type="radio" name="placement" checked={placement === 'handed_to'} onChange={() => setPlacement('handed_to')} /> Handed to someone</label>
        <label><input type="radio" name="placement" checked={placement === 'left_at_door'} onChange={() => setPlacement('left_at_door')} /> Left at the door</label>
      </fieldset>
      {placement === 'handed_to' && <label className="dr-field">Recipient name (optional)<input value={recipient} maxLength={120} onChange={(e) => setRecipient(e.target.value)} autoComplete="off" /></label>}
      <PhotoInput label="Photo" required onFile={(f) => { setPhoto(f); setErr(null) }} />
      {placement === 'handed_to' && <SignaturePad ref={pad} />}
      {err && <Alert>{err}</Alert>}
      <div className="dr-row"><button type="submit" className="dr-big primary">Confirm delivery</button><button type="button" className="dr-big" onClick={onCancel}>Cancel</button></div>
    </form>
  )
}

function FailForm({ stop, queue, onCancel, onDone }: { stop: S; queue: DriverQueue; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason) { setErr('Choose a reason.'); return }
    const ids = photo ? [await queue.enqueueProof(stop.id, 'photo', await shrinkImage(photo))] : []
    queue.enqueueEvent(stop.id, { type: 'failed', reason, note: note.trim() || undefined }, ids)
    onDone()
  }
  return (
    <form className="dr-card" onSubmit={(e) => void submit(e)} aria-label="Failed attempt" noValidate>
      <h2>Failed attempt</h2>
      <label className="dr-field">Reason
        <select value={reason} onChange={(e) => { setReason(e.target.value); setErr(null) }}><option value="">Choose…</option>{FAIL_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
      </label>
      <label className="dr-field">Note (optional)<textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <PhotoInput label="Photo (optional)" onFile={setPhoto} />
      {err && <Alert>{err}</Alert>}
      <div className="dr-row"><button type="submit" className="dr-big danger">Save failed attempt</button><button type="button" className="dr-big" onClick={onCancel}>Cancel</button></div>
    </form>
  )
}

export interface SignaturePadHandle { toBlob(): Promise<Blob | null> }
import { forwardRef, useImperativeHandle } from 'react'
const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_p, ref) {
  const cv = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false); const dirty = useRef(false)
  const pt = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * cv.current!.width, y: ((e.clientY - r.top) / r.height) * cv.current!.height } }
  useImperativeHandle(ref, () => ({ toBlob: () => new Promise((res) => { if (!dirty.current || !cv.current?.toBlob) res(null); else cv.current.toBlob(res, 'image/png') }) }))
  const ctx = () => cv.current?.getContext?.('2d') ?? null
  return (
    <div className="dr-field">
      <span id="sig-l">Signature (optional)</span>
      <canvas ref={cv} width={600} height={220} className="dr-sig" role="img" aria-labelledby="sig-l" style={{ touchAction: 'none' }}
        onPointerDown={(e) => { drawing.current = true; const c = ctx(); if (c) { const p = pt(e); c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.moveTo(p.x, p.y) } cv.current?.setPointerCapture?.(e.pointerId) }}
        onPointerMove={(e) => { if (!drawing.current) return; const c = ctx(); if (c) { const p = pt(e); c.lineTo(p.x, p.y); c.stroke(); dirty.current = true } }}
        onPointerUp={() => { drawing.current = false }} />
      <button type="button" className="dr-small" onClick={() => { const c = ctx(); if (c && cv.current) c.clearRect(0, 0, cv.current.width, cv.current.height); dirty.current = false }}>Clear signature</button>
    </div>
  )
})

/** The device position at the moment of delivery (part of the proof). Resolves to null when unavailable or denied: it is never required. */
function position(): Promise<{ lat: number; lng: number } | null> {
  if (!navigator.geolocation) return Promise.resolve(null)
  return new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { timeout: 4000, maximumAge: 60_000 }))
}

/** While a route is active and the driver has consented (and not paused): send the position about every 45 seconds. The server rounds it before storing. */
function useLocationSharing(on: boolean) {
  useEffect(() => {
    if (!on || !navigator.geolocation) return
    const send = () => navigator.geolocation.getCurrentPosition((p) => { void driverApi.location(p.coords.latitude, p.coords.longitude).catch(() => undefined) }, () => undefined, { maximumAge: 30_000, timeout: 10_000 })
    send(); const t = setInterval(send, 45_000)
    return () => clearInterval(t)
  }, [on])
}
