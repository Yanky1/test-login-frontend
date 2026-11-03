import type { APIRequestContext, Browser, Page } from '@playwright/test'
import { test, expect, baseConfig, PASSWORD, newEmail, createSeller, lastMail, uiLogin, dismissPasskeyOffer, expectNoSeriousA11y } from './helpers'

const BUSINESS = (name: string) => ({ vendorName: name, contactName: 'Dana', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false })

async function token(request: APIRequestContext, email: string, password = PASSWORD) {
  const r = await request.post('/api/v1/auth/login', { data: { email, password } })
  expect(r.ok()).toBeTruthy()
  return (await r.json()).accessToken as string
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

async function seller(request: APIRequestContext, name: string) {
  const s = await createSeller(request)
  const t = await token(request, s.email)
  expect((await request.put('/api/v1/seller/application/business', { headers: bearer(t), data: BUSINESS(name) })).ok()).toBeTruthy()
  return { ...s, token: t }
}
async function inviteToken(request: APIRequestContext, to: string) {
  const text = await lastMail(request, to, 'team-invitation')
  return /\/invite\/([A-Za-z0-9_-]+)/.exec(text)![1]
}
async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await uiLogin(page, email)
  await dismissPasskeyOffer(page)
}
async function logOut(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login/)
}
async function freshPage(browser: Browser) {
  const ctx = await browser.newContext()
  await ctx.route('**/config.json', (r) => r.fulfill({ json: baseConfig }))
  return ctx.newPage()
}

test('owner invites a Manager scoped to one brand; the invitee (new user) joins and sees only that brand', async ({ page, request }) => {
  const owner = await seller(request, 'Alpha Bakery')
  await signIn(page, owner.email)
  // Brands: add a second brand through the UI
  await page.goto('/settings/brands')
  await expect(page.getByRole('heading', { name: 'Brands' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Brands' }).locator('strong', { hasText: 'Alpha Bakery' })).toBeVisible() // default brand named after the business
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Add a brand' }).click()
  await expectNoSeriousA11y(page) // dialog open
  await page.getByLabel('Brand name').fill('Second Brand')
  await page.getByRole('button', { name: 'Add brand' }).click()
  await expect(page.getByText('Second Brand added.')).toBeVisible()
  // Team: invite
  await page.getByRole('link', { name: 'Team' }).click()
  await expect(page.getByRole('heading', { name: 'Team members' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Invite a team member' }).click()
  const inviteeEmail = newEmail()
  const dlg = page.getByRole('dialog', { name: 'Invite a team member' })
  await dlg.getByLabel('Email address').fill('not-an-email')
  await dlg.getByRole('button', { name: 'Send invitation' }).click()
  await expect(dlg.getByText('Enter a valid email address.')).toBeVisible()
  await dlg.getByLabel('Email address').fill(inviteeEmail)
  await dlg.getByLabel('Role').selectOption('Manager')
  await dlg.getByLabel('Only selected brands').check()
  await dlg.getByLabel('Second Brand').check()
  await expectNoSeriousA11y(page)
  await dlg.getByRole('button', { name: 'Send invitation' }).click()
  await expect(page.getByText(`Invitation sent to ${inviteeEmail}.`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible()
  await expect(page.getByText(inviteeEmail, { exact: true })).toBeVisible()
  await logOut(page)

  // The invitee follows the emailed link (signed out, new user): email is locked, no seller wizard
  const t = await inviteToken(request, inviteeEmail)
  await page.goto(`/invite/${t}`)
  await expect(page.getByRole('heading', { name: "You're invited" })).toBeVisible()
  await expect(page.getByLabel('Email')).toHaveValue(inviteeEmail)
  await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '')
  await expectNoSeriousA11y(page)
  await page.getByLabel('Choose a password').fill(PASSWORD)
  await page.getByLabel(/I agree to the Terms/).check()
  await page.getByRole('button', { name: 'Create login and join' }).click()
  await dismissPasskeyOffer(page)
  await expect(page).toHaveURL(/\/settings\/brands/)
  const brands = page.getByRole('list', { name: 'Brands' })
  await expect(brands.locator('strong', { hasText: 'Second Brand' })).toBeVisible()
  await expect(brands.locator('strong', { hasText: 'Alpha Bakery' })).toHaveCount(0) // out of scope
  await expect(page.getByRole('button', { name: 'Add a brand' })).toHaveCount(0) // Managers can't manage brands
  await expect(page.getByRole('link', { name: 'Team' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Alpha Bakery/ })).toBeVisible() // account switcher shows the account + role
  await expectNoSeriousA11y(page)
  // the used link is dead
  await logOut(page)
  await page.goto(`/invite/${t}`)
  await expect(page.getByRole('heading', { name: 'This invitation was already used' })).toBeVisible()
  await expectNoSeriousA11y(page)
})

test('a user in two accounts signs in, chooses an account and switches', async ({ page, request }) => {
  const x = await seller(request, 'Alpha Bakery')
  const u = await seller(request, 'Beta Shop')
  // Alpha invites Beta's owner as Viewer; accepted through the API (the UI join is covered above)
  expect((await request.post('/api/v1/team/invitations', { headers: bearer(x.token), data: { email: u.email, role: 'Viewer' } })).status()).toBe(202)
  const t = await inviteToken(request, u.email)
  expect((await request.post(`/api/v1/invitations/${t}/accept`, { headers: bearer(u.token), data: {} })).ok()).toBeTruthy()

  await page.goto('/login')
  await uiLogin(page, u.email)
  await dismissPasskeyOffer(page)
  await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible()
  const list = page.getByRole('list', { name: 'Your accounts' })
  await expect(list.getByText('Alpha Bakery', { exact: true })).toBeVisible()
  await expect(list.getByText('Beta Shop', { exact: true })).toBeVisible()
  await expect(list.getByText('Viewer')).toBeVisible()
  await expect(list.getByText('Owner')).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Continue to Alpha Bakery' }).click()
  await expect(page).toHaveURL(/\/settings\/brands/) // a Viewer lands on the brands, read-only
  await expect(page.getByRole('button', { name: 'Add a brand' })).toHaveCount(0)
  // switch via the header switcher
  await page.getByRole('button', { name: /Alpha Bakery/ }).click()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: /Beta Shop/ }).click()
  await expect(page).toHaveURL(/\/signup\//) // Owner of a draft account: back to the application
  await expect(page.getByRole('button', { name: /Beta Shop/ })).toBeVisible()
  // the choice is remembered: a new sign-in goes straight to Beta Shop
  await logOut(page)
  await uiLogin(page, u.email)
  await dismissPasskeyOffer(page)
  await expect(page).toHaveURL(/\/signup\//)
  await page.getByRole('button', { name: /Beta Shop/ }).click()
  await page.getByRole('link', { name: 'Create a new seller account' }).click()
  await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible()
  await expectNoSeriousA11y(page)
})

test('owner removes a member: their very next action is denied', async ({ page, browser, request }) => {
  const owner = await seller(request, 'Alpha Bakery')
  const memberEmail = newEmail()
  expect((await request.post('/api/v1/team/invitations', { headers: bearer(owner.token), data: { email: memberEmail, role: 'Admin' } })).status()).toBe(202)
  const t = await inviteToken(request, memberEmail)
  expect((await request.post(`/api/v1/invitations/${t}/join`, { data: { password: PASSWORD, acceptTerms: true } })).ok()).toBeTruthy()

  const other = await freshPage(browser)
  await signIn(other, memberEmail)
  await expect(other).toHaveURL(/\/settings\/brands/)
  await other.getByRole('link', { name: 'Team' }).click()
  await expect(other.getByRole('heading', { name: 'Team members' })).toBeVisible()

  await signIn(page, owner.email)
  await page.goto('/settings/team')
  await page.getByRole('button', { name: `Remove ${memberEmail}` }).click()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Remove member' }).click()
  await expect(page.getByText(`${memberEmail} was removed.`)).toBeVisible()
  expect(await lastMail(request, memberEmail, 'team-removed')).toContain('removed')

  // the removed member, still holding the old token: the next request is refused and the app drops them to the empty state
  await other.getByRole('link', { name: 'Brands' }).click()
  await expect(other.getByRole('heading', { name: "You're not part of any seller account" })).toBeVisible()
  await expectNoSeriousA11y(other)
  await other.context().close()
})

test('Settings, Team and Brands pages work at 320px wide in dark mode', async ({ page, request }) => {
  const owner = await seller(request, 'Alpha Bakery')
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await signIn(page, owner.email)
  await page.goto('/settings/team')
  await expect(page.getByRole('heading', { name: 'Team members' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy() // no horizontal scroll
  await expectNoSeriousA11y(page)
  await page.goto('/settings/brands')
  await expect(page.getByRole('heading', { name: 'Brands' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await expectNoSeriousA11y(page)
})
