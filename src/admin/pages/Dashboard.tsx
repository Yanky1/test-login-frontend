import { Link } from 'react-router-dom'
import { adminApi } from '../api'
import { ErrorNote, Loading, PageHeader, Panel, StatTile, useLoad } from '../components'
import { useAdmin } from '../AdminAuth'

interface Dash {
  generatedAt: string
  applications: { waiting: number; pendingReview: number; needsInfo: number; oldestPendingDays: number | null; averagePendingDays: number | null }
  sellers: { newLast7Days: number; newLast30Days: number; approved: number; suspended: number }
  listings: { active: number; activeServices: number; hiddenByStaff: number }
  today: { orders: number; bookings: number }
  openReports: number
  integrations: { deadLetters: number; retrying: number; pending: number; inboundRejectedLast24h: number }
  phone: { smsSentLast24h: number; smsBlockedLast24h: number; smsFailedLast24h: number; phoneSignInsLast24h: number }
  trend: { date: string; newSellers: number; orders: number; bookings: number }[]
}

const SERIES = [
  { key: 'orders', label: 'Orders', cls: 's1' },
  { key: 'bookings', label: 'Bookings', cls: 's2' },
  { key: 'newSellers', label: 'New sellers', cls: 's3' },
] as const

/** Grouped bars as inline SVG. The same numbers are in the table below (screen readers and keyboard users read that). */
function TrendChart({ data }: { data: Dash['trend'] }) {
  const max = Math.max(1, ...data.flatMap((d) => SERIES.map((s) => d[s.key])))
  const W = 560, H = 160, gap = W / data.length, bw = Math.max(3, gap / 4)
  const desc = `Orders, bookings and new sellers per day for the last ${data.length} days. Peak value ${max}.`
  return (
    <figure className="adm-chart">
      <svg viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label={desc}>
        <line x1="0" y1={H} x2={W} y2={H} className="axis" />
        {data.map((d, i) => (
          <g key={d.date} transform={`translate(${i * gap + gap / 2 - (bw * 3) / 2}, 0)`}>
            {SERIES.map((s, j) => { const h = (d[s.key] / max) * (H - 8); return <rect key={s.key} className={s.cls} x={j * bw} y={H - h} width={bw - 1} height={h}><title>{`${d.date}: ${s.label} ${d[s.key]}`}</title></rect> })}
            {i % 2 === 0 && <text x={bw * 1.5} y={H + 16} textAnchor="middle" className="tick">{d.date.slice(5)}</text>}
          </g>
        ))}
      </svg>
      <figcaption>
        <ul className="adm-legend">{SERIES.map((s) => <li key={s.key}><span className={`sw ${s.cls}`} aria-hidden="true" /> {s.label}</li>)}</ul>
      </figcaption>
      <details className="adm-chartdata"><summary>Show the numbers as a table</summary>
        <table className="adm-table"><caption className="sr-only">Daily numbers</caption>
          <thead><tr><th scope="col">Day</th>{SERIES.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
          <tbody>{data.map((d) => <tr key={d.date}><th scope="row">{d.date}</th>{SERIES.map((s) => <td key={s.key}>{d[s.key]}</td>)}</tr>)}</tbody>
        </table>
      </details>
    </figure>
  )
}

export default function Dashboard() {
  const { can } = useAdmin()
  const { data: d, error, loading, reload } = useLoad(() => adminApi<Dash>('/dashboard'), [])
  return (
    <>
      <PageHeader title="Dashboard" lead={d ? `Updated ${new Date(d.generatedAt).toLocaleTimeString()}` : undefined} actions={<button className="btn" onClick={reload}>Refresh</button>} />
      <ErrorNote error={error} retry={reload} />
      {loading && !d && <Loading />}
      {d && (
        <>
          <Panel title="Needs attention">
            <div className="adm-tiles">
              <Link className="adm-tilelink" to="/admin/applications"><StatTile label="Applications waiting for review" value={d.applications.waiting} tone={d.applications.waiting > 0 ? 'warn' : undefined}
                hint={d.applications.oldestPendingDays != null ? `Oldest ${d.applications.oldestPendingDays} day(s), average ${d.applications.averagePendingDays} day(s)` : 'None pending'} /></Link>
              <Link className="adm-tilelink" to="/admin/moderation"><StatTile label="Open reports" value={d.openReports} tone={d.openReports > 0 ? 'warn' : undefined} /></Link>
              {can('IntegrationsView') && <Link className="adm-tilelink" to="/admin/integrations"><StatTile label="Dead-lettered events" value={d.integrations.deadLetters} tone={d.integrations.deadLetters > 0 ? 'err' : undefined} hint={`${d.integrations.retrying} retrying · ${d.integrations.pending} pending`} /></Link>}
              <StatTile label="Rejected marketplace requests (24 h)" value={d.integrations.inboundRejectedLast24h} />
            </div>
          </Panel>
          <Panel title="Marketplace">
            <div className="adm-tiles">
              <StatTile label="Orders today" value={d.today.orders} />
              <StatTile label="Bookings today" value={d.today.bookings} />
              <StatTile label="Active listings" value={d.listings.active} hint={`${d.listings.activeServices} services · ${d.listings.hiddenByStaff} hidden by staff`} />
              <StatTile label="New sellers (7 / 30 days)" value={`${d.sellers.newLast7Days} / ${d.sellers.newLast30Days}`} hint={`${d.sellers.approved} approved · ${d.sellers.suspended} suspended`} />
            </div>
            <h3 className="adm-h3">Last 14 days</h3>
            <TrendChart data={d.trend} />
          </Panel>
          <Panel title="Phone and SMS (last 24 hours)">
            <div className="adm-tiles">
              <StatTile label="SMS sent" value={d.phone.smsSentLast24h} />
              <StatTile label="SMS blocked (opt-out / no consent)" value={d.phone.smsBlockedLast24h} />
              <StatTile label="SMS failed" value={d.phone.smsFailedLast24h} tone={d.phone.smsFailedLast24h > 0 ? 'err' : undefined} />
              <StatTile label="Phone sign-ins" value={d.phone.phoneSignInsLast24h} />
            </div>
          </Panel>
        </>
      )}
    </>
  )
}
