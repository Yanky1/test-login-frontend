import { useEffect, useState } from 'react'
import { Button } from '../../components/ui'
import { adminApi, fmtDate, fmtMoney } from '../api'
import { Badge, Can, ErrorNote, KV, Loading, Panel, ReasonAction, Table, useLoad } from '../components'

interface Zone { id: string; name: string; country: string | null; radiusKm: number | null; postcodes: string[] | string | null; feeCents: number; freeOverCents: number | null; minOrderCents: number | null; priority: number; active: boolean }
interface Win { id: string; start: string; end: string; capacity: number | null; days: string[] | string | null; active: boolean }
interface Setting { brandId: string | null; enabled: boolean; timeZone: string; sameDayCutoff: string | null; minLeadMinutes: number; maxDaysAhead: number; version: number; exists: boolean; zones: Zone[]; windows: Win[] }
interface Delivery { id: string; orderId: string; number: string; code: string | null; status: string; date: string | null; windowStartUtc: string | null; windowEndUtc: string | null; routeId: string | null; attempts: number; feeCents: number; deliveredAt: string | null }
interface Overview { settings: Setting[]; routes: { id: string; date: string; status: string; startedAt: string | null; completedAt: string | null }[]; deliveries: Delivery[] }
interface Proof { expiresInMinutes: number; proofs: { id: string; kind: string; url: string }[]; attempts: { number: number; outcome: string; reason: string | null; note: string | null; recipientName: string | null; placement: string | null; at: string }[] }

const list = (v: string[] | string | null) => (Array.isArray(v) ? v.join(', ') : v) || '—'

/** The proof of one delivery. It lives only in the parent's state: hiding it (or leaving the tab) discards the links, so nothing is kept in the page or the browser. */
function ProofView({ d, proof, onClose }: { d: Delivery; proof: Proof; onClose: () => void }) {
  return (
    <Panel title={`Proof of delivery for ${d.number} (revealed)`} actions={<Button onClick={onClose}>Hide proof</Button>}>
      <p className="adm-muted">This view was recorded in the audit log. The links stop working after {proof.expiresInMinutes} minutes and are forgotten when you hide the proof or leave this tab.</p>
      {proof.proofs.length === 0 ? <p>No proof was captured for this delivery.</p> : (
        <ul className="adm-proofs">{proof.proofs.map((p) => <li key={p.id}><figure><img src={p.url} alt={`${p.kind} proof for order ${d.number}`} referrerPolicy="no-referrer" width={320} /><figcaption>{p.kind}</figcaption></figure></li>)}</ul>
      )}
      <Table caption="Delivery attempts" head={['#', 'When', 'Outcome', 'Reason', 'Recipient', 'Placement', 'Note']} empty="No attempts recorded.">
        {proof.attempts.map((a) => <tr key={a.number}><th scope="row">{a.number}</th><td>{fmtDate(a.at)}</td><td>{a.outcome}</td><td>{a.reason ?? '—'}</td><td>{a.recipientName ?? '—'}</td><td>{a.placement ?? '—'}</td><td>{a.note ?? '—'}</td></tr>)}
      </Table>
    </Panel>
  )
}

/** The delivery read carries no currency; the seller's account currency is the one on its payments balances (USD when that cannot be read). */
function useAccountCurrency(id: string) {
  const [cur, setCur] = useState('USD')
  useEffect(() => {
    let alive = true
    adminApi<{ balances?: { currency: string }[] }>(`/payments/sellers/${id}`).then((r) => { if (alive && r.balances?.[0]?.currency) setCur(r.balances[0].currency) }, () => undefined)
    return () => { alive = false }
  }, [id])
  return cur
}

export function SellerDelivery({ id }: { id: string }) {
  const cur = useAccountCurrency(id)
  const { data: d, error, loading, reload } = useLoad(() => adminApi<Overview>(`/sellers/${id}/local-delivery`), [id])
  const [shown, setShown] = useState<{ delivery: Delivery; proof: Proof } | null>(null)
  useEffect(() => () => setShown(null), [])        // leaving the tab drops the revealed proof
  useEffect(() => { setShown(null) }, [id])
  if (loading && !d) return <Loading />
  if (error || !d) return <ErrorNote error={error ?? 'Not found'} retry={reload} />
  return (
    <>
      <Panel title="Delivery settings">
        {d.settings.length === 0 ? <p className="adm-muted">This seller has no local-delivery settings.</p> : d.settings.map((s, i) => (
          <div key={s.brandId ?? i} className="adm-balance">
            <h3>{s.brandId ? `Brand ${s.brandId.slice(0, 8)}…` : 'Account'} <Badge value={s.enabled ? 'On' : 'Off'} tone={s.enabled ? 'ok' : 'muted'} /></h3>
            <KV items={[['Time zone', s.timeZone], ['Same-day cut-off', s.sameDayCutoff], ['Minimum lead time', `${s.minLeadMinutes} minutes`], ['Booking horizon', `${s.maxDaysAhead} days`], ['Settings version', s.version]]} />
            <Table caption="Delivery zones" head={['Zone', 'Country', 'Radius', 'Postcodes', 'Fee', 'Free over', 'Minimum order', 'Active']} empty="No zones.">
              {s.zones.map((z) => <tr key={z.id}><th scope="row">{z.name}</th><td>{z.country ?? '—'}</td><td>{z.radiusKm != null ? `${z.radiusKm} km` : '—'}</td><td className="adm-clip">{list(z.postcodes)}</td><td>{fmtMoney(z.feeCents, cur)}</td><td>{fmtMoney(z.freeOverCents, cur)}</td><td>{fmtMoney(z.minOrderCents, cur)}</td><td>{z.active ? 'Yes' : 'No'}</td></tr>)}
            </Table>
            <Table caption="Delivery windows" head={['From', 'To', 'Capacity', 'Days', 'Active']} empty="No windows.">
              {s.windows.map((w) => <tr key={w.id}><th scope="row">{w.start}</th><td>{w.end}</td><td>{w.capacity ?? '—'}</td><td>{list(w.days)}</td><td>{w.active ? 'Yes' : 'No'}</td></tr>)}
            </Table>
          </div>
        ))}
      </Panel>
      <Panel title="Recent routes">
        <Table caption="Routes" head={['Date', 'Status', 'Started', 'Completed']} empty="No routes.">
          {d.routes.map((r) => <tr key={r.id}><th scope="row">{r.date}</th><td><Badge value={r.status} /></td><td>{fmtDate(r.startedAt)}</td><td>{fmtDate(r.completedAt)}</td></tr>)}
        </Table>
      </Panel>
      <Panel title="Recent deliveries">
        <p className="adm-muted">No names or addresses are shown here. Proof of delivery is break-glass: it needs a reason and is recorded in the audit log.</p>
        <Table caption="Deliveries" head={['Order', 'Code', 'Status', 'Date', 'Attempts', 'Fee', 'Delivered', 'Proof']} empty="No deliveries.">
          {d.deliveries.map((x) => (
            <tr key={x.id}><th scope="row">{x.number}</th><td>{x.code ?? '—'}</td><td><Badge value={x.status} tone={x.status === 'Delivered' ? 'ok' : /fail|return/i.test(x.status) ? 'err' : 'warn'} /></td><td>{x.date ?? '—'}</td><td>{x.attempts}</td><td>{fmtMoney(x.feeCents, cur)}</td><td>{fmtDate(x.deliveredAt)}</td>
              <td><Can permission="LookupsReveal"><ReasonAction label="Access proof" variant="destructive" dialog={{
                title: `Access the proof of delivery for ${x.number}`, confirm: 'Reveal proof', danger: true, reasonLabel: 'Reason, with the ticket reference',
                lead: 'Break-glass: shows the delivery photo, signature and recipient. Use only for a real support case. Your reason is recorded in the audit log before anything is shown.',
                onSubmit: async (reason) => { setShown({ delivery: x, proof: await adminApi<Proof>(`/local-delivery/deliveries/${x.id}/proof-access`, { body: { reason } }) }) },
              }} /></Can></td></tr>
          ))}
        </Table>
      </Panel>
      {shown && <ProofView d={shown.delivery} proof={shown.proof} onClose={() => setShown(null)} />}
    </>
  )
}
