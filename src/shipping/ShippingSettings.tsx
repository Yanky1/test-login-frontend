import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../api'
import { Alert, Button, Skeleton } from '../components/ui'
import { useBrands } from '../pages/teams/BrandContext'
import { fromCents, money, toCents } from '../orders/format'
import { ConfirmDialog } from '../orders/Dialogs'
import { Dialog, PIcon, SelectField, TextField } from '../products/ui'
import { shippingApi, type PackagePreset, type Profile, type ScopeSettings, type ShipAddress, type ShippingConfig, type Speed, type Zone } from './api'
import { SPEED_LABEL, grams } from './format'
import '../products/products.css'   // dialog sizing/scrolling (.pdialog) and field grids; only loaded with the product routes otherwise
import './shipping.css'

const msg = (e: unknown, fallback = 'Something went wrong. Try again.') => (e instanceof ApiError ? Object.values(e.fieldErrors())[0] ?? e.message2 : fallback)

/** Settings → Shipping: ship-from addresses, package presets, shipping rates, handling time and the return address. Owners and Admins edit; everyone else reads. */
export default function ShippingSettings() {
  const [cfg, setCfg] = useState<ShippingConfig | null>(null); const [error, setError] = useState(''); const [flash, setFlash] = useState('')
  const [dlg, setDlg] = useState<{ k: 'address'; v?: ShipAddress } | { k: 'package'; v?: PackagePreset } | { k: 'profile'; v?: Profile } | null>(null)
  const [rm, setRm] = useState<{ what: string; name: string; run: () => Promise<unknown>; done: string } | null>(null)
  const load = useCallback(async () => { try { setCfg(await shippingApi.config()); setError('') } catch (e) { setError(msg(e, 'Could not load your shipping settings.')) } }, [])
  useEffect(() => { void load() }, [load])
  if (!cfg) return <div aria-busy="true" aria-label="Loading shipping settings"><Alert>{error}</Alert><Skeleton lines={5} /></div>
  const can = cfg.canManage
  const act = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); setFlash(done); await load() } catch (e) { setError(msg(e)) } }
  const saved = () => { setDlg(null); void load() }
  return (
    <div className="ship-settings">
      <div aria-live="polite" className="flash">{flash && <Alert kind="success">{flash}</Alert>}</div>
      <Alert>{error}</Alert>
      {!can && <Alert kind="info">Only Owners and Admins can change shipping settings. You can see them here and use them when you ship.</Alert>}

      <section className="pcard" aria-labelledby="sa-h">
        <div className="sh-head"><div><h2 id="sa-h">Ship-from addresses</h2><p className="sub">Where your parcels leave from. We check each address with the carrier network. One address is the default.</p></div>
          {can && <Button variant="primary" onClick={() => setDlg({ k: 'address' })}>Add an address</Button>}</div>
        {cfg.addresses.length === 0 ? <p className="sub">No address yet. Add one to buy labels.</p> : (
          <ul className="plain sh-list">{cfg.addresses.map((a) => (
            <li key={a.id}>
              <div className="grow">
                <strong>{a.label || a.name}</strong>{' '}{a.isDefault && <span className="chip ok">Default</span>}{' '}
                {a.validation === 'valid' ? <span className="chip ok">Address verified</span> : <span className="chip warn" title={a.validationMessage ?? ''}>Not verified</span>}
                <address>{a.name}{a.company ? `, ${a.company}` : ''}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.city}{a.region ? `, ${a.region}` : ''} {a.postalCode} · {a.country}</address>
                {a.validation !== 'valid' && a.validationMessage && <p className="sub">{a.validationMessage}</p>}
              </div>
              {can && <div className="actions">
                {!a.isDefault && <Button onClick={() => void act(() => shippingApi.defaultAddress(a.id), 'Default address changed.')}>Make default<span className="sr-only"> {a.label || a.name}</span></Button>}
                <Button onClick={() => setDlg({ k: 'address', v: a })}>Edit<span className="sr-only"> {a.label || a.name}</span></Button>
                <Button variant="ghost" onClick={() => setRm({ what: 'address', name: a.label || a.name, run: () => shippingApi.removeAddress(a.id), done: 'Address removed.' })}>Remove<span className="sr-only"> {a.label || a.name}</span></Button>
              </div>}
            </li>))}</ul>
        )}
      </section>

      <section className="pcard" aria-labelledby="sp-h">
        <div className="sh-head"><div><h2 id="sp-h">Package presets</h2><p className="sub">Your usual boxes and envelopes. The default is used when you don't pick one. Item weights are added to the empty weight.</p></div>
          {can && <Button variant="primary" onClick={() => setDlg({ k: 'package' })}>Add a package</Button>}</div>
        {cfg.packages.length === 0 ? <p className="sub">No packages yet.</p> : (
          <ul className="plain sh-list">{cfg.packages.map((p) => (
            <li key={p.id}>
              <div className="grow"><strong>{p.name}</strong>{' '}{p.isDefault && <span className="chip ok">Default</span>}
                <div className="sub">{p.kind === 'box' ? 'Box' : p.kind === 'envelope' ? 'Envelope' : 'Soft pack'} · {p.lengthMm} × {p.widthMm} × {p.heightMm} mm · empty {grams(p.emptyWeightGrams)}</div></div>
              {can && <div className="actions"><Button onClick={() => setDlg({ k: 'package', v: p })}>Edit<span className="sr-only"> {p.name}</span></Button>
                <Button variant="ghost" onClick={() => setRm({ what: 'package', name: p.name, run: () => shippingApi.removePackage(p.id), done: 'Package removed.' })}>Remove<span className="sr-only"> {p.name}</span></Button></div>}
            </li>))}</ul>
        )}
      </section>

      <section className="pcard" aria-labelledby="pr-h">
        <div className="sh-head"><div><h2 id="pr-h">Shipping rates</h2><p className="sub">What buyers are charged at checkout, by destination and speed. Solvelt charges the buyer; labels you buy are billed to your seller balance.</p></div>
          {can && <Button variant="primary" onClick={() => setDlg({ k: 'profile' })}>Add a rate profile</Button>}</div>
        {cfg.profiles.length === 0 ? <p className="sub">No rate profile yet.</p> : (
          <ul className="plain sh-list">{cfg.profiles.map((p) => (
            <li key={p.id}>
              <div className="grow"><strong>{p.name}</strong>{' '}{p.isDefault && <span className="chip ok">Default</span>}
                {p.freeShippingThresholdCents != null && <div className="sub">Free shipping from {money(p.freeShippingThresholdCents, p.currency)}</div>}
                <ul className="zone-sum">{p.zones.map((z) => <li key={z.name}><strong>{z.name}</strong> ({z.countries.join(', ')}): {z.speeds.filter((s) => s.enabled).map((s) => `${SPEED_LABEL[s.speed]} ${s.method === 'flat' ? money(s.flatCents ?? 0, p.currency) : `${money(s.baseCents ?? 0, p.currency)} + ${money(s.perKgCents ?? 0, p.currency)}/kg`}`).join(' · ') || 'no speeds on'}</li>)}</ul></div>
              {can && <div className="actions"><Button onClick={() => setDlg({ k: 'profile', v: p })}>Edit<span className="sr-only"> {p.name}</span></Button>
                <Button variant="ghost" onClick={() => setRm({ what: 'rate profile', name: p.name, run: () => shippingApi.removeProfile(p.id), done: 'Rate profile removed.' })}>Remove<span className="sr-only"> {p.name}</span></Button></div>}
            </li>))}</ul>
        )}
      </section>

      <HandlingCard cfg={cfg} can={can} onSaved={(m) => { setFlash(m); void load() }} onError={setError} />

      {rm && <ConfirmDialog title={`Remove this ${rm.what}?`} confirm={`Yes, remove it`} destructive onClose={() => setRm(null)} body={<p>“{rm.name}” will no longer be offered when you buy labels or quote shipping.</p>}
        onConfirm={async () => { await rm.run(); setFlash(rm.done); setRm(null); await load() }} />}
      {dlg?.k === 'address' && <AddressDialog value={dlg.v} onClose={() => setDlg(null)} onSaved={() => { setFlash('Address saved.'); saved() }} />}
      {dlg?.k === 'package' && <PackageDialog value={dlg.v} onClose={() => setDlg(null)} onSaved={() => { setFlash('Package saved.'); saved() }} />}
      {dlg?.k === 'profile' && <ProfileDialog value={dlg.v} onClose={() => setDlg(null)} onSaved={() => { setFlash('Rate profile saved.'); saved() }} />}
    </div>
  )
}

// ---- handling time, label format, return address --------------------------------------------------------------------------------
function HandlingCard({ cfg, can, onSaved, onError }: { cfg: ShippingConfig; can: boolean; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const acct: ScopeSettings | undefined = cfg.settings.find((s) => s.brandId === null)
  const [days, setDays] = useState(acct?.handlingDays != null ? String(acct.handlingDays) : '')
  const [format, setFormat] = useState(acct?.labelFormat ?? cfg.defaultLabelFormat)
  const [ret, setRet] = useState(acct?.returnAddressId ?? '')
  const [busy, setBusy] = useState(false)
  const dErr = days !== '' && (!/^\d+$/.test(days) || Number(days) > 30) ? 'Use a whole number from 0 to 30.' : ''
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (dErr) return
    setBusy(true)
    try { await shippingApi.saveSettings({ handlingDays: days === '' ? undefined : Number(days), clearHandling: days === '', labelFormat: format, returnAddressId: ret || undefined, clearReturnAddress: !ret }); onSaved('Handling and returns saved.') }
    catch (x) { onError(msg(x)) } finally { setBusy(false) }
  }
  return (
    <section className="pcard" aria-labelledby="hr-h">
      <h2 id="hr-h">Handling time and returns</h2>
      <form onSubmit={submit} noValidate>
        <div className="pgrid2">
          <TextField label="Handling time (days)" optional type="number" inputMode="numeric" min={0} max={30} value={days} disabled={!can} error={dErr} onChange={(e) => setDays(e.target.value)} hint="How long you need to pack an order. It sets the ship-by date of new orders (a product's own handling time wins)." />
          <SelectField label="Label format" value={format} disabled={!can} onChange={(e) => setFormat(e.target.value)} hint="PDF for a normal printer, ZPL for a thermal label printer.">
            {cfg.labelFormats.map((f) => <option key={f} value={f}>{f === 'PDF_4x6' ? 'PDF (4 × 6 in)' : f === 'PNG' ? 'PNG image' : 'ZPL (thermal printer)'}</option>)}
          </SelectField>
          <SelectField label="Return address" value={ret} disabled={!can} onChange={(e) => setRet(e.target.value)} hint="Prepaid return labels ship back to this address.">
            <option value="">Use my default ship-from address</option>{cfg.addresses.map((a) => <option key={a.id} value={a.id}>{a.label || a.name} – {a.line1}, {a.city}</option>)}
          </SelectField>
        </div>
        {can && <Button type="submit" variant="primary" loading={busy}>Save</Button>}
      </form>
      {cfg.spend.limitCents > 0 && <p className="sub"><PIcon name="box" /> Label spending this month: {money(cfg.spend.spentCents)} of {money(cfg.spend.limitCents)}.</p>}
    </section>
  )
}

// ---- dialogs ------------------------------------------------------------------------------------------------------------------------------
function useSave(onSaved: () => void) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  return { busy, error, run: async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); onSaved() } catch (e) { setError(msg(e)) } finally { setBusy(false) } } }
}

function BrandScope({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { brands } = useBrands()
  if (brands.length < 2) return null
  return <SelectField label="Applies to" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}><option value="">All my brands</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</SelectField>
}

function AddressDialog({ value, onClose, onSaved }: { value?: ShipAddress; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ label: value?.label ?? '', name: value?.name ?? '', company: value?.company ?? '', line1: value?.line1 ?? '', line2: value?.line2 ?? '', city: value?.city ?? '', region: value?.region ?? '',
    postalCode: value?.postalCode ?? '', country: value?.country ?? 'US', phone: value?.phone ?? '', brandId: value?.brandId ?? '', isDefault: value?.isDefault ?? false })
  const [touched, setTouched] = useState(false); const { busy, error, run } = useSave(onSaved)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const req = (v: string, what: string) => (touched && !v.trim() ? `Enter ${what}.` : '')
  const cErr = touched && !/^[A-Za-z]{2}$/.test(f.country) ? 'Use the 2-letter country code, like US.' : ''
  const rErr = touched && f.country.toUpperCase() === 'US' && !f.region.trim() ? 'Enter the state.' : ''
  const bad = !f.name.trim() || !f.line1.trim() || !f.city.trim() || !f.postalCode.trim() || !!cErr || !!rErr || !/^[A-Za-z]{2}$/.test(f.country) || (f.country.toUpperCase() === 'US' && !f.region.trim())
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTouched(true); if (bad) return
    const body = { label: f.label.trim() || undefined, name: f.name.trim(), company: f.company.trim() || undefined, line1: f.line1.trim(), line2: f.line2.trim() || undefined, city: f.city.trim(), region: f.region.trim() || undefined,
      postalCode: f.postalCode.trim(), country: f.country.trim().toUpperCase(), phone: f.phone.trim() || undefined, brandId: f.brandId || null, isDefault: f.isDefault }
    void run(() => (value ? shippingApi.editAddress(value.id, body) : shippingApi.addAddress(body)))
  }
  return (
    <Dialog title={value ? 'Edit ship-from address' : 'Add a ship-from address'} onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        <div className="pgrid2">
          <TextField label="Name for this address" optional placeholder="e.g. Warehouse" value={f.label} onChange={set('label')} maxLength={80} />
          <TextField label="Contact name" value={f.name} onChange={set('name')} error={req(f.name, 'a contact name')} autoComplete="name" />
          <TextField label="Company" optional value={f.company} onChange={set('company')} autoComplete="organization" />
          <TextField label="Phone" optional value={f.phone} onChange={set('phone')} autoComplete="tel" hint="Carriers may call this number." />
          <TextField label="Address line 1" value={f.line1} onChange={set('line1')} error={req(f.line1, 'the street address')} autoComplete="address-line1" />
          <TextField label="Address line 2" optional value={f.line2} onChange={set('line2')} autoComplete="address-line2" />
          <TextField label="City" value={f.city} onChange={set('city')} error={req(f.city, 'the city')} autoComplete="address-level2" />
          <TextField label="State or region" value={f.region} onChange={set('region')} error={rErr} autoComplete="address-level1" />
          <TextField label="ZIP or postal code" value={f.postalCode} onChange={set('postalCode')} error={req(f.postalCode, 'the postal code')} autoComplete="postal-code" />
          <TextField label="Country (2 letters)" value={f.country} onChange={set('country')} error={cErr} maxLength={2} autoComplete="country" />
        </div>
        <BrandScope value={f.brandId} onChange={(v) => setF({ ...f, brandId: v })} disabled={!!value} />
        {!value && <div className="field check"><label><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /> Make this my default address</label></div>}
        <Alert>{error}</Alert>
        <div className="actions dlg-actions"><Button variant="primary" type="submit" loading={busy}>Save address</Button><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  )
}

function PackageDialog({ value, onClose, onSaved }: { value?: PackagePreset; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: value?.name ?? '', kind: value?.kind ?? 'box', l: String(value?.lengthMm ?? ''), w: String(value?.widthMm ?? ''), h: String(value?.heightMm ?? ''), empty: String(value?.emptyWeightGrams ?? '100'), isDefault: value?.isDefault ?? false })
  const [touched, setTouched] = useState(false); const { busy, error, run } = useSave(onSaved)
  const num = (v: string, max: number) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= max
  const err = (v: string, max: number, what: string) => (touched && !num(v, max) ? `${what}: a whole number from 1 to ${max}.` : '')
  const eErr = touched && !(/^\d+$/.test(f.empty) && Number(f.empty) <= 70000) ? 'Empty weight: grams, 0 to 70000.' : ''
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTouched(true)
    if (!f.name.trim() || !num(f.l, 2000) || !num(f.w, 2000) || !num(f.h, 2000) || !/^\d+$/.test(f.empty) || Number(f.empty) > 70000) return
    const body = { name: f.name.trim(), kind: f.kind, lengthMm: Number(f.l), widthMm: Number(f.w), heightMm: Number(f.h), emptyWeightGrams: Number(f.empty), isDefault: f.isDefault }
    void run(() => (value ? shippingApi.editPackage(value.id, body) : shippingApi.addPackage(body)))
  }
  return (
    <Dialog title={value ? 'Edit package' : 'Add a package'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <TextField label="Name" value={f.name} onChange={set('name')} maxLength={80} error={touched && !f.name.trim() ? 'Enter a name.' : ''} />
        <SelectField label="Type" value={f.kind} onChange={set('kind')}><option value="box">Box</option><option value="envelope">Envelope</option><option value="soft_pack">Soft pack</option></SelectField>
        <div className="pgrid3">
          <TextField label="Length (mm)" inputMode="numeric" value={f.l} onChange={set('l')} error={err(f.l, 2000, 'Length')} />
          <TextField label="Width (mm)" inputMode="numeric" value={f.w} onChange={set('w')} error={err(f.w, 2000, 'Width')} />
          <TextField label="Height (mm)" inputMode="numeric" value={f.h} onChange={set('h')} error={err(f.h, 2000, 'Height')} />
        </div>
        <TextField label="Empty weight (g)" inputMode="numeric" value={f.empty} onChange={set('empty')} error={eErr} hint="What the box or envelope weighs on its own." />
        <div className="field check"><label><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /> Use as my default package</label></div>
        <Alert>{error}</Alert>
        <div className="actions dlg-actions"><Button variant="primary" type="submit" loading={busy}>Save package</Button><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  )
}

interface ZoneForm { name: string; kind: 'domestic' | 'international'; countries: string; speeds: Record<Speed, { enabled: boolean; method: 'flat' | 'weight'; flat: string; base: string; perKg: string }> }
const blankSpeeds = (): ZoneForm['speeds'] => ({ standard: { enabled: true, method: 'flat', flat: '5.00', base: '3.00', perKg: '2.00' }, expedited: { enabled: false, method: 'flat', flat: '12.00', base: '8.00', perKg: '3.00' }, overnight: { enabled: false, method: 'flat', flat: '25.00', base: '15.00', perKg: '4.00' } })
const toZoneForm = (z: Zone): ZoneForm => {
  const s = blankSpeeds()
  for (const x of z.speeds) s[x.speed] = { enabled: x.enabled, method: x.method, flat: fromCents(x.flatCents ?? 0), base: fromCents(x.baseCents ?? 0), perKg: fromCents(x.perKgCents ?? 0) }
  return { name: z.name, kind: z.kind, countries: z.countries.join(', '), speeds: s }
}
const SPEEDS: Speed[] = ['standard', 'expedited', 'overnight']

function ProfileDialog({ value, onClose, onSaved }: { value?: Profile; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(value?.name ?? 'Standard shipping'); const [free, setFree] = useState(value?.freeShippingThresholdCents != null ? fromCents(value.freeShippingThresholdCents) : '')
  const [brandId, setBrandId] = useState(value?.brandId ?? ''); const [isDefault, setIsDefault] = useState(value?.isDefault ?? false)
  const [zones, setZones] = useState<ZoneForm[]>(value ? value.zones.map(toZoneForm) : [{ name: 'Domestic', kind: 'domestic', countries: 'US', speeds: blankSpeeds() }])
  const [touched, setTouched] = useState(false); const { busy, error, run } = useSave(onSaved)
  const upd = (i: number, z: Partial<ZoneForm>) => setZones(zones.map((x, j) => (j === i ? { ...x, ...z } : x)))
  const updSpeed = (i: number, sp: Speed, p: Partial<ZoneForm['speeds'][Speed]>) => upd(i, { speeds: { ...zones[i].speeds, [sp]: { ...zones[i].speeds[sp], ...p } } })
  const money1 = (v: string) => toCents(v) !== null
  const zoneErr = (z: ZoneForm): string => {
    if (!z.name.trim()) return 'Give every zone a name.'
    if (!z.countries.split(',').map((c) => c.trim()).filter(Boolean).every((c) => c === '*' || /^[A-Za-z]{2}$/.test(c)) || !z.countries.trim()) return `Zone ${z.name}: list country codes like US, CA (or * for the rest of the world).`
    const on = SPEEDS.filter((s) => z.speeds[s].enabled)
    if (on.length === 0) return `Zone ${z.name}: turn on at least one speed.`
    for (const s of on) { const x = z.speeds[s]; if (x.method === 'flat' ? !money1(x.flat) : !money1(x.base) || !money1(x.perKg)) return `Zone ${z.name}: enter valid amounts for ${SPEED_LABEL[s].toLowerCase()}.` }
    return ''
  }
  const freeErr = free.trim() !== '' && !money1(free) ? 'Enter an amount like 75.00.' : ''
  const err = !name.trim() ? 'Enter a name.' : freeErr || zones.map(zoneErr).find(Boolean) || (zones.length === 0 ? 'Add at least one zone.' : '')
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTouched(true); if (err) return
    const body = {
      name: name.trim(), currency: 'USD', brandId: brandId || null, isDefault, freeShippingThresholdCents: free.trim() === '' ? null : toCents(free),
      zones: zones.map((z) => ({
        name: z.name.trim(), kind: z.kind, countries: z.countries.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
        speeds: SPEEDS.filter((s) => z.speeds[s].enabled).map((s) => { const x = z.speeds[s]; return x.method === 'flat' ? { speed: s, enabled: true, method: 'flat', flatCents: toCents(x.flat) } : { speed: s, enabled: true, method: 'weight', baseCents: toCents(x.base), perKgCents: toCents(x.perKg) } }),
      })),
    }
    void run(() => (value ? shippingApi.editProfile(value.id, body) : shippingApi.addProfile(body)))
  }
  return (
    <Dialog title={value ? 'Edit rate profile' : 'Add a rate profile'} onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        <div className="pgrid2">
          <TextField label="Profile name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={touched && !name.trim() ? 'Enter a name.' : ''} />
          <TextField label="Free shipping from (USD)" optional value={free} onChange={(e) => setFree(e.target.value)} error={touched ? freeErr : ''} hint="Items subtotal at or above this ships free." />
        </div>
        <BrandScope value={brandId} onChange={setBrandId} disabled={!!value} />
        {zones.map((z, i) => (
          <fieldset key={i} className="zone-edit">
            <legend>Zone {i + 1}</legend>
            <div className="pgrid3">
              <TextField label={`Zone ${i + 1} name`} value={z.name} onChange={(e) => upd(i, { name: e.target.value })} />
              <SelectField label={`Zone ${i + 1} type`} value={z.kind} onChange={(e) => upd(i, { kind: e.target.value as ZoneForm['kind'] })}><option value="domestic">Domestic</option><option value="international">International</option></SelectField>
              <TextField label={`Zone ${i + 1} countries`} value={z.countries} onChange={(e) => upd(i, { countries: e.target.value })} hint="Codes separated by commas, or * for everywhere else." />
            </div>
            {SPEEDS.map((s) => {
              const x = z.speeds[s]
              return (
                <div key={s} className="speed-row">
                  <div className="field check"><label><input type="checkbox" checked={x.enabled} onChange={(e) => updSpeed(i, s, { enabled: e.target.checked })} /> {SPEED_LABEL[s]}<span className="sr-only"> in zone {i + 1}</span></label></div>
                  {x.enabled && (
                    <>
                      <SelectField label={`${SPEED_LABEL[s]} price type (zone ${i + 1})`} value={x.method} onChange={(e) => updSpeed(i, s, { method: e.target.value as 'flat' | 'weight' })}><option value="flat">Flat rate</option><option value="weight">By weight</option></SelectField>
                      {x.method === 'flat'
                        ? <TextField label={`${SPEED_LABEL[s]} flat rate (USD, zone ${i + 1})`} value={x.flat} onChange={(e) => updSpeed(i, s, { flat: e.target.value })} />
                        : <><TextField label={`${SPEED_LABEL[s]} base (USD, zone ${i + 1})`} value={x.base} onChange={(e) => updSpeed(i, s, { base: e.target.value })} /><TextField label={`${SPEED_LABEL[s]} per kg (USD, zone ${i + 1})`} value={x.perKg} onChange={(e) => updSpeed(i, s, { perKg: e.target.value })} /></>}
                    </>
                  )}
                </div>
              )
            })}
            {zones.length > 1 && <Button type="button" variant="ghost" onClick={() => setZones(zones.filter((_, j) => j !== i))}>Remove zone {i + 1}</Button>}
          </fieldset>
        ))}
        {zones.length < 10 && <Button type="button" onClick={() => setZones([...zones, { name: 'International', kind: 'international', countries: '*', speeds: blankSpeeds() }])}>Add a zone</Button>}
        <div className="field check"><label><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Use as my default profile</label></div>
        {touched && err && <p className="field-error" role="alert">{err}</p>}
        <Alert>{error}</Alert>
        <div className="actions dlg-actions"><Button variant="primary" type="submit" loading={busy}>Save profile</Button><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  )
}
