import { useState, type ReactNode } from 'react'
import { Button } from '../../components/ui'
import { Link, useParams } from 'react-router-dom'
import { Alert, Field } from '../../components/ui'
import { AdminError, adminApi, fmtDate, qs, type Page } from '../api'
import { Badge, Can, ErrorNote, KV, Loading, PageHeader, Pager, Panel, ReasonAction, ReasonDialog, Table, useLoad } from '../components'
import { useAdmin } from '../AdminAuth'

interface Item { id: string; kind: string; targetId: string; sellerId: string; reason: string; summary: string; reporterKind: string; status: string; createdAt: string; resolution: string | null; vendor: string | null }
interface Msg { id: string; direction: string; text: string; createdAt: string; contactWarning?: boolean; reported?: boolean }
interface ContentReport { reportId: string; kind: string; targetId: string | null; reason: string | null; note: string | null; reporterRef: string | null; decision: string | null; decidedAt: string | null; createdAt: string }
interface Detail extends Item { resolvedAt: string | null; resolutionNote: string | null; target: { conversationId?: string; bookingId?: string; productId?: string; reviewId?: string; subject?: string; messages?: Msg[]; replyId?: string; replyText?: string; repliedAt?: string; editedAt?: string | null; removed?: boolean; removedReason?: string | null; review?: { reviewId: string; rating: number; text: string | null; buyerDisplayName: string | null; createdAt: string; state: string; productTitle: string | null }; [k: string]: unknown } | null; contentReports?: ContentReport[] }
const KINDS: Record<string, string> = { message: 'Reported message', contact_warning: 'Contact details in a message', listing: 'Reported listing', booking_message: 'Reported booking message', question: 'Reported question', review: 'Reported review', review_reply: 'Reported review reply' }

export default function Moderation() {
  const { id } = useParams()
  return id ? <ReportDetail id={id} /> : <Queue />
}

function Queue() {
  const [status, setStatus] = useState('open'); const [kind, setKind] = useState(''); const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Item>>('/moderation' + qs({ status, kind, page })), [status, kind, page])
  return (
    <>
      <PageHeader title="Moderation" lead="Reported listings, questions, messages, reviews and review replies, and contact-detail warnings. Oldest first." />
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

const DECISIONS = {
  'dismiss': { label: 'Dismiss', ok: 'Report dismissed.', title: 'Dismiss this report', lead: 'The content stays and no one is warned.', confirm: 'Dismiss', shown: true },
  'hide-content': { label: 'Hide content', ok: 'The content was hidden.', title: 'Hide the reported content', lead: 'A listing leaves the marketplace until staff unhide it. For a message or review the decision is recorded and the marketplace acts on it.', confirm: 'Hide content', shown: true, danger: true },
  'remove-content': { label: 'Remove content', ok: 'The content was removed.', title: 'Remove the reported content', lead: 'A listing is archived and stays unlisted. For a message or review the decision is recorded and the marketplace removes it. This is the stronger action.', confirm: 'Remove content', shown: true, danger: true },
  'warn-seller': { label: 'Warn seller', ok: 'The seller was warned by email.', title: 'Warn the seller', lead: 'The reason is emailed to the seller’s owners. The content stays.', reasonLabel: 'Warning text (sent to the seller)', confirm: 'Send warning', shown: true },
  'escalate-suspend': { label: 'Escalate: suspend the seller', ok: 'The seller was suspended.', title: 'Suspend the seller', lead: 'The seller’s account is suspended and its members lose access. This resolves the report.', confirm: 'Suspend seller', shown: true, danger: true },
} as const
type DecisionKey = keyof typeof DECISIONS

/** One decision on a report, behind a confirm dialog with a reason. When another moderator decided first the server answers `already_resolved`: nothing was changed, so say so and reload. */
function Decide({ id, action, variant, disabled, onDone, onLost }: { id: string; action: DecisionKey; variant?: 'secondary' | 'destructive'; disabled?: boolean; onDone: (m: string) => void; onLost: () => void }) {
  const d = DECISIONS[action]
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState('')
  const reasonLabel = 'reasonLabel' in d ? d.reasonLabel : undefined
  const extra: ReactNode = (
    <Field label="Message for the person who reported it (optional, they are told this)" value={shown} maxLength={500} onChange={(e) => setShown(e.target.value)} hint="Leave empty to tell them nothing beyond the outcome. It is never copied from your internal reason." />
  )
  return (
    <>
      <Button variant={variant ?? (('danger' in d && d.danger) ? 'destructive' : 'secondary')} disabled={disabled} onClick={() => { setShown(''); setOpen(true) }}>{d.label}</Button>
      {open && (
        <ReasonDialog title={d.title} lead={d.lead} confirm={d.confirm} danger={'danger' in d && d.danger} reasonLabel={reasonLabel} extra={extra} onClose={() => setOpen(false)}
          onSubmit={async (reason) => {
            try { await adminApi(`/moderation/${id}/${action}`, { body: { reason, ...(shown.trim() ? { reasonShownToUser: shown.trim() } : {}) } }); onDone(d.ok) }
            catch (x) { if (x instanceof AdminError && x.code === 'already_resolved') onLost(); else throw x }
          }} />
      )}
    </>
  )
}

const NO_SELLER = '00000000-0000-0000-0000-000000000000'

/** Marketplace reports behind this row (one row can carry several), with their own decision. */
function ContentReports({ items }: { items: ContentReport[] }) {
  return (
    <Panel title="Reports from the marketplace">
      <Table caption="Marketplace reports" head={['Reported', 'Kind', 'Reason', 'Note', 'Reporter', 'Decision']} empty="No marketplace reports.">
        {items.map((c) => <tr key={c.reportId}><td>{fmtDate(c.createdAt)}</td><th scope="row">{KINDS[c.kind] ?? c.kind}</th><td>{c.reason ?? '—'}</td><td className="adm-clip">{c.note ?? '—'}</td><td>{c.reporterRef ?? '—'}</td><td>{c.decision ? <Badge value={c.decision} tone="muted" /> : <Badge value="Open" tone="warn" />}</td></tr>)}
      </Table>
    </Panel>
  )
}

function ReportDetail({ id }: { id: string }) {
  const { can, me } = useAdmin()
  const { data: d, error, loading, reload } = useLoad(() => adminApi<Detail>(`/moderation/${id}`), [id])
  const [msg, setMsg] = useState<string | null>(null)
  const [lost, setLost] = useState(false)
  if (loading && !d) return <Loading />
  if (error || !d) return <><PageHeader title="Report" /><ErrorNote error={error ?? 'Not found'} retry={reload} /><Link to="/admin/moderation">Back to the queue</Link></>
  const done = (m: string) => { setMsg(m); setLost(false); reload() }
  const open = d.status === 'Open'
  const hasSeller = !!d.sellerId && d.sellerId !== NO_SELLER && d.kind !== 'review'      // a review has no seller on this portal; a seller's reply to one does
  const canHide = d.kind !== 'review_reply'                                             // the server answers 409 unsupported_decision: a reply cannot be hidden, only removed
  const known = ['conversationId', 'bookingId', 'productId', 'reviewId', 'subject', 'messages', 'replyId', 'replyText', 'repliedAt', 'editedAt', 'removed', 'removedReason', 'review']
  const extraTarget = Object.entries(d.target ?? {}).filter(([k, v]) => !known.includes(k) && (typeof v === 'string' || typeof v === 'number'))
  return (
    <>
      <PageHeader title={KINDS[d.kind] ?? d.kind} lead={`Reported ${fmtDate(d.createdAt)} by ${d.reporterKind}: ${d.reason}`} actions={<Link className="btn" to="/admin/moderation">Back to the queue</Link>} />
      <Alert kind="success">{msg ?? ''}</Alert>
      {lost && <Alert kind="info">Another moderator already resolved this report, so nothing was changed. The decision they made is shown below.</Alert>}
      <Panel title="Decision" actions={<Badge value={d.status} />}>
        {!open && <p>{d.resolution ? `Resolved: ${d.resolution}. ` : ''}{d.resolutionNote}</p>}
        <p className="adm-muted">{hasSeller ? <>Seller: <Link to={`/admin/sellers/${d.sellerId}`}>{d.vendor ?? d.sellerId}</Link></> : 'This report has no seller on this portal; the marketplace acts on the content.'}</p>
        <Can permission="ModerationAct">
          <div className="adm-actionrow">
            <Decide id={id} action="dismiss" disabled={!open} onDone={done} onLost={() => { setLost(true); reload() }} />
            {canHide && <Decide id={id} action="hide-content" disabled={!open} onDone={done} onLost={() => { setLost(true); reload() }} />}
            <Decide id={id} action="remove-content" disabled={!open} onDone={done} onLost={() => { setLost(true); reload() }} />
            {hasSeller && <Decide id={id} action="warn-seller" disabled={!open} onDone={done} onLost={() => { setLost(true); reload() }} />}
            {hasSeller && <Decide id={id} action="escalate-suspend" disabled={!open} onDone={done} onLost={() => { setLost(true); reload() }} />}
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
      {d.kind === 'review_reply' && d.target?.replyId && (
        <>
          <Panel title="The reply under report" actions={d.target.removed ? <Badge value="Removed" tone="muted" /> : undefined}>
            {!can('ModerationAct') && <p className="adm-muted">The text is masked for your role.</p>}
            <p className="adm-note">{d.target.replyText}</p>
            <KV items={[['Replied', fmtDate(d.target.repliedAt)], ['Edited', d.target.editedAt ? fmtDate(d.target.editedAt) : 'No'], ['Removal reason', d.target.removedReason ?? '—']]} />
          </Panel>
          {d.target.review && (
            <Panel title="The review it answers" actions={<Badge value={d.target.review.state} tone="muted" />}>
              <KV items={[['Rating', `${d.target.review.rating} out of 5`], ['Buyer', d.target.review.buyerDisplayName ?? '—'], ['Product', d.target.review.productTitle ?? '—'], ['Written', fmtDate(d.target.review.createdAt)], ['Review text', d.target.review.text ?? '—']]} />
            </Panel>
          )}
        </>
      )}
      {(d.kind === 'review' || (d.kind === 'review_reply' && !d.target?.replyId)) && (
        <Panel title={d.kind === 'review_reply' ? 'The review reply under report' : 'The review under report'}>
          <p className="adm-muted">Reviews live on the marketplace: your decision is sent there and the marketplace hides or removes the content.</p>
          <KV items={[['Review id', d.target?.reviewId ? <code key="r">{d.target.reviewId}</code> : '—'], ['What was reported', d.summary || d.reason], ...extraTarget.map(([k, v]) => [k, String(v)] as [string, ReactNode])]} />
        </Panel>
      )}
      {!d.target?.messages && !d.kind.startsWith('review') && d.kind !== 'listing' && <Panel title="What was reported"><p>{d.summary || d.reason}</p></Panel>}
      {(d.contentReports ?? []).length > 0 && <ContentReports items={d.contentReports!} />}
      {d.kind === 'listing' && <ListingView id={d.targetId} onChange={reload} />}
    </>
  )
}
