import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert } from '../../components/ui'
import { adminApi, fmtDate, qs, type Page } from '../api'
import { Badge, Can, ErrorNote, KV, Loading, PageHeader, Pager, Panel, ReasonAction, Table, Tabs, useLoad } from '../components'

const TABS = [['outbox', 'Events'], ['inbound', 'Marketplace requests'], ['phone', 'Phone and SMS'], ['jobs', 'Background jobs']] as const

export default function Integrations() {
  const { tab = 'outbox' } = useParams()
  const nav = useNavigate()
  return (
    <>
      <PageHeader title="Integration health" lead="Events to the marketplace, requests from it, phone/SMS delivery and background jobs." />
      <Tabs label="Integration areas" tabs={TABS} current={tab} onSelect={(t) => nav(`/admin/integrations/${t}`)}>
        {tab === 'outbox' && <Outbox />}
        {tab === 'inbound' && <Inbound />}
        {tab === 'phone' && <PhoneTab />}
        {tab === 'jobs' && <Jobs />}
      </Tabs>
    </>
  )
}

interface Ev { id: string; eventType: string; sellerId: string | null; aggregateId: string; status: string; attempts: number; createdAt: string; nextAttemptAt: string; lastError: string | null; payload: string | null }
interface OutboxPage extends Page<Ev> { counts: { pending: number; retrying: number; dead: number; discarded: number } }

function Outbox() {
  const [status, setStatus] = useState('dead'); const [page, setPage] = useState(1); const [open, setOpen] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null)
  const { data, error, loading, reload } = useLoad(() => adminApi<OutboxPage>('/integrations/outbox' + qs({ status, page })), [status, page])
  return (
    <Panel title="Outgoing events">
      <Alert kind="success">{msg ?? ''}</Alert>
      {data && <ul className="adm-chips" aria-label="Counts by status">
        {([['pending', 'Pending'], ['retrying', 'Retrying'], ['dead', 'Dead-lettered'], ['discarded', 'Discarded']] as const).map(([k, l]) => <li key={k}><button className={`adm-chip ${status === k ? 'active' : ''}`} aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1) }}>{l} <strong>{data.counts[k]}</strong></button></li>)}
        <li><button className={`adm-chip ${status === '' ? 'active' : ''}`} aria-pressed={status === ''} onClick={() => { setStatus(''); setPage(1) }}>All</button></li>
      </ul>}
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Table caption="Outgoing events" head={['Event', 'Aggregate', 'Status', 'Attempts', 'Created', 'Last error', '']} empty="No events with this status.">
            {data.items.map((e) => (
              <tr key={e.id}>
                <th scope="row">{e.eventType}</th><td className="adm-clip">{e.aggregateId}</td><td><Badge value={e.status} /></td><td>{e.attempts}</td><td>{fmtDate(e.createdAt)}</td><td className="adm-clip">{e.lastError ?? ''}</td>
                <td><button className="btn" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>Details{' '}<span className="sr-only">for {e.eventType} {e.aggregateId}</span></button></td>
              </tr>
            ))}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          {open && <EventDetail id={open} onChange={(m) => { setMsg(m); reload() }} />}
        </>
      )}
    </Panel>
  )
}

function EventDetail({ id, onChange }: { id: string; onChange: (m: string) => void }) {
  const { data: e, error } = useLoad(() => adminApi<Ev>(`/integrations/outbox/${id}`), [id])
  if (error) return <ErrorNote error={error} />
  if (!e) return <Loading lines={2} />
  const post = (p: string) => (reason: string) => adminApi(`/integrations/outbox/${id}/${p}`, { body: { reason } })
  return (
    <section className="adm-detail" aria-label={`Event ${e.eventType}`}>
      <h3 className="adm-h3">{e.eventType}</h3>
      <KV items={[['Status', <Badge key="s" value={e.status} />], ['Attempts', e.attempts], ['Next attempt', fmtDate(e.nextAttemptAt)], ['Last error', e.lastError]]} />
      <p className="adm-muted">Payload preview (personal data is redacted):</p>
      <pre className="adm-pre" tabIndex={0}>{e.payload}</pre>
      {e.status === 'Dead' && (
        <div className="adm-actionrow">
          <Can permission="IntegrationsAct"><ReasonAction label="Retry delivery" variant="primary" onDone={() => onChange('The event is queued again.')} dialog={{ title: 'Retry this event', lead: 'It returns to Pending with zero attempts and is delivered by the next run.', confirm: 'Retry', onSubmit: post('retry') }} /></Can>
          <Can permission="IntegrationsDiscard"><ReasonAction label="Discard" variant="destructive" onDone={() => onChange('The event was discarded.')} dialog={{ title: 'Discard this event', lead: 'It will never be delivered. You will be asked for your authenticator code.', confirm: 'Discard', danger: true, onSubmit: post('discard') }} /></Can>
        </div>
      )}
    </section>
  )
}

function Counts({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data)
  return (
    <div className="adm-countbox"><h3 className="adm-h3">{title}</h3>
      {entries.length === 0 ? <p className="adm-muted">None.</p> : <KV items={entries.map(([k, v]) => [k.replaceAll('_', ' '), v])} />}</div>
  )
}

function Inbound() {
  const { data, error, loading, reload } = useLoad(() => adminApi<{ last24h: Record<string, number>; last7d: Record<string, number>; recent: { at: string; code: string; ipAddress: string | null }[] }>('/integrations/inbound'), [])
  return (
    <Panel title="Rejected marketplace requests">
      <p className="adm-muted">Requests that failed the signature, timestamp or replay check. A spike usually means clock drift or a rotated secret.</p>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="adm-cols"><Counts title="Last 24 hours" data={data.last24h} /><Counts title="Last 7 days" data={data.last7d} /></div>
          <Table caption="Recent rejections" head={['When', 'Cause', 'IP']} empty="No rejected requests.">{data.recent.map((r, i) => <tr key={i}><td>{fmtDate(r.at)}</td><td>{r.code.replaceAll('_', ' ')}</td><td>{r.ipAddress ?? '—'}</td></tr>)}</Table>
        </>
      )}
    </Panel>
  )
}

function PhoneTab() {
  const { data, error, loading, reload } = useLoad(() => adminApi<{ last24h: Record<string, number>; last7d: Record<string, number>; recentFailures: { type: string; at: string; detail: string | null }[] }>('/integrations/phone'), [])
  return (
    <Panel title="Phone and SMS delivery">
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="adm-cols"><Counts title="Last 24 hours" data={data.last24h} /><Counts title="Last 7 days" data={data.last7d} /></div>
          <Table caption="Recent failures and blocked messages" head={['When', 'Type', 'Detail']} empty="No failures.">{data.recentFailures.map((r, i) => <tr key={i}><td>{fmtDate(r.at)}</td><td>{r.type}</td><td className="adm-clip">{r.detail}</td></tr>)}</Table>
        </>
      )}
    </Panel>
  )
}

function Jobs() {
  const { data, error, loading, reload } = useLoad(() => adminApi<{ items: { name: string; lastStartedAt: string; lastFinishedAt: string | null; lastSucceeded: boolean; lastResult: string | null; runs: number; failures: number; minutesSinceLastRun: number | null }[] }>('/integrations/jobs'), [])
  return (
    <Panel title="Background jobs" actions={<button className="btn" onClick={reload}>Refresh</button>}>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <Table caption="Background jobs" head={['Job', 'Last run', 'Result', 'Runs', 'Failures', 'Output']} empty="No job has run yet (jobs record themselves when the workers run).">
          {data.items.map((j) => <tr key={j.name}><th scope="row">{j.name}</th><td>{fmtDate(j.lastFinishedAt)}{j.minutesSinceLastRun != null ? ` (${Math.round(j.minutesSinceLastRun)} min ago)` : ''}</td><td><Badge value={j.lastSucceeded ? 'OK' : 'Failed'} tone={j.lastSucceeded ? 'ok' : 'err'} /><span className="sr-only">{j.lastSucceeded ? ' succeeded' : ' failed'}</span></td><td>{j.runs}</td><td>{j.failures}</td><td className="adm-clip">{j.lastResult}</td></tr>)}
        </Table>
      )}
      <p><Link to="/admin/audit">Open the audit log</Link></p>
    </Panel>
  )
}
