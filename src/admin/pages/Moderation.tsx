import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert } from '../../components/ui'
import { adminApi, fmtDate, qs, type Page } from '../api'
import { Badge, Can, ErrorNote, KV, Loading, PageHeader, Pager, Panel, ReasonAction, Table, useLoad } from '../components'
import { useAdmin } from '../AdminAuth'

interface Item { id: string; kind: string; targetId: string; sellerId: string; reason: string; summary: string; reporterKind: string; status: string; createdAt: string; resolution: string | null; vendor: string | null }
interface Msg { id: string; direction: string; text: string; createdAt: string; contactWarning?: boolean; reported?: boolean }
interface Detail extends Item { resolvedAt: string | null; resolutionNote: string | null; target: { conversationId?: string; bookingId?: string; productId?: string; subject?: string; messages?: Msg[] } | null }
const KINDS: Record<string, string> = { message: 'Reported message', contact_warning: 'Contact details in a message', listing: 'Reported listing', booking_message: 'Reported booking message' }

export default function Moderation() {
  const { id } = useParams()
  return id ? <ReportDetail id={id} /> : <Queue />
}

function Queue() {
  const [status, setStatus] = useState('open'); const [kind, setKind] = useState(''); const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Item>>('/moderation' + qs({ status, kind, page })), [status, kind, page])
  return (
    <>
      <PageHeader title="Moderation" lead="Reported messages, contact-detail warnings and reported listings. Oldest first." />
      <Panel>
        <form className="adm-filters" aria-label="Filter the queue" onSubmit={(e) => e.preventDefault()}>
          <div className="field"><label htmlFor="m-status">Status</label>
            <select id="m-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}><option value="open">Open</option><option value="dismissed">Dismissed</option><option value="actioned">Actioned</option><option value="all">All</option></select></div>
          <div className="field"><label htmlFor="m-kind">Type</label>
            <select id="m-kind" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1) }}><option value="">All types</option>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </form>
        <ErrorNote error={error} retry={reload} />
        {loading && !data ? <Loading /> : data && (
          <>
            <Table caption="Moderation queue" head={['Type', 'What was reported', 'Seller', 'Reported by', 'When', 'Status']} empty="The queue is empty.">
              {data.items.map((r) => <tr key={r.id}><th scope="row"><Link to={`/admin/moderation/${r.id}`}>{KINDS[r.kind] ?? r.kind}</Link></th><td className="adm-clip">{r.summary || r.reason}</td><td>{r.vendor ?? '—'}</td><td>{r.reporterKind}</td><td>{fmtDate(r.createdAt)}</td><td><Badge value={r.status === 'Open' ? 'Open' : r.resolution ? `${r.status} (${r.resolution})` : r.status} tone={r.status === 'Open' ? 'warn' : 'muted'} /></td></tr>)}
            </Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  )
}

interface Listing { id: string; type: string; status: string; title: string; description: string | null; sku: string | null; priceCents: number | null; stock: number; brand: string | null; seller: { id: string; vendorName: string | null; status: string } | null; images: number
  moderation: { hidden: boolean; reason: string | null; since: string } | null }

function ListingView({ id, onChange }: { id: string; onChange: () => void }) {
  const { can } = useAdmin()
  const { data: l, error, reload } = useLoad(() => adminApi<Listing>(`/listings/${id}`), [id])
  if (error) return <ErrorNote error={error} retry={reload} />
  if (!l) return <Loading lines={2} />
  const post = (p: string) => (reason: string) => adminApi(`/listings/${id}/${p}`, { body: { reason } })
  return (
    <Panel title="Listing (read-only)" actions={<Badge value={l.moderation ? 'Suspended' : l.status} tone={l.moderation ? 'err' : undefined} />}>
      <KV items={[['Title', l.title], ['Type', l.type], ['Seller', l.seller ? <Link to={`/admin/sellers/${l.seller.id}`}>{l.seller.vendorName}</Link> : '—'], ['Brand', l.brand], ['Price', l.priceCents != null ? (l.priceCents / 100).toFixed(2) : '—'], ['Stock', l.stock], ['Photos', l.images], ['Status', l.moderation ? `Hidden by staff since ${fmtDate(l.moderation.since)}: ${l.moderation.reason}` : l.status]]} />
      {l.description && <details className="adm-chartdata"><summary>Description (plain text)</summary><pre className="adm-pre">{l.description}</pre></details>}
      {can('ModerationAct') && (
        <div className="adm-actionrow">
          {l.moderation
            ? <ReasonAction label="Unhide listing" variant="primary" onDone={() => { reload(); onChange() }} dialog={{ title: 'Unhide this listing', lead: 'The seller is emailed and can sell it again.', confirm: 'Unhide', onSubmit: post('unhide') }} />
            : <ReasonAction label="Hide listing" variant="destructive" onDone={() => { reload(); onChange() }} dialog={{ title: 'Hide this listing', lead: 'It leaves the marketplace. The reason is shown to the seller and emailed to them.', reasonLabel: 'Reason (shown to the seller)', confirm: 'Hide listing', danger: true, onSubmit: post('hide') }} />}
        </div>
      )}
    </Panel>
  )
}

function ReportDetail({ id }: { id: string }) {
  const { can, me } = useAdmin()
  const { data: d, error, loading, reload } = useLoad(() => adminApi<Detail>(`/moderation/${id}`), [id])
  const [msg, setMsg] = useState<string | null>(null)
  if (loading && !d) return <Loading />
  if (error || !d) return <><PageHeader title="Report" /><ErrorNote error={error ?? 'Not found'} retry={reload} /><Link to="/admin/moderation">Back to the queue</Link></>
  const post = (p: string) => (reason: string) => adminApi(`/moderation/${id}/${p}`, { body: { reason } })
  const done = (m: string) => () => { setMsg(m); reload() }
  const open = d.status === 'Open'
  return (
    <>
      <PageHeader title={KINDS[d.kind] ?? d.kind} lead={`Reported ${fmtDate(d.createdAt)} by ${d.reporterKind}: ${d.reason}`} actions={<Link className="btn" to="/admin/moderation">Back to the queue</Link>} />
      <Alert kind="success">{msg ?? ''}</Alert>
      <Panel title="Decision" actions={<Badge value={d.status} />}>
        {!open && <p>{d.resolution ? `Resolved: ${d.resolution}. ` : ''}{d.resolutionNote}</p>}
        <p className="adm-muted">Seller: <Link to={`/admin/sellers/${d.sellerId}`}>{d.vendor ?? d.sellerId}</Link></p>
        <Can permission="ModerationAct">
          <div className="adm-actionrow">
            <ReasonAction label="Dismiss" disabled={!open} onDone={done('Report dismissed.')} dialog={{ title: 'Dismiss this report', confirm: 'Dismiss', onSubmit: post('dismiss') }} />
            <ReasonAction label="Warn seller" disabled={!open} onDone={done('The seller was warned by email.')} dialog={{ title: 'Warn the seller', lead: 'The reason is emailed to the seller’s owners.', reasonLabel: 'Warning text (sent to the seller)', confirm: 'Send warning', onSubmit: post('warn-seller') }} />
            <ReasonAction label="Escalate: suspend the seller" variant="destructive" disabled={!open} onDone={done('The seller was suspended.')} dialog={{ title: 'Suspend the seller', lead: 'The seller’s account is suspended and its members lose access. This resolves the report.', confirm: 'Suspend seller', danger: true, onSubmit: post('escalate-suspend') }} />
          </div>
        </Can>
        {me && !can('ModerationAct') && <p className="adm-muted">Your role can read reports but not act on them.</p>}
      </Panel>
      {d.target?.messages && (
        <Panel title="Message and context">
          {!can('ModerationAct') && <p className="adm-muted">Email addresses and phone numbers in message text are hidden for your role.</p>}
          <ol className="adm-thread" aria-label="Conversation">
            {d.target.messages.map((m) => <li key={m.id} className={m.direction.toLowerCase()}><div className="adm-who2">{m.direction === 'Buyer' || m.direction === 'buyer' ? 'Buyer' : 'Seller'} · <time dateTime={m.createdAt}>{fmtDate(m.createdAt)}</time>{m.reported ? ' · reported' : ''}{m.contactWarning ? ' · contact-details warning' : ''}</div><p>{m.text}</p></li>)}
          </ol>
        </Panel>
      )}
      {d.kind === 'listing' && <ListingView id={d.targetId} onChange={reload} />}
    </>
  )
}
