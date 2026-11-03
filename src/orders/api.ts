import { api, refreshSession, tokenStore } from '../api'
import { fetchBlob } from '../products/api'

export type OrderStatus = 'New' | 'Accepted' | 'PartiallyShipped' | 'Shipped' | 'Delivered' | 'Completed' | 'OnHold' | 'Cancelled'
  | 'ReturnRequested' | 'ReturnApproved' | 'ReturnRejected' | 'ReturnReceived' | 'Refunded'

export interface OrderListItem {
  id: string; number: string; marketplaceOrderId: string; brandId: string; brandName: string; placedAt: string; status: OrderStatus; buyerName: string; currency: string
  totalCents: number; netCents: number; refundedCents: number; itemCount: number; itemsSummary: string; thumbnailLineId: string | null; shipByAt: string; deliverByAt: string
  late: boolean; oversold: boolean; cancelRequested: boolean; returnOpen: boolean; shippingSpeed: string; version: number; redacted: boolean; needsAction: boolean
}
export interface OrderList { items: OrderListItem[]; total: number; page: number; pageSize: number }
export interface OrderCounts { needsAction: number; pending: number; shipped: number; delivered: number; cancelled: number; returns: number; late: number; all: number }
export interface MessageCounts { unread: number; needsReply: number; overdue: number; all: number }
export interface Dashboard {
  todayOrders: number; toShip: number; late: number; returnsOpen: number; sales30Cents: number; orders30: number; daily: { date: string; orders: number; salesCents: number }[]
  lateShipmentRate: number; cancellationRate: number
  messages: { unread: number; needsReply: number; overdue: number; avgResponseHours: number | null; repliedInTimePct: number | null }
}

export interface OrderLine {
  id: string; productId: string; variantId: string | null; title: string; sku: string | null; options: string | null; hasImage: boolean; unitPriceCents: number; quantity: number
  discountCents: number; taxCents: number; lineTotalCents: number; shippedQty: number; cancelledQty: number; refundedQty: number; returnedQty: number; unshippedQty: number
  reservedQty: number; stockShort: boolean
}
export interface Shipment { id: string; carrier: string; service: string | null; trackingNumber: string; trackingUrl: string | null; shippedAt: string; deliveredAt: string | null; lines: { lineId: string; quantity: number }[] }
export interface CancelRequestDto { id: string; requestedBy: string; status: 'Requested' | 'Approved' | 'Rejected'; reason: string; note: string | null; decisionNote: string | null; createdAt: string; resolvedAt: string | null }
export interface ReturnDto {
  id: string; status: 'Requested' | 'Approved' | 'Rejected' | 'Received' | 'Refunded'; reason: string; buyerComment: string | null; decisionReason: string | null; restock: boolean; refundCents: number
  createdAt: string; decidedAt: string | null; receivedAt: string | null; lines: { lineId: string; quantity: number }[]
}
export interface RefundDto { id: string; returnId: string | null; amountCents: number; shippingCents: number; reason: string; note: string | null; createdAt: string; lines: { lineId: string; quantity: number; amountCents: number }[] }
export interface OrderActions {
  accept: boolean; hold: boolean; resume: boolean; ship: boolean; editTracking: boolean; markDelivered: boolean; cancel: boolean; cancelRemainder: boolean; refund: boolean
  refundLimitCents: number | null; note: boolean
}
export interface OrderDetail {
  id: string; number: string; marketplaceOrderId: string; brandId: string; brandName: string; placedAt: string; status: OrderStatus; heldFrom: string | null; currency: string; version: number
  late: boolean; oversold: boolean; cancelRequested: boolean; returnOpen: boolean; redacted: boolean; shipByAt: string; deliverByAt: string; shippingMethod: string; shippingSpeed: string
  giftMessage: string | null; cancelReason: string | null; cancelledBy: string | null; shippedLate: boolean; stockMismatch: boolean
  buyer: { name: string; relayEmail: string | null; phone: string | null }
  shippingAddress: { name: string; line1: string; line2: string | null; city: string; region: string | null; postalCode: string; country: string }
  money: { itemsCents: number; discountCents: number; shippingCents: number; taxCents: number; totalCents: number; feeCents: number; netCents: number; refundedCents: number; refundableCents: number }
  lines: OrderLine[]; shipments: Shipment[]; cancellations: CancelRequestDto[]; returns: ReturnDto[]; refunds: RefundDto[]
  timeline: { id: string; type: string; actor: string; text: string | null; at: string }[]
  notes: { id: string; text: string; author: string; createdAt: string }[]
  conversationId: string | null; actions: OrderActions
  reasons: { cancel: string[]; refund: string[]; rejectReturn: string[]; carriers: string[] }
}
export interface TrackingPreview { applied: boolean; total: number; valid: number; results: { row: number; orderNumber: string; orderId: string | null; ok: boolean; error: string | null; applied: boolean }[] }
export interface PackingSlip {
  id: string; number: string; brandName: string; placedAt: string; shippingMethod: string
  shipTo: { name: string; line1: string; line2: string | null; city: string; region: string | null; postalCode: string; country: string; phone: string | null }
  giftMessage: string | null; isGift: boolean; showPrices: boolean; currency: string
  lines: { title: string; sku: string | null; options: string | null; quantity: number; unshipped: number; unitPriceCents: number }[]
}

export interface ConversationItem {
  id: string; kind: 'order' | 'product'; subject: string; buyerName: string; brandId: string; brandName: string; orderId: string | null; orderNumber: string | null; productId: string | null
  productTitle: string | null; assignedUserId: string | null; assignedTo: string | null; noReplyNeeded: boolean; flagged: boolean; flagReason: string | null; unread: boolean; needsReply: boolean
  awaitingReplySince: string | null; overdue: boolean; dueAt: string | null; lastMessageAt: string; messageCount: number; redacted: boolean; preview: string | null
}
export interface Attachment { id: string; fileName: string; contentType: string; size: number }
export interface ChatMessage {
  id: string; direction: 'buyer' | 'seller'; text: string; createdAt: string; delivery: 'pending' | 'delivered' | 'read' | 'failed'; author: string | null; authorId: string | null
  contactWarning: boolean; reported: boolean; respondedAt: string | null; attachments: Attachment[]
}
export interface ConversationDetail {
  conversation: ConversationItem
  order: { id: string; number: string; status: OrderStatus; totalCents: number; currency: string; shipByAt: string; placedAt: string } | null
  product: { id: string; title: string; sku: string | null; priceCents: number | null; status: string } | null
  messages: ChatMessage[]; notes: { id: string; text: string; author: string; createdAt: string }[]; canWrite: boolean
}
export interface MessageTemplate { id: string; title: string; body: string }
export interface NotificationPrefs { newOrder: boolean; cancelRequest: boolean; returnRequest: boolean; buyerMessage: boolean; overdueReply: boolean }

const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}
export type ListParams = Record<string, string | number | boolean | undefined | null>
const O = '/seller/orders'
const M = '/seller/messages'

export const ordersApi = {
  list: (o: ListParams) => api<OrderList>(`${O}${qs(o)}`),
  counts: () => api<OrderCounts>(`${O}/counts`),
  dashboard: (brandId?: string) => api<Dashboard>(`${O}/dashboard${qs({ brandId })}`),
  get: (id: string) => api<OrderDetail>(`${O}/${id}`),
  act: (id: string, action: string, body: object = {}) => api<OrderDetail>(`${O}/${id}/${action}`, { body }),
  editTracking: (id: string, shipmentId: string, body: object) => api<OrderDetail>(`${O}/${id}/shipments/${shipmentId}`, { method: 'PUT', body }),
  previewRefund: (id: string, body: object) => api<{ amountCents: number; shippingCents: number; maxCents: number; lines: { lineId: string; quantity: number; amountCents: number }[] }>(`${O}/${id}/refunds/preview`, { body }),
  bulkAccept: (ids: string[]) => api<{ results: { id: string; number?: string; ok: boolean; code: string; message: string }[] }>(`${O}/bulk/accept`, { body: { ids } }),
  packingSlip: (id: string) => api<PackingSlip>(`${O}/${id}/packing-slip`),
  packingSlips: (ids: string[]) => api<{ slips: PackingSlip[] }>(`${O}/bulk/packing-slips`, { body: { ids } }),
  importTracking: (file: File, apply: boolean) => { const f = new FormData(); f.append('file', file); return api<TrackingPreview>(`${O}/import-tracking${qs({ apply })}`, { form: f }) },
  sendMessage: (id: string, text: string, acknowledgeWarning = false) => api<{ conversationId: string }>(`${O}/${id}/messages`, { body: { text, acknowledgeWarning } }),
  thumbnail: (orderId: string, lineId: string) => `${O}/${orderId}/lines/${lineId}/image`,
}

export const messagesApi = {
  list: (o: ListParams) => api<{ items: ConversationItem[]; total: number; page: number; pageSize: number }>(`${M}${qs(o)}`),
  counts: () => api<MessageCounts>(`${M}/counts`),
  get: (id: string) => api<ConversationDetail>(`${M}/${id}`),
  read: (id: string) => api<null>(`${M}/${id}/read`, { body: {} }),
  reply: (id: string, text: string, attachmentIds: string[], acknowledgeWarning: boolean) => api<{ message: ChatMessage; warnings?: string[] }>(`${M}/${id}/messages`, { body: { text, attachmentIds, acknowledgeWarning } }),
  upload: (id: string, file: File) => { const f = new FormData(); f.append('file', file); return api<Attachment>(`${M}/${id}/attachments`, { form: f }) },
  removeAttachment: (id: string, attId: string) => api<null>(`${M}/${id}/attachments/${attId}`, { method: 'DELETE' }),
  assign: (id: string, userId: string | null) => api<null>(`${M}/${id}/assign`, { body: { userId } }),
  noReply: (id: string, value: boolean) => api<null>(`${M}/${id}/no-reply-needed`, { body: { value } }),
  note: (id: string, text: string) => api<null>(`${M}/${id}/notes`, { body: { text } }),
  attachmentPath: (id: string, attId: string) => `${M}/${id}/attachments/${attId}`,
  templates: () => api<MessageTemplate[]>('/seller/message-templates'),
  addTemplate: (title: string, body: string) => api<MessageTemplate>('/seller/message-templates', { body: { title, body } }),
  deleteTemplate: (id: string) => api<null>(`/seller/message-templates/${id}`, { method: 'DELETE' }),
  prefs: () => api<NotificationPrefs>('/seller/notification-preferences'),
  savePrefs: (p: Partial<NotificationPrefs>) => api<NotificationPrefs>('/seller/notification-preferences', { method: 'PUT', body: p }),
}

export { fetchBlob }

/** Server-Sent Events over fetch (EventSource cannot send the bearer header). Calls onEvent(type); resolves when the stream ends. */
export async function readEvents(signal: AbortSignal, onEvent: (type: string) => void, onOpen?: () => void): Promise<void> {
  const open = () => fetch('/api/v1/seller/events', { headers: { Authorization: `Bearer ${tokenStore.get() ?? ''}`, Accept: 'text/event-stream' }, signal, credentials: 'same-origin' })
  let res = await open()
  if (res.status === 401 && (await refreshSession())) res = await open()
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  onOpen?.()
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2)
      const m = /^event: (.+)$/m.exec(block)
      if (m) onEvent(m[1])
    }
  }
}
