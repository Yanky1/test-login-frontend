import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { refreshSession } from '../api'
import { useAuth } from '../auth'

const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

/**
 * Inactivity logout + activity-gated background refresh.
 * - warning appears `warningSeconds` before the idle timeout, with a live mm:ss countdown
 * - the access token is refreshed in the background ONLY if the user was active since the last refresh
 */
export function IdleGuard() {
  const { config, logout } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const idleMs = config.idleTimeoutMinutes * 60_000
  const warnMs = Math.min(config.warningSeconds * 1000, idleMs)
  const refreshMs = config.refreshIntervalMinutes * 60_000
  const lastActivity = useRef(Date.now())
  const lastRefresh = useRef(Date.now())
  const [remaining, setRemaining] = useState<number | null>(null) // seconds, only while warning is shown
  const warning = useRef(false)
  const here = useRef(loc.pathname + loc.search)
  here.current = loc.pathname + loc.search

  const signOut = useCallback(async () => {
    const next = here.current
    await logout('idle')
    nav(`/login?reason=idle&next=${encodeURIComponent(next)}`, { replace: true })
  }, [logout, nav])

  const stay = useCallback(() => {
    lastActivity.current = Date.now()
    warning.current = false
    setRemaining(null)
    lastRefresh.current = Date.now()
    void refreshSession()
  }, [])

  useEffect(() => {
    const onActivity = () => { if (!warning.current) lastActivity.current = Date.now() }
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    const tick = setInterval(() => {
      const now = Date.now()
      const idle = now - lastActivity.current
      if (idle >= idleMs) { clearInterval(tick); void signOut(); return }
      if (idle >= idleMs - warnMs) {
        warning.current = true
        setRemaining(Math.max(0, Math.ceil((idleMs - idle) / 1000)))
        return
      }
      // background refresh: only while active (activity since the last refresh)
      if (now - lastRefresh.current >= refreshMs) {
        if (lastActivity.current > lastRefresh.current) { lastRefresh.current = now; void refreshSession() }
        else lastRefresh.current = now - refreshMs + 1000 // idle: don't refresh, re-check shortly
      }
    }, 1000)
    return () => { clearInterval(tick); EVENTS.forEach((e) => window.removeEventListener(e, onActivity)) }
  }, [idleMs, warnMs, refreshMs, signOut])

  if (remaining === null) return null
  return (
    <div className="modal-backdrop">
      <div role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-desc" className="modal">
        <h2 id="idle-title">Are you still there?</h2>
        <p id="idle-desc" aria-live="polite" role="timer">You will be logged out in {fmt(remaining)}</p>
        <div className="row">
          <button className="btn primary" autoFocus onClick={stay}>Stay signed in</button>
          <button className="btn" onClick={() => void signOut()}>Log out</button>
        </div>
      </div>
    </div>
  )
}
