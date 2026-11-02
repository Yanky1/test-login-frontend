/* eslint-disable @typescript-eslint/no-explicit-any */
export const passkeysSupported = () =>
  typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials

export async function conditionalUiAvailable(): Promise<boolean> {
  try {
    return passkeysSupported() && (await (PublicKeyCredential as any).isConditionalMediationAvailable?.()) === true
  } catch {
    return false
  }
}

export async function createCredential(optionsJson: unknown): Promise<unknown> {
  const publicKey = (PublicKeyCredential as any).parseCreationOptionsFromJSON(optionsJson)
  const cred = (await navigator.credentials.create({ publicKey })) as any
  if (!cred) throw new Error('No credential created')
  return cred.toJSON()
}

export async function getCredential(optionsJson: unknown, opts: { conditional?: boolean; signal?: AbortSignal } = {}): Promise<unknown> {
  const publicKey = (PublicKeyCredential as any).parseRequestOptionsFromJSON(optionsJson)
  const cred = (await navigator.credentials.get({
    publicKey,
    ...(opts.conditional ? { mediation: 'conditional' as CredentialMediationRequirement } : {}),
    signal: opts.signal,
  })) as any
  if (!cred) throw new Error('No credential')
  return cred.toJSON()
}
