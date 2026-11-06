import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ApiError } from '../api'
import { useAuth } from '../auth'
import { Alert, Skeleton } from '../components/ui'
import { setUnsavedHandler } from '../lib/unsaved'
import { cacheDriverRoutes, dismissExpiredNotice, driverStorageName, noteDriverDiscardConfirmed, readCachedDriverRoutes, readExpiredNotice } from './storage'
import { driverApi, FAIL_REASONS, STATUS_LABEL, timeRange, type DriverMe, type DriverRoute, type LocalStatus, type StopDto } from './api'
import { browserBlobs, DriverQueue, type BlobStore } from './queue'
import './driver.css'

/** The driver's phone app (`/driver`): installable PWA, big touch targets, works offline through the queue. */
export default function DriverApp(props: { queueOverride?: DriverQueue } = {}) {
  const { user } = useAuth()
  // /driver/me is a Driver-only endpoint (403 for Owner/Admin/Manager/Viewer): other roles never mount the app that calls it
  if (user?.role != null && user.role !== 'Driver') return <Navigate to="/" replace />
  return <DriverAppInner {...props} />
}

function DriverAppInner({ queueOverride }: { queueOverride?: DriverQueue } = {}) {
  const { user } = useAuth()
  const blobs = useMemo<BlobStore>(() => browserBlobs(), [])
  const storageName = driverStorageName(user)       // one queue per user AND account: another account's events can never be replayed into this one
  const queue = useMemo(() => queueOverride ?? new DriverQueue(localStorage, blobs, undefined, storageName), [queueOverride, blobs, storageName])
  const [me, setMe] = useState<DriverMe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pending, setPending] = useState(queue.pending())
  const [failures, setFailures] = useState(queue.failures())
  const [notices, setNotices] = useState(queue.notices())
  const [expired, setExpired] = useState<{ count: number; days: number } | null>(null)      // unsent updates removed because they sat on this device for too long
  const email = user?.email
  useEffect(() => { setExpired(email ? readExpiredNotice(email) : null) }, [email])
  const [open, setOpen] = useState<string | null>(null)
  const [optimistic, setOptimistic] = useState<Record<string, LocalStatus>>({})
  const [busy, setBusy] = useState(false)
  const prevOpen = useRef<string | null>(null)

  const load = useCallback(async () => {
    try { const m = await driverApi.me(); setMe(m); setError(null); setOptimistic({}); cacheDriverRoutes(storageName, m) }
    catch (e) {
      if (e instanceof ApiError) { setError(e.message2); return }
      const cached = readCachedDriverRoutes<DriverMe>(storageName)             // offline: the last route (addresses only, no names or phone numbers) plus the queue
      if (cached) setMe((m) => m ?? cached)
      setError('You are offline. Showing the last loaded route; your updates are saved and will be sent.')
    }
  }, [storageName])

  const sync = useCallback(async () => {
    if (queue.pending() === 0) return
    const r = await queue.flush()
    setPending(queue.pending()); setFailures(queue.failures()); setNotices(queue.notices())
    if (r.paused) setError('Your sign-in needs attention. Your updates are saved and will be sent as soon as you are signed in again.')
    if (r.sent > 0) await load()
  }, [queue, load])

  useEffect(() => queue.subscribe(() => { setPending(queue.pending()); setFailures(queue.failures()); setNotices(queue.notices()) }), [queue])
  // logging out or switching account with unsent deliveries: try to send them first, and only then warn
  useEffect(() => setUnsavedHandler(async () => {
    if (queue.pending() === 0) return true
    if (navigator.onLine) await queue.flush().catch(() => undefined)
    if (queue.pending() === 0) return true
    const ok = window.confirm(`${queue.pending()} update(s) have not been sent yet. If you leave now they are lost. Leave anyway?`)
    if (ok) noteDriverDiscardConfirmed(storageName)        // a log-out that follows must not ask about this queue a second time
    return ok
  }), [queue, storageName])
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
  // keyboard / screen-reader focus follows the view: into the stop's heading when it opens, back to its button in the list when it closes
  useEffect(() => {
    if (open) document.getElementById('page-title')?.focus()
    else if (prevOpen.current) document.querySelector<HTMLElement>(`[data-stop="${prevOpen.current}"]`)?.focus()
    prevOpen.current = open
  }, [open])      // only when the view changes: `me` is replaced every 30 s and after each sync, and that must not steal focus from the form being filled in

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
          <button type="button" className="dr-small" onClick={() => { queue.dismissFailures(); setFailures([]) }}>Dismiss</button>
        </Alert>
      )}
      {expired && user && (
        <Alert>
          {expired.count} unsent update{expired.count > 1 ? 's were' : ' was'} removed from this phone because {expired.count > 1 ? 'they were' : 'it was'} more than {expired.days} days old. Tell your dispatcher.{' '}
          <button type="button" className="dr-small" onClick={() => { dismissExpiredNotice(user.email); setExpired(null) }}>Dismiss</button>
        </Alert>
      )}
      {notices.length > 0 && (
        <Alert kind="info">
          {notices.map((n) => n.message).join(' ')}{' '}
          <button type="button" className="dr-small" onClick={() => { queue.dismissNotices(); setNotices([]) }}>Dismiss</button>
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
                      <button type="button" className="dr-stop" data-stop={s.id} onClick={() => setOpen(s.id)}>
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

/** Removes the metadata blocks (EXIF with GPS, XMP, IPTC, comments) from a JPEG without re-encoding it. Returns null when the bytes are not a well-formed JPEG. */
export function stripJpegMetadata(d: Uint8Array): Uint8Array | null {
  if (d.length < 4 || d[0] !== 0xff || d[1] !== 0xd8) return null
  const out: number[] = [0xff, 0xd8]
  let i = 2
  while (i + 3 < d.length) {
    if (d[i] !== 0xff) return null
    const m = d[i + 1]
    if (m === 0xff) { i++; continue }
    if (m === 0xda) { for (let k = i; k < d.length; k++) out.push(d[k]); return Uint8Array.from(out) }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { out.push(0xff, m); i += 2; continue }
    const len = (d[i + 2] << 8) | d[i + 3]
    if (len < 2 || i + 2 + len > d.length) return null
    if (m !== 0xe1 && m !== 0xed && m !== 0xfe) for (let k = i; k < i + 2 + len; k++) out.push(d[k])
    i += 2 + len
  }
  return null
}

/**
 * Prepares a phone photo for the queue: redrawn on a canvas (max 1600 px JPEG; the redraw drops all metadata). If the browser can't do that, a JPEG gets its
 * metadata blocks stripped directly. Anything else is REJECTED: an unprocessed original (with its GPS position) never lands in IndexedDB.
 */
export async function shrinkImage(file: Blob, max = 1600): Promise<Blob> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file)
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('no_canvas')      // never queue a blank JPEG: fall back to the byte-level strip, else reject
      ctx.drawImage(bmp, 0, 0, c.width, c.height)
      const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.82))
      if (out) return out
    }
  } catch { /* fall through to the byte-level strip */ }
  const clean = stripJpegMetadata(new Uint8Array(await file.arrayBuffer()))
  if (clean) return new Blob([clean.buffer as ArrayBuffer], { type: 'image/jpeg' })
  throw new Error('photo_unprocessable')
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
    let prepared: Blob
    try { prepared = await shrinkImage(photo) } catch { setErr('This photo could not be prepared. Please take it again.'); return }
    const ids = [await queue.enqueueProof(stop.id, 'photo', prepared)]
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
    let prepared: Blob | null = null
    if (photo) { try { prepared = await shrinkImage(photo) } catch { setErr('This photo could not be prepared. Please take it again.'); return } }
    const ids = prepared ? [await queue.enqueueProof(stop.id, 'photo', prepared)] : []
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
const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_p, ref) {
  const cv = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false); const dirty = useRef(false)
  const pt = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * cv.current!.width, y: ((e.clientY - r.top) / r.height) * cv.current!.height } }
  useImperativeHandle(ref, () => ({ toBlob: () => new Promise((res) => { if (!dirty.current || !cv.current?.toBlob) res(null); else cv.current.toBlob(res, 'image/png') }) }))
  const ctx = () => cv.current?.getContext?.('2d') ?? null
  const paper = () => { const c = ctx(); if (c && cv.current) { const st = getComputedStyle(cv.current); c.fillStyle = st.getPropertyValue('--sig-bg').trim() || '#ffffff'; c.fillRect(0, 0, cv.current.width, cv.current.height); c.strokeStyle = st.getPropertyValue('--sig-ink').trim() || '#14172b' } }
  useEffect(() => { paper() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="dr-field">
      <span id="sig-l">Signature (optional)</span>
      <canvas ref={cv} width={600} height={220} className="dr-sig" role="img" aria-labelledby="sig-l" style={{ touchAction: 'none' }}
        onPointerDown={(e) => { drawing.current = true; const c = ctx(); if (c) { const p = pt(e); c.lineWidth = 4; c.lineCap = 'round'; c.strokeStyle = getComputedStyle(cv.current!).getPropertyValue('--sig-ink').trim() || '#14172b'; c.beginPath(); c.moveTo(p.x, p.y) } cv.current?.setPointerCapture?.(e.pointerId) }}
        onPointerMove={(e) => { if (!drawing.current) return; const c = ctx(); if (c) { const p = pt(e); c.lineTo(p.x, p.y); c.stroke(); dirty.current = true } }}
        onPointerUp={() => { drawing.current = false }} />
      <button type="button" className="dr-small" onClick={() => { paper(); dirty.current = false }}>Clear signature</button>
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
