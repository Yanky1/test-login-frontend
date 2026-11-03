import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth'
import { Icon } from '../../components/ui'
import { RoleBadge } from './parts'

/** Header control: current account + role; switch to another; create a new seller account. */
export function AccountSwitcher() {
  const { user, switchAccount } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [open])
  if (!user?.accounts) return null
  const current = user.accounts.find((a) => a.sellerId === user.activeAccountId)
  const go = async (id: string) => {
    setErr(null)
    try { await switchAccount(id); setOpen(false); nav('/', { replace: true }) } catch { setErr('Could not switch accounts. Try again.') }
  }
  return (
    <div className="switcher" ref={root}>
      <button type="button" className="btn switch-btn" aria-expanded={open} aria-controls="acct-menu" onClick={() => setOpen((o) => !o)}>
        <Icon name="store" />
        <span className="switch-name">{current?.vendorName || (current ? 'New seller account' : 'Choose account')}</span>
        {current && <RoleBadge role={current.role} />}
      </button>
      {open && (
        <div id="acct-menu" className="switch-menu" role="group" aria-label="Switch account">
          <ul className="list">
            {user.accounts.map((a) => (
              <li key={a.sellerId}>
                <button type="button" className="btn link switch-item" aria-current={a.sellerId === user.activeAccountId ? 'true' : undefined} onClick={() => void go(a.sellerId)}>
                  <span className="switch-name">{a.vendorName || 'New seller account'}</span><RoleBadge role={a.role} />
                  {a.sellerId === user.activeAccountId && <Icon name="check" label="Current account" />}
                </button>
              </li>
            ))}
          </ul>
          {err && <div className="field-error">{err}</div>}
          <Link className="btn link" to="/accounts?new=1" onClick={() => setOpen(false)}>Create a new seller account</Link>
          <Link className="btn link" to="/accounts" onClick={() => setOpen(false)}>All accounts and invitations</Link>
        </div>
      )}
    </div>
  )
}
