import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, ApiError, type Hint, type LoginResponse } from '../api'
import { useAuth } from '../auth'
import { safeNext } from '../lib/safeNext'
import { conditionalUiAvailable, getCredential, passkeysSupported } from '../lib/passkeys'
import { Alert, Card, Field, Icon, PasswordField } from '../components/ui'
import { Turnstile } from '../components/Turnstile'
import { useGoogleEnabled, usePublicConfig } from '../lib/publicConfig'

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})
type Form = z.infer<typeof schema>

/** Live mm:ss countdown + reset CTA while the account is temporarily locked. */
function Lockout({ until }: { until: string }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000)))
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000))), 1000)
    return () => clearInterval(t)
  }, [until])
  if (left <= 0) return <p className="saved">The lock has ended. You can try signing in again.</p>
  return (
    <div className="alert info lockout">
      <Icon name="clock" /> Too many attempts. You can try again in <strong>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</strong>, or <Link to="/forgot-password">reset your password now</Link>.
    </div>
  )
}

const errorText: Record<string, string> = {
  external_failed: 'Sign-in with that provider failed. Please try again.',
  email_unverified: 'Your provider has not verified your email address, so we cannot sign you in with it.',
  terms_required: 'Please accept the Terms on the sign-up page before signing up with a provider.',
  login_failed: 'Login failed',
}

export default function LoginPage() {
  const { applyLogin, config, logoutReason, clearLogoutReason } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const pub = usePublicConfig()
  const googleOn = useGoogleEnabled()
  const siteKey = config.turnstileSiteKey ?? pub?.turnstileSiteKey ?? ''
  const { register, handleSubmit, formState: { errors, isSubmitting }, getValues } = useForm<Form>({ resolver: zodResolver(schema), mode: 'onBlur' })
  const [msg, setMsg] = useState<string | null>(null)
  const [hint, setHint] = useState<Hint | null>(null)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [needCaptcha, setNeedCaptcha] = useState(false)
  const [needTotp, setNeedTotp] = useState(false)
  const [useRecovery, setUseRecovery] = useState(false)
  const [second, setSecond] = useState('')
  const errRef = useRef<HTMLDivElement>(null)
  const idle = params.get('reason') === 'idle' || logoutReason === 'idle'
  const providerError = params.get('error')

  useEffect(() => { if (logoutReason) clearLogoutReason() }, [logoutReason, clearLogoutReason])

  const finish = (r: LoginResponse, method: 'password' | 'other') => { applyLogin(r, method); nav(next ?? '/', { replace: true }) }

  const onSubmit = async (v: Form) => {
    setMsg(null)
    try {
      const r = await api<LoginResponse>('/auth/login', {
        auth: false,
        body: { email: v.email, password: v.password, captchaToken: captcha ?? undefined, totpCode: needTotp && !useRecovery ? second : undefined, recoveryCode: needTotp && useRecovery ? second : undefined },
      })
      finish(r, 'password')
    } catch (e) {
      if (!(e instanceof ApiError)) { setMsg('Network error. Please try again.'); return }
      if (e.status === 400 && e.body?.error === 'Verification failed') { setNeedCaptcha(true); setCaptcha(null); setMsg('Please complete the verification and try again.') }
      else if (e.status === 401) {
        const h = e.body?.hint as Hint | undefined
        setHint(h ?? null)
        if (h?.captchaRequired) setNeedCaptcha(true)
        if (e.body?.twoFactorRequired) { setNeedTotp(true); setMsg('Enter the code from your authenticator app.') }
        else setMsg(e.body?.error ?? 'Login failed')
        setCaptcha(null)
      } else if (e.status === 429) setMsg('Too many attempts. Please wait a minute and try again.')
      else setMsg('Something went wrong. Please try again.')
      errRef.current?.focus()
    }
  }

  // ---- passkeys: conditional UI (autofill) + explicit button
  const abort = useRef<AbortController | null>(null)
  const passkeyLogin = async (conditional: boolean) => {
    abort.current?.abort()
    const ac = new AbortController(); abort.current = ac
    try {
      const opts = await api('/auth/passkey/options', { method: 'POST', body: {}, auth: false })
      const credential = await getCredential(opts, { conditional, signal: ac.signal })
      const r = await api<LoginResponse>('/auth/passkey/signin', { auth: false, body: { credential } })
      finish(r, 'other')
    } catch (e) {
      if (ac.signal.aborted) return
      if (!conditional) setMsg(e instanceof ApiError ? 'Login failed' : 'Passkey sign-in was cancelled or is not available.')
    }
  }
  useEffect(() => {
    let alive = true
    void conditionalUiAvailable().then((ok) => { if (ok && alive) void passkeyLogin(true) })
    return () => { alive = false; abort.current?.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const googleUrl = `/api/v1/auth/external/google/start${next ? `?returnUrl=${encodeURIComponent(next)}` : ''}`
  const appleUrl = googleUrl.replace('google', 'apple')

  return (
    <Card title="Sign in" lead="Welcome back. Use a passkey or your email to continue.">
      {idle && <Alert kind="info">You were signed out because you were inactive. Sign in to continue.</Alert>}
      {providerError && <Alert>{errorText[providerError] ?? 'Sign-in failed'}</Alert>}
      <div className="social">
        {passkeysSupported() && <button className="btn block" type="button" onClick={() => void passkeyLogin(false)}><Icon name="key" /> Sign in with a passkey</button>}
        {googleOn && <a className="btn block" href={googleUrl}><Icon name="google" /> Continue with Google</a>}
        {config.features.apple && <a className="btn block" href={appleUrl}><Icon name="apple" /> Continue with Apple</a>}
      </div>
      <div className="divider">or continue with email</div>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field label="Email" type="email" autoComplete="username webauthn" inputMode="email" error={errors.email?.message} {...register('email')} />
        <PasswordField label="Password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        {needTotp && (
          <Field label={useRecovery ? 'Recovery code' : 'Authentication code'} autoComplete="one-time-code" inputMode={useRecovery ? 'text' : 'numeric'}
            value={second} onChange={(e) => setSecond(e.target.value)} hint={<button type="button" className="btn link" onClick={() => { setUseRecovery(!useRecovery); setSecond('') }}>{useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</button>} />
        )}
        {needCaptcha && <div className="field"><Turnstile siteKey={siteKey} onToken={setCaptcha} /></div>}
        <div ref={errRef} tabIndex={-1}>
          <Alert>{msg}{hint?.message && msg !== hint.message ? ` — ${hint.message}` : ''}</Alert>
        </div>
        {hint?.lockedUntil && <Lockout until={hint.lockedUntil} />}
        <button className="btn primary block" type="submit" disabled={isSubmitting || (needCaptcha && !captcha)} aria-busy={isSubmitting || undefined}>Sign in</button>
      </form>
      <p className="links"><Link to="/forgot-password" state={{ email: getValues('email') }}>Forgot password?</Link><Link to="/signup">Create a seller account</Link><Link to="/signup/verify">Verify your email</Link></p>
    </Card>
  )
}
