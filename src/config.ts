export interface RuntimeConfig {
  idleTimeoutMinutes: number
  warningSeconds: number
  refreshIntervalMinutes: number
  turnstileSiteKey?: string
  features: { apple: boolean }
}

export const defaultConfig: RuntimeConfig = {
  idleTimeoutMinutes: 15,
  warningSeconds: 60,
  refreshIntervalMinutes: 5,
  features: { apple: false },
}

/** Loads /config.json at runtime so timings can change without a rebuild. */
export async function loadConfig(): Promise<RuntimeConfig> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (!res.ok) return defaultConfig
    const j = (await res.json()) as Partial<RuntimeConfig>
    return { ...defaultConfig, ...j, features: { ...defaultConfig.features, ...j.features } }
  } catch {
    return defaultConfig
  }
}
