import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { TextField } from '../products/ui'

interface Made { marketplaceOrderId: string; orders: { id: string; number: string; brandId: string; oversold: boolean }[] }
const SCENARIOS: [string, string][] = [['single', 'One item'], ['multi', 'Several items'], ['multi_brand', 'Split across brands'], ['variants', 'With variants'], ['out_of_stock', 'Out of stock']]
const EVENTS: [string, string][] = [['cancel_request', 'Buyer asks to cancel'], ['return_request', 'Buyer asks to return'], ['delivered', 'Carrier confirms delivery'], ['message', 'Buyer sends a message']]

/** Development-only (the route does not exist in production builds): create realistic test orders and simulate what the buyer site would send. */
export default function SimulatorPage() {
  const [made, setMade] = useState<Made[]>([]); const [error, setError] = useState(''); const [info, setInfo] = useState('')
  const [orderId, setOrderId] = useState(''); const [productId, setProductId] = useState(''); const [sink, setSink] = useState<{ Type: string; body: string }[] | null>(null)
  const run = async <T,>(fn: () => Promise<T>, ok: (r: T) => string) => { setError(''); setInfo(''); try { setInfo(ok(await fn())) } catch (e) { setError(e instanceof ApiError ? (e.body?.errors ? JSON.stringify(e.body.errors) : e.message2) : 'Request failed.') } }
  return (
    <main className="pwrap" aria-labelledby="page-title">
      <h1 id="page-title" tabIndex={-1}>Order simulator</h1>
      <p className="lead">Test tool for development. It creates orders for your own active products, exactly as the main website would send them.</p>
      <Alert>{error}</Alert><div aria-live="polite">{info && <Alert kind="success">{info}</Alert>}</div>
      <section className="pcard" aria-labelledby="sim-new"><h2 id="sim-new">Create a test order</h2>
        <div className="actions">{SCENARIOS.map(([k, l]) => <Button key={k} onClick={() => void run(() => api<Made>('/seller/dev/orders', { body: { scenario: k } }), (r) => { setMade((m) => [r, ...m]); setOrderId(r.orders[0].id); return `Created ${r.orders.map((o) => o.number).join(', ')}${r.orders.some((o) => o.oversold) ? ' (oversold)' : ''}` })}>{l}</Button>)}</div>
        <ul>{made.map((m) => <li key={m.marketplaceOrderId}>{m.orders.map((o) => <span key={o.id}><Link to={`/orders/${o.id}`}>{o.number}</Link>{o.oversold ? ' (oversold) ' : ' '}</span>)}</li>)}</ul>
      </section>
      <section className="pcard" aria-labelledby="sim-ev"><h2 id="sim-ev">Buyer events</h2>
        <TextField label="Order id" value={orderId} onChange={(e) => setOrderId(e.target.value)} hint="Filled in automatically with the last test order." />
        <div className="actions">{EVENTS.map(([k, l]) => <Button key={k} disabled={!orderId} onClick={() => void run(() => api(`/seller/dev/orders/${orderId}/events`, { body: { type: k } }), () => `Sent: ${l}`)}>{l}</Button>)}</div>
        <TextField label="Product id (for a question before buying)" value={productId} onChange={(e) => setProductId(e.target.value)} />
        <Button disabled={!productId} onClick={() => void run(() => api('/seller/dev/messages', { body: { productId, text: 'Does this come in other colours?' } }), () => 'Question sent')}>Buyer asks a product question</Button>
      </section>
      <section className="pcard" aria-labelledby="sim-sink"><h2 id="sim-sink">What the marketplace received</h2>
        <div className="actions"><Button onClick={() => void run(async () => { await fetch('/api/dev/outbox/dispatch', { method: 'POST' }); const r = await fetch('/api/dev/outbox'); setSink((await r.json()) as { Type: string; body: string }[]); return 0 }, () => 'Updated')}>Deliver and refresh</Button></div>
        <ul>{sink?.map((s, i) => <li key={i}><code>{s.Type}</code></li>)}</ul>
      </section>
    </main>
  )
}
