import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { signedPost } from './adminKit'

// Real backend (Testing environment): reviews come in through the SIGNED marketplace endpoint, exactly like the marketplace sends them.
export const REVIEWS = '/api/internal/v1/reviews'

export const ingest = (request: APIRequestContext, s: { sellerId: string }, listingId: string, o: { rating?: number; text?: string | null; name?: string; reviewId?: string; createdAt?: string } = {}) => {
  const reviewId = o.reviewId ?? 'rev-' + randomUUID().replace(/-/g, '').slice(0, 20)
  return signedPost(request, REVIEWS, { reviewId, listingId, sellerId: s.sellerId, rating: o.rating ?? 4, text: o.text === undefined ? 'Lovely mug, arrived quickly.' : o.text, buyerDisplayName: o.name ?? 'Jane B.', createdAt: o.createdAt ?? new Date().toISOString() }).then(async (r) => ({ reviewId, status: r.status(), body: await r.text() }))
}

