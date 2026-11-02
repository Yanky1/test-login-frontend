import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'

export function Alert({ children, kind = 'error' }: { children?: ReactNode; kind?: 'error' | 'info' | 'success' }) {
  // always rendered so screen readers announce changes (aria-live)
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} aria-live={kind === 'error' ? 'assertive' : 'polite'} className={children ? `alert ${kind}` : 'sr-only'}>
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

export function Card({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <main className={wide ? 'card wide' : 'card'}>
      <h1 tabIndex={-1} id="page-title">{title}</h1>
      {children}
    </main>
  )
}
