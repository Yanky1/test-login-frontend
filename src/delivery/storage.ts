import type { User } from '../auth'

/**
 * Everything the driver app keeps on the device lives under one prefix (localStorage) and one IndexedDB database, keyed by user + account, so it can be
 * wiped in one call when the session ends and one account's queue can never be replayed into another's.
 */
export const DRIVER_PREFIX = 'solvelt.driver.'
export const DRIVER_DB = 'solvelt-driver'
const CACHED_USER = DRIVER_PREFIX + 'cachedUser'

export const driverStorageName = (u: { email: string; activeAccountId?: string | null; sellerId?: string } | null | undefined) =>
  `${u?.email ?? 'anon'}|${u?.activeAccountId ?? u?.sellerId ?? 'none'}`

/** Removes every solvelt.driver.* key and the photo database. Called on log-out, when the session ends and when another tab logs out. */
export function clearDriverStorage() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith(DRIVER_PREFIX)) localStorage.removeItem(k) }
  } catch { /* storage unavailable: nothing to clear */ }
  try { if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(DRIVER_DB) } catch { /* ignore */ }
}

/**
 * The session ended WITHOUT the driver confirming anything (it expired, or the app logged them out for inactivity, or the log-out came from another tab).
 * Unsent deliveries must survive that: only the cached profile and route (which hold addresses) go; the queue, the failures, the photo bookkeeping and the
 * photo database stay. They are keyed by email + account, so nothing can replay into another account, and the same driver's next sign-in sends them.
 * With nothing waiting it is a full wipe. A manual log-out the driver confirmed (after the pending-work warning) still wipes everything: clearDriverStorage().
 */
export function endDriverSession(): 'kept' | 'wiped' {
  if (!hasPendingDriverWork()) { clearDriverStorage(); return 'wiped' }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k === CACHED_USER || k?.startsWith(DRIVER_PREFIX + 'route.')) localStorage.removeItem(k)
    }
  } catch { /* ignore */ }
  return 'kept'
}

/** Anything still waiting to be sent (any account) — for warnings that don't have the queue object at hand. */
export function hasPendingDriverWork(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(DRIVER_PREFIX + 'queue.') && (JSON.parse(localStorage.getItem(k) ?? '[]') as unknown[]).length > 0) return true
    }
  } catch { /* ignore */ }
  return false
}

/** The signed-in driver's profile, so an offline reload of /driver still opens the app (no token: only the queue and the cached route work). */
export function cacheDriverUser(u: User) { try { localStorage.setItem(CACHED_USER, JSON.stringify(u)) } catch { /* ignore */ } }
export function readCachedDriverUser(): User | null {
  try { const v = localStorage.getItem(CACHED_USER); const u = v ? (JSON.parse(v) as User) : null; return u?.role === 'Driver' ? u : null } catch { return null }
}

/** The last loaded route for offline use: stops, windows and addresses only. Names and phone numbers are NOT cached. */
export function cacheDriverRoutes<T extends { routes: { stops: { to?: unknown; contact?: unknown }[] }[] }>(name: string, me: T) {
  try {
    const slim = { ...me, routes: me.routes.map((r) => ({ ...r, stops: r.stops.map((s) => ({ ...s, contact: null, to: s.to ? { ...(s.to as object), name: '' } : null })) })) }
    localStorage.setItem(`${DRIVER_PREFIX}route.${name}`, JSON.stringify(slim))
  } catch { /* ignore */ }
}
export function readCachedDriverRoutes<T>(name: string): T | null {
  try { const v = localStorage.getItem(`${DRIVER_PREFIX}route.${name}`); return v ? (JSON.parse(v) as T) : null } catch { return null }
}
