import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api'
import { useAuth } from '../auth'
import { Alert, Skeleton } from '../components/ui'
import { deliveryApi, money, STATUS_LABEL, timeRange, type Board, type BoardDelivery, type DriverRef } from './api'
import './dispatch.css'

const today = () => new Date().toISOString().slice(0, 10)

/** Dispatch board: local orders by day and window, assign drivers, build and optimize routes, print the route sheet. */
export default function DispatchBoard() {
  const { user } = useAuth()
  const canDispatch = user?.role === 'Owner' || user?.role === 'Admin' || user?.role === 'Manager'
  const [date, setDate] = useState<string | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [drivers, setDrivers] = useState<DriverRef[]>([])
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [sheet, setSheet] = useState<Awaited<ReturnType<typeof deliveryApi.routeSheet>> | null>(null)

  const load = useCallback(async (d?: string | null) => {
    try { const b = await deliveryApi.board(d ?? undefined); setBoard(b); if (!d) setDate(b.date); setError(null) } catch (e) { setError(e instanceof ApiError ? e.message2 : 'Could not load the board.') }
  }, [])
  useEffect(() => { void load(date) }, [date, load])
  useEffect(() => { deliveryApi.drivers().then(setDrivers).catch(() => setDrivers([])) }, [])
  useEffect(() => { const t = setInterval(() => void load(date), 30_000); return () => clearInterval(t) }, [date, load])   // periodic refresh (no live map in v1)

  const act = async (f: () => Promise<unknown>, ok: string) => {
    try { await f(); setMsg(ok); setError(null); await load(date) }
    catch (e) {
      setMsg(null)
      // whatever went wrong, the board may be out of date (someone else assigned it, the driver moved on): reload it so the next click works from the truth
      await load(date)
      setError(e instanceof ApiError ? (e.status === 409 ? 'This was changed by someone else. The board has been refreshed: check it and try again.' : e.message2) : 'That did not work. Try again.')   // after the reload, which clears errors
    }
  }

  const unassigned = board?.deliveries.filter((d) => d.status === 'Unassigned') ?? []
  const byWindow = new Map<string, BoardDelivery[]>()
  for (const d of board?.deliveries ?? []) byWindow.set(d.windowStart, [...(byWindow.get(d.windowStart) ?? []), d])

  return (
    <main className="dispatch" aria-labelledby="page-title">
      <div className="dp-head">
        <h1 id="page-title" tabIndex={-1}>Local delivery</h1>
        <label className="dp-date">Day <input type="date" value={date ?? today()} onChange={(e) => setDate(e.target.value)} /></label>
        <Link className="btn" to="/settings/delivery">Delivery settings</Link>
      </div>
      {error && <Alert>{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}
      {!board ? <Skeleton lines={5} /> : (
        <>
          <section aria-label="Window capacity" className="dp-windows">
            {board.windows.length === 0 && <p className="dp-muted">No delivery windows are set up. <Link to="/settings/delivery">Set them up</Link></p>}
            {board.windows.map((w) => (
              <div key={w.id} className={`dp-win ${w.warning ?? ''}`}>
                <strong>{w.start} – {w.end}</strong>
                <span>{w.booked} of {w.capacity} booked</span>
                {w.warning && <span className="dp-flag" role="status">{w.warning === 'full' ? 'Full' : 'Nearly full'}</span>}
              </div>
            ))}
          </section>

          <section aria-label="Deliveries">
            <h2>Deliveries ({board.deliveries.length})</h2>
            {board.deliveries.length === 0 && <p className="dp-muted">No local deliveries for this day.</p>}
            {[...byWindow.entries()].map(([start, rows]) => (
              <div key={start} className="dp-group">
                <h3>{timeRange(rows[0].windowStart, rows[0].windowEnd)}</h3>
                <ul className="dp-list">
                  {rows.map((d) => (
                    <li key={d.id} className={`dp-row${d.late ? ' late' : ''}${d.exception ? ' exception' : ''}`}>
                      <div className="dp-main">
                        <Link to={`/orders/${d.orderId}`}><strong>{d.number}</strong></Link>
                        <span>{d.city} {d.postalCode}</span>
                        <span className="dp-chip">{STATUS_LABEL[d.status]}</span>
                        {d.late && <span className="dp-flag" role="status">Late</span>}
                        {d.exception && <span className="dp-flag" role="status">Needs attention{d.failReason ? `: ${d.failReason.replace(/_/g, ' ')}` : ''}</span>}
                        {d.driver && <span className="dp-muted">Driver {d.driver} · stop {d.seq}</span>}
                        {d.eta && <span className="dp-muted">ETA {new Date(d.eta).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>}
                        <span className="dp-muted">{money(d.feeCents)}</span>
                      </div>
                      {canDispatch && d.status === 'Unassigned' && (
                        <div className="dp-act">
                          <label className="sr-only" htmlFor={`drv-${d.id}`}>Driver for {d.number}</label>
                          <select id={`drv-${d.id}`} value={pick[d.id] ?? ''} onChange={(e) => setPick({ ...pick, [d.id]: e.target.value })}>
                            <option value="">Choose a driver…</option>
                            {drivers.map((x) => <option key={x.membershipId} value={x.membershipId}>{x.firstName} ({x.email})</option>)}
                          </select>
                          <button type="button" className="btn primary" disabled={!pick[d.id]} onClick={() => void act(() => deliveryApi.assign(d.id, pick[d.id]), `${d.number} assigned.`)}>Assign</button>
                        </div>
                      )}
                      {canDispatch && d.status === 'Failed' && (
                        <div className="dp-act"><button type="button" className="btn" onClick={() => void act(() => deliveryApi.unassign(d.id), `${d.number} is back in the pool: assign it again.`)}>Unassign failed stop</button></div>
                      )}
                      {canDispatch && d.status === 'Assigned' && <div className="dp-act"><button type="button" className="btn" onClick={() => void act(() => deliveryApi.unassign(d.id), `${d.number} unassigned.`)}>Unassign</button></div>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {unassigned.length > 0 && <p className="dp-muted">{unassigned.length} waiting for a driver.</p>}
          </section>

          <section aria-label="Routes">
            <h2>Routes</h2>
            {board.routes.length === 0 && <p className="dp-muted">No routes yet. Assign a delivery to a driver to start one.</p>}
            {board.routes.map((r) => {
              const stops = board.deliveries.filter((d) => d.routeId === r.id).sort((a, b) => a.seq - b.seq)
              return (
                <div key={r.id} className="dp-route">
                  <h3>{r.driver ?? 'Driver'} <span className="dp-chip">{r.status === 'Planned' ? 'Not started' : r.status}</span></h3>
                  <ol>{stops.map((s) => <li key={s.id}>{s.number} · {s.city} · {STATUS_LABEL[s.status]}</li>)}</ol>
                  <div className="dp-act">
                    {canDispatch && r.status === 'Planned' && <button type="button" className="btn" onClick={() => void act(() => deliveryApi.optimize(r.id), 'Stops reordered by distance.')}>Optimize order</button>}
                    {canDispatch && r.status === 'Planned' && drivers.length > 1 && (
                      <>
                        <label className="sr-only" htmlFor={`re-${r.id}`}>Reassign route to</label>
                        <select id={`re-${r.id}`} defaultValue="" onChange={(e) => { if (e.target.value) void act(() => deliveryApi.reassign(r.id, e.target.value), 'Route reassigned.') }}>
                          <option value="">Reassign to…</option>{drivers.filter((x) => x.membershipId !== r.driverMembershipId).map((x) => <option key={x.membershipId} value={x.membershipId}>{x.firstName}</option>)}
                        </select>
                      </>
                    )}
                    <button type="button" className="btn" onClick={() => void deliveryApi.routeSheet(r.id).then(setSheet).catch(() => setError('Could not load the route sheet.'))}>Print route</button>
                  </div>
                </div>
              )
            })}
          </section>
        </>
      )}
      {sheet && (
        <section className="dp-sheet" aria-label="Route sheet">
          <h2>Route sheet · {sheet.date}</h2>
          <ol>{sheet.stops.map((s) => <li key={s.id}><strong>{s.number}</strong> {s.name}, {s.address} <em>({timeRange(s.windowStart, s.windowEnd)})</em></li>)}</ol>
          <div className="dp-act no-print"><button type="button" className="btn primary" onClick={() => window.print()}>Print</button><button type="button" className="btn" onClick={() => setSheet(null)}>Close</button></div>
        </section>
      )}
    </main>
  )
}
