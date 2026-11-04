import type { OrderListItem, OrderStatus } from './api'

export const money = (cents: number | null | undefined, currency = 'USD') =>
  cents == null ? '' : (cents / 100).toLocaleString('en-US', { style: 'currency', currency })

export const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '')

const LABEL: Record<OrderStatus, string> = {
  New: 'Pending acceptance', Accepted: 'To ship', PartiallyShipped: 'Partly shipped', Shipped: 'Shipped', Delivered: 'Delivered', Completed: 'Completed', OnHold: 'On hold',
  Cancelled: 'Cancelled', ReturnRequested: 'Return requested', ReturnApproved: 'Return approved', ReturnRejected: 'Return rejected', ReturnReceived: 'Return received', Refunded: 'Refunded',
}
export const statusLabel = (s: OrderStatus, o?: { refundedCents: number; totalCents: number }) =>
  s === 'Refunded' && o && o.refundedCents < o.totalCents ? 'Refunded (partial)' : LABEL[s]
export const statusTone = (s: OrderStatus) =>
  s === 'Cancelled' || s === 'ReturnRejected' ? 'st-archived' : s === 'New' || s === 'ReturnRequested' ? 'warn' : s === 'OnHold' ? 'st-draft' : s === 'Delivered' || s === 'Completed' || s === 'Shipped' ? 'ok' : 'st-inactive'

const UNSHIPPED: OrderStatus[] = ['New', 'Accepted', 'PartiallyShipped', 'OnHold']
/** "Ship by Nov 5 · in 2 days" / "Late by 1 day"; only while there is something left to ship. */
export function shipByText(o: Pick<OrderListItem, 'status' | 'shipByAt'>, now = Date.now()): { text: string; tone: 'ok' | 'warn' | 'bad' | 'none' } {
  if (!UNSHIPPED.includes(o.status)) return { text: '', tone: 'none' }
  const ms = new Date(o.shipByAt).getTime() - now
  const days = Math.ceil(Math.abs(ms) / 86_400_000)
  if (ms < 0) { const late = Math.max(1, Math.floor(Math.abs(ms) / 86_400_000)); return { text: `Late by ${late} day${late === 1 ? '' : 's'}`, tone: 'bad' } }
  if (ms < 86_400_000) { const h = Math.max(1, Math.floor(ms / 3_600_000)); return { text: `Ship within ${h} hour${h === 1 ? '' : 's'}`, tone: 'warn' } }
  return { text: `Ship by ${day(o.shipByAt)} · in ${days} days`, tone: days <= 1 ? 'warn' : 'ok' }
}

const REASONS: Record<string, string> = {
  out_of_stock: 'Out of stock', cannot_ship_to_address: "Can't ship to this address", pricing_error: 'Pricing error', buyer_requested: 'Buyer requested', fraud_suspected: 'Suspected fraud', other: 'Other',
  returned_item: 'Returned item', item_not_as_described: 'Item not as described', damaged_in_transit: 'Damaged in transit', late_delivery: 'Late delivery', goodwill: 'Goodwill',
  outside_return_window: 'Outside the return window', item_used: 'Item used', not_eligible: 'Not eligible for return', wrong_item_returned: 'Wrong item returned',
  changed_mind: 'Changed their mind', ordered_by_mistake: 'Ordered by mistake', found_better_price: 'Found a better price', delivery_too_slow: 'Delivery too slow',
  damaged: 'Arrived damaged', not_as_described: 'Not as described', wrong_item: 'Wrong item', no_longer_needed: 'No longer needed', cancelled_remainder: 'Cancelled remainder',
}
export const reasonLabel = (r: string) => REASONS[r] ?? r

const EVENT: Record<string, string> = {
  'shipment.exception': 'Delivery problem reported', 'shipment.voided': 'Shipping label voided', 'shipment.attention_dismissed': 'Delivery problem marked as handled',
  'return.label_created': 'Prepaid return label sent', 'return.label_voided': 'Return label voided', 'return.arrived': 'Return parcel arrived', 'label.voided': 'Shipping label refunded',
  'order.placed': 'Order placed', 'order.accepted': 'Accepted', 'order.held': 'Put on hold', 'order.resumed': 'Hold removed', 'order.shipped': 'Shipped', 'order.partially_shipped': 'Partly shipped',
  'order.tracking_updated': 'Tracking updated', 'order.delivered': 'Delivered', 'shipment.delivered': 'Shipment delivered', 'order.cancelled': 'Cancelled', 'order.remainder_cancelled': 'Unshipped items cancelled',
  'order.refunded': 'Refund issued', 'order.completed': 'Completed', 'order.oversold': 'Not enough stock', 'order.pii_redacted': 'Buyer details removed', 'cancellation.requested': 'Buyer asked to cancel',
  'cancellation.rejected': 'Cancellation request declined', 'cancellation.auto_rejected': 'Cancellation request declined automatically', 'return.requested': 'Buyer requested a return',
  'return.approved': 'Return approved', 'return.rejected': 'Return rejected', 'return.received': 'Return received', 'stock.mismatch': 'Stock needs checking',
}
export const eventLabel = (t: string) => EVENT[t] ?? t

/** Cents from a dollars text field ("12.5" -> 1250); null when it isn't a valid non-negative amount. */
export const toCents = (s: string): number | null => {
  const t = s.trim().replace(/^\$/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}
export const fromCents = (c: number) => (c / 100).toFixed(2)

/** Carrier tracking formats; mirrors the server (Tracking.cs) so the dialog can say what is wrong before saving. */
const FORMATS: Record<string, RegExp[]> = {
  UPS: [/^1Z[0-9A-Z]{16}$/, /^T\d{10}$/], USPS: [/^\d{20,22}$/, /^[A-Z]{2}\d{9}US$/, /^\d{26,34}$/], FedEx: [/^\d{12}$/, /^\d{15}$/, /^\d{20,22}$/],
  DHL: [/^\d{10,11}$/, /^JD\d{18}$/, /^[A-Z]{3}\d{7,}$/], Other: [/^[A-Z0-9-]{3,40}$/],
}
export const normalizeTracking = (t: string) => t.replace(/\s/g, '').toUpperCase()
export const trackingValid = (carrier: string, t: string) => (FORMATS[carrier] ?? FORMATS.Other).some((r) => r.test(normalizeTracking(t)))

/** Today as YYYY-MM-DD in the browser's own time zone (toISOString would give the UTC date, which is tomorrow/yesterday for part of the day). */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
