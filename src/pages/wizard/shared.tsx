import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { api, ApiError } from '../../api'
import type { FieldConfig } from '../../lib/kosher'
import { Icon, Shell, Spinner } from '../../components/ui'

export const STEPS = [
  { key: 'account', label: 'Account' },
  { key: 'verify', label: 'Verify' },
  { key: 'business', label: 'Business' },
  { key: 'kosher', label: 'Kosher' },
  { key: 'review', label: 'Review' },
  { key: 'pending', label: 'Pending approval' },
] as const

export interface Application {
  sellerId: string
  status: 'Draft' | 'PendingReview' | 'NeedsInfo' | 'Approved' | 'Live' | 'Rejected' | 'Suspended'
  statusNote: string | null
  draftStep: number
  editable: boolean
  business: { vendorName: string | null; contactName: string | null; contactPhone: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null; smsOptIn: boolean }
  kosher: { answers: Record<string, string>; certificate: { id: string; name: string; size: number; contentType: string } | null }
  legal: { termsVersion: string | null; termsAcceptedAt: string | null; sellerAgreementVersion: string | null; sellerAgreementAcceptedAt: string | null }
  marketplaceUrl: string
}

interface Ctx { app: Application; fields: FieldConfig[]; setApp: (a: Application) => void; reload: () => Promise<void> }
const WizardCtx = createContext<Ctx | null>(null)
export const useWizard = () => {
  const c = useContext(WizardCtx)
  if (!c) throw new Error('Wizard context missing')
  return c
}

/** Where the server-side draft says the user should be. */
export function stepPath(app: Application): string {
  if (app.status !== 'Draft' && app.status !== 'NeedsInfo') return '/signup/pending'
  if (app.status === 'NeedsInfo') return '/signup/business'
  const idx = Math.min(Math.max(app.draftStep, 3), 5)
  return `/signup/${STEPS[idx - 1].key}`
}

export function ProgressBar({ current }: { current: number }) {
  return (
    <nav aria-label="Progress">
      <div role="progressbar" aria-label="Sign-up progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={current + 1} aria-valuetext={`Step ${current + 1} of ${STEPS.length}: ${STEPS[current].label}`} className="progress">
        <div className="progress-fill" style={{ width: `${((current + 1) / STEPS.length) * 100}%` }} />
      </div>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === current ? 'step' : undefined} className={i < current ? 'done' : i === current ? 'current' : ''}>
            <span className="dot">{i < current ? '✓' : i + 1}</span><span className="lbl">{s.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function StepFrame({ index, children }: { index: number; children: ReactNode }) {
  return (
    <Shell>
      <main className="card wide">
        <ProgressBar current={index} />
        {children}
        {index > 0 && index < 5 && <p className="saved"><Icon name="save" /> Your progress is saved. You can close this tab and pick up where you left off.</p>}
      </main>
    </Shell>
  )
}

/** Loads the server-side draft + branching config for the authenticated wizard steps. */
export function WizardLayout() {
  const [app, setApp] = useState<Application | null>(null)
  const [fields, setFields] = useState<FieldConfig[]>([])
  const [error, setError] = useState<number | null>(null)
  const loc = useLocation()

  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const reload = useCallback(async () => {
    try {
      const [a, f] = await Promise.all([api<Application>('/seller/application'), api<FieldConfig[]>('/seller/field-config')])
      if (!alive.current) return // unmounted while the request was in flight
      setApp(a); setFields(f)
    } catch (e) { if (alive.current) setError(e instanceof ApiError ? e.status : 0) }
  }, [])
  useEffect(() => { void reload() }, [reload])

  if (error === 403 || error === 404) return <Shell split><main className="card"><p>This account has no seller application.</p></main></Shell>
  if (!app) return <div className="center"><Spinner /></div>
  // Guard against skipping ahead of the saved draft
  const want = STEPS.findIndex((s) => loc.pathname.endsWith('/' + s.key)) + 1
  const draftOk = app.status === 'Draft' ? want >= 3 && want <= Math.max(app.draftStep, 3) : app.status === 'NeedsInfo' ? want >= 3 && want <= 5 : want === 6
  if (!draftOk) return <Navigate to={stepPath(app)} replace />
  return <WizardCtx.Provider value={{ app, fields, setApp, reload }}><Outlet /></WizardCtx.Provider>
}
