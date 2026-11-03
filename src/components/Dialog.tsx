import { useEffect, useRef, type ReactNode } from 'react'

/** Accessible modal: labelled, Escape closes, focus moves in and returns to the opener, Tab stays inside. */
export function Dialog({ title, onClose, children, id }: { title: string; onClose: () => void; children: ReactNode; id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const root = ref.current
    const focusables = () => Array.from(root?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((e) => !(e as HTMLButtonElement).disabled)
    ;(root?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? root)?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab') return
      const f = focusables(); if (f.length === 0) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); opener?.focus?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="modal modal-wide" tabIndex={-1}>
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
