/** Staff admin API client. The staff token is kept in memory only and is NEVER shared with the seller session (separate store, no refresh cookie). */
export class AdminError extends Error {
  status: number
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any
  constructor(status: number, body: unknown) { super(`HTTP ${status}`); this.status = status; this.body = body }
  get code(): string | undefined { return this.body?.code }
  /** Plain-language message from the server's problem details. */
  get text(): string {
    const errs = this.body?.errors
    if (errs && typeof errs === 'object' && !Array.isArray(errs)) {
      const first = Object.values(errs).flat()[0]
      if (typeof first === 'string') return first
    }
    return this.body?.title ?? this.body?.error ?? 'Something went wrong'
  }
}

let token: string | null = null
export const adminToken = { get: () => token, set: (t: string | null) => { token = t } }

const endedListeners = new Set<() => void>()
export const onAdminSessionEnded = (l: () => void) => { endedListeners.add(l); return () => { endedListeners.delete(l) } }

const forbiddenListeners = new Set<() => void>()
export const onAdminForbidden = (l: () => void) => { forbiddenListeners.add(l); return () => { forbiddenListeners.delete(l) } }

interface Opts { method?: string; body?: unknown; auth?: boolean }

async function send(path: string, opts: Opts): Promise<Response> {
  const { method = opts.body !== undefined ? 'POST' : 'GET', auth = true } = opts
  const headers: Record<string, string> = {}
  if (auth && token) headers.Authorization = `Bearer ${token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch('/api/v1/admin' + path, { method, headers, credentials: 'omit', body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
  if (res.status === 401 && auth && token) {
    // A wrong authenticator code at step-up is a 401 too, but the session is fine: only a real expiry ends it.
    const code = await res.clone().json().then((b: { code?: string }) => b?.code, () => undefined)
    if (code !== 'step_up_failed') { token = null; endedListeners.forEach((l) => l()) }
  }
  if (res.status === 403 && auth && token && path !== '/auth/me') {
    const code = await res.clone().json().then((b: { code?: string }) => b?.code, () => undefined)
    if (code !== 'step_up_required') forbiddenListeners.forEach((l) => l())
  }
  return res
}

export async function adminApi<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const res = await send(path, opts)
  const text = await res.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) throw new AdminError(res.status, body)
  return body as T
}

/** Authenticated download (CSV export, certificate): returns the blob, never a URL with a token in it. */
export async function adminBlob(path: string): Promise<{ blob: Blob; type: string }> {
  const res = await send(path, {})
  if (!res.ok) throw new AdminError(res.status, await res.json().catch(() => null))
  return { blob: await res.blob(), type: res.headers.get('Content-Type') ?? '' }
}

export type StaffRole = 'SuperAdmin' | 'Support' | 'Moderator' | 'ReadOnly'
export const ROLE_LABEL: Record<StaffRole, string> = { SuperAdmin: 'Super admin', Support: 'Support', Moderator: 'Moderator', ReadOnly: 'Read-only' }
export const STAFF_ROLES: StaffRole[] = ['SuperAdmin', 'Support', 'Moderator', 'ReadOnly']

export type Permission =
  | 'DashboardView' | 'ApplicationsView' | 'ApplicationsDecide' | 'ApplicationsAssign'
  | 'SellersView' | 'SellersSuspend' | 'SellersClose' | 'SellersResendVerification' | 'SellersTransferOwnership'
  | 'UsersView' | 'UsersAct' | 'UsersDisable2fa' | 'ModerationView' | 'ModerationAct' | 'LookupsView' | 'LookupsReveal'
  | 'IntegrationsView' | 'IntegrationsAct' | 'IntegrationsDiscard' | 'AuditView' | 'AuditExport' | 'SettingsView' | 'SettingsEdit' | 'StaffView' | 'StaffManage'
  | 'PaymentsView' | 'PaymentsHold' | 'PaymentsRetry' | 'PaymentsAdjust' | 'DeliveryView' | 'ShippingView' | 'ShippingRetry'

export interface Me {
  userId: string; email: string; role: StaffRole; permissions: Permission[]
  sessionExpiresAt: string | null; idleMinutes: number; stepUpUntil: string | null
}
export interface LoginResult { accessToken: string; expiresIn: number; email: string; role: StaffRole; permissions: Permission[] }
export interface Page<T> { total: number; page: number; pageSize: number; items: T[] }

export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')
export const fmtMoney = (cents?: number | null, cur = 'USD') => (cents == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(cents / 100))
