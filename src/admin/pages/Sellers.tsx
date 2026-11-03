import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert } from '../../components/ui'
import { adminApi, fmtDate, qs, type Page } from '../api'
import { Badge, Can, ErrorNote, KV, Loading, PageHeader, Pager, Panel, ReasonDialog, ReasonAction, Table, useLoad } from '../components'
import { Button, Field } from '../../components/ui'

interface Row { id: string; vendorName: string | null; status: string; country: string | null; createdAt: string; ownerEmail: string | null }
interface Detail {
  id: string; vendorName: string | null; status: string; statusNote: string | null; country: string | null; createdAt: string; submittedAt: string | null; ownerEmail: string | null; ownerEmailVerified: boolean
  members: { userId: string; email: string; role: string; status: string; lastActiveAt: string | null }[]
  brands: { id: string; name: string; status: string }[]
  counts: { listings: number; activeListings: number; orders: number; bookings: number }
  statusHistory: { type: string; at: string; detail: string | null; reason: string | null; actorRole: string | null }[]
  recentActivity: { lastOrderAt: string | null; lastBookingAt: string | null; lastListingUpdateAt: string | null; lastMemberActivityAt: string | null }
  notes: { id: string; text: string; at: string }[] | null
}
const STATUSES = ['', 'PendingReview', 'NeedsInfo', 'Approved', 'Rejected', 'Suspended', 'Closed', 'Draft']

export default function Sellers() {
  const { id } = useParams()
  return id ? <SellerDetail id={id} /> : <SellerList />
}

function SellerList() {
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Row>>('/sellers' + qs({ q, status, page })), [q, status, page])
  return (
    <>
      <PageHeader title="Seller accounts" lead="Search by business name, owner or member email, or account id." />
      <Panel>
        <form className="adm-filters" role="search" aria-label="Find sellers" onSubmit={(e) => e.preventDefault()}>
          <Field label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
          <div className="field"><label htmlFor="s-status">Status</label>
            <select id="s-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>{STATUSES.map((s) => <option key={s} value={s}>{s || 'Any status'}</option>)}</select></div>
        </form>
        <ErrorNote error={error} retry={reload} />
        {loading && !data ? <Loading /> : data && (
          <>
            <Table caption="Seller accounts" head={['Business', 'Owner', 'Status', 'Country', 'Created']} empty="No sellers match.">
              {data.items.map((r) => <tr key={r.id}><th scope="row"><Link to={`/admin/sellers/${r.id}`}>{r.vendorName ?? '(no name)'}</Link></th><td>{r.ownerEmail}</td><td><Badge value={r.status} /></td><td>{r.country ?? '—'}</td><td>{fmtDate(r.createdAt)}</td></tr>)}
            </Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  )
}

function TransferAction({ d, onDone }: { d: Detail; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const candidates = d.members.filter((m) => m.status === 'Active' && m.role !== 'Owner')
  return (
    <>
      <Button disabled={candidates.length === 0} onClick={() => setOpen(true)}>Transfer ownership</Button>
      {open && (
        <ReasonDialog title="Emergency ownership transfer" confirm="Transfer ownership" danger
          lead="The chosen member becomes the Owner and every current Owner becomes an Admin. Both are emailed. Use only when the Owner cannot be reached."
          extra={<div className="field"><label htmlFor="new-owner">New Owner</label>
            <select id="new-owner" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a member…</option>{candidates.map((m) => <option key={m.userId} value={m.userId}>{m.email} ({m.role})</option>)}</select></div>}
          onSubmit={async (reason) => { if (!to) throw new Error('Choose the new Owner.'); await adminApi(`/sellers/${d.id}/transfer-ownership`, { body: { newOwnerUserId: to, reason } }); onDone() }}
          onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function SellerDetail({ id }: { id: string }) {
  const { data: d, error, loading, reload } = useLoad(() => adminApi<Detail>(`/sellers/${id}`), [id])
  const [msg, setMsg] = useState<string | null>(null)
  if (loading && !d) return <Loading />
  if (error || !d) return <><PageHeader title="Seller account" /><ErrorNote error={error ?? 'Not found'} retry={reload} /><Link to="/admin/sellers">Back to sellers</Link></>
  const post = (path: string) => (reason: string) => adminApi(`/sellers/${id}/${path}`, { body: { reason } })
  const done = (m: string) => () => { setMsg(m); reload() }
  return (
    <>
      <PageHeader title={d.vendorName ?? 'Seller account'} lead={d.ownerEmail ? `${d.ownerEmail}${d.ownerEmailVerified ? '' : ' (email not verified)'}` : undefined} actions={<Link className="btn" to="/admin/sellers">Back to sellers</Link>} />
      <Alert kind="success">{msg ?? ''}</Alert>
      <Panel title="Account" actions={<Badge value={d.status} />}>
        <KV items={[['Created', fmtDate(d.createdAt)], ['Submitted', fmtDate(d.submittedAt)], ['Country', d.country], ['Status note (shown to the seller)', d.statusNote || '—'],
          ['Listings', `${d.counts.listings} (${d.counts.activeListings} active)`], ['Orders', d.counts.orders], ['Bookings', d.counts.bookings]]} />
        <div className="adm-actionrow">
          <Can permission="SellersSuspend">
            <ReasonAction label="Suspend" variant="destructive" disabled={d.status !== 'Approved'} onDone={done('Account suspended.')} dialog={{ title: 'Suspend this account', lead: 'Members lose access at once. The reason is internal and stays in the audit log.', confirm: 'Suspend', danger: true, onSubmit: post('suspend') }} />
            <ReasonAction label="Reactivate" disabled={d.status !== 'Suspended'} onDone={done('Account reactivated.')} dialog={{ title: 'Reactivate this account', confirm: 'Reactivate', onSubmit: post('reactivate') }} />
          </Can>
          <Can permission="SellersClose">
            <ReasonAction label="Close account" variant="destructive" disabled={d.status === 'Closed'} onDone={done('Account closed.')} dialog={{ title: 'Close this account', lead: 'Nobody can sign in to it any more and the owners are emailed. Closing cannot be undone here. You will be asked for your authenticator code.', confirm: 'Close account', danger: true, onSubmit: post('close') }} />
          </Can>
          <Can permission="SellersResendVerification">
            <ReasonAction label="Resend owner verification" disabled={d.ownerEmailVerified} onDone={done('A new verification code was sent.')} dialog={{ title: 'Resend the verification code', confirm: 'Send code', onSubmit: post('resend-verification') }} />
          </Can>
          <Can permission="SellersTransferOwnership"><TransferAction d={d} onDone={done('Ownership transferred.')} /></Can>
        </div>
      </Panel>
      <Panel title="Members and roles">
        <Table caption="Members" head={['Email', 'Role', 'Status', 'Last active']} empty="No members.">
          {d.members.map((m) => <tr key={m.userId}><th scope="row"><Link to={`/admin/users/${m.userId}`}>{m.email}</Link></th><td>{m.role}</td><td>{m.status}</td><td>{fmtDate(m.lastActiveAt)}</td></tr>)}
        </Table>
      </Panel>
      <div className="adm-cols">
        <Panel title="Brands"><ul className="adm-list">{d.brands.map((b) => <li key={b.id}>{b.name} <Badge value={b.status} /></li>)}</ul></Panel>
        <Panel title="Recent activity"><KV items={[['Last order', fmtDate(d.recentActivity.lastOrderAt)], ['Last booking', fmtDate(d.recentActivity.lastBookingAt)], ['Last listing change', fmtDate(d.recentActivity.lastListingUpdateAt)], ['Last member activity', fmtDate(d.recentActivity.lastMemberActivityAt)]]} /></Panel>
      </div>
      <Panel title="Status history">
        {d.statusHistory.length === 0 ? <p className="adm-muted">No changes recorded.</p> : (
          <ol className="adm-timeline">{d.statusHistory.map((h, i) => <li key={i}><time dateTime={h.at}>{fmtDate(h.at)}</time> <strong>{h.type.replace(/^admin\./, '').replaceAll('_', ' ')}</strong>{h.detail && !h.reason ? ` — ${h.detail.split(';')[0]}` : ''}{h.actorRole ? ` (${h.actorRole})` : ''}{h.reason ? ` — ${h.reason}` : ''}</li>)}</ol>
        )}
      </Panel>
      {(d.notes ?? []).length > 0 && <Panel title="Internal notes">{d.notes!.map((n) => <p key={n.id} className="adm-note"><time dateTime={n.at}>{fmtDate(n.at)}</time> {n.text}</p>)}</Panel>}
    </>
  )
}
