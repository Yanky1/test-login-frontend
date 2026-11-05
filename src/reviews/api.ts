import { api } from '../api'
import type { Review, ReviewList } from './types'

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const reviewsApi = {
  list: (o: Record<string, string | number | undefined | null>) => api<ReviewList>(`/seller/reviews${qs(o)}`),
  reply: (id: string, text: string) => api<Review>(`/seller/reviews/${id}/reply`, { method: 'PUT', body: { text } }),
  removeReply: (id: string) => api<null>(`/seller/reviews/${id}/reply`, { method: 'DELETE' }),
}
