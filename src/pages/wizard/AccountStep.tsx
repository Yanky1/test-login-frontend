import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, ApiError } from '../../api'
import { rememberPendingEmail } from './pending'
import { useAuth } from '../../auth'
import { suggestEmail } from '../../lib/emailTypo'
import { passwordChecks, passwordValid } from '../../lib/password'
import { createCredential, passkeysSupported } from '../../lib/passkeys'
import { Alert, Field, PasswordField } from '../../components/ui'
import { StepFrame } from './shared'

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email address').max(254),
  password: z.string().refine(passwordValid, 'Password does not meet the requirements'),
  confirm: z.string().min(1, 'Confirm your password'),
  terms: z.boolean().refine((v) => v, 'You must accept the Terms to continue'),
}).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
type Form = z.infer<typeof schema>

export default function AccountStep() {
  const { status, user } = useAuth()
  const nav = useNavigate()
  const { register, handleSubmit, watch, setValue, setError, trigger, getValues, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema), mode: 'onBlur', reValidateMode: 'onChange', defaultValues: { terms: false },
  })
  const [msg, setMsg] = useState<string | null>(null)
  const [typo, setTypo] = useState<{ domain: string; email: string } | null>(null)
  const pw = watch('password') ?? ''

  if (status === 'authed') {
    // Back from the Verify step lands here: the account exists already.
    return (
      <StepFrame index={0}>
        <h1 tabIndex={-1}>Create your account</h1>
        <Alert kind="success">Your account is created for {user?.email}.</Alert>
        <button className="btn primary" onClick={() => nav('/')}>Continue</button>
      </StepFrame>
    )
  }
  if (status === 'loading') return <Navigate to="/signup" replace />

  const serverErrors = (e: ApiError) => {
    const fe = e.fieldErrors()
    if (fe.email) setError('email', { message: fe.email })
    if (fe.password) setError('password', { message: fe.password })
    if (fe.acceptTerms) setError('terms', { message: fe.acceptTerms })
    if (!Object.keys(fe).length) setMsg(e.status === 429 ? 'Too many attempts. Please wait a minute.' : 'Something went wrong. Please try again.')
  }

  const onSubmit = async (v: Form) => {
    setMsg(null)
    try {
      // 202: no session yet and the answer is the same whether or not the address is already registered.
      await api('/auth/signup', { auth: false, body: { email: v.email, password: v.password, acceptTerms: v.terms } })
      rememberPendingEmail(v.email)
      nav('/signup/verify')
    } catch (e) { if (e instanceof ApiError) serverErrors(e) }
  }

  const needEmailAndTerms = async () => {
    const ok = await trigger(['email', 'terms'])
    return ok
  }

  const google = async () => { if (await trigger('terms')) window.location.assign('/api/v1/auth/external/google/start?terms=1') }

  const passkey = async () => {
    if (!(await needEmailAndTerms())) return
    setMsg(null)
    try {
      const email = getValues('email')
      const opts = await api('/auth/signup/passkey/options', { auth: false, body: { email, acceptTerms: true } })
      const credential = await createCredential(opts)
      await api('/auth/signup/passkey/complete', { auth: false, body: { credential, email, acceptTerms: true } })
      rememberPendingEmail(email)
      nav('/signup/verify')
    } catch (e) {
      if (e instanceof ApiError) serverErrors(e)
      else setMsg('Passkey creation was cancelled or is not available on this device.')
    }
  }

  const emailReg = register('email')
  return (
    <StepFrame index={0}>
      <h1 tabIndex={-1}>Create your seller account</h1>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field label="Email" type="email" autoComplete="username" inputMode="email" error={errors.email?.message} {...emailReg}
          onBlur={(e) => { void emailReg.onBlur(e); setTypo(suggestEmail(e.target.value.trim())) }} />
        {typo && (
          <div className="suggest" role="status">
            Did you mean <button type="button" className="btn link" onClick={() => { setValue('email', typo.email, { shouldValidate: true }); setTypo(null) }}>{typo.domain}</button>?
          </div>
        )}
        <PasswordField label="Password" autoComplete="new-password" error={errors.password?.message} {...register('password')}
          hint={<ul className="checks">{passwordChecks(pw).map((c) => <li key={c.label} className={c.ok ? 'ok' : ''}>{c.ok ? '✓' : '○'} {c.label}</li>)}</ul>} />
        <PasswordField label="Confirm password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
        <div className="field check">
          <label><input type="checkbox" aria-invalid={errors.terms ? true : undefined} {...register('terms')} /> I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a></label>
          <div className="field-error" aria-live="polite">{errors.terms?.message}</div>
        </div>
        <Alert>{msg}</Alert>
        <button className="btn primary block" disabled={isSubmitting}>Create account</button>
      </form>
      <div className="divider">or sign up with</div>
      {passkeysSupported() && <button type="button" className="btn block" onClick={() => void passkey()}>Sign up with a passkey</button>}
      <button type="button" className="btn block" onClick={() => void google()}>Sign up with Google</button>
      <p className="links">Already have an account? <Link to="/login">Sign in</Link></p>
    </StepFrame>
  )
}
