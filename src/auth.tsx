import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, onSessionEnded, refreshSession, tokenStore, type LoginResponse } from './api'
import { loadConfig, defaultConfig, type RuntimeConfig } from './config'

export interface User { email: string; sellerId: string; vendorName: string; accountStatus: string; roles: string[] }
type Status = 'loading' | 'authed' | 'anon'

interface AuthCtx {
  status: Status
  user: User | null
  config: RuntimeConfig
  /** Store a successful login/signup/exchange/refresh response. */
  applyLogin: (r: LoginResponse, method?: 'password' | 'other') => void
  setAccessToken: (t: string, patch?: Partial<User>) => void
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

const toUser = (r: LoginResponse): User => ({ email: r.email, sellerId: r.sellerId, vendorName: r.vendorName, accountStatus: r.accountStatus, roles: r.roles })

export function AuthProvider({ children, initialConfig }: { children: ReactNode; initialConfig?: RuntimeConfig }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [config, setConfig] = useState<RuntimeConfig>(initialConfig ?? defaultConfig)
  const [logoutReason, setLogoutReason] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const cfg = initialConfig ?? (await loadConfig())
      if (!alive) return
      setConfig(cfg)
      // Restore the session after a reload: the access token is memory-only, the refresh cookie is not readable by JS.
      const r = await refreshSession()
      if (!alive) return
      if (r) { setUser(toUser(r)); setStatus('authed') } else setStatus('anon')
    })()
    return () => { alive = false }
  }, [initialConfig])

  useEffect(() => onSessionEnded(() => { tokenStore.set(null); setUser(null); setStatus('anon') }), [])

  const applyLogin = useCallback((r: LoginResponse, method: 'password' | 'other' = 'other') => {
    tokenStore.set(r.accessToken)
    setUser(toUser(r)); setStatus('authed')
    try { if (method === 'password') sessionStorage.setItem('offerPasskey', '1') } catch { /* ignore */ }
  }, [])

  const setAccessToken = useCallback((t: string, patch?: Partial<User>) => {
    tokenStore.set(t)
    if (patch) setUser((u) => (u ? { ...u, ...patch } : u))
  }, [])

  const logout = useCallback(async (reason: 'idle' | 'manual' = 'manual') => {
    try { await api('/auth/logout', { method: 'POST', auth: false }) } catch { /* server session is revoked best-effort */ }
    tokenStore.set(null)
    setUser(null); setStatus('anon')
    setLogoutReason(reason === 'idle' ? 'idle' : null)
    try { sessionStorage.removeItem('offerPasskey') } catch { /* ignore */ }
  }, [])

  const value = useMemo<AuthCtx>(() => ({
    status, user, config, applyLogin, setAccessToken, logout, logoutReason, clearLogoutReason: () => setLogoutReason(null),
  }), [status, user, config, applyLogin, setAccessToken, logout, logoutReason])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
