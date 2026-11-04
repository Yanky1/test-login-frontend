import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, onAccountLost, onSessionEnded, refreshSession, refreshUnreachable, tokenStore, type AccountItem, type LoginResponse, type Role } from './api'
import { loadConfig, defaultConfig, type RuntimeConfig } from './config'
import { crossTab } from './lib/crossTab'
import { canLeave, LeaveRefused } from './lib/unsaved'
import { clearDrafts } from './lib/drafts'
import { cacheDriverUser, clearDriverStorageFor, endDriverSession, expireDriverStorage, pendingDriverNamesFor, readCachedDriverUser, takeDriverDiscardConfirmed } from './delivery/storage'

export interface User {
  email: string; sellerId: string; vendorName: string; accountStatus: string; roles: string[]
  /** The account this session acts on (null: none selected yet). */
  activeAccountId: string | null
  /** null only when talking to a server without multi-account support (then no account gate is shown). */
  accounts: AccountItem[] | null
  role: Role | null
}
interface AccountsInfo { activeAccountId: string | null; vendorName: string; accountStatus: string | null; role: Role | null; accounts: AccountItem[] }
type Status = 'loading' | 'authed' | 'anon'

interface AuthCtx {
  status: Status
  user: User | null
  config: RuntimeConfig
  /** Store a successful login/signup/exchange/refresh response. */
  applyLogin: (r: LoginResponse, method?: 'password' | 'other') => void
  setAccessToken: (t: string, patch?: Partial<User>) => void
  /** Make another account the active one (server validates the membership and issues a new access token). */
  switchAccount: (sellerId: string) => Promise<void>
  /** Re-read the account list / active account from the server. */
  refreshAccounts: () => Promise<void>
  logout: (reason?: 'idle' | 'manual') => Promise<void>
  logoutReason: string | null
  clearLogoutReason: () => void
}

const Ctx = createContext<AuthCtx | null>(null)
export const useAuth = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('AuthProvider missing')
  return c
}

const toUser = (r: LoginResponse): User => {
  const accounts = r.accounts ?? null
  const active = r.activeAccountId ?? null
  return {
    email: r.email, sellerId: r.sellerId, vendorName: r.vendorName, accountStatus: r.accountStatus, roles: r.roles,
    activeAccountId: active, accounts, role: accounts?.find((a) => a.sellerId === active)?.role ?? null,
  }
}
const withInfo = (u: User, i: AccountsInfo): User => ({
  ...u, activeAccountId: i.activeAccountId, accounts: i.accounts, role: i.role, sellerId: i.activeAccountId ?? '', vendorName: i.vendorName ?? '',
})

export function AuthProvider({ children, initialConfig }: { children: ReactNode; initialConfig?: RuntimeConfig }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<User | null>(null)
  const userRef = useRef<User | null>(null)       // the log-out paths below run from effects/callbacks created once: they need the CURRENT user
  userRef.current = user
  const [config, setConfig] = useState<RuntimeConfig>(initialConfig ?? defaultConfig)
  const [logoutReason, setLogoutReason] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      expireDriverStorage()      // kept queues and photos of former drivers on this device expire after a week
      const cfg = initialConfig ?? (await loadConfig())
      if (!alive) return
      setConfig(cfg)
      // Restore the session after a reload: the access token is memory-only, the refresh cookie is not readable by JS.
      const r = await refreshSession()
      if (!alive) return
      if (r) { setUser(toUser(r)); setStatus('authed') }
      else if (refreshUnreachable() && readCachedDriverUser()) { setUser(readCachedDriverUser()); setStatus('authed') }   // offline reload of the driver app: keep working from the queue and the cached route
      else setStatus('anon')
    })()
    return () => { alive = false }
  }, [initialConfig])

  useEffect(() => onSessionEnded(() => { tokenStore.set(null); clearDrafts(); endDriverSession(); setUser(null); setStatus('anon') }), [])    // a session that simply ended must not eat unsent deliveries

  // Another tab logged out (manually or by inactivity): follow it without calling the API again.
  useEffect(() => crossTab().subscribe((m) => {
    if (m.type !== 'logout') return
    tokenStore.set(null); clearDrafts()
    // a manual log-out in the other tab was confirmed there, but only for THIS user's data: another driver's kept queue on the device stays
    if (m.reason === 'idle' || !userRef.current) endDriverSession(); else clearDriverStorageFor(userRef.current.email)
    setUser(null); setStatus('anon')
    setLogoutReason(m.reason === 'idle' ? 'idle' : null)
  }), [])

  const applyLogin = useCallback((r: LoginResponse, method: 'password' | 'other' = 'other') => {
    tokenStore.set(r.accessToken)
    setUser(toUser(r)); setStatus('authed')
    try { if (method === 'password') sessionStorage.setItem('offerPasskey', '1') } catch { /* ignore */ }
  }, [])

  const setAccessToken = useCallback((t: string, patch?: Partial<User>) => {
    tokenStore.set(t)
    if (patch) setUser((u) => (u ? { ...u, ...patch } : u))
  }, [])

  const refreshAccounts = useCallback(async () => {
    try {
      const info = await api<AccountsInfo>('/session')
      setUser((u) => (u ? withInfo(u, info) : u))
    } catch { /* a 401 ends the session through the normal path */ }
  }, [])

  const switchAccount = useCallback(async (sellerId: string) => {
    if (!(await canLeave())) throw new LeaveRefused() // unsaved edits on the page: the user decides first
    const r = await api<{ accessToken: string; body: AccountsInfo }>('/session/account', { body: { sellerId } })
    tokenStore.set(r.accessToken)
    setUser((u) => (u ? withInfo(u, r.body) : u))
  }, [])

  useEffect(() => onAccountLost(() => { void refreshAccounts() }), [refreshAccounts])

  const logout = useCallback(async (reason: 'idle' | 'manual' = 'manual') => {
    if (reason === 'manual') takeDriverDiscardConfirmed()      // forget any older "leave anyway" (an account switch): only a confirm given by THIS log-out's own canLeave() counts
    if (reason === 'manual' && !(await canLeave())) return // idle/cross-tab logouts are never blocked
    if (reason === 'manual' && userRef.current) {
      // unsent driver deliveries of THIS user (any account) are discarded by a manual log-out, whichever page they log out from: ask first (the driver app already asked about its own queue)
      const asked = takeDriverDiscardConfirmed()
      const left = pendingDriverNamesFor(userRef.current.email).filter((q) => q.name !== asked)
      const n = left.reduce((a, q) => a + q.count, 0)
      if (n > 0 && !window.confirm(`${n} delivery update${n > 1 ? 's' : ''} saved on this phone ${n > 1 ? 'have' : 'has'} not been sent yet. If you log out now ${n > 1 ? 'they are' : 'it is'} lost. Log out anyway?`)) return
    }
    try { await api('/auth/logout', { method: 'POST', auth: false }) } catch { /* server session is revoked best-effort */ }
    tokenStore.set(null); clearDrafts()
    // idle skips the confirmation (canLeave), so it keeps the unsent queue; a confirmed manual log-out removes THIS user's data only (never another driver's kept queue)
    if (reason === 'idle' || !userRef.current) endDriverSession(); else clearDriverStorageFor(userRef.current.email)
    setUser(null); setStatus('anon')
    setLogoutReason(reason === 'idle' ? 'idle' : null)
    try { sessionStorage.removeItem('offerPasskey') } catch { /* ignore */ }
    crossTab().post({ type: 'logout', reason })
  }, [])

  // a driver's profile is cached (no token) so an offline reload of /driver still opens the app; back online, the session is picked up again
  useEffect(() => { if (user?.role === 'Driver') cacheDriverUser(user) }, [user])
  useEffect(() => {
    const on = () => { if (status === 'authed' && !tokenStore.get()) void refreshSession().then((r) => { if (r) { setUser(toUser(r)); void refreshAccounts() } }) }
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [status, refreshAccounts])

  const value = useMemo<AuthCtx>(() => ({
    status, user, config, applyLogin, setAccessToken, switchAccount, refreshAccounts, logout, logoutReason, clearLogoutReason: () => setLogoutReason(null),
  }), [status, user, config, applyLogin, setAccessToken, switchAccount, refreshAccounts, logout, logoutReason])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
