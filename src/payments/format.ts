/** Money and dates of the Payments pages. */

const digitsCache = new Map<string, number>()
/** Minor-unit digits of a currency (2 for USD, 0 for JPY, 3 for KWD), from Intl. */
export const currencyDigits = (currency: string): number => {
  let d = digitsCache.get(currency)
  if (d === undefined) {
    try { d = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2 } catch { d = 2 }
    digitsCache.set(currency, d)
  }
  return d
}

/** Amount in minor units -> text with the currency's real decimals (1500 JPY is ¥1,500, 1500 USD is $15.00). */
export const money = (minor: number | null | undefined, currency = 'USD'): string => {
  if (minor == null) return ''
  const digits = currencyDigits(currency)
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits)
  } catch { return `${(minor / 100).toFixed(2)} ${currency}` }
}

/** A date that Stripe/the server sends as a UTC instant but means as a calendar day (transfer day, payout arrival, evidence deadline): shown in UTC, never shifted by the viewer's zone. */
export const dayUtc = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }) : ''

/** Only Stripe's own hosts (and, in development builds, the fake provider's host) may receive the browser. */
export function isStripeUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const h = u.hostname.toLowerCase()
  return h === 'stripe.com' || h.endsWith('.stripe.com') || (import.meta.env.DEV && h === 'connect.fake-stripe.test')
}
