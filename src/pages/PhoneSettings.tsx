import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { pinChecks, pinValid } from '../lib/pin'
import { Alert, Field, PasswordField, SettingCard } from '../components/ui'

interface PhoneState { hasNumber: boolean; numberEnding: string | null; hasPin: boolean }
interface StepUp { stepUpRequired?: boolean; message?: string }
interface Me { hasPassword: boolean }

const digits = (s: string) => s.replace(/\D/g, '')
const codeLabel = (msg: string) => /email/i.test(msg) ? 'Email confirmation code' : 'Texted confirmation code'
const errText = (e: unknown, fallback: string) => e instanceof ApiError ? (e.body?.detail ?? e.body?.title ?? fallback) : 'Network error. Please try again.'

/** The two phone cards of Settings → Security: the verified mobile number and the 6-digit phone PIN. */
export function PhoneCards({ me }: { me: Me }) {
  const [st, setSt] = useState<PhoneState | null>(null)
  const load = useCallback(async () => setSt(await api<PhoneState>('/account/phone')), [])
  useEffect(() => { void load() }, [load])
  return (
    <>
      <PhoneNumberCard me={me} st={st} reload={load} />
      <PhonePinCard me={me} st={st} reload={load} />
    </>
  )
}

type Mode = 'idle' | 'add' | 'verify' | 'remove'

function PhoneNumberCard({ me, st, reload }: { me: Me; st: PhoneState | null; reload: () => Promise<void> }) {
  const [mode, setMode] = useState<Mode>('idle')
  const [number, setNumber] = useState('')
  const [pw, setPw] = useState('')
  const [stepUp, setStepUp] = useState<string | null>(null) // server message when a step-up code was sent
  const [stepUpCode, setStepUpCode] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const reset = () => { setMode('idle'); setNumber(''); setPw(''); setStepUp(null); setStepUpCode(''); setCode(''); setMsg(null) }

  const start = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null); setOk(null)
    try {
      const r = await api<StepUp>('/account/phone/start', { body: { phoneNumber: number, currentPassword: me.hasPassword ? pw : undefined, stepUpCode: stepUp ? stepUpCode : undefined } })
      if (r?.stepUpRequired) { setStepUp(r.message ?? 'We sent you a confirmation code.'); return }
      setStepUp(null); setMode('verify')
    } catch (ex) { setMsg(ex instanceof ApiError ? (ex.fieldErrors().phoneNumber ?? errText(ex, 'Could not send the code')) : errText(ex, '')) }
  }
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null)
    try {
      const r = await api<{ numberEnding: string }>('/account/phone/verify', { body: { code } })
      reset(); setOk(`Mobile number ending ${r.numberEnding} is verified. We emailed you a notice.`); await reload()
    } catch (ex) { setMsg(errText(ex, 'That code did not work')) }
  }
  const remove = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null); setOk(null)
    try {
      const r = await api<StepUp>('/account/phone/remove', { body: { currentPassword: me.hasPassword ? pw : undefined, stepUpCode: stepUp ? stepUpCode : undefined } })
      if (r?.stepUpRequired) { setStepUp(r.message ?? 'We sent you a confirmation code.'); return }
      reset(); setOk('Mobile number and phone PIN removed.'); await reload()
    } catch (ex) { setMsg(errText(ex, 'Could not remove the number')) }
  }

  const stepUpFields = (
    <>
      {me.hasPassword && <PasswordField label="Password to confirm" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
      {stepUp && (
        <>
          <p role="status">{stepUp}</p>
          <Field label={codeLabel(stepUp)} autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={stepUpCode} onChange={(e) => setStepUpCode(digits(e.target.value))} />
        </>
      )}
    </>
  )

  return (
    <SettingCard id="ph" icon="phone" title="Phone number" desc="Sign in and get help by phone call or text with a verified mobile number."
      badge={st ? { text: st.hasNumber ? `Ends ${st.numberEnding}` : 'Not added', tone: st.hasNumber ? 'ok' : 'muted' } : undefined}>
      {st?.hasNumber && mode === 'idle' && (
        <>
          <p>Mobile number ending <strong>{st.numberEnding}</strong> is verified.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => { setOk(null); setMode('add') }}>Change number</button>
            <button type="button" className="btn danger" onClick={() => { setOk(null); setMode('remove') }}>Remove number</button>
          </div>
        </>
      )}
      {st && !st.hasNumber && mode === 'idle' && (
        <>
          <p className="empty">No number yet. Add one to sign in by phone or text.</p>
          <button type="button" className="btn" onClick={() => { setOk(null); setMode('add') }}>Add a mobile number</button>
        </>
      )}
      {mode === 'add' && (
        <form onSubmit={start} noValidate>
          <Field label="Mobile number" type="tel" autoComplete="tel" inputMode="tel" value={number} onChange={(e) => setNumber(e.target.value)}
            hint="We text a 6-digit code to confirm it. Message and data rates may apply. Reply STOP to opt out." />
          {stepUpFields}
          <div className="row"><button className="btn primary">{stepUp ? 'Continue' : 'Text me a code'}</button><button type="button" className="btn link" onClick={reset}>Cancel</button></div>
        </form>
      )}
      {mode === 'verify' && (
        <form onSubmit={verify} noValidate>
          <p>We texted a code to your new number.</p>
          <Field label="Verification code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(digits(e.target.value))} />
          <div className="row"><button className="btn primary">Verify number</button><button type="button" className="btn link" onClick={reset}>Cancel</button></div>
        </form>
      )}
      {mode === 'remove' && (
        <form onSubmit={remove} noValidate>
          <p>Removing your number also removes your phone PIN. You can no longer sign in by phone.</p>
          {stepUpFields}
          <div className="row"><button className="btn danger">{stepUp ? 'Confirm removal' : 'Remove number'}</button><button type="button" className="btn link" onClick={reset}>Cancel</button></div>
        </form>
      )}
      <Alert>{msg}</Alert><Alert kind="success">{ok}</Alert>
    </SettingCard>
  )
}

function PhonePinCard({ me, st, reload }: { me: Me; st: PhoneState | null; reload: () => Promise<void> }) {
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [pw, setPw] = useState('')
  const [stepUp, setStepUp] = useState<string | null>(null)
  const [stepUpCode, setStepUpCode] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null); setOk(null)
    if (!pinValid(pin)) { setMsg('Choose a PIN that meets the rules below.'); return }
    if (pin !== again) { setMsg('The two PINs do not match.'); return }
    try {
      const r = await api<StepUp>('/account/phone/pin', { method: 'PUT', body: { pin, currentPassword: me.hasPassword ? pw : undefined, stepUpCode: stepUp ? stepUpCode : undefined } })
      if (r?.stepUpRequired) { setStepUp(r.message ?? 'We sent you a confirmation code.'); return }
      setPin(''); setAgain(''); setPw(''); setStepUp(null); setStepUpCode(''); setOk('Phone PIN saved. We emailed you a notice.'); await reload()
    } catch (ex) { setMsg(ex instanceof ApiError ? (ex.fieldErrors().pin ?? errText(ex, 'Could not save the PIN')) : errText(ex, '')) }
  }
  return (
    <SettingCard id="pn" icon="lock" title="Phone PIN" desc="A 6-digit PIN you enter on the keypad (or by text) together with a texted code to sign in by phone."
      badge={st ? { text: st.hasPin ? 'Set' : 'Not set', tone: st.hasPin ? 'ok' : 'muted' } : undefined}>
      {st && !st.hasNumber ? <p className="empty">Add and verify a mobile number first.</p> : (
        <form onSubmit={submit} noValidate>
          <Field label={st?.hasPin ? 'New PIN' : 'PIN'} type="password" autoComplete="off" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(digits(e.target.value))}
            hint={<ul className="checks">{pinChecks(pin).map((c) => <li key={c.label} className={c.ok ? 'ok' : ''}>{c.ok ? '✓' : '○'} {c.label}</li>)}</ul>} />
          <Field label="Confirm PIN" type="password" autoComplete="off" inputMode="numeric" maxLength={6} value={again} onChange={(e) => setAgain(digits(e.target.value))} />
          {me.hasPassword && <PasswordField label="Password to confirm PIN change" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
          {stepUp && (<><p role="status">{stepUp}</p><Field label={codeLabel(stepUp)} autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={stepUpCode} onChange={(e) => setStepUpCode(digits(e.target.value))} /></>)}
          <button className="btn primary">{stepUp ? 'Continue' : st?.hasPin ? 'Change PIN' : 'Set PIN'}</button>
        </form>
      )}
      <Alert>{msg}</Alert><Alert kind="success">{ok}</Alert>
    </SettingCard>
  )
}
