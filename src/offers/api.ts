import { api } from '../api'
import type { OfferDetail, OfferListItem, OfferWrite, Preview } from './types'

const P = '/seller/offers'
export const offersApi = {
  list: (brandId?: string) => api<{ items: OfferListItem[] }>(`${P}${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ''}`),
  get: (id: string) => api<OfferDetail>(`${P}/${id}`),
  create: (body: OfferWrite) => api<OfferDetail>(P, { body }),
  update: (id: string, body: OfferWrite) => api<OfferDetail>(`${P}/${id}`, { method: 'PUT', body }),
  end: (id: string, version: number) => api<OfferDetail>(`${P}/${id}/end`, { body: { version } }),
  preview: (body: Partial<OfferWrite> & { sampleProductId?: string }) => api<Preview>(`${P}/preview`, { body }),
}
