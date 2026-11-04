import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { useBrands } from '../pages/teams/BrandContext'
import { AuthImage } from '../products/AuthImage'
import { fetchBlob, saveBlob } from '../products/api'
import { PIcon, SelectField, TextField } from '../products/ui'
import { useCanWrite } from '../products/usePermissions'
import { TabList, tabPanelProps } from './tabs'
import { ordersApi, type Dashboard, type OrderCounts, type OrderList, type OrderListItem, type PackingSlip } from './api'
import { day, money, shipByText, statusLabel, statusTone } from './format'
import { useLiveReload } from './live'
import { PackingSlips } from './PackingSlips'
import { TrackingImport } from './TrackingImport'
import { BulkLabelsDialog } from '../shipping/OrderShipping'
import { summaryLabel, summaryTone } from '../shipping/format'
import './orders.css'

const TABS: [string, string, keyof OrderCounts][] = [
  ['needs_action', 'Needs action', 'needsAction'], ['pending', 'Pending acceptance', 'pending'], ['shipped', 'Shipped', 'shipped'], ['delivered', 'Delivered', 'delivered'],
  ['cancelled', 'Cancelled', 'cancelled'], ['returns', 'Returns', 'returns'], ['all', 'All orders', 'all'],
]
const STATUSES = ['New', 'Accepted', 'PartiallyShipped', 'Shipped', 'Delivered', 'Completed', 'OnHold', 'Cancelled', 'ReturnRequested', 'ReturnApproved', 'ReturnRejected', 'ReturnReceived', 'Refunded'] as const

function Flags({ o }: { o: OrderListItem }) {
  return (
    <>
      <span className={`chip ${statusTone(o.status)}`}>{statusLabel(o.status, o)}</span>
      {o.late && <span className="chip bad">Late</span>}
      {o.oversold && <span className="chip warn">Oversold</span>}
      {o.cancelRequested && <span className="chip warn">Cancel requested</span>}
      {o.trackingStatus && <span className={`chip ${summaryTone(o.trackingStatus)}`}>{summaryLabel(o.trackingStatus)}</span>}
    </>
  )
}
function ShipBy({ o }: { o: OrderListItem }) {
  const s = shipByText(o)
  return s.tone === 'none' ? <span className="sub">—</span> : <span className={s.tone === 'bad' ? 'quality bad' : s.tone === 'warn' ? 'quality warn' : 'quality ok'}>{s.text}</span>
}
const Thumb = ({ o }: { o: OrderListItem }) => o.thumbnailLineId ? <AuthImage src={ordersApi.thumbnail(o.id, o.thumbnailLineId)} alt="" className="pthumb" /> : <span className="pthumb img-ph" aria-hidden="true" />

export default function OrdersListPage() {
  const canWrite = useCanWrite()
  const { selected } = useBrands(); const brandId = selected === 'all' ? '' : selected
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') ?? 'needs_action'; const q = sp.get('q') ?? ''; const page = Number(sp.get('page') ?? '1') || 1
  const sort = sp.get('sort') ?? 'placed_desc'; const status = sp.get('status') ?? ''; const speed = sp.get('speed') ?? ''
  const tracking = sp.get('tracking') ?? ''; const from = sp.get('from') ?? ''; const to = sp.get('to') ?? ''; const late = sp.get('late') === '1'; const oversold = sp.get('oversold') === '1'
  const [search, setSearch] = useState(q)
  const [data, setData] = useState<OrderList | null>(null); const [counts, setCounts] = useState<OrderCounts | null>(null); const [dash, setDash] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [slips, setSlips] = useState<PackingSlip[] | null>(null); const [importing, setImporting] = useState(false); const [bulkLabels, setBulkLabels] = useState(false)
  const set = useCallback((o: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(o)) { if (v) n.set(k, v); else n.delete(k) } if (!('page' in o)) n.delete('page'); setSp(n, { replace: true }) }, [sp, setSp])
  const params = useMemo(() => ({ tab, q, page, sort, status, speed, tracking, from, to, late: late || undefined, oversold: oversold || undefined, brandId, pageSize: 20 }), [tab, q, page, sort, status, speed, tracking, from, to, late, oversold, brandId])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await ordersApi.list(params)) } catch (e) { setError(e instanceof ApiError ? e.message2 : 'Could not load your orders.') } finally { setLoading(false) }
    ordersApi.counts().then(setCounts).catch(() => undefined)
    ordersApi.dashboard(brandId || undefined).then(setDash).catch(() => undefined)
  }, [params, brandId])
  useEffect(() => { void load(); setSel(new Set()) }, [load])
  useLiveReload(['order.new', 'order.changed', 'order.cancel_requested', 'order.return_requested'], () => void load())
  useEffect(() => { const t = setTimeout(() => { if (search !== q) set({ q: search }) }, 350); return () => clearTimeout(t) }, [search, q, set])

  const items = data?.items ?? []
  const all = items.length > 0 && items.every((i) => sel.has(i.id))
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const bulkAccept = async () => {
    const r = await ordersApi.bulkAccept([...sel]).catch((e) => { setNotice({ kind: 'error', text: e instanceof ApiError ? e.message2 : 'Could not accept the orders.' }); return null })
    if (!r) return
    const ok = r.results.filter((x) => x.ok).length; const failed = r.results.filter((x) => !x.ok)
    setNotice(failed.length ? { kind: 'error', text: `${ok} accepted. ${failed.map((f) => `${f.number ?? 'An order'}: ${f.message}`).join(' ')}` } : { kind: 'success', text: `${ok} order${ok === 1 ? '' : 's'} accepted.` })
    void load()
  }
  const printSlips = async () => { try { setSlips((await ordersApi.packingSlips([...sel])).slips) } catch { setNotice({ kind: 'error', text: 'Could not prepare the packing slips.' }) } }
  const exportCsv = async () => {
    const o = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v && k !== 'page' && k !== 'pageSize') o.set(k, String(v))
    try { saveBlob(await fetchBlob(`/seller/orders/export.csv?${o}`), 'orders.csv') } catch { setNotice({ kind: 'error', text: 'Could not export the orders.' }) }
  }
  const maxSales = Math.max(1, ...(dash?.daily.map((d) => d.salesCents) ?? [1]))
  const stat = (v: string | number, l: string, tone = '') => <li className={`stat ${tone}`}><span className="v">{v}</span><span className="l">{l}</span></li>

  return (
    <main className="pwrap" aria-labelledby="page-title">
      <div className="plist-head"><div><h1 id="page-title" tabIndex={-1}>Orders</h1><p className="lead">Accept, pack and ship what buyers ordered. Solvelt handles payment and payouts.</p></div>
        <div className="bulkbar-top"><Button onClick={() => void exportCsv()}><PIcon name="download" /> Export CSV</Button>{canWrite && <Button onClick={() => setImporting(true)}><PIcon name="upload" /> Upload tracking CSV</Button>}</div>
      </div>

      {dash && (
        <section aria-label="Orders at a glance">
          <ul className="stats">
            {stat(dash.todayOrders, "Today's orders")}{stat(dash.toShip, 'To ship')}{stat(dash.late, 'Late', dash.late > 0 ? 'bad' : '')}{stat(dash.returnsOpen, 'Open returns', dash.returnsOpen > 0 ? 'warn' : '')}
            {stat(money(dash.sales30Cents), 'Sales, last 30 days')}{stat(`${dash.lateShipmentRate}%`, 'Shipped late')}{stat(`${dash.cancellationRate}%`, 'Cancelled by seller or buyer')}
            {dash.shipping && stat(dash.shipping.labelsToPrint, 'Labels to print', dash.shipping.labelsToPrint > 0 ? 'warn' : '')}{dash.shipping && stat(dash.shipping.exceptions, 'Delivery problems', dash.shipping.exceptions > 0 ? 'bad' : '')}
          </ul>
          <div className="sales-chart" role="img" aria-label={`Daily sales for the last 30 days, ${money(dash.sales30Cents)} in total across ${dash.orders30} orders`}>
            {dash.daily.map((d) => <span key={d.date} style={{ height: `${Math.max(4, (d.salesCents / maxSales) * 100)}%` }} />)}
          </div>
        </section>
      )}

      <TabList label="Order groups" idPrefix="otab" value={tab} onChange={(id) => set({ tab: id === 'needs_action' ? '' : id })}
        tabs={TABS.map(([id, label, key]) => ({ id, label: <>{label}{counts && <>{' '}<span className="pcount">{counts[key]}</span></>}</> }))} />

      <div className="filters">
        <div className="field search"><label className="sr-only" htmlFor="order-search">Search orders</label><PIcon name="search" /><input id="order-search" type="search" role="searchbox" aria-label="Search orders" placeholder="Order number, buyer, SKU or tracking number" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <SelectField label="Sort by" value={sort} onChange={(e) => set({ sort: e.target.value === 'placed_desc' ? '' : e.target.value })}>
          <option value="placed_desc">Newest first</option><option value="placed_asc">Oldest first</option><option value="shipby_asc">Ship-by date</option><option value="total_desc">Highest total</option><option value="total_asc">Lowest total</option>
        </SelectField>
      </div>
      <details className="filters-more" open={!!(from || to || status || speed || tracking || late || oversold)}>
        <summary>More filters</summary>
        <div className="filters">
          <TextField label="Placed from" type="date" value={from} onChange={(e) => set({ from: e.target.value })} />
          <TextField label="Placed until" type="date" value={to} onChange={(e) => set({ to: e.target.value })} />
          <SelectField label="Status" value={status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</SelectField>
          <SelectField label="Delivery progress" value={tracking} onChange={(e) => set({ tracking: e.target.value })}><option value="">Any</option><option value="in_transit">In transit</option><option value="exception">Delivery problem</option><option value="delivered">Delivered</option></SelectField>
          <SelectField label="Shipping speed" value={speed} onChange={(e) => set({ speed: e.target.value })}><option value="">Any speed</option><option value="standard">Standard</option><option value="expedited">Expedited</option><option value="overnight">Overnight</option></SelectField>
          <div className="field check"><label><input type="checkbox" checked={late} onChange={(e) => set({ late: e.target.checked ? '1' : '' })} /> Late only</label></div>
          <div className="field check"><label><input type="checkbox" checked={oversold} onChange={(e) => set({ oversold: e.target.checked ? '1' : '' })} /> Oversold only</label></div>
        </div>
      </details>

      <div aria-live="polite">{notice && <Alert kind={notice.kind}>{notice.text}</Alert>}</div>
      <Alert>{error}</Alert>

      {canWrite && sel.size > 0 && (
        <div className="bulkbar-sel" role="region" aria-label="Selected orders">
          <strong>{sel.size} selected</strong>
          <Button variant="primary" onClick={() => void bulkAccept()}>Accept</Button><Button onClick={() => setBulkLabels(true)}>Buy labels</Button><Button onClick={() => void printSlips()}>Print packing slips</Button><Button variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
        </div>
      )}
      {!canWrite && sel.size > 0 && <div className="bulkbar-sel"><Button onClick={() => void printSlips()}>Print packing slips</Button></div>}

      <div {...tabPanelProps('otab', tab)}>
      {loading && !data && <div className="skel-table" aria-busy="true" aria-label="Loading orders">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton row-sk" />)}</div>}
      {data && items.length === 0 && !loading && (
        <div className="pempty"><PIcon name="box" />
          <h2>{q || status || from || to || late || oversold || speed || tracking ? 'No orders match' : tab === 'needs_action' ? 'Nothing needs your attention' : 'No orders here yet'}</h2>
          <p>{q || status || from || to || late || oversold || speed || tracking ? 'Try different filters or clear the search.' : tab === 'needs_action' ? 'New orders and requests from buyers will show up here.' : 'When shoppers order your products, they appear here.'}</p>
          {(q || status || from || to || late || oversold || speed || tracking) && <Button onClick={() => { setSearch(''); setSp(new URLSearchParams(tab === 'needs_action' ? {} : { tab })) }}>Clear filters</Button>}
        </div>
      )}
      {items.length > 0 && (
        <>
          <div className="tablewrap desk">
            <table className="ptable" aria-busy={loading || undefined}>
              <caption className="sr-only">Your orders</caption>
              <thead><tr>
                <th scope="col"><input type="checkbox" aria-label="Select all on this page" checked={all} onChange={() => setSel(all ? new Set() : new Set(items.map((i) => i.id)))} /></th>
                <th scope="col">Order</th><th scope="col">Items</th><th scope="col">Buyer</th><th scope="col">Total</th><th scope="col">Ship by</th><th scope="col">Status</th>
              </tr></thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id}>
                    <td><input type="checkbox" aria-label={`Select order ${o.number}`} checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></td>
                    <td><Link to={`/orders/${o.id}`} className="ptitle">{o.number}</Link><div className="sub">{day(o.placedAt)}{brandId === '' && o.brandName ? ` · ${o.brandName}` : ''}</div></td>
                    <td><div className="pcell"><Thumb o={o} /><div>{o.itemsSummary}<div className="sub">{o.itemCount} item{o.itemCount === 1 ? '' : 's'}</div></div></div></td>
                    <td>{o.buyerName}</td><td>{money(o.totalCents, o.currency)}</td><td><ShipBy o={o} /></td><td><Flags o={o} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="pcards" aria-label="Your orders">
            {items.map((o) => (
              <li key={o.id} className="pcard">
                <div className="pcell"><input type="checkbox" aria-label={`Select order ${o.number}`} checked={sel.has(o.id)} onChange={() => toggle(o.id)} /><Thumb o={o} />
                  <div className="pc-body"><Link to={`/orders/${o.id}`} className="ptitle">{o.number}</Link><div className="sub">{o.itemsSummary}</div><div className="sub">{o.buyerName} · {day(o.placedAt)} · {money(o.totalCents, o.currency)}</div></div></div>
                <div className="pc-meta"><Flags o={o} /><ShipBy o={o} /></div>
              </li>
            ))}
          </ul>
          <nav className="pager" aria-label="Pages">
            <Button disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</Button>
            <span>Page {page} of {pages}</span>
            <Button disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Next</Button>
          </nav>
        </>
      )}
      </div>
      {slips && <PackingSlips slips={slips} onClose={() => setSlips(null)} />}
      {bulkLabels && <BulkLabelsDialog orderIds={[...sel]} onClose={() => setBulkLabels(false)} onDone={(n) => { if (n > 0) setNotice({ kind: 'success', text: `${n} label${n === 1 ? '' : 's'} bought. Open each order to print it.` }); setSel(new Set()); void load() }} />}
      {importing && <TrackingImport onClose={() => setImporting(false)} onDone={(n) => { setNotice({ kind: 'success', text: `${n} order${n === 1 ? '' : 's'} marked as shipped.` }); void load() }} />}
    </main>
  )
}
