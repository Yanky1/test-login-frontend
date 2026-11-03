export interface LoginResponse {
  tokenType: string
  accessToken: string
  expiresIn: number
  refreshToken: string
  sellerId: string
  email: string
  vendorName: string
  accountStatus: string
  roles: string[]
}

export interface Hint {
  attemptsRemaining: number | null
  lastTry: boolean
  captchaRequired: boolean
  lockedUntil: string | null
  message: string | null
}

export class ApiError extends Error {
  status: number
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any
  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`)
    this.status = status
    this.body = body
  }
  /** First ProblemDetails validation message for a field, or the title. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    const e = this.body?.errors
    if (e && typeof e === 'object') for (const [k, v] of Object.entries(e)) out[k] = (v as string[]).join(' ')
    return out
  }
  get message2(): string {
    return (this.body?.detail ?? this.body?.title) ?? this.body?.error ?? 'Something went wrong'
  }
}

// ---- access token lives in memory only (never localStorage/sessionStorage)
let accessToken: string | null = null
export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => { accessToken = t },
}

type Listener = () => void
const sessionEndedListeners = new Set<Listener>()
export const onSessionEnded = (l: Listener) => { sessionEndedListeners.add(l); return () => { sessionEndedListeners.delete(l) } }

function csrfToken(): string {
  const m = document.cookie.split('; ').find((c) => c.startsWith('sl_csrf='))
  return m ? decodeURIComponent(m.slice('sl_csrf='.length)) : ''
}

let refreshing: Promise<LoginResponse | null> | null = null

/** Single-flight refresh using the HttpOnly cookie (+ CSRF header). Returns null when the session is gone. */
export function refreshSession(): Promise<LoginResponse | null> {
  if (!refreshing) {
    const run = async (): Promise<LoginResponse | null> => {
      try {
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
          body: '{}',
        })
        if (!res.ok) { tokenStore.set(null); return null }
        const body = (await res.json()) as LoginResponse
        tokenStore.set(body.accessToken)
        return body
      } catch {
        return null
      }
    }
    // One refresh at a time across ALL tabs (they share the rotating refresh cookie); single-flight within the tab as before.
    const locks = (navigator as Navigator & { locks?: LockManager }).locks
    refreshing = (locks ? locks.request('solvelt-refresh', run) : run()).finally(() => { refreshing = null })
  }
  return refreshing
}

interface Opts { method?: string; body?: unknown; form?: FormData; auth?: boolean; retry?: boolean }

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const { method = opts.body !== undefined || opts.form ? 'POST' : 'GET', auth = true, retry = true } = opts
  const headers: Record<string, string> = {}
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (path.startsWith('/auth/logout')) headers['X-CSRF-Token'] = csrfToken()
  const res = await fetch('/api/v1' + path, {
    method, headers, credentials: 'same-origin',
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  })
  if (res.status === 401 && auth && retry) {
    const renewed = await refreshSession()
    if (renewed) return api<T>(path, { ...opts, retry: false })
    sessionEndedListeners.forEach((l) => l())
  }
  const text = await res.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) throw new ApiError(res.status, body)
  return body as T
}
