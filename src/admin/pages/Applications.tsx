import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Field } from '../../components/ui'
import { adminApi, adminBlob, fmtDate, qs, type Page } from '../api'
import { Badge, Can, ErrorNote, KV, Loading, PageHeader, Pager, Panel, ReasonAction, Table, useLoad } from '../components'
import { useAdmin } from '../AdminAuth'

interface Row { id: string; vendorName: string | null; status: string; country: string | null; submittedAt: string | null; ownerEmail: string | null; assignedTo: string | null; ageDays: number | null }
interface Detail {
  id: string; status: string; statusNote: string | null; submittedAt: string | null; ageDays: number | null
  owner: { email: string; emailVerified: boolean }
  business: Record<string, string | boolean | null>
  kosher: { key: string; label: string; type: string; answer: string | null }[]
  files: { id: string; fieldKey: string; originalName: string; contentType: string; size: number; createdAt: string }[]
  legal: { termsVersion: string | null; termsAcceptedAt: string | null; sellerAgreementVersion: string | null; sellerAgreementAcceptedAt: string | null }
  assignment: { assignedTo: string | null; assignedAt: string } | null
  detail: { statusHistory: { type: string; at: string; detail: string | null; reason: string | null; actorRole: string | null }[]; notes: { id: string; text: string; at: string }[] | null }
}
const STATUSES = ['', 'PendingReview', 'NeedsInfo', 'Approved', 'Rejected', 'Suspended']

export default function Applications() {
  const { id } = useParams()
  return id ? <ApplicationDetail id={id} /> : <ApplicationList />
}

function ApplicationList() {
  const [status, setStatus] = useState(''); const [country, setCountry] = useState(''); const [minAge, setMinAge] = useState(''); const [assigned, setAssigned] = useState('')
  const [q, setQ] = useState(''); const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Row>>('/applications' + qs({ status, country, minAgeDays: minAge, assigned, q, page })), [status, country, minAge, assigned, q, page])
  return (
    <>
      <PageHeader title="Seller applications" lead="Review queue: applications waiting for a decision come first (oldest on top)." />
      <Panel>
        <form className="adm-filters" role="search" aria-label="Filter applications" onSubmit={(e) => e.preventDefault()}>
          <div className="field"><label htmlFor="f-status">Status</label>
            <select id="f-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>{STATUSES.map((s) => <option key={s} value={s}>{s === '' ? 'Waiting for review' : s}</option>)}</select></div>
          <Field label="Country" value={country} onChange={(e) => { setCountry(e.target.value); setPage(1) }} placeholder="US" />
          <Field label="At least this many days old" type="number" min={0} value={minAge} onChange={(e) => { setMinAge(e.target.value); setPage(1) }} />
          <div className="field"><label htmlFor="f-asg">Assigned</label>
            <select id="f-asg" value={assigned} onChange={(e) => { setAssigned(e.target.value); setPage(1) }}><option value="">Anyone</option><option value="me">To me</option><option value="none">Unassigned</option></select></div>
          <Field label="Search business or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        </form>
        <ErrorNote error={error} retry={reload} />
        {loading && !data ? <Loading /> : data && (
          <>
            <Table caption="Seller applications" head={['Business', 'Owner', 'Status', 'Country', 'Submitted', 'Age', 'Assigned']} empty="No applications match.">
              {data.items.map((r) => (
                <tr key={r.id}>
                  <th scope="row"><Link to={`/admin/applications/${r.id}`}>{r.vendorName ?? '(no name)'}</Link></th>
                  <td>{r.ownerEmail}</td><td><Badge value={r.status} /></td><td>{r.country ?? '—'}</td><td>{fmtDate(r.submittedAt)}</td>
                  <td>{r.ageDays != null ? `${r.ageDays} d` : '—'}</td><td>{r.assignedTo ? 'Assigned' : 'Unassigned'}</td>
                </tr>
              ))}
            </Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  )
}

function CertificateViewer({ sellerId, file }: { sellerId: string; file: Detail['files'][number] }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const isImg = file.contentType.startsWith('image/')
  useEffect(() => {
    let alive = true; let u: string | null = null
    adminBlob(`/applications/${sellerId}/files/${file.id}`).then(({ blob }) => { if (alive) { u = URL.createObjectURL(blob); setUrl(u) } }).catch(() => alive && setErr('The file could not be loaded.'))
    return () => { alive = false; if (u) URL.revokeObjectURL(u) }
  }, [sellerId, file.id])
  return (
    <div className="adm-cert">
      <p><strong>{file.originalName}</strong> · {file.contentType} · {Math.max(1, Math.round(file.size / 1024))} KB</p>
      <Alert>{err}</Alert>
      {url && isImg && <img src={url} alt={`Uploaded certificate ${file.originalName}`} className="adm-certimg" />}
      {url && !isImg && <object data={url} type={file.contentType} className="adm-certpdf" aria-label={`Certificate ${file.originalName}`}><a href={url} target="_blank" rel="noopener noreferrer">Open the PDF in a new tab</a></object>}
      {url && <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Open in a new tab</a>}
    </div>
  )
}

function ApplicationDetail({ id }: { id: string }) {
  const nav = useNavigate()
  const { me, can } = useAdmin()
  const { data: d, error, loading, reload } = useLoad(() => adminApi<Detail>(`/applications/${id}`), [id])
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const decidable = d && (d.status === 'PendingReview' || d.status === 'NeedsInfo')
  if (loading && !d) return <Loading />
  if (error || !d) return <><PageHeader title="Application" /><ErrorNote error={error ?? 'Not found'} retry={reload} /><Link to="/admin/applications">Back to the queue</Link></>
  const act = (path: string, body: unknown) => adminApi(`/applications/${id}/${path}`, { body })
  const b = d.business
  return (
    <>
      <PageHeader title={String(b.vendorName ?? 'Application')} lead={`${d.owner.email}${d.owner.emailVerified ? '' : ' (email not verified)'}`}
        actions={<Link className="btn" to="/admin/applications">Back to the queue</Link>} />
      <Alert kind="success">{msg ?? ''}</Alert>
      <Panel title="Decision" actions={<Badge value={d.status} />}>
        {d.statusNote && <p>Note shown to the seller: “{d.statusNote}”</p>}
        <p className="adm-muted">Submitted {fmtDate(d.submittedAt)}{d.ageDays != null ? ` · waiting ${d.ageDays} day(s)` : ''}</p>
        <div className="adm-actionrow">
          <Can permission="ApplicationsDecide">
            <ReasonAction label="Approve" variant="primary" disabled={!decidable} onDone={() => { setMsg('Application approved.'); reload() }}
              dialog={{ title: 'Approve this application', lead: 'The seller can start selling at once and is emailed.', confirm: 'Approve', reasonLabel: 'Reason (internal, kept in the audit log)', onSubmit: (reason) => act('approve', { reason }) }} />
            <ReasonAction label="Needs info" disabled={!decidable} onDone={() => { setMsg('The seller was asked for more information.'); reload() }}
              dialog={{ title: 'Ask the seller for more information', lead: 'This message is emailed to the seller and shown in their application.', confirm: 'Send request', reasonLabel: 'What is missing?', minLength: 5,
                onSubmit: (message) => act('needs-info', { message }) }} />
            <ReasonAction label="Reject" variant="destructive" disabled={!decidable} onDone={() => { setMsg('Application rejected.'); reload() }}
              dialog={{ title: 'Reject this application', lead: 'The seller is emailed and loses access. They can reapply only through you.', confirm: 'Reject', danger: true, reasonLabel: 'Reason (internal, kept in the audit log)', onSubmit: (reason) => act('reject', { reason }) }} />
          </Can>
          <Can permission="ApplicationsAssign">
            <ReasonAction label="Assign to me" disabled={!decidable} onDone={() => { setMsg('Assigned to you.'); reload() }}
              dialog={{ title: 'Assign this application to yourself', confirm: 'Assign', onSubmit: (reason) => act('assign', { assignTo: me?.userId, reason }) }} />
            {d.assignment?.assignedTo && <ReasonAction label="Unassign" onDone={reload} dialog={{ title: 'Remove the assignment', confirm: 'Unassign', onSubmit: (reason) => act('assign', { assignTo: null, reason }) }} />}
          </Can>
        </div>
        {d.assignment?.assignedTo && <p className="adm-muted">Assigned {d.assignment.assignedTo === me?.userId ? 'to you' : 'to a reviewer'} on {fmtDate(d.assignment.assignedAt)}.</p>}
      </Panel>
      <div className="adm-cols">
        <Panel title="Business details">
          <KV items={[['Business', String(b.vendorName ?? '')], ['Contact', String(b.contactName ?? '')], ['Phone', String(b.contactPhone ?? '')],
            ['Address', [b.addressLine1, b.addressLine2, b.city, b.region, b.postalCode, b.country].filter(Boolean).join(', ')], ['SMS opt-in', b.smsOptIn ? `Yes (${fmtDate(String(b.smsConsentAt ?? ''))})` : 'No']]} />
        </Panel>
        <Panel title="Terms and agreement">
          <KV items={[['Terms version', d.legal.termsVersion], ['Terms accepted', fmtDate(d.legal.termsAcceptedAt)], ['Seller Agreement version', d.legal.sellerAgreementVersion], ['Seller Agreement accepted', fmtDate(d.legal.sellerAgreementAcceptedAt)]]} />
        </Panel>
      </div>
      <Panel title="Kosher answers">
        {d.kosher.length === 0 ? <p className="adm-muted">No questions applied to this seller.</p> : <KV items={d.kosher.map((k) => [k.label, k.answer ?? 'Not answered'])} />}
        {d.files.length === 0 ? <p className="adm-muted">No certificate uploaded.</p> : d.files.map((f) => <CertificateViewer key={f.id} sellerId={id} file={f} />)}
      </Panel>
      <Panel title="Timeline">
        {d.detail.statusHistory.length === 0 ? <p className="adm-muted">No history yet.</p> : (
          <ol className="adm-timeline">{d.detail.statusHistory.map((h, i) => <li key={i}><time dateTime={h.at}>{fmtDate(h.at)}</time> <strong>{h.type.replace(/^admin\./, '').replaceAll('_', ' ')}</strong>{h.actorRole ? ` (${h.actorRole})` : ''}{h.reason ? ` — ${h.reason}` : ''}</li>)}</ol>
        )}
      </Panel>
      <Panel title="Internal notes">
        {(d.detail.notes ?? []).map((n) => <p key={n.id} className="adm-note"><time dateTime={n.at}>{fmtDate(n.at)}</time> {n.text}</p>)}
        {(d.detail.notes ?? []).length === 0 && <p className="adm-muted">No notes yet. Notes are never shown to the seller.</p>}
        {can('ApplicationsDecide') && (
          <form onSubmit={async (e) => { e.preventDefault(); if (note.trim().length < 3) return; await act('notes', { text: note.trim() }); setNote(''); reload() }}>
            <div className="field"><label htmlFor="note">Add a note</label><textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></div>
            <Button type="submit">Add note</Button>
          </form>
        )}
      </Panel>
      <Link to={`/admin/sellers/${id}`} onClick={(e) => { e.preventDefault(); nav(`/admin/sellers/${id}`) }}>Open the seller account</Link>
    </>
  )
}
