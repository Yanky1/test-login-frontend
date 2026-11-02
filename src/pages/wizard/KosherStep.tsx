import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api'
import { pruneAnswers, visibleKeys } from '../../lib/kosher'
import { Alert } from '../../components/ui'
import { StepFrame, useWizard, type Application } from './shared'

const MAX = 5 * 1024 * 1024
const TYPES = ['application/pdf', 'image/png', 'image/jpeg']

export default function KosherStep() {
  const { app, fields, setApp } = useWizard()
  const nav = useNavigate()
  const [answers, setAnswers] = useState<Record<string, string>>(app.kosher.answers)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const visible = visibleKeys(fields, answers) // branching comes from seller_field_config, not from this component
  const cert = app.kosher.certificate

  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }))

  const upload = async (file: File | undefined) => {
    if (!file) return
    setErrors((e) => ({ ...e, kosher_certificate: '' }))
    if (!TYPES.includes(file.type) && !/\.(pdf|png|jpe?g)$/i.test(file.name)) { setErrors((e) => ({ ...e, kosher_certificate: 'Only PDF, PNG or JPG files are allowed.' })); return }
    if (file.size > MAX) { setErrors((e) => ({ ...e, kosher_certificate: 'File must be 5 MB or smaller.' })); return }
    // the certificate endpoint needs the answers saved first (the field only exists when Kosher = yes)
    try {
      setApp(await api<Application>('/seller/application/kosher', { method: 'PUT', body: { answers: pruneAnswers(fields, answers) } }))
      const form = new FormData(); form.append('file', file)
      await api('/seller/application/kosher/certificate', { form })
      setApp(await api<Application>('/seller/application'))
    } catch (e) {
      setErrors((x) => ({ ...x, kosher_certificate: e instanceof ApiError ? (e.fieldErrors().file ?? 'Upload failed.') : 'Upload failed.' }))
    }
  }

  const removeCert = async () => {
    await api('/seller/application/kosher/certificate', { method: 'DELETE' })
    setApp(await api<Application>('/seller/application'))
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    const errs: Record<string, string> = {}
    for (const f of fields) {
      if (!visible.has(f.key) || !f.required) continue
      if (f.type === 'file') { if (!cert) errs[f.key] = 'Please upload your certificate.' }
      else if (!answers[f.key]) errs[f.key] = 'Please answer this question.'
    }
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      setApp(await api<Application>('/seller/application/kosher', { method: 'PUT', body: { answers: pruneAnswers(fields, answers) } }))
      nav('/signup/review')
    } catch { setMsg('Could not save. Please try again.') } finally { setBusy(false) }
  }

  return (
    <StepFrame index={3}>
      <h1 tabIndex={-1}>Food &amp; kosher</h1>
      <form onSubmit={save} noValidate>
        {fields.filter((f) => visible.has(f.key)).map((f) => (
          <fieldset key={f.key} className="field">
            {f.type === 'yesno' && (
              <>
                <legend>{f.label}</legend>
                {['yes', 'no'].map((v) => (
                  <label key={v} className="radio"><input type="radio" name={f.key} value={v} checked={answers[f.key] === v} onChange={() => set(f.key, v)} /> {v === 'yes' ? 'Yes' : 'No'}</label>
                ))}
              </>
            )}
            {f.type === 'select' && (
              <>
                <label htmlFor={f.key}><span className="legend">{f.label}</span></label>
                <select id={f.key} value={answers[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">Select…</option>
                  {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </>
            )}
            {f.type === 'text' && (<><label htmlFor={f.key}>{f.label}</label><input id={f.key} value={answers[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} /></>)}
            {f.type === 'file' && (
              <>
                <label htmlFor={f.key}>{f.label}</label>
                {cert ? (
                  <p>Uploaded: <strong>{cert.name}</strong> ({Math.ceil(cert.size / 1024)} KB) <button type="button" className="btn link" onClick={() => void removeCert()}>Remove</button></p>
                ) : (
                  <input id={f.key} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(e) => void upload(e.target.files?.[0])} />
                )}
              </>
            )}
            <div className="field-error" aria-live="polite">{errors[f.key]}</div>
          </fieldset>
        ))}
        <Alert>{msg}</Alert>
        <div className="nav-row">
          <button type="button" className="btn" onClick={() => nav('/signup/business')}>← Back</button>
          <button className="btn primary" disabled={busy}>Continue</button>
        </div>
      </form>
    </StepFrame>
  )
}
