import { useEffect, useRef, type ReactNode } from 'react'

/** A view that replaces the control the user just pressed (Buy, Done...) must take focus itself, or focus falls back to <body> outside the dialog (WCAG 2.4.3). */
export function FocusedStatus({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return <div ref={ref} tabIndex={-1} role="status" className={className}>{children}</div>
}
