/** C18 quantity offers (backend docs/CONTRACT.md). All money is integer cents computed by the server. */
export type OfferScope = 'all' | 'category' | 'products'
export type OfferStatus = 'draft' | 'active' | 'ended'
export type OfferState = 'draft' | 'scheduled' | 'active' | 'expired' | 'ended'
export interface Tier { minQuantity: number; unitPriceCents: number }
export interface Gift { minQuantity: number; productId: string; quantity: number; title?: string | null }

export interface OfferListItem {
  id: string; name: string; brandId: string; brandName: string | null; status: OfferStatus; state: OfferState; version: number; scope: OfferScope
  tiers: Tier[] | null; giftCount: number; activeFrom: string | null; activeTo: string | null; updatedAt: string; demo: boolean
}

export interface OfferDetail {
  id: string; brandId: string; brandName: string | null; name: string; status: OfferStatus; state: OfferState; version: number; createdAt: string; updatedAt: string; endedAt: string | null; demo: boolean
  scope: OfferScope; categoryIds: string[]; categories: { id: string; name: string | null }[]; productIds: string[]; products: { id: string; title: string | null }[]
  tiers: Tier[] | null; gifts: Gift[] | null; activeFrom: string | null; activeTo: string | null
  versions: { version: number; status: OfferStatus; createdAt: string; supersededAt: string | null }[]
}

export interface OfferWrite {
  name: string; brandId?: string; status: 'draft' | 'active'; scope: OfferScope; categoryIds: string[]; productIds: string[]
  tiers: Tier[]; gifts: Omit<Gift, 'title'>[]; activeFrom: string | null; activeTo: string | null; version?: number
}

export interface PreviewRow { quantity: number; unitPriceCents: number | null; totalCents: number | null; tierMinQuantity: number | null; discountCents: number | null; gifts: { productId: string; title: string; quantity: number }[] }
export interface Preview { sample: { productId: string; title: string; unitPriceCents: number | null } | null; eligibleProducts: number; rows: PreviewRow[]; summary: string; currency: string }
