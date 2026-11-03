import { checkBarcode } from '../lib/barcode'
import { TextField, Toggle } from '../ui'
import type { SectionProps } from './types'

export default function Identifiers({ ed }: SectionProps) {
  const { form, set, errors } = ed
  const res = form.barcode ? checkBarcode(form.barcode) : null
  return (
    <>
      <Toggle label="This product has no barcode" checked={form.noBarcode} onChange={(v) => set({ noBarcode: v, barcode: v ? null : form.barcode })} hint="Handmade, custom or private-label items often don't have one." />
      {!form.noBarcode && (
        <TextField id="f-barcode" label="UPC, EAN, GTIN or ISBN" value={form.barcode ?? ''} inputMode="numeric" maxLength={30} autoComplete="off"
          onChange={(e) => set({ barcode: e.target.value || null })} error={errors.barcode ?? (res && !res.valid ? (res.error ?? undefined) : undefined)}
          hint={res?.valid ? <span className="ok-text">✓ Valid {res.type}</span> : 'The digits under the barcode. Spaces and hyphens are fine; we check the last (check) digit.'} />
      )}
    </>
  )
}
