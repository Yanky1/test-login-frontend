import { DemoPill } from '../demo/DemoPill'
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button, Skeleton } from '../components/ui'
import { useBrands } from '../pages/teams/BrandContext'
import { servicesApi } from './api'
import { BookingStatusChip, LOCATION_LABEL, useProviders } from './shared'
import { fmtDateTime, money } from './time'
import type { BookingCounts, BookingList, QuoteList } from './types'
import './services.css'

const TABS = [
  { id: 'requests', label: 'Requests', count: (c: BookingCounts) => c.requests }, { id: 'upcoming', label: 'Upcoming', count: (c: BookingCounts) => c.upcoming },
  { id: 'today', label: 'Today', count: (c: BookingCounts) => c.today }, { id: 'past', label: 'Past' }, { id: 'cancelled', label: 'Cancelled' },
  { id: 'quotes', label: 'Quote requests', count: (c: BookingCounts) => c.quoteRequests },
] as const

export default function BookingsPage() {
  const [sp, setSp] = useSearchParams()
  const { tz } = useProviders()
  const { selected } = useBrands()
  const tab = sp.get('tab') ?? 'requests'; const page = Number(sp.get('page') ?? 1) || 1
  const brandId = selected === 'all' ? '' : selected
  const [counts, setCounts] = useState<BookingCounts | null>(null)
  const [list, setList] = useState<BookingList | null>(null); const [quotes, setQuotes] = useState<QuoteList | null>(null)
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(sp.get('q') ?? '')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      servicesApi.counts().then(setCounts).catch(() => undefined)
      if (tab === 'quotes') { setQuotes(await servicesApi.quotes({ page, pageSize: 20, brandId })); setList(null) }
      else { setList(await servicesApi.bookings({ tab, page, pageSize: 20, brandId, q: sp.get('q') ?? '' })); setQuotes(null) }
    } catch (e) { setError(e instanceof ApiError ? e.message2 : 'Could not load bookings.') } finally { setLoading(false) }
  }, [tab, page, brandId, sp])
  useEffect(() => { void load() }, [load])
  useEffect(() => { document.title = 'Bookings - Solvelt' }, [])
  const update = (o: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(o)) { if (v) n.set(k, v); else n.delete(k) }; setSp(n, { replace: true }) }
  const total = list?.total ?? quotes?.total ?? 0; const pages = Math.max(1, Math.ceil(total / 20))

  return (
    <main className="pwrap" aria-labelledby="page-title">
      <header className="cal-bar"><h1 id="page-title" tabIndex={-1} className="grow">Bookings</h1><Link className="btn" to="/calendar">Open calendar</Link></header>
      <div className="stabs" role="tablist" aria-label="Bookings">
        {TABS.map((t) => {
          const n = counts && 'count' in t ? t.count(counts) : null
          return <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => update({ tab: t.id, page: '' })}>{t.label}{n ? <span className="badge-n" aria-label={`${n} need${n === 1 ? 's' : ''} attention`}>{n}</span> : null}</button>
        })}
      </div>
      {tab !== 'quotes' && <form className="filters" role="search" onSubmit={(e) => { e.preventDefault(); update({ q, page: '' }) }}><div className="field search"><label htmlFor="bk-q" className="sr-only">Search bookings</label><input id="bk-q" type="search" placeholder="Search by number, service or customer" value={q} onChange={(e) => setQ(e.target.value)} /></div><Button type="submit">Search</Button></form>}
      <p className="tz-note">Times in {tz}. Open a booking for the provider's own time zone.</p>
      <Alert>{error}</Alert>
      {loading && !list && !quotes && <Skeleton lines={5} />}
      {list && (list.items.length === 0 ? <div className="pempty"><h2>{tab === 'requests' ? 'No requests waiting' : 'Nothing here yet'}</h2><p>{tab === 'requests' ? 'New booking requests that need your approval show up here.' : 'Bookings that match this tab show up here.'}</p></div> : (
        <div className="tablewrap">
          <table className="btable" aria-busy={loading || undefined}>
            <caption className="sr-only">Bookings: {TABS.find((t) => t.id === tab)?.label}</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Service</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Total</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {list.items.map((b) => (
                <tr key={b.id}>
                  <td>{fmtDateTime(b.startAt, tz)}{b.rescheduleRequested && <div className="meta warn-text">Wants a new time</div>}</td>
                  <td>{b.serviceTitle}{b.demo && <DemoPill />}<div className="meta">{b.number} · {LOCATION_LABEL[b.location]}</div></td>
                  <td>{b.buyerName ?? '-'}</td>
                  <td><BookingStatusChip status={b.status} />{b.approvalDeadline && b.status === 'Requested' && <div className="meta">Answer by {fmtDateTime(b.approvalDeadline, tz)}</div>}</td>
                  <td>{money(b.totalCents)}</td>
                  <td><Link className="btn link" to={`/bookings/${b.id}`}>Open<span className="sr-only"> {b.number}</span></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {quotes && (quotes.items.length === 0 ? <div className="pempty"><h2>No quote requests</h2><p>When a buyer asks for a quote on a "quote required" service it appears here.</p></div> : (
        <div className="tablewrap">
          <table className="btable"><caption className="sr-only">Quote requests</caption>
            <thead><tr><th scope="col">Received</th><th scope="col">Service</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{quotes.items.map((x) => (
              <tr key={x.id}><td>{fmtDateTime(x.createdAt, tz)}</td><td>{x.serviceTitle}{x.demo && <DemoPill />}<div className="meta">{x.location === 'customer' ? x.postalCode ?? '' : LOCATION_LABEL[x.location]}</div></td><td>{x.buyerName ?? '-'}</td>
                <td><span className={`chip ${x.status === 'Requested' ? 'bks-Requested' : x.status === 'Accepted' ? 'bks-Confirmed' : 'bks-Completed'}`}>{x.status === 'Requested' ? 'Needs a quote' : x.status === 'Quoted' ? 'Quote sent' : x.status}</span></td>
                <td><Link className="btn link" to={`/bookings/quotes/${x.id}`}>{x.status === 'Requested' ? 'Send a quote' : 'Open'}<span className="sr-only"> for {x.serviceTitle}</span></Link></td></tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {total > 20 && <nav className="pager" aria-label="Pagination"><Button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Previous</Button><span>Page {page} of {pages}</span><Button disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>Next</Button></nav>}
    </main>
  )
}
