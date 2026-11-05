import { test, expect, expectNoSeriousA11y } from './helpers'
import { staffMember } from './adminKit'

// Real backend started with Demo__Enabled=true AND Demo__AllowStaffMfaSkip=true (playwright.config.ts): test sites only.
test('on a test site a staff member skips two-factor after the password: banner, step-up action without a code, 2FA state untouched', async ({ page, request }) => {
  test.setTimeout(90_000)
  const sa = await staffMember(request, 'SuperAdmin')                       // an account with real two-factor
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(sa.email)
  await page.getByLabel('Password', { exact: true }).fill(sa.password)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByLabel('Authenticator code')).toBeVisible()
  const skip = page.getByRole('button', { name: 'Skip two-factor (test mode)' })
  await expect(skip).toBeVisible()
  await expectNoSeriousA11y(page)
  await skip.click()                                                        // no authenticator code typed
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  const banner = page.getByRole('status').filter({ hasText: 'Two-factor skipped (test mode)' })
  await expect(banner).toBeVisible()
  await expectNoSeriousA11y(page)

  // a step-up action works with no code prompt
  await page.getByRole('navigation', { name: 'Staff areas' }).getByRole('link', { name: 'Platform settings' }).click()
  await expect(page.getByRole('heading', { name: 'Platform settings' })).toBeVisible()
  await expect(banner).toBeVisible()                                        // permanent: still shown on another page
  const fee = page.getByLabel('Fee in basis points (100 = 1%)')
  const current = Number(await fee.inputValue())
  await fee.fill(String(current === 1100 ? 1200 : 1100))
  await page.getByRole('button', { name: 'Save fee' }).click()
  await page.getByRole('dialog').getByLabel(/^Reason/).fill('E2E: step-up satisfied by the test-mode skip')
  await page.getByRole('dialog').getByRole('button', { name: 'Save fee' }).click()
  await expect(page.getByText('Fee saved.')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Confirm it’s you' })).toHaveCount(0)

  // the account itself still has its real two-factor: a normal sign-in still needs the code, and shows no banner
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(sa.email)
  await page.getByLabel('Password', { exact: true }).fill(sa.password)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByLabel('Authenticator code')).toBeVisible()
})
