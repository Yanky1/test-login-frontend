import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Field } from '../../components/ui'
import { AdminError, adminApi, fmtDate, fmtMoney } from '../api'
import { Badge, Can, ErrorNote, KV, Loading, PageHeader, Panel, ReasonAction, Table, Tabs, useLoad } from '../components'

const KINDS = [['orders', 'Orders'], ['bookings', 'Bookings'], ['quotes', 'Quotes'], ['conversations', 'Conversations']] as const
type Kind = (typeof KINDS)[number][0]
const HINT: Record<Kind, string> = { orders: 'Order number (SO-…), id, marketplace id or buyer email', bookings: 'Booking number (BK-…), id, marketplace id or buyer email', quotes: 'Quote id, marketplace id or buyer email', conversations: 'Conversation id, marketplace thread id, order number or buyer email' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>

export default function Lookups() {
  const { kind, id } = useParams()
  const nav = useNavigate()
  const k = (KINDS.find(([x]) => x === kind)?.[0] ?? 'orders') as Kind
  const [q, setQ] = useState(''); const [rows, setRows] = useState<Rec[] | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const search = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { setRows((await adminApi<{ items: Rec[] }>(`/lookups/${k}?q=${encodeURIComponent(q.trim())}`)).items) }
    catch (e) {
      setErr(e instanceof AdminError
        ? (e.status === 429 ? 'Too many searches. Wait a moment and try again.' : e.status === 400 ? 'Enter at least 3 characters (a number, id or email).' : e.text)
        : 'The search could not be completed. Check your connection and try again.')
    }
    finally { setBusy(false) }
  }
  return (
    <>
      <PageHeader title="Support lookups" lead="Read-only. Personal data is masked; revealing it needs a reason and is recorded in the audit log." />
      <Tabs label="What to look up" tabs={KINDS} current={k} onSelect={(x) => { setRows(null); nav(`/admin/lookups/${x}`) }}>
      <Panel>
        <form className="adm-filters" role="search" aria-label={`Find ${k}`} onSubmit={search}>
          <Field label={`Find ${k}`} hint={HINT[k]} value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="primary" loading={busy} disabled={q.trim().length < 3}>Search</Button>
        </form>
        <Alert>{err}</Alert>
        {rows && <Table caption={`${k} results`} head={['Reference', 'Seller', 'Status', 'Buyer', 'Date']} empty="Nothing found.">
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row"><Link to={`/admin/lookups/${k}/${r.id}`}>{r.number ?? r.serviceTitle ?? r.subject ?? String(r.id).slice(0, 8)}</Link></th>
              <td><Link to={`/admin/sellers/${r.sellerId}`}>Seller</Link></td><td>{r.status ? <Badge value={r.status} tone="muted" /> : r.flagged ? 'Flagged' : '—'}</td>
              <td>{r.buyerName ?? '—'}{r.buyerEmail ? ` · ${r.buyerEmail}` : ''}</td><td>{fmtDate(r.placedAt ?? r.startUtc ?? r.createdAt ?? r.lastMessageAt)}</td>
            </tr>
          ))}
        </Table>}
      </Panel>
      </Tabs>
      {id && <Detail kind={k} id={id} />}
    </>
  )
}

function Detail({ kind, id }: { kind: Kind; id: string }) {
  const { data, error, loading, reload, setData } = useLoad(() => adminApi<Rec>(`/lookups/${kind}/${id}`), [kind, id])
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorNote error={error ?? 'Not found'} retry={reload} />
  const revealed = !!data.revealed
  const reveal = async (reason: string) => setData(await adminApi<Rec>(`/lookups/${kind}/${id}/reveal`, { body: { reason } }))
  const buyer = data.buyer as Rec | undefined
  return (
    <Panel title={`${data.number ?? data.serviceTitle ?? data.subject ?? kind.slice(0, -1)} (${revealed ? 'personal data revealed' : 'masked'})`} actions={
      <Can permission="LookupsReveal">
        {!revealed && <ReasonAction label="Reveal personal data" variant="destructive" dialog={{ title: 'Reveal personal data', lead: 'Break-glass: use only for a real support case. This is recorded in the audit log with your reason (put the ticket reference in it).', reasonLabel: 'Reason, with the ticket reference', confirm: 'Reveal', danger: true, onSubmit: reveal }} />}
      </Can>
    }>
      {revealed && <Alert kind="info">Personal data is shown. This view was recorded in the audit log.</Alert>}
      <KV items={[
        ['Status', data.status], ['Seller', <Link key="s" to={`/admin/sellers/${data.sellerId}`}>Open seller</Link>],
        ...(data.totalCents != null ? ([['Total', fmtMoney(data.totalCents, data.currency)], ['Fee', fmtMoney(data.feeCents, data.currency)], ['Refunded', fmtMoney(data.refundedCents, data.currency)], ['Lines', data.lines]] as [string, React.ReactNode][]) : []),
        ...(data.startUtc ? ([['Starts', fmtDate(data.startUtc)], ['Price', fmtMoney(data.priceCents)]] as [string, React.ReactNode][]) : []),
        ...(buyer ? ([['Buyer name', buyer.name], ['Buyer email', buyer.email], ['Buyer phone', buyer.phone], ['Postal code', buyer.postalCode]] as [string, React.ReactNode][]) : []),
        ...(data.buyerName !== undefined ? ([['Buyer', data.buyerName]] as [string, React.ReactNode][]) : []),
        ...(data.shipTo ? ([['Ship to', [data.shipTo.name, data.shipTo.line1, data.shipTo.line2, data.shipTo.city, data.shipTo.region, data.shipTo.postalCode, data.shipTo.country].filter(Boolean).join(', ')]] as [string, React.ReactNode][]) : []),
        ...(data.details ? ([['Details', data.details]] as [string, React.ReactNode][]) : []),
      ]} />
      {Array.isArray(data.messages) && (
        <ol className="adm-thread" aria-label="Messages">{(data.messages as Rec[]).map((m) => <li key={m.id} className={String(m.direction).toLowerCase()}><div className="adm-who2">{m.direction} · <time dateTime={m.createdAt}>{fmtDate(m.createdAt)}</time></div><p>{m.text}</p></li>)}</ol>
      )}
    </Panel>
  )
}
