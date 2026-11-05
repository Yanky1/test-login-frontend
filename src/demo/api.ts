import { api } from '../api'

export interface DemoCounts { products: number; services: number; orders: number; bookings: number; quotes: number; conversations: number; notifications: number }
export interface DemoStatus { exists: boolean; batchId: string | null; createdAt: string | null; counts: DemoCounts }

export const demoApi = {
  status: () => api<DemoStatus>('/seller/demo-data'),
  fill: () => api<{ batchId: string; counts: DemoCounts }>('/seller/demo-data', { method: 'POST', body: {} }),
  remove: () => api<{ removed: DemoCounts }>('/seller/demo-data', { method: 'DELETE' }),
  approve: () => api<{ status: string }>('/seller/demo/approve', { method: 'POST', body: {} }),
}

/** Demo data was added or removed: pages under the seller shell reload their data. */
const listeners = new Set<() => void>()
export const onDemoChanged = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const demoChanged = () => listeners.forEach((l) => l())

/** Statuses an account can be approved from (the server decides; this only decides whether to offer the button). */
export const isPendingStatus = (s: string | null | undefined) => s === 'PendingReview' || s === 'NeedsInfo'

export const countsSummary = (c: DemoCounts) => {
  const parts: [number, string, string][] = [[c.products, 'product', 'products'], [c.services, 'service', 'services'], [c.orders, 'order', 'orders'], [c.bookings, 'booking', 'bookings'], [c.quotes, 'quote request', 'quote requests'], [c.conversations, 'conversation', 'conversations']]
  return parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(', ')
}
