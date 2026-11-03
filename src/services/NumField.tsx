import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { TextField } from '../products/ui'

const parse = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s))

/**
 * Number input that keeps what the person types ("40." and "-" survive) and reports the parsed number (null when empty or not a number).
 * Controlled numeric inputs that round-trip through Number() lose the decimal point while typing; this one never does.
 */
export function NumField({ value, onNumber, ...rest }: Omit<ComponentProps<typeof TextField>, 'value' | 'onChange'> & { value: number | null | undefined; onNumber: (n: number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const last = useRef(value ?? null)
  useEffect(() => { if ((value ?? null) !== last.current && (value ?? null) !== parse(text)) setText(value == null ? '' : String(value)); last.current = value ?? null }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return <TextField {...rest} inputMode={rest.inputMode ?? 'decimal'} value={text} onChange={(e) => { setText(e.target.value); const n = parse(e.target.value); last.current = n; onNumber(n) }} />
}
