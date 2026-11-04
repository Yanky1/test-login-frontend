import { useEffect, useState } from 'react'
import { ApiError, tokenStore } from '../api'
import { Alert } from '../components/ui'
import { deliveryApi, STATUS_LABEL, TRACKING_LABEL, timeRange, type TrackingTimeline, type DeliverySettings } from './api'

/** Order detail: the tracking timeline of a local delivery (with proof of delivery) and "switch to local delivery" for orders that qualify. */
export default function LocalTracking({ orderId, status, canConvert }: { orderId: string; status: string; canConvert: boolean }) {
  const [t, setT] = useState<TrackingTimeline | null>(null)
  const [settings, setSettings] = useState<DeliverySettings | null>(null)
  const [date, setDate] = useState('')
  const [win, setWin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [proofs, setProofs] = useState<Record<string, string>>({})
  const load = () => deliveryApi.tracking(orderId).then(setT).catch(() => setT(null))
  useEffect(() => { void load() }, [orderId, status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (canConvert && t && t.method === 'carrier') deliveryApi.settings().then(setSettings).catch(() => undefined) }, [canConvert, t])
  useEffect(() => () => { Object.values(proofs).forEach((u) => URL.revokeObjectURL(u)) }, [proofs])

  if (!t) return null
  if (t.method === 'carrier') {
    if (!canConvert || !settings?.enabled || !['New', 'Accepted'].includes(status) || settings.windows.length === 0) return null
    const convert = async (e: React.FormEvent) => {
      e.preventDefault(); setErr(null)
      try { await deliveryApi.convert(orderId, win, date); await load() } catch (er) { setErr(er instanceof ApiError ? er.message2 : 'Could not switch this order.') }
    }
    return (
      <form className="card" onSubmit={(e) => void convert(e)} aria-label="Switch to local delivery">
        <h3>Deliver locally</h3>
        <p>If this address is inside one of your delivery zones you can deliver it with your own driver instead of a carrier. The buyer is notified.</p>
        {err && <Alert>{err}</Alert>}
        <label>Day<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Window<select required value={win} onChange={(e) => setWin(e.target.value)}><option value="">Choose…</option>{settings.windows.filter((w) => w.id).map((w) => <option key={w.id} value={w.id}>{w.start} – {w.end}</option>)}</select></label>
        <button type="submit" className="btn">Switch to local delivery</button>
      </form>
    )
  }
  const open = async (id: string, url: string) => {   // proofs need the bearer token: fetch and show through an object URL
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenStore.get() ?? ''}` } })
      if (!res.ok) return
      const u = URL.createObjectURL(await res.blob()); setProofs((p) => ({ ...p, [id]: u }))
    } catch { /* ignore */ }
  }
  return (
    <section className="card" aria-label="Local delivery tracking">
      <h3>Local delivery {t.delivery && <span className="dp-chip">{STATUS_LABEL[t.delivery.status]}</span>}</h3>
      {t.delivery && <p>Window {timeRange(t.delivery.windowStart, t.delivery.windowEnd)} · code {t.delivery.code}</p>}
      <ol className="timeline" aria-label="Tracking history">
        {t.events.map((e, i) => <li key={i}><strong>{TRACKING_LABEL[e.status] ?? e.status}</strong> <time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>{e.detail && e.status === 'failure' ? ` · ${e.detail.replace(/_/g, ' ')}` : ''}</li>)}
      </ol>
      {t.attempts.filter((a) => a.outcome === 'delivered').map((a) => <p key={a.number}>Delivered {a.placement === 'left_at_door' ? 'and left at the door' : a.recipientName ? `to ${a.recipientName}` : 'by hand'}.</p>)}
      {t.proofs.length > 0 && (
        <div className="proofs">
          <h4>Proof of delivery</h4>
          {t.proofs.map((p) => proofs[p.id]
            ? <img key={p.id} src={proofs[p.id]} alt={p.kind === 'signature' ? 'Recipient signature' : 'Photo of the delivery'} style={{ maxWidth: '100%', maxHeight: 240 }} />
            : <button key={p.id} type="button" className="btn" onClick={() => void open(p.id, p.url)}>Show {p.kind === 'signature' ? 'signature' : 'photo'}</button>)}
        </div>
      )}
    </section>
  )
}
