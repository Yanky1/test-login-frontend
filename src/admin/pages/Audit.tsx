import { useState } from 'react'
import { Alert, Button, Field } from '../../components/ui'
import { AdminError, adminApi, adminBlob, fmtDate, qs, type Page } from '../api'
import { Can, ErrorNote, Loading, PageHeader, Pager, Panel, Table, download, useLoad } from '../components'
import { useAdmin } from '../AdminAuth'

interface Row { id: number; type: string; at: string; actorId: string | null; actorRole: string | null; subject: string | null; targetType: string | null; targetId: string | null; reason: string | null; ipAddress: string | null; detail: string | null }

export default function Audit() {
  const { run } = useAdmin()
  const [f, setF] = useState({ actor: '', target: '', action: '', from: '', to: '', staffOnly: false })
  const [applied, setApplied] = useState(f)
  const [page, setPage] = useState(1)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const params = (x: typeof f) => ({ actor: x.actor.trim(), target: x.target.trim(), action: x.action.trim(), from: x.from ? new Date(x.from).toISOString() : '', to: x.to ? new Date(x.to).toISOString() : '', staffOnly: x.staffOnly })
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Row>>('/audit' + qs({ ...params(applied), page })), [applied, page])
  const exportCsv = async () => {
    setBusy(true); setErr(null)
    try { const { blob } = await run(() => adminBlob('/audit/export' + qs(params(applied)))); download(blob, 'solvelt-audit.csv') }
    catch (e) { setErr(e instanceof AdminError ? e.text : 'The export failed.') } finally { setBusy(false) }
  }
  return (
    <>
      <PageHeader title="Audit log" lead="Every sign-in, security event and staff action. Staff actions record who (and their role), what, the target, the reason, and before/after where useful."
        actions={<Can permission="AuditExport"><Button loading={busy} onClick={exportCsv}>Export CSV</Button></Can>} />
      <Panel>
        <form className="adm-filters" role="search" aria-label="Filter the audit log" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f) }}>
          <Field label="Actor (user id or email part)" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
          <Field label="Target id" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
          <Field label="Action" hint="e.g. user.signed_out or pii.revealed" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
          <Field label="From" type="datetime-local" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <Field label="To" type="datetime-local" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          <div className="field adm-check"><label><input type="checkbox" checked={f.staffOnly} onChange={(e) => setF({ ...f, staffOnly: e.target.checked })} /> Staff actions only</label></div>
          <Button type="submit" variant="primary">Apply filters</Button>
        </form>
        <Alert>{err}</Alert>
        <ErrorNote error={error} retry={reload} />
        {loading && !data ? <Loading /> : data && (
          <>
            <Table caption="Audit events" head={['When', 'Event', 'Actor', 'Target', 'Reason', 'IP']} empty="No events match these filters.">
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.at)}</td><th scope="row">{r.type}</th>
                  <td>{r.actorRole ? `${r.actorRole} ` : ''}<span className="adm-mono">{r.actorId?.slice(0, 8) ?? r.subject ?? '—'}</span></td>
                  <td>{r.targetType ? `${r.targetType} ` : ''}<span className="adm-mono">{r.targetId?.slice(0, 8) ?? ''}</span></td>
                  <td className="adm-clip">{r.reason ?? ''}</td><td>{r.ipAddress ?? ''}</td>
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
