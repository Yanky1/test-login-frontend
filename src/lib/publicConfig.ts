import { useEffect, useState } from 'react'
import { api } from '../api'

export interface PublicConfig {
  marketplaceUrl: string
  termsVersion: string
  sellerAgreementVersion: string
  smsWording: string
  smsWordingVersion: string
  turnstileSiteKey: string
  /** Test mode: the server offers the demo-data tools (backend Demo:Enabled). Absent/false in production. */
  demoEnabled?: boolean
  /** Test sites only: the server also lets staff skip two-factor for one session (backend Demo:Enabled AND Demo:AllowStaffMfaSkip). */
  staffMfaSkipEnabled?: boolean
  /** Google sign-in is configured on the server (backend App Google client id set). Absent/false: the Google buttons are hidden. */
  googleEnabled?: boolean
}

let cached: PublicConfig | null = null

export function usePublicConfig(): PublicConfig | null {
  const [cfg, setCfg] = useState<PublicConfig | null>(cached)
  useEffect(() => {
    if (cached) return
    api<PublicConfig>('/public-config', { auth: false }).then((c) => { cached = c; setCfg(c) }).catch(() => undefined)
  }, [])
  return cfg
}

export const resetPublicConfigCache = () => { cached = null }

/** True only when the server says demo (test) mode is on. Until the config is known it is false, so nothing flashes in production. */
export const useDemoEnabled = (): boolean => usePublicConfig()?.demoEnabled === true

/** The staff "Skip two-factor (test mode)" button: only when the server says BOTH demo mode and the staff skip are on. */
export const useStaffMfaSkip = (): boolean => { const c = usePublicConfig(); return c?.demoEnabled === true && c?.staffMfaSkipEnabled === true }

/** Google buttons only when the server says Google sign-in is configured (otherwise /auth/external/google/start answers 404). */
export const useGoogleEnabled = (): boolean => usePublicConfig()?.googleEnabled === true
