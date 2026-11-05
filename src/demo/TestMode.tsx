import { useState } from 'react'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { Dialog } from '../products/ui'
import { demoApi } from './api'
import { useAuth } from '../auth'
import { useDemoEnabled } from '../lib/publicConfig'
import './demo.css'

/** Topbar badge: shown to everyone while the backend runs with Demo:Enabled. */
export function TestModeBadge() {
  const on = useDemoEnabled()
  return on ? <span className="chip test-mode" title="This server is in test mode: demo tools are available">TEST MODE</span> : null
}

/** Demo tools are for the Owner of an account, and only when the server says demo mode is on. */
export function useDemoTools() {
  const enabled = useDemoEnabled()
  const { user } = useAuth()
  return enabled && user?.role === 'Owner'
}

/** Confirm, then act: shared by approve and remove. Errors stay in the dialog. */
export function ConfirmAction({ title, confirm, destructive, onClose, onConfirm, children }: { title: string; confirm: string; destructive?: boolean; onClose: () => void; onConfirm: () => Promise<void>; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  return (
    <Dialog title={title} onClose={onClose}>
      <div>{children}</div>
      <Alert>{error}</Alert>
      <div className="actions dlg-actions">
        <Button variant={destructive ? 'destructive' : 'primary'} loading={busy} onClick={async () => { setBusy(true); setError(''); try { await onConfirm() } catch (e) { setError(describe(e)) } finally { setBusy(false) } }}>{confirm}</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  )
}

export function describe(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Too many tries. Please wait a while and try again (the limit is 5 per hour).'
    if (e.status === 403) return 'Only the account Owner can do this.'
    if (e.code === 'demo_data_exists') return 'This account already has demo data. Remove it first to start again.'
    if (e.code === 'not_pending') return 'This account is not waiting for approval.'
    return e.message2
  }
  return 'Something went wrong. Please try again.'
}

/** "Approve this account (test mode)": a button plus its confirm dialog. Calls `onApproved` once the server said yes. */
export function ApproveAccountButton({ onApproved, variant = 'primary' }: { onApproved: () => void | Promise<void>; variant?: 'primary' | 'secondary' }) {
  const [open, setOpen] = useState(false)
  const { refreshAccounts } = useAuth()
  const approve = async () => {
    try { await demoApi.approve() } catch (e) { if (!(e instanceof ApiError && e.code === 'already_approved')) throw e }
    await refreshAccounts()
    setOpen(false)
    await onApproved()
  }
  return (
    <>
      <Button variant={variant} type="button" onClick={() => setOpen(true)}>Approve this account (test mode)</Button>
      {open && <ConfirmAction title="Approve this account?" confirm="Yes, approve it" onClose={() => setOpen(false)} onConfirm={approve}>
        <p>This is a test tool. It skips the staff review and opens your shop right away. It is only available while the server is in test mode.</p>
      </ConfirmAction>}
    </>
  )
}
