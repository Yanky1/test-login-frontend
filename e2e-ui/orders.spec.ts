import { expect, test, type Page } from '@playwright/test'

const login = { tokenType: 'Bearer', accessToken: 'tok', expiresIn: 900, refreshToken: '', sellerId: 's1', email: 'rivka@example.com', vendorName: 'Rivka Bakes', accountStatus: 'Approved', roles: ['Seller'], activeAccountId: 's1', accounts: [{ sellerId: 's1', vendorName: 'Rivka Bakes', role: 'Owner', accountStatus: 'Approved', brandCount: 1 }] }
const order = (i: number, demo: boolean) => ({
  id: `o${i}`, number: `SO-2026-00000${i}`, marketplaceOrderId: `MP-${i}`, brandId: 'b1', brandName: 'Rivka Bakes', placedAt: '2026-11-01T10:00:00Z', status: 'New', buyerName: 'Jane Buyer', currency: 'USD',
  totalCents: 4000, netCents: 3500, refundedCents: 0, itemCount: 2, itemsSummary: 'Challah', thumbnailLineId: null, shipByAt: '2030-01-01T10:00:00Z', deliverByAt: '2030-01-05T10:00:00Z',
  late: false, oversold: false, cancelRequested: false, returnOpen: false, shippingSpeed: 'standard', version: 1, redacted: false, needsAction: true, demo,
})

async function mock(page: Page) {
  await page.route('**/config.json', (r) => r.fulfill({ json: { idleTimeoutMinutes: 60, warningSeconds: 60, refreshIntervalMinutes: 5, features: { apple: false }, turnstileSiteKey: 'stub' } }))
  await page.route('**/api/v1/**', (r) => {
    const p = new URL(r.request().url()).pathname.replace('/api/v1', '')
    if (p === '/auth/refresh') return r.fulfill({ json: login })
    if (p === '/brands') return r.fulfill({ json: [{ id: 'b1', name: 'Rivka Bakes', isDefault: true }] })
    if (p === '/public-config') return r.fulfill({ json: { marketplaceUrl: 'https://m.example', termsVersion: '1', sellerAgreementVersion: '1', smsWordingVersion: '1', smsWording: 'x', turnstileSiteKey: 'stub', demoEnabled: true } })
    if (p === '/seller/orders/counts') return r.fulfill({ json: { needsAction: 3, pending: 0, shipped: 0, delivered: 0, cancelled: 0, returns: 0, late: 0, all: 3 } })
    if (p === '/seller/orders/dashboard') return r.fulfill({ json: { todayOrders: 1, toShip: 2, late: 0, returnsOpen: 0, sales30Cents: 12000, orders30: 3, daily: [], lateShipmentRate: 0, cancellationRate: 0, messages: { unread: 0, needsReply: 0, overdue: 0, avgResponseHours: null, repliedInTimePct: null } } })
    if (p === '/seller/orders') return r.fulfill({ json: { items: [order(1, true), order(2, true), order(3, false)], total: 3, page: 1, pageSize: 25 } })
    return r.fulfill({ json: {} })
  })
}

test.describe('/orders layout', () => {
  for (const width of [1280, 320]) {
    test(`order number, Demo pill and selection checkboxes at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await mock(page)
      await page.goto('/orders')
      const links = page.locator('a.ptitle:visible')
      await expect(links.first()).toBeVisible()
      // #54: the order number never overlaps the "Demo data" pill
      const pairs = await page.evaluate(() => [...document.querySelectorAll('a.ptitle')].filter((a) => (a as HTMLElement).offsetParent).map((a) => {
        const pill = a.parentElement!.querySelector('.chip.demo'); if (!pill) return null
        const x = a.getBoundingClientRect(), y = pill.getBoundingClientRect()
        return { sideBySide: Math.abs((x.top + x.bottom) / 2 - (y.top + y.bottom) / 2) < 8 && y.left >= x.right, overlapX: Math.min(x.right, y.right) - Math.max(x.left, y.left), overlapY: Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) }
      }).filter(Boolean) as { sideBySide: boolean; overlapX: number; overlapY: number }[])
      expect(pairs.length).toBeGreaterThan(0)
      for (const p of pairs) {
        expect(p.overlapX <= 0 || p.overlapY <= 0).toBe(true)
        if (width >= 768) expect(p.sideBySide, 'order number and Demo pill sit side by side').toBe(true)
      }
      // #52: tap targets are at least 24x24 CSS px
      for (const sel of ['a.ptitle:visible', 'input[type=checkbox]:visible']) {
        for (const el of await page.locator(sel).all()) {
          const b = (await el.boundingBox())!
          expect(b.height, sel).toBeGreaterThanOrEqual(24)
          if (sel.startsWith('input')) expect(b.width, sel).toBeGreaterThanOrEqual(24)
        }
      }
    })
  }
})
