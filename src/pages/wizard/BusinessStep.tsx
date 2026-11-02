import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, ApiError } from '../../api'
import { usePublicConfig } from '../../lib/publicConfig'
import { Alert, Field } from '../../components/ui'
import { StepFrame, useWizard, type Application } from './shared'

const schema = z.object({
  vendorName: z.string().trim().min(2, 'Enter your business name').max(200),
  contactName: z.string().trim().min(1, 'Enter a contact name').max(120),
  contactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number'),
  addressLine1: z.string().trim().min(1, 'Enter your street address').max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, 'Enter your city').max(100),
  region: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().min(1, 'Enter your postal code').max(20),
  country: z.string().trim().length(2, 'Use a 2-letter country code, e.g. US'),
  smsOptIn: z.boolean(),
})
type Form = z.infer<typeof schema>

export default function BusinessStep() {
  const { app, setApp } = useWizard()
  const nav = useNavigate()
  const pub = usePublicConfig()
  const b = app.business
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema), mode: 'onBlur', reValidateMode: 'onChange',
    defaultValues: { vendorName: b.vendorName ?? '', contactName: b.contactName ?? '', contactPhone: b.contactPhone ?? '', addressLine1: b.addressLine1 ?? '',
      addressLine2: b.addressLine2 ?? '', city: b.city ?? '', region: b.region ?? '', postalCode: b.postalCode ?? '', country: b.country ?? '', smsOptIn: b.smsOptIn },
  })
  const [msg, setMsg] = useState<string | null>(null)
  const onSubmit = async (v: Form) => {
    setMsg(null)
    try {
      setApp(await api<Application>('/seller/application/business', { method: 'PUT', body: v }))
      nav('/signup/kosher')
    } catch (e) {
      if (e instanceof ApiError) {
        const fe = e.fieldErrors(); let any = false
        for (const [k, m] of Object.entries(fe)) { setError(k as keyof Form, { message: m }); any = true }
        if (!any) setMsg(e.status === 409 ? 'This application can no longer be edited.' : 'Could not save. Please try again.')
      }
    }
  }
  return (
    <StepFrame index={2}>
      <h1 tabIndex={-1}>Business details</h1>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field label="Business name" autoComplete="organization" error={errors.vendorName?.message} {...register('vendorName')} />
        <Field label="Contact name" autoComplete="name" error={errors.contactName?.message} {...register('contactName')} />
        <Field label="Phone" type="tel" autoComplete="tel" error={errors.contactPhone?.message} {...register('contactPhone')} />
        <Field label="Address line 1" autoComplete="address-line1" error={errors.addressLine1?.message} {...register('addressLine1')} />
        <Field label="Address line 2 (optional)" autoComplete="address-line2" error={errors.addressLine2?.message} {...register('addressLine2')} />
        <div className="grid2">
          <Field label="City" autoComplete="address-level2" error={errors.city?.message} {...register('city')} />
          <Field label="State / region" autoComplete="address-level1" error={errors.region?.message} {...register('region')} />
          <Field label="Postal code" autoComplete="postal-code" error={errors.postalCode?.message} {...register('postalCode')} />
          <Field label="Country (2-letter code)" autoComplete="country" maxLength={2} error={errors.country?.message} {...register('country')} />
        </div>
        <div className="field check">
          <label><input type="checkbox" {...register('smsOptIn')} /> {pub?.smsWording ?? 'I agree to receive text messages about my seller account.'}</label>
          <div className="hint">Optional. No messages are sent yet; we only record your consent.</div>
        </div>
        <Alert>{msg}</Alert>
        <div className="nav-row">
          <button type="button" className="btn" onClick={() => nav('/signup/verify')}>← Back</button>
          <button className="btn primary" disabled={isSubmitting}>Continue</button>
        </div>
      </form>
    </StepFrame>
  )
}
