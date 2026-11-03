import { useCallback, useRef, useState } from 'react'
import { ApiError } from '../api'
import { useAutosave } from '../products/useAutosave'
import { productsApi } from '../products/api'
import type { EditorApi } from '../products/useProductEditor'
import { servicesApi } from './api'
import type { ServiceDetails } from './types'

export const DEFAULT_SERVICE: ServiceDetails = {
  pricingModel: 'fixed', price: null, minMinutes: null, maxMinutes: null, incrementMinutes: 60, defaultDurationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
  minNoticeHours: 24, maxAdvanceDays: 60, slotGranularityMinutes: 30, online: false, onlineInstructions: null, atCustomer: false, serviceArea: { postalCodes: [], radius: null },
  travelFee: null, travelBufferMinutes: 0, atSeller: false, sellerAddress: null, bookingMode: 'instant', approvalHours: 24, intake: [], requirements: null, addOns: [],
  cancelFreeHours: 24, cancelFeePercent: 0, maxReschedules: 2, noShowFeePercent: 100, assignmentRule: 'buyerchoice', readyProviders: 0,
}

/** Request body of PUT /seller/services/{id}/details from the local form (server enum names are case-insensitive). */
export const toWrite = (s: ServiceDetails, version: number) => ({
  version, pricingModel: s.pricingModel, price: s.price, minMinutes: s.minMinutes, maxMinutes: s.maxMinutes, incrementMinutes: s.incrementMinutes, defaultDurationMinutes: s.defaultDurationMinutes,
  bufferBeforeMinutes: s.bufferBeforeMinutes, bufferAfterMinutes: s.bufferAfterMinutes, minNoticeHours: s.minNoticeHours, maxAdvanceDays: s.maxAdvanceDays, slotGranularityMinutes: s.slotGranularityMinutes,
  online: s.online, onlineInstructions: s.onlineInstructions, atCustomer: s.atCustomer, serviceArea: s.serviceArea, travelFee: s.travelFee, travelBufferMinutes: s.travelBufferMinutes,
  atSeller: s.atSeller, sellerAddress: s.sellerAddress, bookingMode: s.bookingMode, approvalHours: s.approvalHours, intake: s.intake, requirements: s.requirements,
  addOns: s.addOns, cancelFreeHours: s.cancelFreeHours, cancelFeePercent: s.cancelFeePercent, maxReschedules: s.maxReschedules, noShowFeePercent: s.noShowFeePercent, assignmentRule: s.assignmentRule,
})

/**
 * Local copy of the service sections with autosave for drafts (manual "Save" for live listings, like the product form).
 * It saves through the editor's serial queue and keeps the listing version in step so the main autosave never sees a stale token.
 */
export function useServiceDetails(ed: EditorApi) {
  const [form, setForm] = useState<ServiceDetails>(ed.detail.service ?? DEFAULT_SERVICE)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const formRef = useRef(form); formRef.current = form
  const doSave = useCallback(() => ed.enqueue(async () => {
    try {
      await ed.save.flush().catch(() => undefined)
      const fresh = await productsApi.get(ed.detail.id)            // the current version token (the main form may have saved just before)
      const d = await servicesApi.saveDetails(ed.detail.id, toWrite(formRef.current, fresh.version))
      ed.patchDetail({ version: d.version, issues: d.issues, canPublish: d.canPublish, qualityScore: d.qualityScore, status: d.status, service: d.service, updatedAt: d.updatedAt })
      setErrors({})
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 400) setErrors(e.fieldErrors())
        else if (e.status === 422 && Array.isArray(e.body?.extra)) ed.patchDetail({ issues: e.body.extra, canPublish: false })
      }
      throw e
    }
  }), [ed])
  const save = useAutosave(doSave, 1500, ed.live)
  const set = useCallback((patch: Partial<ServiceDetails>) => {
    setForm((f) => ({ ...f, ...patch }))
    setErrors((e) => { const n = { ...e }; for (const k of Object.keys(patch)) delete n[k]; return n })
    save.touch()
  }, [save])
  return { form, set, errors, save, setErrors }
}
export type ServiceForm = ReturnType<typeof useServiceDetails>
