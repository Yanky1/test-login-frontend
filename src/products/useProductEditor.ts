import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api'
import { productsApi } from './api'
import { syncVariants } from './lib/variants'
import type { AttrConfig, Faq, ImageDto, Issue, OptionDto, ProductDetail, ProductForm, VariantDto } from './types'
import { useAutosave } from './useAutosave'

export const toForm = (d: ProductDetail): ProductForm => ({
  version: d.version, brandId: d.brandId, categoryId: d.categoryId, title: d.title, handle: d.handle, condition: d.condition, conditionNote: d.conditionNote, sku: d.sku,
  price: d.price, compareAtPrice: d.compareAtPrice, salePrice: d.salePrice, saleStart: d.saleStart, saleEnd: d.saleEnd, cost: d.cost,
  quantity: d.quantity, lowStockAlert: d.lowStockAlert, allowBackorder: d.allowBackorder, maxPerOrder: d.maxPerOrder, barcode: d.barcode, noBarcode: d.noBarcode,
  bullets: d.bullets, description: d.description, weightGrams: d.weightGrams, lengthCm: d.lengthCm, widthCm: d.widthCm, heightCm: d.heightCm, handlingDays: d.handlingDays,
  shipping: d.shipping, localPickup: d.localPickup, returnsDays: d.returnsDays, returnsCondition: d.returnsCondition, warrantyMonths: d.warrantyMonths, warrantyNote: d.warrantyNote,
  searchTerms: d.searchTerms, metaTitle: d.metaTitle, metaDescription: d.metaDescription, hasVariants: d.hasVariants, attributes: d.attributes ?? {},
})

/** Server-computed values that must refresh after a save without touching what the seller is typing. */
const derived = (d: ProductDetail) => ({
  version: d.version, status: d.status, margin: d.margin, currentPrice: d.currentPrice, onSale: d.onSale, available: d.available, barcodeCheck: d.barcodeCheck,
  descriptionHtml: d.descriptionHtml, qualityScore: d.qualityScore, canPublish: d.canPublish, issues: d.issues, updatedAt: d.updatedAt, publishedAt: d.publishedAt, handle: d.handle,
})

export type Errors = Record<string, string>
export interface EditorApi {
  detail: ProductDetail; form: ProductForm; errors: Errors; set: (patch: Partial<ProductForm>) => void
  options: OptionDto[]; variants: VariantDto[]; faqs: Faq[]
  setVariantState: (options: OptionDto[], variants: VariantDto[]) => void
  setFaqs: (f: Faq[]) => void
  images: ImageDto[]; setImages: (i: ImageDto[] | ((prev: ImageDto[]) => ImageDto[]), q?: { qualityScore: number; canPublish: boolean }) => void
  attrConfig: AttrConfig[]; changeCategory: (id: string | null) => Promise<void>
  issues: Issue[]; score: number; canPublish: boolean
  /** All server writes of this editor are serialised so a save never races an image upload (optimistic-concurrency token). */
  enqueue: <T>(fn: () => Promise<T>) => Promise<T>
  refreshReadiness: () => Promise<void>
  save: ReturnType<typeof useAutosave>
  conflict: boolean; resolveConflict: (keepMine: boolean) => Promise<void>
  live: boolean
  patchDetail: (p: Partial<ProductDetail>) => void
  replaceDetail: (d: ProductDetail) => void
}

export function useProductEditor(initial: ProductDetail): EditorApi {
  const [detail, setDetail] = useState(initial)
  const [form, setForm] = useState(() => toForm(initial))
  const [options, setOptions] = useState<OptionDto[]>(initial.options)
  const [variants, setVariants] = useState<VariantDto[]>(initial.variants)
  const [faqs, setFaqsState] = useState<Faq[]>(initial.faqs)
  const [attrConfig, setAttrConfig] = useState<AttrConfig[]>(initial.attributeConfig ?? [])
  const [errors, setErrors] = useState<Errors>({})
  const [conflict, setConflict] = useState(false)
  const formRef = useRef(form); formRef.current = form
  const optRef = useRef(options); optRef.current = options
  const varRef = useRef(variants); varRef.current = variants
  const faqRef = useRef(faqs); faqRef.current = faqs
  const dirtyVariants = useRef(false); const dirtyFaqs = useRef(false)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const versionRef = useRef(initial.version)

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(fn, fn)
    chain.current = next.catch(() => undefined)
    return next
  }, [])

  const absorb = useCallback((d: ProductDetail) => { versionRef.current = d.version; setDetail((cur) => ({ ...cur, ...derived(d) })) }, [])

  const doSave = useCallback(() => enqueue(async () => {
    try {
      const f = { ...formRef.current, version: versionRef.current }
      const saved = await productsApi.save(detail.id, f)
      absorb(saved); setErrors({}); setConflict(false)
      if (dirtyVariants.current) {
        dirtyVariants.current = false
        const sent = { o: JSON.stringify(optRef.current), v: JSON.stringify(varRef.current) }
        const d = await productsApi.setVariants(detail.id, { hasVariants: formRef.current.hasVariants, options: optRef.current, variants: varRef.current })
        absorb(d); setDetail((cur) => ({ ...cur, images: d.images }))
        // adopt server ids only if the seller did not keep typing meanwhile
        if (sent.o === JSON.stringify(optRef.current) && sent.v === JSON.stringify(varRef.current)) { setOptions(d.options); setVariants(d.variants) }
        else setVariants((cur) => cur.map((v) => v.id ? v : { ...v, id: d.variants.find((x) => x.values.join('|') === v.values.join('|'))?.id }))
      }
      if (dirtyFaqs.current) {
        dirtyFaqs.current = false
        const r = await productsApi.setFaqs(detail.id, faqRef.current)
        setFaqsState((cur) => (JSON.stringify(cur.map((x) => [x.question, x.answer])) === JSON.stringify(r.faqs.map((x) => [x.question, x.answer])) ? r.faqs : cur))
      }
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409 && e.body?.code === 'version_conflict') setConflict(true)
        else if (e.status === 400) setErrors(e.fieldErrors())
        else if (e.status === 422 && Array.isArray(e.body?.extra)) setDetail((cur) => ({ ...cur, issues: e.body.extra, canPublish: false }))
      }
      if (dirtyVariants.current === false && e instanceof ApiError && e.status === 400 && Object.keys(e.fieldErrors()).some((k) => k.startsWith('options') || k.startsWith('variants'))) dirtyVariants.current = true
      throw e
    }
  }), [detail.id, absorb, enqueue])

  const live = detail.status === 'Active'
  const save = useAutosave(doSave, 1200, live)

  const set = useCallback((patch: Partial<ProductForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setErrors((e) => { const n = { ...e }; for (const k of Object.keys(patch)) delete n[k]; return n })
    save.touch()
  }, [save])

  const setVariantState = useCallback((o: OptionDto[], v: VariantDto[]) => {
    setOptions(o); setVariants(v); dirtyVariants.current = true; save.touch()
  }, [save])
  const setFaqs = useCallback((f: Faq[]) => { setFaqsState(f); dirtyFaqs.current = true; save.touch() }, [save])

  const setImages = useCallback((images: ImageDto[] | ((prev: ImageDto[]) => ImageDto[]), q?: { qualityScore: number; canPublish: boolean }) =>
    setDetail((d) => ({ ...d, images: typeof images === 'function' ? images(d.images) : images, ...(q ? { qualityScore: q.qualityScore, canPublish: q.canPublish } : {}) })), [])

  const changeCategory = useCallback(async (id: string | null) => {
    // details of the old category are cleared immediately (the server drops them as well)
    setForm((f) => ({ ...f, categoryId: id, attributes: {} })); save.touch()
    setAttrConfig(id ? await productsApi.categoryAttributes(id) : [])
  }, [save])

  const refreshReadiness = useCallback(async () => {
    const r = await productsApi.readiness(detail.id)
    setDetail((d) => ({ ...d, issues: r.issues, qualityScore: r.score, canPublish: r.canPublish }))
  }, [detail.id])

  const replaceDetail = useCallback((d: ProductDetail) => {
    versionRef.current = d.version; setDetail(d); setForm(toForm(d)); setOptions(d.options); setVariants(d.variants); setFaqsState(d.faqs); setAttrConfig(d.attributeConfig ?? []); setErrors({}); setConflict(false)
  }, [])

  const resolveConflict = useCallback(async (keepMine: boolean) => {
    const latest = await productsApi.get(detail.id)
    if (keepMine) { versionRef.current = latest.version; setConflict(false); save.touch(); await save.flush() } else replaceDetail(latest)
  }, [detail.id, replaceDetail, save])

  // keep the grid in step with the options (new combinations appear, removed ones disappear)
  useEffect(() => { /* grid sync is done by the Variations section through setVariantState */ }, [])

  return useMemo(() => ({
    detail, form, errors, set, options, variants, faqs, setVariantState, setFaqs, images: detail.images, setImages, attrConfig, changeCategory,
    issues: detail.issues, score: detail.qualityScore, canPublish: detail.canPublish, enqueue, refreshReadiness, save, conflict, resolveConflict, live,
    patchDetail: (p) => { if (p.version !== undefined) versionRef.current = p.version; setDetail((d) => ({ ...d, ...p })) }, replaceDetail,
  }), [detail, form, errors, set, options, variants, faqs, setVariantState, setFaqs, setImages, attrConfig, changeCategory, enqueue, refreshReadiness, save, conflict, resolveConflict, live, replaceDetail])
}

export { syncVariants }
