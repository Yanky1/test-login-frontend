import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AdminError, adminApi, adminToken, onAdminForbidden, onAdminSessionEnded, type LoginResult, type Me, type Permission } from './api'
import { StepUpDialog } from './components'

interface Ctx {
  me: Me | null
  can: (p: Permission) => boolean
  login: (email: string, password: string, code?: { totp?: string; recovery?: string }) => Promise<void>
  logout: () => Promise<void>
  stepUp: (code: string, recovery?: boolean) => Promise<void>
  /** Runs `fn`; when the server asks for a recent step-up it opens the dialog and retries once. */
  run: <T>(fn: () => Promise<T>) => Promise<T>
  endedReason: string | null
  /** True after an explicit sign-out: the next sign-in starts at the dashboard instead of returning to the page left. */
  signedOut: boolean
  /** True in the last minute before the absolute session limit. */
  expiring: boolean
}

const AdminCtx = createContext<Ctx | null>(null)
export const useAdmin = () => { const c = useContext(AdminCtx); if (!c) throw new Error('AdminProvider missing'); return c }

export function AdminProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [endedReason, setEndedReason] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [asking, setAsking] = useState<{ resolve: () => void; reject: (e: unknown) => void } | null>(null)
  const [expiring, setExpiring] = useState(false)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback((reason: string | null) => { adminToken.set(null); setMe(null); setEndedReason(reason) }, [])
  useEffect(() => onAdminSessionEnded(() => clear('Your staff session ended. Sign in again.')), [clear])

  const logout = useCallback(async () => {
    try { await adminApi('/auth/logout', { method: 'POST' }) } catch { /* already gone */ }
    clear(null); setSignedOut(true)
  }, [clear])

  // client-side inactivity: the server enforces its own idle limit too (15 minutes by default)
  useEffect(() => {
    if (!me) return
    const bump = () => {
      if (idle.current) clearTimeout(idle.current)
      idle.current = setTimeout(() => { void logout().then(() => setEndedReason('You were signed out after a period of inactivity.')) }, Math.max(1, (me.idleMinutes || 15) - 1) * 60_000)
    }
    const evs = ['pointerdown', 'keydown', 'scroll'] as const
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    bump()
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); if (idle.current) clearTimeout(idle.current) }
  }, [me, logout])

  // Warn a minute before the absolute session limit so work is not lost mid-form.
  useEffect(() => {
    setExpiring(false)
    if (!me?.sessionExpiresAt) return
    const ms = new Date(me.sessionExpiresAt).getTime() - Date.now() - 60_000
    const t = setTimeout(() => setExpiring(true), Math.max(0, ms))
    return () => clearTimeout(t)
  }, [me?.sessionExpiresAt])

  const login: Ctx['login'] = useCallback(async (email, password, code) => {
    const r = await adminApi<LoginResult>('/auth/login', { auth: false, body: { email, password, totpCode: code?.totp, recoveryCode: code?.recovery } })
    adminToken.set(r.accessToken)
    setEndedReason(null); setSignedOut(false)
    setMe(await adminApi<Me>('/auth/me'))
  }, [])

  const refreshMe = useCallback(async () => setMe(await adminApi<Me>('/auth/me')), [])
  // A 403 that is not a step-up request usually means the role changed: re-read what this session may do.
  useEffect(() => onAdminForbidden(() => { if (adminToken.get()) void refreshMe().catch(() => undefined) }), [refreshMe])
  const stepUp: Ctx['stepUp'] = useCallback(async (code, recovery) => {
    await adminApi('/auth/step-up', { body: recovery ? { recoveryCode: code } : { code } })
    await refreshMe()
  }, [refreshMe])

  const run: Ctx['run'] = useCallback(async (fn) => {
    try { return await fn() } catch (e) {
      if (!(e instanceof AdminError) || e.code !== 'step_up_required') throw e
      await new Promise<void>((resolve, reject) => setAsking({ resolve, reject }))
      return fn()
    }
  }, [])

  const value = useMemo<Ctx>(() => ({
    me, login, logout, stepUp, run, endedReason, signedOut, expiring,
    can: (p) => !!me?.permissions.includes(p),
  }), [me, login, logout, stepUp, run, endedReason, signedOut, expiring])

  return (
    <AdminCtx.Provider value={value}>
      {children}
      {asking && <StepUpDialog onDone={() => { asking.resolve(); setAsking(null) }} onCancel={() => { asking.reject(new AdminError(0, { title: 'Confirmation cancelled' })); setAsking(null) }} />}
    </AdminCtx.Provider>
  )
}
