import type { EntityLink, PageContext } from './types'

/**
 * Entity links are built HERE from kind + id (never from model-provided URLs). Routes of the orders/services areas follow the planned
 * seller-portal paths; until those pages exist the app's catch-all sends the visitor home.
 */
export function linkFor(l: EntityLink): string | null {
  if (!/^[0-9a-fA-F-]{36}$/.test(l.id)) return null
  switch (l.kind) {
    case 'product': case 'service': return `/products/${l.id}`
    case 'order': return `/orders/${l.id}`
    case 'booking': return `/bookings/${l.id}`
    case 'conversation': return `/messages/${l.id}`
    case 'quote': return `/quote-requests/${l.id}`
    default: return null
  }
}

const UUID = '[0-9a-fA-F-]{36}'
/** What the user is looking at, derived from the route (sent to the server as context for "this listing"). */
export function pageContextFor(pathname: string): PageContext | null {
  let m = new RegExp(`^/products/(${UUID})(?:/|$)`).exec(pathname); if (m) return { kind: 'product', id: m[1] }
  m = new RegExp(`^/orders/(${UUID})(?:/|$)`).exec(pathname); if (m) return { kind: 'order', id: m[1] }
  m = new RegExp(`^/bookings/(${UUID})(?:/|$)`).exec(pathname); if (m) return { kind: 'booking', id: m[1] }
  return null
}

/** Suggested prompts by page. Viewers only get read-only ones. */
export function suggestionsFor(pathname: string, canPropose: boolean): string[] {
  const ctx = pageContextFor(pathname)
  if (ctx?.kind === 'product') return ['Improve this listing', 'What is missing before I can publish this?', ...(canPropose ? ['Deactivate this listing'] : [])]
  if (pathname.startsWith('/products')) return ['Is my catalogue healthy? What should I fix first?', 'Which listings are out of stock?', ...(canPropose ? ['Add a draft product for a challah board, $25, 10 in stock'] : [])]
  if (pathname.startsWith('/questions')) return ['Which questions are still unanswered?', 'How do I answer a customer question?']
  return ['Which orders are late?', 'What do I need to ship today?', 'Which buyer messages haven’t I answered?', ...(canPropose ? ['Add a draft product for a challah board, $25, 10 in stock'] : [])]
}
