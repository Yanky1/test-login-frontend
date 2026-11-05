import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui'
import { ordersApi } from '../orders/api'
import { productsApi } from '../products/api'
import { countsSummary, demoApi, demoChanged, type DemoCounts } from './api'
import { describe, useDemoTools } from './TestMode'
import './demo.css'

/** True when the account has no products and no orders. A probe that fails is ignored (a pending account may not read orders yet). */
export function useAccountEmpty(enabled: boolean): boolean | null {
  const [empty, setEmpty] = useState<boolean | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    Promise.all([
      productsApi.list({ pageSize: 1 }).then((r) => r.total, () => 0),
      ordersApi.counts().then((c) => c.all, () => 0),
      demoApi.status().then((s) => (s.exists ? 1 : 0), () => 0),
    ]).then(([p, o, d]) => { if (alive) setEmpty(p + o + d === 0) })
    return () => { alive = false }
  }, [enabled])
  return enabled ? empty : null
}

/**
 * "Fill with demo data" card for an empty account (test mode, Owner only). On the pending-approval screen the data is created too,
 * but only shows up in the lists after approval, and the card says so.
 */
export function DemoFillCard({ pending = false, onFilled }: { pending?: boolean; onFilled?: () => void }) {
  const tools = useDemoTools()
  const empty = useAccountEmpty(tools)
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState('')
  const [counts, setCounts] = useState<DemoCounts | null>(null)
  if (!tools) return null
  if (state !== 'done' && empty !== true) return null
  const run = async () => {
    setState('busy'); setError('')
    try {
      const r = await demoApi.fill()
      setCounts(r.counts); setState('done'); demoChanged(); onFilled?.()
    } catch (e) { setError(describe(e)); setState('idle') }
  }
  if (state === 'done') {
    return (
      <section className="demo-card" aria-labelledby="demo-card-h">
        <h2 id="demo-card-h">Demo data added</h2>
        <p role="status">{counts ? `Added ${countsSummary(counts)}. ` : ''}{pending ? 'It will appear in your lists once this account is approved.' : <>You can remove it any time in <Link to="/settings/test-tools">Settings, Test tools</Link>.</>}</p>
      </section>
    )
  }
  return (
    <section className="demo-card" aria-labelledby="demo-card-h">
      <h2 id="demo-card-h"><span className="chip test-mode">TEST MODE</span> Fill with demo data</h2>
      <p>Your account is empty. Add sample products, services, orders, bookings and messages so you can try the portal. Demo records are marked <span className="chip demo">Demo</span> and can be removed again.</p>
      {pending && <p className="demo-note">This account is waiting for approval, so the demo data will appear in your lists after approval.</p>}
      {error && <p role="alert" className="alert error">{error}</p>}
      <div className="demo-actions">
        <Button variant="primary" type="button" loading={state === 'busy'} onClick={() => void run()}>Fill with demo data</Button>
        {state === 'busy' && <span role="status" className="demo-progress"><span className="spinner" aria-hidden="true" /> Creating demo data, this takes a few seconds</span>}
      </div>
    </section>
  )
}
