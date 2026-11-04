import { api } from '../api'

export type LocalStatus = 'Unassigned' | 'Assigned' | 'InTransit' | 'OutForDelivery' | 'Delivered' | 'Failed' | 'Returned' | 'Cancelled'

export interface ZoneDto {
  id?: string; name: string; country: string; originLat: number | null; originLng: number | null; radiusKm: number | null; postcodes: string[]
  polygon?: number[][]; feeCents: number; freeOverCents: number | null; minOrderCents: number; priority: number; active: boolean
}
export interface WindowDto { id?: string; start: string; end: string; capacity: number; days: number[]; active: boolean }
export interface DeliverySettings {
  brandId: string | null; enabled: boolean; timeZone: string; sameDayCutoff: string | null; minLeadMinutes: number; maxDaysAhead: number
  zones: ZoneDto[]; windows: WindowDto[]; version: number; exists: boolean
}

export interface BoardWindow { id: string; start: string; end: string; capacity: number; booked: number; warning: 'full' | 'nearly_full' | null }
export interface BoardDelivery {
  id: string; orderId: string; number: string; brandId: string; status: LocalStatus; trackingStatus: string | null; code: string; windowId: string | null
  windowStart: string; windowEnd: string; city: string; postalCode: string; routeId: string | null; seq: number; driverMembershipId: string | null; driver: string | null
  feeCents: number; eta: string | null; late: boolean; exception: boolean; failReason: string | null; attempts: number; hasCoordinates: boolean; version: number; orderStatus: string
}
export interface BoardRoute { id: string; status: 'Planned' | 'Active' | 'Completed' | 'Cancelled'; driverMembershipId: string; driver: string | null; startedAt: string | null; version: number }
export interface Board { date: string; timeZone: string; windows: BoardWindow[]; deliveries: BoardDelivery[]; routes: BoardRoute[] }
export interface DriverRef { membershipId: string; email: string; firstName: string }

export interface TrackingTimeline {
  method: 'carrier' | 'local'
  delivery: { id: string; code: string; status: LocalStatus; trackingStatus: string | null; windowStart: string; windowEnd: string; feeCents: number; attempts: number; eta: string | null } | null
  events: { status: string; detail: string | null; at: string; method: string }[]
  attempts: { number: number; outcome: string; reason: string | null; note: string | null; recipientName: string | null; placement: string | null; at: string }[]
  proofs: { id: string; kind: 'photo' | 'signature'; url: string; at: string }[]
}

export const deliveryApi = {
  settings: (brandId?: string) => api<DeliverySettings>(`/seller/delivery/settings${brandId ? `?brandId=${brandId}` : ''}`),
  saveSettings: (s: Partial<DeliverySettings> & { brandId?: string | null }) => api<DeliverySettings>('/seller/delivery/settings', { method: 'PUT', body: s }),
  board: (date?: string) => api<Board>(`/seller/delivery/board${date ? `?date=${date}` : ''}`),
  drivers: () => api<DriverRef[]>('/seller/delivery/drivers'),
  assign: (deliveryId: string, driverMembershipId: string) => api(`/seller/delivery/deliveries/${deliveryId}/assign`, { body: { driverMembershipId } }),
  unassign: (deliveryId: string) => api(`/seller/delivery/deliveries/${deliveryId}/unassign`, { method: 'POST' }),
  optimize: (routeId: string) => api(`/seller/delivery/routes/${routeId}/optimize`, { method: 'POST' }),
  reassign: (routeId: string, driverMembershipId: string) => api(`/seller/delivery/routes/${routeId}/reassign`, { body: { driverMembershipId } }),
  routeSheet: (routeId: string) => api<{ id: string; date: string; status: string; stops: { id: string; seq: number; status: string; code: string; windowStart: string; windowEnd: string; number: string; name: string; address: string }[] }>(`/seller/delivery/routes/${routeId}`),
  tracking: (orderId: string) => api<TrackingTimeline>(`/seller/orders/${orderId}/tracking`),
  convert: (orderId: string, windowId: string, date: string) => api(`/seller/orders/${orderId}/local-delivery`, { body: { windowId, date } }),
}

// ---- driver app ------------------------------------------------------------------------------------------------------------------
export interface StopDto {
  id: string; seq: number; status: LocalStatus; trackingStatus: string | null; code: string; window: { start: string; end: string }; eta: string | null; attempts: number; version: number
  detailsVisible: boolean; to: { name: string; line1: string; line2: string | null; city: string; region: string | null; postalCode: string } | null
  contact: { firstName: string; phone: string | null; call: string | null; sms: string | null } | null; navigateUrl: string | null; proofs: number
}
export interface DriverRoute { id: string; date: string; status: 'Planned' | 'Active' | 'Completed'; startedAt: string | null; version: number; stops: StopDto[] }
export interface DriverMe { role: string; consented: boolean; paused: boolean; routes: DriverRoute[] }
export type DriverEventType = 'out_for_delivery' | 'delivered' | 'failed' | 'reattempt' | 'return_to_store'
export interface DriverEventBody {
  clientEventId: string; type: DriverEventType; clientAt: string; reason?: string; note?: string; recipientName?: string; placement?: 'left_at_door' | 'handed_to'
  proofIds?: string[]; lat?: number; lng?: number
}

export const driverApi = {
  me: () => api<DriverMe>('/driver/me'),
  start: (routeId: string) => api(`/driver/routes/${routeId}/start`, { method: 'POST' }),
  consent: (consented?: boolean, paused?: boolean) => api<{ consented: boolean; paused: boolean }>('/driver/consent', { body: { consented, paused } }),
  location: (lat: number, lng: number) => api('/driver/location', { body: { lat, lng } }),
}

/** RFC 4122 v4 UUID from getRandomValues: crypto.randomUUID() needs a secure context and newer browsers, but the server requires a real GUID for every client id. */
export function newId(): string {
  const b = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const STATUS_LABEL: Record<LocalStatus, string> = {
  Unassigned: 'Not assigned', Assigned: 'Assigned', InTransit: 'In transit', OutForDelivery: 'Out for delivery', Delivered: 'Delivered', Failed: 'Failed attempt', Returned: 'Returned to store', Cancelled: 'Cancelled',
}
export const TRACKING_LABEL: Record<string, string> = {
  pre_transit: 'Assigned to a driver', in_transit: 'On its way', out_for_delivery: 'Out for delivery', delivered: 'Delivered', failure: 'Delivery attempt failed', return_to_sender: 'Returned to the store',
}
export const FAIL_REASONS: { value: string; label: string }[] = [
  { value: 'no_one_home', label: 'No one home' }, { value: 'address_issue', label: 'Address problem' }, { value: 'refused', label: 'Delivery refused' }, { value: 'unsafe', label: 'Unsafe to deliver' },
]
export const money = (cents: number) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
export const timeRange = (a: string, b: string) => {
  const f = (x: string) => new Date(x).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${f(a)} – ${f(b)}`
}
