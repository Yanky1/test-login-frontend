import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './services.css'
import { Button } from '../components/ui'
import { AreaField, PIcon, SelectField, TextField, Toggle } from '../products/ui'
import { NumField } from './NumField'
import { servicesApi } from './api'
import { ServiceAreaEditor } from './ServiceAreaEditor'
import type { ServiceForm } from './useServiceDetails'
import type { AddOnDto, IntakeQuestion, ServiceProviderChoice } from './types'

type P = { sf: ServiceForm }

export function ServicePricing({ sf }: P) {
  const { form: f, set, errors: e } = sf
  const hourly = f.pricingModel === 'hourly'
  return (
    <>
      <SelectField id="f-svc-model" label="How do you charge?" value={f.pricingModel} error={e.pricingModel} onChange={(x) => set({ pricingModel: x.target.value as typeof f.pricingModel })}
        hint="By the hour, one price per job, or ask for details first and send a quote.">
        <option value="hourly">By the hour</option><option value="fixed">One price per job</option><option value="quote">Quote required</option>
      </SelectField>
      {f.pricingModel !== 'quote' && <NumField id="f-svc-price" label={hourly ? 'Hourly rate (USD)' : 'Price per job (USD)'} value={f.price} error={e.price} onNumber={(v) => set({ price: v })} />}
      {f.pricingModel === 'quote' && <p className="hint">Buyers describe the job and you reply with a price, an estimated duration and time slots. You'll find requests under Bookings → Quote requests.</p>}
      {hourly && (
        <div className="grid2">
          <SelectField id="f-svc-increment" label="Bill in steps of" value={String(f.incrementMinutes)} error={e.incrementMinutes} onChange={(x) => set({ incrementMinutes: Number(x.target.value) })}>
            <option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option>
          </SelectField>
          <NumField id="f-svc-min" label="Minimum (minutes)" optional value={f.minMinutes} error={e.minMinutes} onNumber={(v) => set({ minMinutes: v })} />
          <NumField id="f-svc-max" label="Maximum (minutes)" optional value={f.maxMinutes} error={e.maxMinutes} onNumber={(v) => set({ maxMinutes: v })} />
        </div>
      )}
      <NumField id="f-svc-duration" label={hourly ? 'Default booked time (minutes)' : 'How long does it take? (minutes)'} value={f.defaultDurationMinutes} error={e.defaultDurationMinutes}
        onNumber={(v) => set({ defaultDurationMinutes: v ?? 0 })} hint={hourly ? 'Shown to buyers as the starting point; they can choose more or less.' : undefined} />
      <AddOns sf={sf} />
    </>
  )
}

function AddOns({ sf }: P) {
  const { form: f, set, errors: e } = sf
  const upd = (i: number, p: Partial<AddOnDto>) => set({ addOns: f.addOns.map((a, k) => (k === i ? { ...a, ...p } : a)) })
  return (
    <fieldset className="plain">
      <legend>Add-ons <span className="opt">(optional)</span></legend>
      {f.addOns.map((a, i) => (
        <div key={i} className="row tight addon">
          <TextField label={`Add-on ${i + 1} name`} value={a.name} onChange={(x) => upd(i, { name: x.target.value })} />
          <NumField label={`Add-on ${i + 1} price (USD)`} value={a.price} onNumber={(v) => upd(i, { price: v })} />
          <NumField label={`Add-on ${i + 1} extra minutes`} inputMode="numeric" value={a.extraMinutes} onNumber={(v) => upd(i, { extraMinutes: v })} />
          <Button type="button" variant="ghost" onClick={() => set({ addOns: f.addOns.filter((_, k) => k !== i) })}><PIcon name="trash" /><span className="sr-only">Remove add-on {i + 1}</span></Button>
        </div>
      ))}
      {e.addOns && <div className="field-error" role="alert">{e.addOns}</div>}
      {f.addOns.length < 20 && <Button type="button" onClick={() => set({ addOns: [...f.addOns, { name: '', price: 0, extraMinutes: 0 }] })}><PIcon name="plus" /> Add an add-on</Button>}
    </fieldset>
  )
}

export function ServiceTiming({ sf }: P) {
  const { form: f, set, errors: e } = sf
  return (
    <div className="grid2">
      <NumField id="f-svc-notice" label="Minimum notice (hours)" value={f.minNoticeHours} error={e.minNoticeHours} onNumber={(v) => set({ minNoticeHours: v ?? 0 })} hint="How far ahead buyers must book." />
      <NumField id="f-svc-window" label="Book up to (days ahead)" value={f.maxAdvanceDays} error={e.maxAdvanceDays} onNumber={(v) => set({ maxAdvanceDays: v ?? 0 })} />
      <SelectField id="f-svc-gran" label="Offer start times every" value={String(f.slotGranularityMinutes)} error={e.slotGranularityMinutes} onChange={(x) => set({ slotGranularityMinutes: Number(x.target.value) })}>
        {[5, 10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m === 60 ? '1 hour' : `${m} minutes`}</option>)}
      </SelectField>
      <NumField id="f-svc-before" label="Buffer before (minutes)" value={f.bufferBeforeMinutes} error={e.bufferBeforeMinutes} onNumber={(v) => set({ bufferBeforeMinutes: v ?? 0 })} hint="Set-up time kept free before a job." />
      <NumField id="f-svc-after" label="Buffer after (minutes)" value={f.bufferAfterMinutes} error={e.bufferAfterMinutes} onNumber={(v) => set({ bufferAfterMinutes: v ?? 0 })} hint="Clean-up time kept free after a job." />
    </div>
  )
}

export function ServiceLocation({ sf }: P) {
  const { form: f, set, errors: e } = sf
  return (
    <>
      <p className="hint">A service can be offered in more than one way. Pick every place it can happen.</p>
      <Toggle id="f-svc-online" label="Online" checked={f.online} onChange={(v) => set({ online: v })} />
      {f.online && <AreaField id="f-svc-instr" label="Meeting link or instructions" rows={3} value={f.onlineInstructions ?? ''} error={e.onlineInstructions} onChange={(x) => set({ onlineInstructions: x.target.value || null })}
        hint="Only the buyer with a confirmed booking gets this." />}
      <Toggle id="f-svc-customer" label="At the customer's location" checked={f.atCustomer} onChange={(v) => set({ atCustomer: v })} />
      {f.atCustomer && (
        <div id="f-svc-area">
          <ServiceAreaEditor value={f.serviceArea} onChange={(v) => set({ serviceArea: v })} error={e.serviceArea} />
          <div className="grid2">
            <NumField id="f-svc-travelfee" label="Travel fee (USD)" optional value={f.travelFee} error={e.travelFee} onNumber={(v) => set({ travelFee: v })} />
            <NumField id="f-svc-travelbuf" label="Travel time between jobs (minutes)" value={f.travelBufferMinutes} error={e.travelBufferMinutes} onNumber={(v) => set({ travelBufferMinutes: v ?? 0 })}
              hint="Kept free before and after jobs at a customer's home." />
          </div>
        </div>
      )}
      <Toggle id="f-svc-seller" label="At my location" checked={f.atSeller} onChange={(v) => set({ atSeller: v })} />
      {f.atSeller && <TextField id="f-svc-address" label="Address customers come to" value={f.sellerAddress ?? ''} error={e.sellerAddress} onChange={(x) => set({ sellerAddress: x.target.value || null })} />}
    </>
  )
}

export function ServiceBooking({ sf }: P) {
  const { form: f, set, errors: e } = sf
  const upd = (i: number, p: Partial<IntakeQuestion>) => set({ intake: f.intake.map((q, k) => (k === i ? { ...q, ...p } : q)) })
  return (
    <>
      <SelectField id="f-svc-mode" label="How do bookings work?" value={f.bookingMode} error={e.bookingMode} onChange={(x) => set({ bookingMode: x.target.value as 'instant' | 'request' })}>
        <option value="instant">Instant booking: buyers book an open time right away</option><option value="request">Request to book: you approve each request</option>
      </SelectField>
      {f.bookingMode === 'request' && <NumField id="f-svc-approval" label="Answer within (hours)" value={f.approvalHours} error={e.approvalHours} onNumber={(v) => set({ approvalHours: v ?? 0 })} hint="Requests you don't answer in time are declined automatically." />}
      <SelectField id="f-svc-assign" label="Who does the job?" value={f.assignmentRule} error={e.assignmentRule} onChange={(x) => set({ assignmentRule: x.target.value as typeof f.assignmentRule })}>
        <option value="buyerchoice">The buyer chooses a team member</option><option value="leastbusy">Assign the least busy team member</option><option value="roundrobin">Take turns (round robin)</option>
      </SelectField>
      <fieldset className="plain">
        <legend>Questions for the buyer <span className="opt">(optional)</span></legend>
        {f.intake.map((q, i) => (
          <div key={i} className="intake-q">
            <div className="row tight">
              <TextField label={`Question ${i + 1}`} value={q.label} onChange={(x) => upd(i, { label: x.target.value })} />
              <SelectField label={`Answer type for question ${i + 1}`} value={q.type} onChange={(x) => upd(i, { type: x.target.value as IntakeQuestion['type'] })}><option value="text">Short text</option><option value="choice">Choose one</option><option value="yesno">Yes / no</option></SelectField>
              <Toggle label={`Required (question ${i + 1})`} checked={q.required} onChange={(v) => upd(i, { required: v })} />
              <Button type="button" variant="ghost" onClick={() => set({ intake: f.intake.filter((_, k) => k !== i) })}><PIcon name="trash" /><span className="sr-only">Remove question {i + 1}</span></Button>
            </div>
            {q.type === 'choice' && <TextField label={`Options for question ${i + 1}`} hint="Separate with commas (at least two)." value={(q.options ?? []).join(', ')} onChange={(x) => upd(i, { options: x.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />}
          </div>
        ))}
        {e.intake && <div className="field-error" role="alert">{e.intake}</div>}
        {f.intake.length < 20 && <Button type="button" onClick={() => set({ intake: [...f.intake, { label: '', type: 'text', required: false }] })}><PIcon name="plus" /> Add a question</Button>}
      </fieldset>
      <AreaField id="f-svc-req" label="What should the buyer prepare?" optional rows={3} value={f.requirements ?? ''} error={e.requirements} onChange={(x) => set({ requirements: x.target.value || null })} />
    </>
  )
}

export function ServicePolicies({ sf }: P) {
  const { form: f, set, errors: e } = sf
  return (
    <div className="grid2">
      <NumField id="f-svc-free" label="Free cancellation until (hours before)" value={f.cancelFreeHours} error={e.cancelFreeHours} onNumber={(v) => set({ cancelFreeHours: v ?? 0 })} />
      <NumField id="f-svc-fee" label="Fee after that (% of the price)" value={f.cancelFeePercent} error={e.cancelFeePercent} onNumber={(v) => set({ cancelFeePercent: v ?? 0 })}
        hint="Recorded and sent to the marketplace, which handles the money." />
      <NumField id="f-svc-resched" label="Reschedules allowed" value={f.maxReschedules} error={e.maxReschedules} onNumber={(v) => set({ maxReschedules: v ?? 0 })} />
      <NumField id="f-svc-noshow" label="No-show fee (% of the price)" value={f.noShowFeePercent} error={e.noShowFeePercent} onNumber={(v) => set({ noShowFeePercent: v ?? 0 })} />
    </div>
  )
}

export function ServiceProviders({ serviceId, readOnly, onChanged }: { serviceId: string; readOnly: boolean; onChanged: () => void }) {
  const [list, setList] = useState<ServiceProviderChoice[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { let alive = true; servicesApi.serviceProviders(serviceId).then((r) => alive && setList(r.providers)).catch(() => alive && setErr('Could not load your team.')); return () => { alive = false } }, [serviceId])
  const toggle = async (id: string, on: boolean) => {
    if (!list) return
    const next = list.map((p) => (p.membershipId === id ? { ...p, eligible: on } : p)); setList(next); setErr('')
    try { await servicesApi.setServiceProviders(serviceId, next.filter((p) => p.eligible).map((p) => p.membershipId)); onChanged() }
    catch (x) { setList(list); setErr((x as { message2?: string }).message2 ?? 'Could not save the team.') }
  }
  if (!list) return err ? <p role="alert" className="field-error">{err}</p> : <p>Loading your team…</p>
  if (list.length === 0) return <p>Nobody is set up as a service provider yet. An Owner or Admin can turn it on under <Link to="/settings/availability">Availability</Link>.</p>
  return (
    <fieldset className="plain" disabled={readOnly}>
      <legend>Who can perform this service?</legend>
      <ul className="plainlist">
        {list.map((p) => <li key={p.membershipId}><Toggle id={`prov-${p.membershipId}`} label={`${p.email} (${p.role})`} checked={p.eligible} onChange={(v) => void toggle(p.membershipId, v)} /></li>)}
      </ul>
      <p className="hint">Each provider also needs working hours (Availability) before buyers can book them.</p>
      <div className="field-error" role="alert">{err}</div>
    </fieldset>
  )
}
