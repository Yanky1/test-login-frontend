import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { servicesApi } from './api'
import { BookingStatusChip, LOCATION_LABEL, useProviders } from './shared'
import { fmtTime } from './time'
import type { BookingCounts, BookingListItem } from './types'
import './services.css'

/** Dashboard card: today's schedule and the number of requests that wait for an answer. Hidden while the account has no bookings to show. */
export default function TodayCard() {
  const [counts, setCounts] = useState<BookingCounts | null>(null); const [today, setToday] = useState<BookingListItem[]>([])
  const { tz } = useProviders()
  useEffect(() => {
    let alive = true
    servicesApi.counts().then((c) => { if (!alive) return; setCounts(c); if (c.today > 0) servicesApi.bookings({ tab: 'today', pageSize: 5 }).then((l) => alive && setToday(l.items)).catch(() => undefined) }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  if (!counts || counts.today + counts.requests + counts.quoteRequests + counts.upcoming === 0) return null
  return (
    <section className="pcard today-card" aria-labelledby="today-h" data-testid="today-card">
      <h2 id="today-h">Today's schedule</h2>
      {today.length === 0 ? <p>Nothing scheduled for today.</p> : (
        <ul>{today.map((b) => <li key={b.id}><Link to={`/bookings/${b.id}`}>{fmtTime(b.startAt, tz)} · {b.serviceTitle}</Link> <BookingStatusChip status={b.status} /> <span className="meta">{LOCATION_LABEL[b.location]}</span></li>)}</ul>
      )}
      {counts.requests + counts.quoteRequests > 0 && <p role="status"><Link to={counts.requests > 0 ? '/bookings?tab=requests' : '/bookings?tab=quotes'}><strong>{counts.requests + counts.quoteRequests} request{counts.requests + counts.quoteRequests === 1 ? '' : 's'}</strong> waiting for your answer</Link></p>}
    </section>
  )
}
