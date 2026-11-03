import { useEffect, useState } from 'react'
import { servicesApi } from './api'
import type { BookingStatus, ProviderList } from './types'

/** The caller's provider list (Owner/Admin: the whole team, everybody else: themselves) and the account time zone. */
export function useProviders() {
  const [data, setData] = useState<ProviderList | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { let alive = true; servicesApi.providers().then((d) => alive && setData(d)).catch(() => alive && setFailed(true)); return () => { alive = false } }, [])
  return { data, failed, tz: data?.accountTimeZone ?? 'UTC' }
}

const LABEL: Record<BookingStatus, string> = {
  Hold: 'On hold', Requested: 'Awaiting approval', Confirmed: 'Confirmed', Rescheduled: 'Rescheduled', InProgress: 'In progress', Completed: 'Completed',
  Declined: 'Declined', Expired: 'Expired', CancelledByBuyer: 'Cancelled by buyer', CancelledBySeller: 'Cancelled by you', NoShow: 'No-show',
}
export const statusLabel = (s: BookingStatus) => LABEL[s] ?? s
export function BookingStatusChip({ status }: { status: BookingStatus }) { return <span className={`chip bks-${status}`}>{statusLabel(status)}</span> }
export const LOCATION_LABEL = { online: 'Online', customer: "At the customer's location", seller: 'At your location' } as const
