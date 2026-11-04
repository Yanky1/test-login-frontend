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
 * With nothing waiting it is a full wipe. A manual log-out the driver confirmed (after the pending-work warning) removes only THEIR data: clearDriverStorageFor().
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

// ---- one user's data on a shared device ------------------------------------------------------------------------------------------------------------
/** Kept queues and photos expire after this long without activity (a shared phone must not hold a former driver's addresses and photos forever). */
export const KEPT_MAX_AGE_DAYS = 7
const TOUCHED = DRIVER_PREFIX + 'touched.'
const EXPIRED = DRIVER_PREFIX + 'expired.'

/** The storage name (email|account) a solvelt.driver.<part>.<name> key belongs to, or null for keys without one (the cached profile). */
function nameOfKey(k: string): string | null {
  if (!k.startsWith(DRIVER_PREFIX)) return null
  const rest = k.slice(DRIVER_PREFIX.length); const dot = rest.indexOf('.')
  return dot < 0 || rest.startsWith('expired.') ? null : rest.slice(dot + 1)
}
const allKeys = (): string[] => { const out: string[] = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(DRIVER_PREFIX)) out.push(k) } } catch { /* ignore */ } return out }
const namesWhere = (f: (name: string) => boolean) => [...new Set(allKeys().map(nameOfKey).filter((n): n is string => n !== null && f(n)))]

/** Remember that this queue was last used now: the clock for the expiry above. */
export function touchDriverQueue(name: string) { try { localStorage.setItem(TOUCHED + name, String(Date.now())) } catch { /* ignore */ } }

/** Deletes photo blobs by key (IndexedDB), best effort. */
async function deleteBlobs(keys: string[]) {
  if (keys.length === 0 || typeof indexedDB === 'undefined') return
  try {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(DRIVER_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('blobs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    try { for (const k of keys) await new Promise<void>((res) => { const r = db.transaction('blobs', 'readwrite').objectStore('blobs').delete(k); r.onsuccess = () => res(); r.onerror = () => res() }) } finally { db.close() }
  } catch { /* ignore */ }
}

/** Removes everything stored for these queue names: keys, and their photos. The photo database itself is deleted only when nobody has anything left to send. */
function clearNames(names: string[]) {
  const blobKeys: string[] = []
  for (const n of names) { try { blobKeys.push(...Object.values(JSON.parse(localStorage.getItem(`${DRIVER_PREFIX}blobkeys.${n}`) ?? '{}') as Record<string, string>)) } catch { /* ignore */ } }
  for (const k of allKeys()) { const n = nameOfKey(k); if (n !== null && names.includes(n)) { try { localStorage.removeItem(k) } catch { /* ignore */ } } }
  if (!hasPendingDriverWork()) { try { if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(DRIVER_DB) } catch { /* ignore */ } }
  else void deleteBlobs(blobKeys)
}

/**
 * A manual log-out by this user: removes THEIR queues (every account), routes and photos, and the cached profile when it is theirs. Another driver's kept queue on the
 * same device is not touched, and the photo database is deleted only when nothing is waiting for anybody.
 */
export function clearDriverStorageFor(email: string) {
  clearNames(namesWhere((n) => n.startsWith(email + '|')))
  try { const c = readCachedDriverUser(); if (!c || c.email === email) localStorage.removeItem(CACHED_USER); localStorage.removeItem(EXPIRED + email) } catch { /* ignore */ }
}

/** App start: queues that have not been touched for KEPT_MAX_AGE_DAYS are removed, and the driver is told (once) on their next visit. A queue without a clock starts it now. */
export function expireDriverStorage(now = Date.now()): string[] {
  const cutoff = now - KEPT_MAX_AGE_DAYS * 86_400_000
  const expired: string[] = []
  for (const n of namesWhere(() => true)) {
    let t = NaN
    try { t = Number(localStorage.getItem(TOUCHED + n)) } catch { /* ignore */ }
    if (!t) { touchDriverQueue(n); continue }
    if (t < cutoff) expired.push(n)
  }
  for (const n of expired) {
    let count = 0
    try { count = (JSON.parse(localStorage.getItem(`${DRIVER_PREFIX}queue.${n}`) ?? '[]') as unknown[]).length } catch { /* ignore */ }
    clearNames([n])
    if (count > 0) { try { localStorage.setItem(EXPIRED + n.split('|')[0], JSON.stringify({ count, days: KEPT_MAX_AGE_DAYS })) } catch { /* ignore */ } }
  }
  return expired
}
/** The "your unsent updates were removed" notice for this user, if any. */
export function readExpiredNotice(email: string): { count: number; days: number } | null {
  try { const v = localStorage.getItem(EXPIRED + email); return v ? (JSON.parse(v) as { count: number; days: number }) : null } catch { return null }
}
export function dismissExpiredNotice(email: string) { try { localStorage.removeItem(EXPIRED + email) } catch { /* ignore */ } }

/** Queue names (email|account) of this user that still have something to send: every account counts, not only the active one. */
export function pendingDriverNamesFor(email: string): { name: string; count: number }[] {
  const out: { name: string; count: number }[] = []
  for (const k of allKeys()) {
    if (!k.startsWith(DRIVER_PREFIX + 'queue.' + email + '|')) continue
    try { const n = (JSON.parse(localStorage.getItem(k) ?? '[]') as unknown[]).length; if (n > 0) out.push({ name: k.slice((DRIVER_PREFIX + 'queue.').length), count: n }) } catch { /* ignore */ }
  }
  return out
}
export const hasPendingDriverWorkFor = (email: string) => pendingDriverNamesFor(email).length > 0

// The driver app asks "leave anyway?" for ITS queue before a log-out; the log-out then must not ask again for that same queue (but still asks for the others).
let discardConfirmed: { name: string; at: number } | null = null
export function noteDriverDiscardConfirmed(name: string) { discardConfirmed = { name, at: Date.now() } }
export function takeDriverDiscardConfirmed(): string | null { const d = discardConfirmed; discardConfirmed = null; return d && Date.now() - d.at < 10_000 ? d.name : null }

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
