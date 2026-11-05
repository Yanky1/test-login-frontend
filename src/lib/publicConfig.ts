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
