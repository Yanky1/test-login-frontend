import { api } from '../api'
import { fetchBlob, saveBlob } from '../products/api'

export type TrackingStatus = 'pre_transit' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'available_for_pickup' | 'return_to_sender' | 'failure' | 'unknown'

export interface ShipAddress {
  id: string; brandId: string | null; label: string; name: string; company: string | null; line1: string; line2: string | null; city: string; region: string | null; postalCode: string
  country: string; phone: string | null; email: string | null; isDefault: boolean; validation: 'valid' | 'unverified' | 'invalid'; validationMessage: string | null; validatedAt: string | null
}
export interface PackagePreset { id: string; name: string; kind: 'box' | 'envelope' | 'soft_pack'; lengthMm: number; widthMm: number; heightMm: number; emptyWeightGrams: number; isDefault: boolean }
export type Speed = 'standard' | 'expedited' | 'overnight'
export interface SpeedRate { speed: Speed; enabled: boolean; method: 'flat' | 'weight'; flatCents: number | null; baseCents: number | null; perKgCents: number | null }
export interface Zone { name: string; kind: 'domestic' | 'international'; countries: string[]; speeds: SpeedRate[] }
export interface Profile { id: string; brandId: string | null; name: string; isDefault: boolean; currency: string; freeShippingThresholdCents: number | null; zones: Zone[] }
export interface ScopeSettings { brandId: string | null; handlingDays: number | null; labelFormat: string | null; returnAddressId: string | null }
export interface ShippingConfig {
  addresses: ShipAddress[]; packages: PackagePreset[]; profiles: Profile[]; settings: ScopeSettings[]; labelFormats: string[]; defaultLabelFormat: string; speeds: Speed[]; provider: string
  spend: { limitCents: number; spentCents: number }; canManage: boolean
}

export interface QuotedRate { rateId: string; carrier: string; service: string; amountCents: number; currency: string; estimatedDays: number | null; estimatedDelivery: string | null; meetsDeliverBy: boolean; recommended: boolean }
export interface Quote {
  quoteId: string; expiresAt: string; addressStatus: 'valid' | 'unverified' | 'invalid'; addressMessage: string | null; international: boolean; deliverBy: string
  parcel: { lengthMm: number; widthMm: number; heightMm: number; weightGrams: number }; lines: { lineId: string; quantity: number }[]; rates: QuotedRate[]
}
export interface Label {
  id: string; orderId: string; kind: 'outbound' | 'return'; status: 'purchasing' | 'active' | 'voiding' | 'voided' | 'refundfailed' | 'failed'; shipmentId: string | null; returnId: string | null
  carrier: string; service: string | null; trackingNumber: string | null; costCents: number; currency: string; format: string; purchasedAt: string | null; printedAt: string | null
  estimatedDelivery: string | null; refundStatus: string; refundError: string | null; hasFile: boolean; canVoid: boolean; fileUrl: string | null
}
export interface TrackEvent { status: TrackingStatus; label: string; detail: string | null; location: string | null; at: string }
export interface TrackedShipment {
  id: string; method: string; carrier: string; service: string | null; trackingNumber: string; trackingUrl: string | null; status: TrackingStatus; statusLabel: string; statusDetail: string | null
  eta: string | null; deliveredAt: string | null; live: boolean; labelId: string | null; events: TrackEvent[]
}
export interface TrackedReturn { id: string; returnId: string; carrier: string; service: string | null; trackingNumber: string; trackingUrl: string | null; status: TrackingStatus; statusLabel: string; eta: string | null; deliveredAt: string | null; labelId: string | null; events: TrackEvent[] }
export interface OrderTracking { needsAttention: boolean; attentionReason: string | null; shipments: TrackedShipment[]; returns: TrackedReturn[]; labels: Label[] }
export interface Summary { labelsToPrint: number; exceptions: number; refundsPending: number; refundsFailed: number; spend: { limitCents: number; spentCents: number } }

export interface AddressBody { label?: string; name: string; company?: string; line1: string; line2?: string; city: string; region?: string; postalCode: string; country: string; phone?: string; email?: string; brandId?: string | null; isDefault?: boolean }
export interface PackageBody { name: string; kind: string; lengthMm: number; widthMm: number; heightMm: number; emptyWeightGrams: number; isDefault?: boolean }
export interface PackageInput { presetId?: string; lengthMm?: number; widthMm?: number; heightMm?: number; weightGrams?: number }
export interface CustomsInput { contentsType: string; nonDeliveryOption: string; hsCode?: string }
export interface RatesBody { fromAddressId?: string; package?: PackageInput; lines?: { lineId: string; quantity: number }[]; customs?: CustomsInput }
export interface BulkResult { orderId: string; number?: string; ok: boolean; code: string; message: string }

const S = '/seller/shipping'
export const shippingApi = {
  config: () => api<ShippingConfig>(`${S}/settings`),
  saveSettings: (b: { brandId?: string | null; handlingDays?: number; labelFormat?: string; returnAddressId?: string; clearReturnAddress?: boolean; clearHandling?: boolean }) => api<ScopeSettings>(`${S}/settings`, { method: 'PUT', body: b }),
  addAddress: (b: AddressBody) => api<ShipAddress>(`${S}/addresses`, { body: b }),
  editAddress: (id: string, b: AddressBody) => api<ShipAddress>(`${S}/addresses/${id}`, { method: 'PUT', body: b }),
  defaultAddress: (id: string) => api<ShipAddress>(`${S}/addresses/${id}/default`, { body: {} }),
  removeAddress: (id: string) => api<null>(`${S}/addresses/${id}`, { method: 'DELETE' }),
  addPackage: (b: PackageBody) => api<PackagePreset>(`${S}/packages`, { body: b }),
  editPackage: (id: string, b: PackageBody) => api<PackagePreset>(`${S}/packages/${id}`, { method: 'PUT', body: b }),
  removePackage: (id: string) => api<null>(`${S}/packages/${id}`, { method: 'DELETE' }),
  addProfile: (b: object) => api<Profile>(`${S}/profiles`, { body: b }),
  editProfile: (id: string, b: object) => api<Profile>(`${S}/profiles/${id}`, { method: 'PUT', body: b }),
  removeProfile: (id: string) => api<null>(`${S}/profiles/${id}`, { method: 'DELETE' }),
  rates: (orderId: string, b: RatesBody) => api<Quote>(`${S}/orders/${orderId}/rates`, { body: b }),
  buy: (orderId: string, b: { quoteId: string; rateId: string; idempotencyKey: string; shipAnyway?: { reason: string } }) => api<{ label: Label; replayed: boolean }>(`${S}/orders/${orderId}/labels`, { body: b }),
  voidLabel: (id: string, reason?: string) => api<{ label: Label; pending?: boolean }>(`${S}/labels/${id}/void`, { body: { reason } }),
  printed: (id: string) => api<{ printedAt: string }>(`${S}/labels/${id}/printed`, { body: {} }),
  bulk: (b: { orderIds: string[]; packageId?: string; weightGrams?: number; strategy: 'recommended' | 'cheapest'; idempotencyKey: string }) => api<{ results: BulkResult[]; bought: number; total: number }>(`${S}/labels/bulk`, { body: b }),
  returnLabel: (orderId: string, returnId: string, b: { package?: PackageInput; customs?: CustomsInput; idempotencyKey: string }) => api<{ label: Label; labelUrl: string }>(`${S}/orders/${orderId}/returns/${returnId}/label`, { body: b }),
  tracking: (orderId: string) => api<OrderTracking>(`${S}/orders/${orderId}/tracking`),
  dismiss: (orderId: string) => api<{ needsAttention: boolean }>(`${S}/orders/${orderId}/attention/dismiss`, { body: {} }),
  summary: () => api<Summary>(`${S}/summary`),
  fileBlob: (l: Label) => fetchBlob(l.fileUrl!),
}

/** Structured details the server attaches to an error (requote, spend limit, address status, customs). */
export const errDetail = (e: unknown): Record<string, unknown> => {
  const d = (e as { body?: { errors?: unknown } })?.body?.errors
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {}
}

export const labelExt = (f: string) => (f === 'PNG' ? 'png' : f === 'ZPLII' ? 'zpl' : 'pdf')

/** Opens the label in a new tab (the browser's viewer prints it; the file needs our bearer token, so it goes through a blob URL). ZPL can't be shown: it is downloaded. */
export async function printLabel(l: Label): Promise<void> {
  const blob = await shippingApi.fileBlob(l)
  if (l.format === 'ZPLII') saveBlob(blob, `label-${l.trackingNumber}.zpl`)
  else {
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  await shippingApi.printed(l.id).catch(() => undefined)
}
export async function downloadLabel(l: Label): Promise<void> { saveBlob(await shippingApi.fileBlob(l), `label-${l.trackingNumber}.${labelExt(l.format)}`) }
