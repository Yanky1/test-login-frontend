import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export const API = '*/api/v1'

export const loginBody = (over: Record<string, unknown> = {}) => ({
  tokenType: 'Bearer', accessToken: 'tok-1', expiresIn: 3600, refreshToken: 'rt-1',
  sellerId: '11111111-1111-1111-1111-111111111111', email: 'seller@example.com', vendorName: 'Acme Co',
  accountStatus: 'Active', roles: ['Seller'], ...over,
})

export const handlers = [
  http.post(`${API}/auth/refresh`, () => HttpResponse.json({ error: 'Session expired' }, { status: 401 })),
  http.get(`${API}/account/phone`, () => HttpResponse.json({ hasNumber: false, numberEnding: null, hasPin: false })),
  http.get(`${API}/seller/orders/counts`, () => HttpResponse.json({ needsAction: 0, pending: 0, shipped: 0, delivered: 0, cancelled: 0, returns: 0, late: 0, all: 0 })),
  http.get(`${API}/seller/messages/counts`, () => HttpResponse.json({ unread: 0, needsReply: 0, overdue: 0, all: 0 })),
  http.get(`${API}/seller/events`, () => new HttpResponse(null, { status: 204 })),
  http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${API}/public-config`, () => HttpResponse.json({
    marketplaceUrl: 'https://market.example', termsVersion: '1', sellerAgreementVersion: '1', smsWordingVersion: '1',
    smsWording: 'I agree to receive text messages.', turnstileSiteKey: 'stub',
  })),
]

export const server = setupServer(...handlers)
