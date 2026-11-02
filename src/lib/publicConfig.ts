import { useEffect, useState } from 'react'
import { api } from '../api'

export interface PublicConfig {
  marketplaceUrl: string
  termsVersion: string
  sellerAgreementVersion: string
  smsWording: string
  smsWordingVersion: string
  turnstileSiteKey: string
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
