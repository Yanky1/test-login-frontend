import { Children, createContext, forwardRef, useContext, useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { passwordChecks } from '../lib/password'

export function Alert({ children, kind = 'error' }: { children?: ReactNode; kind?: 'error' | 'info' | 'success' }) {
  // always rendered so screen readers announce changes (aria-live)
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} aria-live={kind === 'error' ? 'assertive' : 'polite'} className={Children.toArray(children).some((c) => c !== '') ? `alert ${kind}` : 'sr-only'}>
      {children}
    </div>
  )
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: ReactNode
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, error, hint, id, ...rest }, ref) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <input ref={ref} id={fid} aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined} {...rest} />
      {hint && !error && <div id={`${fid}-hint`} className="hint">{hint}</div>}
      <div id={`${fid}-err`} className="field-error" aria-live="polite">{error}</div>
    </div>
  )
})

export const PasswordField = forwardRef<HTMLInputElement, FieldProps>(function PasswordField({ label, error, hint, id, ...rest }, ref) {
  const auto = useId()
  const fid = id ?? auto
  const [show, setShow] = useState(false)
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <div className="pw">
        <input ref={ref} id={fid} type={show ? 'text' : 'password'} aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined} {...rest} />
        <button type="button" className="btn link" aria-pressed={show} aria-controls={fid} onClick={() => setShow((s) => !s)}>
          {show ? 'Hide' : 'Show'}<span className="sr-only"> password</span>
        </button>
      </div>
      {hint && !error && <div id={`${fid}-hint`} className="hint">{hint}</div>}
      <div id={`${fid}-err`} className="field-error" aria-live="polite">{error}</div>
    </div>
  )
})

export function Spinner() { return <span className="spinner" role="status" aria-label="Loading" /> }

/* ---- icons (inline SVG, lucide-style paths; decorative unless labelled) ---- */
const PATHS = {
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4',
  key: 'M15 7a4 4 0 11-3.9 4.9L4 19v2h3v-2h2v-2h2l1.9-1.9A4 4 0 0115 7zM16 9h.01',
  google: 'M21 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h5a4.3 4.3 0 01-1.9 2.8v2.3h3A9 9 0 0021 12.2zM12 21c2.5 0 4.6-.8 6.1-2.2l-3-2.3c-.8.6-1.8.9-3.1.9a5.4 5.4 0 01-5.1-3.7H3.8v2.4A9 9 0 0012 21zM6.9 13.7a5.4 5.4 0 010-3.4V7.9H3.8a9 9 0 000 8.2l3.1-2.4zM12 6.6c1.4 0 2.6.5 3.6 1.4l2.7-2.7A9 9 0 003.8 7.9l3.1 2.4C7.6 8.1 9.6 6.6 12 6.6z',
  apple: 'M16 3c0 1.4-1 3-2.5 3.4C13.300 4.900 14.500 3.300 16 3zM12 7c1-.6 2.600-.8 4 .2-1.800 1-2 3.800.2 5-.6 1.500-1.300 3-2.600 4.200-1 .9-1.700.6-2.600.3-1-.4-1.800-.3-2.800.1-1 .3-1.600-.1-2.500-1.100C5.200 13.700 4.700 9.500 7 7.500c1-.9 3-1.200 5-.5z',
  mail: 'M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm0 1l8 6 8-6',
  check: 'M5 12l5 5L20 7',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400',
  moon: 'M21 13A9 9 0 1111 3a7 7 0 0010 10z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
  store: 'M3 9l1.5-5h15L21 9M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0M5 12v8h14v-8M10 20v-5h4v5',
  wallet: 'M3 7a2 2 0 012-2h13v4M3 7v11a2 2 0 002 2h15V9H5a2 2 0 01-2-2zM16 14.5h.01',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.100a4 4 0 010 7.800M22 21v-1a6 6 0 00-4-5.600',
  star: 'M12 3l2.800 5.700 6.200.9-4.500 4.400 1 6.200L12 17.200 6.500 20.200l1-6.200L3 9.600l6.200-.9z',
  laptop: 'M4 5h16v11H4zM2 19h20',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21v-1a8 8 0 0116 0v1',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  phone: 'M8 2h8a1 1 0 011 1v18a1 1 0 01-1 1H8a1 1 0 01-1-1V3a1 1 0 011-1zM11 18h2',
} as const
export type IconName = keyof typeof PATHS
export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}

/* ---- theme (system by default, manual override persisted) ---- */
const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
function savedTheme(): 'light' | 'dark' | null {
  try { const t = localStorage.getItem('solvelt-theme'); return t === 'light' || t === 'dark' ? t : null } catch { return null }
}
export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    const t = document.documentElement.dataset.theme ?? savedTheme()
    return t ? t === 'dark' : systemDark()
  })
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  const flip = () => {
    const next = !dark
    setDark(next)
    try { localStorage.setItem('solvelt-theme', next ? 'dark' : 'light') } catch { /* private mode */ }
  }
  return (
    <button type="button" className="btn link theme-toggle" onClick={flip} aria-pressed={dark} aria-label="Dark mode">
      <Icon name={dark ? 'moon' : 'sun'} />
    </button>
  )
}

export function Logo() {
  return <Link to="/" className="logo" aria-label="Solvelt home"><span className="logo-mark"><Icon name="shield" /></span><span>Solvelt</span></Link>
}

/** True inside the signed-in layout, which renders its own header (so Shell must not add a second logo + theme toggle). */
export const AppHeaderContext = createContext(false)

/** Page shell: brand panel (desktop, auth screens) + top bar with theme toggle. */
export function Shell({ children, split }: { children: ReactNode; split?: boolean }) {
  const { pathname } = useLocation()
  const hasAppHeader = useContext(AppHeaderContext)
  const cross = !split ? null : pathname.startsWith('/signup') ? { q: 'Already selling?', to: '/login', t: 'Sign in' } : pathname === '/login' ? { q: 'New to Solvelt?', to: '/signup', t: 'Start selling' } : null
  return (
    <div className={split ? 'shell split' : 'shell'}>
      {split && (
        <aside className="shell-brand" aria-hidden="true">
          <span className="logo"><span className="logo-mark"><Icon name="shield" /></span><span>Solvelt</span></span>
          <div className="brand-copy">
            <span className="brand-eyebrow">Solvelt for sellers</span>
            <h2>Open your shop. Reach more buyers.</h2>
            <p>Join the marketplace built for the community: list your products, get approved fast and get paid securely.</p>
            <div className="shop-mock">
              <div className="shop-bar"><Icon name="store" /> <b>Your storefront</b><span className="pill">Live</span></div>
              <div className="shop-grid">
                {['t1', 't2', 't3', 't4', 't5', 't6'].map((t) => <div key={t} className={`tile ${t}`}><i /><span /></div>)}
              </div>
            </div>
            <ul className="brand-points">
              <li><span className="bp-ic"><Icon name="store" /></span><span><b>List in minutes</b><br />Set up your storefront and add products as soon as you are approved.</span></li>
              <li><span className="bp-ic"><Icon name="wallet" /></span><span><b>Secure payouts</b><br />Clear fees, protected payments and reliable payouts.</span></li>
              <li><span className="bp-ic"><Icon name="users" /></span><span><b>A community of buyers</b><br />Get discovered by shoppers who already trust the marketplace.</span></li>
            </ul>
          </div>
          <div className="brand-foot"><span><Icon name="lock" /> Secured sign-in with passkeys and 2-step verification</span><span>© Solvelt</span></div>
        </aside>
      )}
      <div className="shell-main">
        {!hasAppHeader && <div className="topbar">{split ? <span className="logo-mini-spacer" /> : null}<Logo /><span className="spacer" />{cross && <span className="topbar-cross"><span className="topbar-q">{cross.q}</span> <Link className="btn topbar-cta" to={cross.to}>{cross.t}</Link></span>}<ThemeToggle /></div>}
        <div className="shell-content">{children}</div>
      </div>
    </div>
  )
}

export function Button({ variant = 'secondary', loading, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'; loading?: boolean }) {
  const cls = { primary: 'btn primary', secondary: 'btn', ghost: 'btn link', destructive: 'btn danger' }[variant]
  return <button {...rest} className={`${cls} ${rest.className ?? ''}`.trim()} aria-busy={loading || undefined} disabled={rest.disabled || loading}>{children}</button>
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div aria-hidden="true">{Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />)}</div>
}

/** Visual strength meter + the checklist (the checklist stays the accessible source of truth). */
export function StrengthMeter({ value }: { value: string }) {
  const done = passwordChecks(value).filter((c) => c.ok).length
  const total = passwordChecks('').length
  const level = !value ? 0 : Math.max(1, Math.round((done / total) * 4))
  return <div className="meter" data-level={level} aria-hidden="true"><i /><i /><i /><i /></div>
}

/** Six-cell one-time-code input: ONE real input (paste, autofill and SMS-fill just work) with a visual cell overlay. */
export const OtpInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { label: string; value: string; onChange: (v: string) => void; error?: string }>(
  function OtpInput({ label, value, onChange, error, id, ...rest }, ref) {
    const auto = useId(); const fid = id ?? auto
    return (
      <div className="field">
        <label htmlFor={fid}>{label}</label>
        <div className="otp">
          <input ref={ref} id={fid} autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="[0-9]*" value={value}
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-err` : undefined}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} {...rest} />
          <div className="otp-cells" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => <span key={i} className={i === Math.min(value.length, 5) ? 'on' : ''}>{value[i] ?? ''}</span>)}
          </div>
        </div>
        <div id={`${fid}-err`} className="field-error" aria-live="polite">{error}</div>
      </div>
    )
  },
)

export function Card({ title, children, wide, lead }: { title: string; children: ReactNode; wide?: boolean; lead?: string }) {
  return (
    <Shell split={!wide}>
      <main className={wide ? 'card wide' : 'card'}>
        <h1 tabIndex={-1} id="page-title">{title}</h1>
        {lead && <p className="card-lead">{lead}</p>}
        {children}
      </main>
    </Shell>
  )
}

/** A titled settings card: icon, heading (the accessible name), description and an optional status chip. */
export function SettingCard({ id, icon, title, desc, badge, children }: { id: string; icon: IconName; title: string; desc?: string; badge?: { text: string; tone?: 'ok' | 'muted' }; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="set-card">
      <header className="set-head">
        <span className="set-ic"><Icon name={icon} /></span>
        <div className="set-title"><h2 id={id}>{title}</h2>{desc && <p className="set-desc">{desc}</p>}</div>
        {badge && <span className={`chip ${badge.tone ?? 'muted'}`}>{badge.text}</span>}
      </header>
      <div className="set-body">{children}</div>
    </section>
  )
}
