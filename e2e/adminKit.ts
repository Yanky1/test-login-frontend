import { createHash, createHmac, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, ADMIN } from './helpers'
import type { APIRequestContext, Page } from '@playwright/test'

export const STAFF_PASSWORD = 'Staff-Passw0rd-Test!x'
export const INBOUND = 'e2e-inbound-secret-0123456789abcdef'
const E2E_DIR = path.resolve('.e2e')
const SECRET_FILE = path.join(E2E_DIR, 'admin-staff.json')

export interface Staff { email: string; password: string; secret: string; role: string }

/** RFC 6238 (SHA-1, 30 s, 6 digits) for a base32 key: the same code an authenticator app shows. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, acc = 0; const bytes: number[] = []
  for (const ch of secret.replace(/[ =]/g, '').toUpperCase()) { acc = (acc << 5) | alphabet.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((acc >> (bits - 8)) & 0xff); bits -= 8 } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const o = h[h.length - 1] & 0x0f
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}

const post = (request: APIRequestContext, p: string, data: object, token?: string) =>
  request.post(`/api/v1/admin${p}`, { data, headers: token ? { Authorization: `Bearer ${token}` } : {} })

export async function enrol2fa(request: APIRequestContext, email: string, password: string): Promise<string> {
  const setup = await post(request, '/auth/2fa/setup', { email, password })
  expect(setup.status(), await setup.text()).toBe(200)
  const secret = (await setup.json()).sharedKey as string
  const en = await post(request, '/auth/2fa/enable', { email, password, code: totp(secret) })
  expect(en.status(), await en.text()).toBe(200)
  return secret
}

export async function apiLogin(request: APIRequestContext, s: Staff): Promise<string> {
  const r = await post(request, '/auth/login', { email: s.email, password: s.password, totpCode: totp(s.secret) })
  expect(r.status(), await r.text()).toBe(200)
  return (await r.json()).accessToken as string
}

export async function apiStepUp(request: APIRequestContext, token: string, s: Staff) {
  const r = await post(request, '/auth/step-up', { code: totp(s.secret) }, token)
  expect(r.status(), await r.text()).toBe(200)
}

/** The seeded admin (legacy Admin role = Super admin). Enrols two-factor once per database and remembers the key next to it. */
export async function superAdmin(request: APIRequestContext): Promise<Staff> {
  fs.mkdirSync(E2E_DIR, { recursive: true })
  const known = fs.existsSync(SECRET_FILE) ? (JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')) as { admin?: Staff; others?: Record<string, Staff> }) : {}
  if (known.admin) return known.admin
  const setup = await post(request, '/auth/2fa/setup', { email: ADMIN.email, password: ADMIN.password })
  if (setup.status() === 409) throw new Error('The seeded admin already has two-factor enabled but its key is unknown: delete the .e2e folder and run again.')
  expect(setup.status(), await setup.text()).toBe(200)
  const secret = (await setup.json()).sharedKey as string
  expect((await post(request, '/auth/2fa/enable', { email: ADMIN.email, password: ADMIN.password, code: totp(secret) })).status()).toBe(200)
  const admin: Staff = { email: ADMIN.email, password: ADMIN.password, secret, role: 'SuperAdmin' }
  fs.writeFileSync(SECRET_FILE, JSON.stringify({ ...known, admin }))
  return admin
}

/** A new staff member with the given role, created the way the product does it: Super admin invites (step-up), invitee accepts, enrols two-factor. */
export async function staffMember(request: APIRequestContext, role: 'Support' | 'Moderator' | 'ReadOnly' | 'SuperAdmin'): Promise<Staff> {
  const sa = await superAdmin(request)
  const token = await apiLogin(request, sa)
  await apiStepUp(request, token, sa)
  const email = `staff-${role.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.com`
  const inv = await post(request, '/staff/invitations', { email, role, reason: 'E2E: new staff member' }, token)
  expect(inv.status(), await inv.text()).toBe(200)
  let text = ''
  await expect.poll(async () => {
    const res = await request.get(`/api/test/emails?to=${encodeURIComponent(email)}&kind=staff-invite`)
    const list = (await res.json()) as { Text?: string; text?: string }[]
    text = list.at(-1)?.Text ?? list.at(-1)?.text ?? ''
    return text
  }, { timeout: 10_000 }).not.toBe('')
  const tok = decodeURIComponent(/token=([^\s&]+)/.exec(text)![1])
  const acc = await post(request, '/auth/accept-invite', { email, token: tok, password: STAFF_PASSWORD })
  expect(acc.status(), await acc.text()).toBe(204)
  return { email, password: STAFF_PASSWORD, secret: await enrol2fa(request, email, STAFF_PASSWORD), role }
}

/** Staff sign-in through the real form: password, then the authenticator code. */
export async function uiStaffLogin(page: Page, s: Staff, path = '/admin') {
  await page.goto(path === '/admin' ? '/admin/login' : path)
  await page.getByLabel('Email').fill(s.email)
  await page.getByLabel('Password', { exact: true }).fill(s.password)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Authenticator code').fill(totp(s.secret))
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(page.getByRole('navigation', { name: 'Staff areas' })).toBeVisible()
}

/** Marketplace-signed request to the internal API (same signing as the real marketplace). */
export async function signedPost(request: APIRequestContext, p: string, body: object) {
  const raw = Buffer.from(JSON.stringify(body))
  const ts = Math.floor(Date.now() / 1000).toString(); const nonce = randomUUID().replace(/-/g, '')
  const canonical = `${ts}\n${nonce}\nPOST\n${p}\n${createHash('sha256').update(raw).digest('hex')}`
  const sig = 'v1=' + createHmac('sha256', INBOUND).update(canonical).digest('hex')
  return request.post(p, { data: raw, headers: { 'Content-Type': 'application/json', 'X-Solvelt-Timestamp': ts, 'X-Solvelt-Nonce': nonce, 'X-Solvelt-Signature': sig } })
}

export async function placeOrder(request: APIRequestContext, s: { sellerId: string; h: Record<string, string> }, productId: string) {
  const brand = ((await (await request.get('/api/v1/brands', { headers: s.h })).json()) as { id: string }[])[0].id
  const r = await signedPost(request, '/api/internal/v1/orders', {
    marketplaceOrderId: 'MP-' + randomUUID().slice(0, 10).toUpperCase(), placedAt: new Date().toISOString(), currency: 'USD',
    buyer: { displayName: 'Jane Buyer', relayEmail: 'relay-abc@relay.solvelt.example', phone: '+1 555 000 1111' },
    shippingAddress: { name: 'Jane Buyer', line1: '1 Main St', line2: 'Apt 2', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US' },
    shippingMethod: 'Standard', shippingSpeed: 'standard',
    lines: [{ marketplaceLineId: 'L1', sellerId: s.sellerId, brandId: brand, productId, quantity: 1, unitPriceCents: 1999, discountCents: 0, taxCents: 0 }],
    shipping: [{ sellerId: s.sellerId, brandId: brand, amountCents: 500 }],
  })
  expect(r.status(), await r.text()).toBe(201)
  const o = (await r.json()).orders[0]
  return { id: o.sellerOrderId as string, number: o.number as string }
}

/** Inserts a dead-lettered outbox event straight into the e2e database (nothing in the product can make one on demand). */
export function insertDeadLetter(): { id: string; aggregate: string } {
  const id = randomUUID().toUpperCase(); const aggregate = 'agg-' + id.slice(0, 6)
  const payload = JSON.stringify({ orderId: 'o-1', buyer: { displayName: 'Jane Buyer', relayEmail: 'jane@example.com' }, shipTo: { line1: '1 Main St', postalCode: '11201' }, totalCents: 1999 })
  const code = `import sqlite3,sys\nc=sqlite3.connect(sys.argv[1], timeout=20)\nc.execute("INSERT INTO outbox_messages (Id,EventType,SellerId,AggregateId,PayloadJson,Status,Attempts,CreatedAt,NextAttemptAt,DeliveredAt,LastError,LockedUntil) VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now','+1 hour'),NULL,?,NULL)",(sys.argv[2],'order.accepted',None,sys.argv[3],sys.argv[4],'Dead',8,'HTTP 500 for jane@example.com'))\nc.commit()`
  execFileSync('python3', ['-c', code, path.join(E2E_DIR, 'e2e.db'), id, aggregate, payload])
  return { id, aggregate }
}
