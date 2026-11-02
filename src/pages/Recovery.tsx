import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, ApiError } from '../api'
import { Alert, Card, Field, PasswordField } from '../components/ui'
import { passwordChecks, passwordValid } from '../lib/password'

export function ForgotPasswordPage() {
  const loc = useLocation()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: z.string().trim().email('Enter a valid email address') })), mode: 'onBlur',
    defaultValues: { email: (loc.state as { email?: string } | null)?.email ?? '' },
  })
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const onSubmit = async (v: { email: string }) => {
    setErr(null)
    try { await api('/auth/forgot-password', { auth: false, body: v }); setDone(true) }
    catch (e) { setErr(e instanceof ApiError && e.status === 429 ? 'Too many requests. Please wait a minute.' : 'Something went wrong.') }
  }
  return (
    <Card title="Reset your password">
      {done ? <Alert kind="success">If an account exists for that email, a reset link is on its way. It is valid for 30 minutes.</Alert> : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <p>Enter your email and we'll send you a link to choose a new password.</p>
          <Field label="Email" type="email" autoComplete="username" error={errors.email?.message} {...register('email')} />
          <Alert>{err}</Alert>
          <button className="btn primary block" disabled={isSubmitting}>Send reset link</button>
        </form>
      )}
      <p className="links"><Link to="/login">Back to sign in</Link></p>
    </Card>
  )
}

const resetSchema = z.object({
  newPassword: z.string().refine(passwordValid, 'Password does not meet the requirements'),
  confirm: z.string(),
}).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
type ResetForm = z.infer<typeof resetSchema>

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const email = params.get('email') ?? ''
  const token = params.get('token') ?? ''
  const { register, handleSubmit, watch, setError, formState: { errors, isSubmitting } } = useForm<ResetForm>({ resolver: zodResolver(resetSchema), mode: 'onBlur' })
  const [err, setErr] = useState<string | null>(null)
  const pw = watch('newPassword') ?? ''
  const onSubmit = async (v: ResetForm) => {
    setErr(null)
    try {
      await api('/auth/reset-password', { auth: false, body: { email, token, newPassword: v.newPassword } })
      nav('/login?reset=1', { replace: true })
    } catch (e) {
      if (e instanceof ApiError) {
        const fe = e.fieldErrors()
        if (fe.newPassword) setError('newPassword', { message: fe.newPassword })
        else setErr(e.body?.code === 'invalid_token' ? 'This reset link is invalid or has expired. Request a new one.' : 'Something went wrong.')
      }
    }
  }
  if (!email || !token) return <Card title="Reset your password"><Alert>This reset link is invalid. <Link to="/forgot-password">Request a new one</Link>.</Alert></Card>
  return (
    <Card title="Choose a new password">
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <PasswordField label="New password" autoComplete="new-password" error={errors.newPassword?.message} {...register('newPassword')}
          hint={<ul className="checks">{passwordChecks(pw).map((c) => <li key={c.label} className={c.ok ? 'ok' : ''}>{c.ok ? '✓' : '○'} {c.label}</li>)}</ul>} />
        <PasswordField label="Confirm new password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
        <Alert>{err}</Alert>
        <button className="btn primary block" disabled={isSubmitting}>Reset password</button>
      </form>
    </Card>
  )
}
