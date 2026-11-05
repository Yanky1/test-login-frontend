import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Field, Skeleton } from '../components/ui'
import { Dialog } from '../components/Dialog'
import { AdminError, ROLE_LABEL, type Permission, type StaffRole } from './api'
import { useAdmin } from './AdminAuth'
import { useStaffMfaSkip } from '../lib/publicConfig'

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [n, setN] = useState(0)
  const ref = useRef(fn); ref.current = fn
  useEffect(() => {
    let alive = true
    setLoading(true)
    ref.current().then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e) => { if (alive) setError(e instanceof AdminError ? e.text : 'Something went wrong') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  const reload = useCallback(() => setN((x) => x + 1), [])
  return { data, error, loading, reload, setData }
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }) {
  return (
    <div className="adm-pagehead">
      <div><h1 tabIndex={-1} id="page-title">{title}</h1>{lead && <p className="adm-lead">{lead}</p>}</div>
      {actions && <div className="adm-actions">{actions}</div>}
    </div>
  )
}

export function Panel({ title, children, actions, id }: { title?: string; children: ReactNode; actions?: ReactNode; id?: string }) {
  const hid = useId()
  return (
    <section className="adm-panel" aria-labelledby={title ? hid : undefined} id={id}>
      {(title || actions) && <div className="adm-panelhead">{title && <h2 id={hid}>{title}</h2>}{actions}</div>}
      {children}
    </section>
  )
}

export function Loading({ lines = 4 }: { lines?: number }) { return <div aria-busy="true"><Skeleton lines={lines} /></div> }
export function ErrorNote({ error, retry }: { error: string | null; retry?: () => void }) {
  if (!error) return null
  return <div className="adm-errnote"><Alert>{error}</Alert>{retry && <Button onClick={retry}>Try again</Button>}</div>
}

const TONES: Record<string, string> = {
  Approved: 'ok', Active: 'ok', Delivered: 'ok', Actioned: 'ok', Dismissed: 'muted', Draft: 'muted', Closed: 'muted', Discarded: 'muted',
  PendingReview: 'warn', NeedsInfo: 'warn', Pending: 'warn', Retrying: 'warn', Open: 'warn',
  Rejected: 'err', Suspended: 'err', Dead: 'err', Failed: 'err',
}
const WORDS: Record<string, string> = { PendingReview: 'Pending review', NeedsInfo: 'Needs info', Dead: 'Dead-lettered', SuperAdmin: 'Super admin', ReadOnly: 'Read-only' }
export function Badge({ value, tone }: { value: string; tone?: string }) {
  return <span className={`adm-badge ${tone ?? TONES[value] ?? 'muted'}`}>{WORDS[value] ?? value}</span>
}
export const RoleBadge = ({ role }: { role: StaffRole }) => <span className="adm-badge role">{ROLE_LABEL[role]}</span>

export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'warn' | 'err' }) {
  return <div className={`adm-tile ${tone ?? ''}`}><div className="adm-tile-v">{value}</div><div className="adm-tile-l">{label}</div>{hint && <div className="adm-tile-h">{hint}</div>}</div>
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return <dl className="adm-kv">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}</dl>
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <nav className="adm-pager" aria-label="Pagination">
      <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span>Page {page} of {pages} · {total} total</span>
      <Button disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </nav>
  )
}

export function Table({ caption, head, children, empty }: { caption: string; head: string[]; children: ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.length : children ? 1 : 0
  return (
    <div className="adm-tablewrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="adm-table">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows === 0 ? <tr><td colSpan={head.length} className="adm-empty">{empty ?? 'Nothing to show.'}</td></tr> : children}</tbody>
      </table>
    </div>
  )
}

export function Can({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAdmin()
  return can(permission) ? <>{children}</> : null
}

/** Step-up re-authentication: the server asked for a recent authenticator code before a sensitive action. */
export function StepUpDialog({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { stepUp, skipStepUp } = useAdmin()
  const canSkip = useStaffMfaSkip()
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { await stepUp(code.replace(/\s/g, ''), recovery); onDone() }
    catch (x) { setErr(x instanceof AdminError ? (x.status === 401 ? 'That code isn’t right.' : x.text) : 'Something went wrong') }
    finally { setBusy(false) }
  }
  return (
    <Dialog id="stepup-title" title="Confirm it’s you" onClose={onCancel}>
      <form onSubmit={submit} noValidate>
        <p>This action needs a fresh confirmation. Enter {recovery ? 'one of your recovery codes' : 'the 6-digit code from your authenticator app'}.</p>
        <Field label={recovery ? 'Recovery code' : 'Authenticator code'} inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} data-autofocus required />
        <Alert>{err}</Alert>
        {canSkip && (
          <div className="adm-skipmfa">
            <p className="adm-muted">Test site only: this skips the code for this session. It is recorded in the audit log.</p>
            <Button type="button" onClick={async () => { setBusy(true); setErr(null); try { await skipStepUp(); onDone() } catch (x) { setErr(x instanceof AdminError ? x.text : 'Something went wrong') } finally { setBusy(false) } }}>Skip two-factor (test mode)</Button>
          </div>
        )}
        <div className="adm-dialog-actions">
          <Button type="button" variant="ghost" onClick={() => { setRecovery(!recovery); setCode('') }}>{recovery ? 'Use authenticator code' : 'Use a recovery code'}</Button>
          <Button type="button" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Confirm</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Every staff write needs a reason (5-500 characters); it is stored in the audit log. */
export function ReasonDialog({ title, lead, confirm, danger, reasonLabel = 'Reason (kept in the audit log)', extra, minLength = 5, onSubmit, onClose }: {
  title: string; lead?: ReactNode; confirm: string; danger?: boolean; reasonLabel?: string; minLength?: number
  extra?: ReactNode
  onSubmit: (reason: string) => Promise<unknown>
  onClose: () => void
}) {
  const { run } = useAdmin()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (reason.trim().length < minLength) { setErr(`Write at least ${minLength} characters.`); return }
    setBusy(true); setErr(null)
    try { await run(() => onSubmit(reason.trim())); onClose() }
    catch (x) { setErr(x instanceof AdminError ? x.text : x instanceof Error ? x.message : 'Something went wrong') }
    finally { setBusy(false) }
  }
  return (
    <Dialog id={`${id}-title`} title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {lead && <div className="adm-dialog-lead">{lead}</div>}
        {extra}
        <div className="field">
          <label htmlFor={`${id}-reason`}>{reasonLabel}</label>
          <textarea id={`${id}-reason`} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus required aria-describedby={err ? `${id}-err` : undefined} aria-invalid={err ? true : undefined} />
          <div id={`${id}-err`} className="field-error" aria-live="polite">{err}</div>
        </div>
        <div className="adm-dialog-actions">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={danger ? 'destructive' : 'primary'} loading={busy}>{confirm}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Button that opens a ReasonDialog. */
export function ReasonAction({ label, variant = 'secondary', dialog, onDone, disabled }: {
  label: string; variant?: 'primary' | 'secondary' | 'destructive' | 'ghost'; disabled?: boolean
  dialog: Omit<Parameters<typeof ReasonDialog>[0], 'onClose'>
  onDone?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant={variant} disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>
      {open && <ReasonDialog {...dialog} onSubmit={async (r) => { await dialog.onSubmit(r); onDone?.() }} onClose={() => setOpen(false)} />}
    </>
  )
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5_000)
}

/** WAI-ARIA tabs: roving tabindex, arrow/Home/End keys, and a tabpanel the tabs control. */
export function Tabs({ label, tabs, current, onSelect, children }: { label: string; tabs: readonly (readonly [string, string])[]; current: string; onSelect: (id: string) => void; children: ReactNode }) {
  const base = useId()
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex(([t]) => t === current)
    let j = i
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = tabs.length - 1
    else return
    e.preventDefault()
    onSelect(tabs[j][0]); refs.current[tabs[j][0]]?.focus()
  }
  return (
    <>
      <div className="adm-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map(([t, text]) => (
          <button key={t} ref={(el) => { refs.current[t] = el }} type="button" role="tab" id={`${base}-tab-${t}`} aria-selected={t === current} aria-controls={`${base}-panel`}
            tabIndex={t === current ? 0 : -1} className={t === current ? 'active' : ''} onClick={() => onSelect(t)}>{text}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${current}`}>{children}</div>
    </>
  )
}
