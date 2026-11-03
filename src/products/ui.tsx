import { forwardRef, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

const PATHS = {
  plus: 'M12 5v14M5 12h14', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', image: 'M4 5h16v14H4zM8 10a1.500 1.500 0 100-3 1.500 1.500 0 000 3zM4 17l5-5 4 4 3-3 4 4',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5', copy: 'M9 9h11v11H9zM5 15H4V4h11v1', up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z', warn: 'M12 3l10 18H2zM12 10v5M12 18h.01', check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18', menu: 'M4 6h16M4 12h16M4 18h16', upload: 'M12 16V4M7 9l5-5 5 5M5 20h14', download: 'M12 4v11M7 11l5 5 5-5M5 20h14', msg: 'M4 5h16v11H9l-5 4z',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10', grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01', star: 'M12 3l2.800 5.700 6.200.9-4.500 4.400 1 6.200L12 17.200 6.500 20.200l1-6.200L3 9.600l6.200-.9z',
} as const
export type PIconName = keyof typeof PATHS
export function PIcon({ name, label }: { name: PIconName; label?: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}

interface Base { label: string; error?: string; hint?: ReactNode; optional?: boolean }
const Wrap = ({ id, label, error, hint, optional, children }: Base & { id: string; children: ReactNode }) => (
  <div className="field">
    <label htmlFor={id}>{label}{optional && <span className="opt"> (optional)</span>}</label>
    {children}
    {hint && !error && <div id={`${id}-hint`} className="hint">{hint}</div>}
    <div id={`${id}-err`} className="field-error" aria-live="polite">{error}</div>
  </div>
)
const describe = (id: string, error?: string, hint?: ReactNode) => (error ? `${id}-err` : hint ? `${id}-hint` : undefined)

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Base>(function TextField({ label, error, hint, optional, id, ...rest }, ref) {
  const auto = useId(); const fid = id ?? auto
  return <Wrap id={fid} {...{ label, error, hint, optional }}><input ref={ref} id={fid} aria-invalid={error ? true : undefined} aria-describedby={describe(fid, error, hint)} {...rest} /></Wrap>
})
export const AreaField = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Base>(function AreaField({ label, error, hint, optional, id, ...rest }, ref) {
  const auto = useId(); const fid = id ?? auto
  return <Wrap id={fid} {...{ label, error, hint, optional }}><textarea ref={ref} id={fid} aria-invalid={error ? true : undefined} aria-describedby={describe(fid, error, hint)} {...rest} /></Wrap>
})
export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Base>(function SelectField({ label, error, hint, optional, id, children, ...rest }, ref) {
  const auto = useId(); const fid = id ?? auto
  return <Wrap id={fid} {...{ label, error, hint, optional }}><select ref={ref} id={fid} aria-invalid={error ? true : undefined} aria-describedby={describe(fid, error, hint)} {...rest}>{children}</select></Wrap>
})
export function Toggle({ label, checked, onChange, hint, id }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; id?: string }) {
  const auto = useId(); const fid = id ?? auto
  return (
    <div className="field check">
      <label htmlFor={fid}><input id={fid} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${fid}-hint` : undefined} /> {label}</label>
      {hint && <div id={`${fid}-hint`} className="hint">{hint}</div>}
    </div>
  )
}

/** Accessible modal dialog: focus moves in, Escape closes, Tab is trapped, focus returns to the opener. */
export function Dialog({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const tid = useId()
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current!
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((x) => !x.hasAttribute('disabled'))
    ;(focusables()[0] ?? el).focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current() }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return
        const first = f[0]; const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    el.addEventListener('keydown', key)
    return () => { el.removeEventListener('keydown', key); prev?.focus?.() }
  }, [])
  return (
    <div className="modal-backdrop">
      <div ref={ref} className={`modal pdialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={tid} tabIndex={-1}>
        <h2 id={tid}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip st-${status.toLowerCase()}`}>{status}</span>
}

export function QualityBadge({ score }: { score: number }) {
  const label = score >= 80 ? 'Great' : score >= 50 ? 'Good' : 'Needs work'
  const tone = score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'bad'
  return <span className={`quality ${tone}`} title={`Listing quality ${score}/100`}><span className="q-dot" aria-hidden="true" />{label} <span className="q-n">{score}</span><span className="sr-only"> out of 100</span></span>
}
