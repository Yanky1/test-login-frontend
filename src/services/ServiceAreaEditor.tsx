import { useState } from 'react'
import { Button } from '../components/ui'
import { PIcon, SelectField, TextField } from '../products/ui'
import { NumField } from './NumField'
import type { ServiceArea } from './types'

const POSTAL = /^[A-Za-z0-9][A-Za-z0-9 -]{0,14}\*?$/
/** Splits pasted text ("11201, 11202\n112*") into normalised postal codes and the entries that are not valid. */
export function parsePostalCodes(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = []; const bad: string[] = []
  for (const raw of text.split(/[,\n;\t]+/)) {
    const c = raw.trim().toUpperCase(); if (!c) continue
    if (POSTAL.test(c)) { if (!ok.includes(c)) ok.push(c) } else bad.push(raw.trim())
  }
  return { ok, bad }
}

/** Service area of an at-customer service: a list of postal codes (prefix with *) and/or a radius around a base location. */
export function ServiceAreaEditor({ value: raw, onChange, error }: { value: ServiceArea; onChange: (v: ServiceArea) => void; error?: string }) {
  const value: ServiceArea = { postalCodes: raw?.postalCodes ?? [], radius: raw?.radius ?? null }
  const [text, setText] = useState('')
  const [bad, setBad] = useState<string[]>([])
  const radius = value.radius ?? { baseAddress: null, lat: null, lng: null, distance: null, unit: 'km' as const }
  const add = () => {
    const { ok, bad: b } = parsePostalCodes(text); setBad(b)
    if (ok.length) onChange({ ...value, postalCodes: [...value.postalCodes, ...ok.filter((c) => !value.postalCodes.includes(c))] })
    setText(b.join(', '))
  }
  const setR = (p: Partial<typeof radius>) => onChange({ ...value, radius: { ...radius, ...p } })
  return (
    <fieldset className="plain svc-area">
      <legend>Service area</legend>
      <p className="hint">Customers inside this area can book you at their address. Use postal codes, a radius, or both.</p>
      <div className="field">
        <label htmlFor="area-codes">Postal codes</label>
        <div className="row tight">
          <input id="area-codes" value={text} placeholder="11201, 11202, 112*" aria-describedby="area-codes-hint" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
          <Button type="button" onClick={add}><PIcon name="plus" /> Add codes</Button>
        </div>
        <div id="area-codes-hint" className="hint">Separate with commas. End with * to cover a prefix (112* = every code starting with 112).</div>
        <div className="field-error" aria-live="polite">{bad.length ? `Not a valid postal code: ${bad.join(', ')}` : error}</div>
        {value.postalCodes.length > 0 && (
          <ul className="chips" aria-label="Postal codes in your service area">
            {value.postalCodes.map((c) => <li key={c} className="vchip">{c}<button type="button" className="chip-x" aria-label={`Remove postal code ${c}`} onClick={() => onChange({ ...value, postalCodes: value.postalCodes.filter((x) => x !== c) })}><PIcon name="x" /></button></li>)}
          </ul>
        )}
      </div>
      <div className="grid2">
        <TextField id="area-base" label="Base location (address)" optional value={radius.baseAddress ?? ''} onChange={(e) => setR({ baseAddress: e.target.value || null })} />
        <div className="row tight">
          <NumField id="area-lat" label="Latitude" optional value={radius.lat} onNumber={(n) => setR({ lat: n })} />
          <NumField id="area-lng" label="Longitude" optional value={radius.lng} onNumber={(n) => setR({ lng: n })} />
        </div>
        <NumField id="area-dist" label="Radius" optional value={radius.distance} onNumber={(n) => setR({ distance: n })} />
        <SelectField id="area-unit" label="Unit" value={radius.unit ?? 'km'} onChange={(e) => setR({ unit: e.target.value as 'km' | 'mi' })}><option value="km">kilometres</option><option value="mi">miles</option></SelectField>
      </div>
      {value.radius && <Button type="button" variant="ghost" onClick={() => onChange({ ...value, radius: null })}>Remove the radius</Button>}
    </fieldset>
  )
}
