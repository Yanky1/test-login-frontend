import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert } from '../../components/ui'
import { adminApi, fmtDate, fmtMoney, qs, type Page } from '../api'
import { Badge, Can, ErrorNote, Loading, PageHeader, Pager, Panel, ReasonAction, Table, Tabs, useLoad } from '../components'

interface Label { id: string; sellerId: string; orderId: string | null; kind: string; status: string; carrier: string | null; service: string | null; trackingNumber: string | null; costCents: number | null; currency: string | null
  createdAt: string; purchasedAt: string | null; refundStatus: string | null; refundError: string | null; refundAttempts: number; refundRequestedAt: string | null; error: string | null }
interface Shipment { id: string; orderId: string; orderNumber: string; carrier: string | null; service: string | null; trackingNumber: string | null; method: string | null; status: string | null; shippedAt: string | null; deliveredAt: string | null; labelId: string | null }
interface Exception { orderId: string; sellerId: string; orderNumber: string; reason: string | null; since: string | null }
interface Webhook { id: string; provider: string; eventId: string | null; trackingNumber: string | null; outcome: string; error: string | null; receivedAt: string }

const tone = (s: string) => (/fail|error/i.test(s) ? 'err' : /void|review|pending/i.test(s) ? 'warn' : /active|deliver/i.test(s) ? 'ok' : 'muted')

/** Retry of a label refund: only for labels whose refund is pending or failed (the server decides; the button just matches its rule). */
function RetryRefund({ l, onDone }: { l: Label; onDone: () => void }) {
  if (l.status !== 'Voiding' && l.status !== 'RefundFailed') return null
  return (
    <Can permission="ShippingRetry">
      <ReasonAction label="Retry refund" onDone={onDone} dialog={{
        title: 'Retry this label refund', lead: `Ask the carrier again to refund label ${l.trackingNumber ?? l.id.slice(0, 8)}${l.refundError ? ` (last error: ${l.refundError})` : ''}.`, confirm: 'Retry refund',
        onSubmit: (reason) => adminApi(`/shipping/labels/${l.id}/refund/retry`, { body: { reason } }),
      }} />
    </Can>
  )
}

const LabelTable = ({ items, onDone, withSeller }: { items: Label[]; onDone: () => void; withSeller?: boolean }) => (
  <Table caption="Labels" head={[...(withSeller ? ['Seller'] : []), 'Tracking', 'Carrier', 'Kind', 'Status', 'Cost', 'Refund', 'Created', 'Action']} empty="No labels.">
    {items.map((l) => (
      <tr key={l.id}>
        {withSeller && <td><Link to={`/admin/sellers/${l.sellerId}/shipping`}>{l.sellerId.slice(0, 8)}…</Link></td>}
        <th scope="row">{l.trackingNumber ?? '—'}</th><td>{[l.carrier, l.service].filter(Boolean).join(' ') || '—'}</td><td>{l.kind}</td><td><Badge value={l.status} tone={tone(l.status)} /></td>
        <td>{fmtMoney(l.costCents, l.currency ?? 'USD')}</td>
        <td>{l.refundStatus ?? '—'}{l.refundAttempts ? ` (${l.refundAttempts} tries)` : ''}{l.refundError ? <div className="adm-muted">{l.refundError}</div> : null}</td>
        <td>{fmtDate(l.createdAt)}</td><td><RetryRefund l={l} onDone={onDone} /></td>
      </tr>
    ))}
  </Table>
)

/* ------------------------------------------------------------------------------------------------ one seller */
export function SellerShipping({ id }: { id: string }) {
  const [sp, setSp] = useState(1); const [lp, setLp] = useState(1); const [status, setStatus] = useState('')
  const ships = useLoad(() => adminApi<Page<Shipment>>(`/shipping/sellers/${id}/shipments` + qs({ page: sp })), [id, sp])
  const labels = useLoad(() => adminApi<Page<Label>>(`/shipping/sellers/${id}/labels` + qs({ status, page: lp })), [id, status, lp])
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <>
      <Alert kind="success">{msg ?? ''}</Alert>
      <Panel title="Shipments">
        <ErrorNote error={ships.error} retry={ships.reload} />
        {ships.loading && !ships.data ? <Loading /> : ships.data && (
          <>
            <Table caption="Shipments" head={['Order', 'Tracking', 'Carrier', 'Status', 'Shipped', 'Delivered']} empty="No shipments yet.">
              {ships.data.items.map((s) => <tr key={s.id}><th scope="row">{s.orderNumber}</th><td>{s.trackingNumber ?? '—'}</td><td>{[s.carrier, s.service].filter(Boolean).join(' ') || s.method || '—'}</td><td>{s.status ? <Badge value={s.status} tone={tone(s.status)} /> : '—'}</td><td>{fmtDate(s.shippedAt)}</td><td>{fmtDate(s.deliveredAt)}</td></tr>)}
            </Table>
            <Pager page={ships.data.page} pageSize={ships.data.pageSize} total={ships.data.total} onPage={setSp} />
          </>
        )}
      </Panel>
      <Panel title="Labels">
        <form className="adm-filters" aria-label="Filter labels" onSubmit={(e) => e.preventDefault()}>
          <div className="field"><label htmlFor="lb-status">Label status</label>
            <select id="lb-status" value={status} onChange={(e) => { setStatus(e.target.value); setLp(1) }}><option value="">Any status</option><option value="Active">Active</option><option value="Voiding">Voiding</option><option value="Voided">Voided</option><option value="RefundFailed">Refund failed</option></select></div>
        </form>
        <ErrorNote error={labels.error} retry={labels.reload} />
        {labels.loading && !labels.data ? <Loading /> : labels.data && (
          <>
            <LabelTable items={labels.data.items} onDone={() => { setMsg('The refund was requested again.'); labels.reload() }} />
            <Pager page={labels.data.page} pageSize={labels.data.pageSize} total={labels.data.total} onPage={setLp} />
          </>
        )}
      </Panel>
    </>
  )
}

/* ------------------------------------------------------------------------------------------------ platform-wide lists */
const TABS = [['refunds', 'Label refunds'], ['exceptions', 'Exceptions'], ['webhooks', 'Webhook failures']] as const

function Refunds() {
  const [state, setState] = useState(''); const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Label>>('/shipping/refunds' + qs({ state, page })), [state, page])
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <Panel title="Label refunds that are not finished">
      <Alert kind="success">{msg ?? ''}</Alert>
      <form className="adm-filters" aria-label="Filter refunds" onSubmit={(e) => e.preventDefault()}>
        <div className="field"><label htmlFor="rf-state">Refund state</label>
          <select id="rf-state" value={state} onChange={(e) => { setState(e.target.value); setPage(1) }}><option value="">All unfinished</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="review">Needs review</option></select></div>
      </form>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <LabelTable withSeller items={data.items} onDone={() => { setMsg('The refund was requested again.'); reload() }} />
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  )
}

function Exceptions() {
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Exception>>('/shipping/exceptions' + qs({ page })), [page])
  return (
    <Panel title="Orders needing attention (tracking exceptions)">
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Table caption="Shipping exceptions" head={['Order', 'Seller', 'Reason', 'Since']} empty="No shipping exceptions.">
            {data.items.map((x) => <tr key={x.orderId}><th scope="row">{x.orderNumber}</th><td><Link to={`/admin/sellers/${x.sellerId}/shipping`}>{x.sellerId.slice(0, 8)}…</Link></td><td>{x.reason ?? '—'}</td><td>{fmtDate(x.since)}</td></tr>)}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  )
}

function Webhooks() {
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Webhook>>('/shipping/webhooks/failures' + qs({ page })), [page])
  return (
    <Panel title="Carrier webhook failures">
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Table caption="Webhook failures" head={['Received', 'Provider', 'Tracking', 'Outcome', 'Error']} empty="No webhook failures.">
            {data.items.map((w) => <tr key={w.id}><td>{fmtDate(w.receivedAt)}</td><th scope="row">{w.provider}</th><td>{w.trackingNumber ?? '—'}</td><td><Badge value={w.outcome} tone="err" /></td><td className="adm-clip">{w.error ?? '—'}</td></tr>)}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  )
}

export default function Shipping() {
  const { tab = 'refunds' } = useParams()
  const nav = useNavigate()
  const current = TABS.some(([t]) => t === tab) ? tab : 'refunds'
  return (
    <>
      <PageHeader title="Shipping" lead="Platform-wide shipping work. Open a seller’s Shipping tab for their shipments and labels." />
      <Tabs label="Shipping lists" tabs={TABS} current={current} onSelect={(t) => nav(`/admin/shipping/${t}`)}>
        {current === 'refunds' && <Refunds />}
        {current === 'exceptions' && <Exceptions />}
        {current === 'webhooks' && <Webhooks />}
      </Tabs>
    </>
  )
}
