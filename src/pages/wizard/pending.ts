const KEY = 'pendingEmail'

/** The address a sign-up is waiting to verify. Not a secret; kept for the tab session so a reload of the Verify step still works. */
export const rememberPendingEmail = (email: string) => { try { sessionStorage.setItem(KEY, email) } catch { /* ignore */ } }
export const pendingEmail = (): string => { try { return sessionStorage.getItem(KEY) ?? '' } catch { return '' } }
export const forgetPendingEmail = () => { try { sessionStorage.removeItem(KEY) } catch { /* ignore */ } }
