import { api } from '../api'
import type { Availability, BlockDto, BookingCounts, BookingDetail, BookingList, BookingMessage, CalendarData, ProviderList, ProviderRow, QuoteDto, QuoteList, ServiceDetails, ServiceProviderChoice } from './types'
import type { ProductDetail } from '../products/types'

const S = '/seller'
const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const servicesApi = {
  saveDetails: (id: string, d: Record<string, unknown>) => api<ProductDetail>(`${S}/services/${id}/details`, { method: 'PUT', body: d }),
  serviceProviders: (id: string) => api<{ providers: ServiceProviderChoice[] }>(`${S}/services/${id}/providers`),
  setServiceProviders: (id: string, membershipIds: string[]) => api<{ providers: string[] }>(`${S}/services/${id}/providers`, { method: 'PUT', body: { membershipIds } }),

  providers: () => api<ProviderList>(`${S}/providers`),
  updateProvider: (id: string, b: Partial<Pick<ProviderRow, 'isProvider' | 'timeZone' | 'reminderDayBefore' | 'reminderHourBefore'>>) => api<unknown>(`${S}/providers/${id}`, { method: 'PUT', body: b }),
  availability: (id: string) => api<Availability>(`${S}/providers/${id}/availability`),
  saveAvailability: (id: string, b: { weekly: { day: number; intervals: { start: string; end: string }[] }[]; overrides: { date: string; intervals: { start: string; end: string }[] }[] }) =>
    api<{ ok: boolean }>(`${S}/providers/${id}/availability`, { method: 'PUT', body: b }),
  blocks: (id: string) => api<{ blocks: BlockDto[] }>(`${S}/providers/${id}/blocks`),
  addBlock: (id: string, b: { kind: 'timeoff' | 'busy'; start?: string; end?: string; allDay?: boolean; date?: string; endDate?: string; note?: string }) =>
    api<{ block: BlockDto; affectedBookings: number }>(`${S}/providers/${id}/blocks`, { body: b }),
  deleteBlock: (id: string, blockId: string) => api<null>(`${S}/providers/${id}/blocks/${blockId}`, { method: 'DELETE' }),
  createIcs: (id: string) => api<{ token: string; path: string }>(`${S}/providers/${id}/ics`, { body: {} }),
  revokeIcs: (id: string) => api<null>(`${S}/providers/${id}/ics`, { method: 'DELETE' }),
  accountIcs: () => api<{ active: boolean; createdAt: string | null }>(`${S}/calendar/ics`),
  createAccountIcs: () => api<{ token: string; path: string }>(`${S}/calendar/ics`, { body: {} }),
  revokeAccountIcs: () => api<null>(`${S}/calendar/ics`, { method: 'DELETE' }),
  setTimeZone: (timeZone: string) => api<{ timeZone: string }>(`${S}/booking-settings`, { method: 'PUT', body: { timeZone } }),

  calendar: (o: { from: string; to: string; providerId?: string; brandId?: string; serviceId?: string }) => api<CalendarData>(`${S}/calendar${qs(o)}`),

  bookings: (o: Record<string, string | number | undefined | null>) => api<BookingList>(`${S}/bookings${qs(o)}`),
  counts: () => api<BookingCounts>(`${S}/bookings/counts`),
  booking: (id: string) => api<BookingDetail>(`${S}/bookings/${id}`),
  act: (id: string, action: string, body: Record<string, unknown> = {}) => api<BookingDetail>(`${S}/bookings/${id}/${action}`, { body }),
  messages: (id: string) => api<{ messages: BookingMessage[] }>(`${S}/bookings/${id}/messages`),
  sendMessage: (id: string, text: string) => api<BookingMessage>(`${S}/bookings/${id}/messages`, { body: { text } }),

  quotes: (o: Record<string, string | number | undefined | null> = {}) => api<QuoteList>(`${S}/quote-requests${qs(o)}`),
  quote: (id: string) => api<QuoteDto>(`${S}/quote-requests/${id}`),
  sendQuote: (id: string, b: { price: number; durationMinutes: number; slots: string[]; providerId?: string; expiresAt: string; note?: string; version?: number }) => api<QuoteDto>(`${S}/quote-requests/${id}/quote`, { body: b }),
  declineQuote: (id: string, reason?: string) => api<QuoteDto>(`${S}/quote-requests/${id}/decline`, { body: { reason } }),
}

export type { ServiceDetails }
