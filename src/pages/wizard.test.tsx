import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { RequireAuth } from '../components/RequireAuth'
import { WizardLayout } from './wizard/shared'
import KosherStep from './wizard/KosherStep'
import VerifyStep from './wizard/VerifyStep'
import ReviewStep from './wizard/ReviewStep'
import PendingStep from './wizard/PendingStep'
import { API, loginBody, server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'

const fieldConfig = [
  { key: 'sells_food', label: 'Do you sell food?', type: 'yesno', parentKey: null, parentValue: null, required: true, sortOrder: 1, options: null },
  { key: 'food_types', label: 'What kind of food do you sell?', type: 'select', parentKey: 'sells_food', parentValue: 'yes', required: true, sortOrder: 2, options: ['Bakery', 'Meat'] },
  { key: 'is_kosher', label: 'Is your food kosher?', type: 'yesno', parentKey: 'sells_food', parentValue: 'yes', required: true, sortOrder: 3, options: null },
  { key: 'kosher_agency', label: 'Kosher certifying agency', type: 'select', parentKey: 'is_kosher', parentValue: 'yes', required: true, sortOrder: 4, options: ['OU', 'OK'] },
  { key: 'kosher_certificate', label: 'Kosher certificate', type: 'file', parentKey: 'is_kosher', parentValue: 'yes', required: true, sortOrder: 5, options: null },
]
const application = (over: Record<string, unknown> = {}) => ({
  sellerId: 's1', status: 'Draft', statusNote: null, draftStep: 4, editable: true,
  business: { vendorName: 'Acme Co', contactName: 'Dana', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', addressLine2: null, city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false },
  kosher: { answers: {}, certificate: null },
  legal: { termsVersion: '1', termsAcceptedAt: 'x', sellerAgreementVersion: null, sellerAgreementAcceptedAt: null }, marketplaceUrl: 'https://market.example', ...over,
})
const wizardRoutes = (
  <Routes>
    <Route path="/signup/verify" element={<VerifyStep />} />
    <Route element={<RequireAuth />}>
      <Route path="/signup" element={<WizardLayout />}>
        <Route path="kosher" element={<KosherStep />} />
        <Route path="review" element={<ReviewStep />} />
        <Route path="pending" element={<PendingStep />} />
        <Route path="business" element={<div>business step</div>} />
      </Route>
    </Route>
    <Route path="/login" element={<div>login page</div>} />
  </Routes>
)
function backend(app = application()) {
  signedIn()
  server.use(
    http.get(`${API}/seller/application`, () => HttpResponse.json(app)),
    http.get(`${API}/seller/field-config`, () => HttpResponse.json(fieldConfig)),
  )
}

describe('kosher branching (driven by seller_field_config)', () => {
  it('hides food questions when "sells food" is No, and kosher agency/certificate when "kosher" is No', async () => {
    const user = userEvent.setup()
    backend()
    renderAt(wizardRoutes, '/signup/kosher')
    const sells = await screen.findByRole('group', { name: 'Do you sell food?' })
    expect(screen.queryByText('Is your food kosher?')).not.toBeInTheDocument()
    await user.click(within(sells).getByLabelText('Yes'))
    const kosher = await screen.findByRole('group', { name: 'Is your food kosher?' })
    expect(screen.getByText('What kind of food do you sell?')).toBeInTheDocument()
    expect(screen.queryByText('Kosher certifying agency')).not.toBeInTheDocument()
    await user.click(within(kosher).getByLabelText('Yes'))
    expect(await screen.findByText('Kosher certifying agency')).toBeInTheDocument()
    expect(screen.getByText('Kosher certificate')).toBeInTheDocument()
    await user.click(within(kosher).getByLabelText('No'))
    await waitFor(() => expect(screen.queryByText('Kosher certifying agency')).not.toBeInTheDocument())
    expect(screen.queryByText('Kosher certificate')).not.toBeInTheDocument()
    expect(screen.getByText('What kind of food do you sell?')).toBeInTheDocument()
    await user.click(within(sells).getByLabelText('No'))
    await waitFor(() => expect(screen.queryByText('Is your food kosher?')).not.toBeInTheDocument())
    expect(screen.queryByText('What kind of food do you sell?')).not.toBeInTheDocument()
  })

  it('sends only answers of visible questions to the server', async () => {
    const user = userEvent.setup()
    backend()
    let sent: { answers: Record<string, string> } | null = null
    server.use(http.put(`${API}/seller/application/kosher`, async ({ request }) => { sent = (await request.json()) as never; return HttpResponse.json(application({ draftStep: 5 })) }))
    renderAt(wizardRoutes, '/signup/kosher')
    const sells = await screen.findByRole('group', { name: 'Do you sell food?' })
    await user.click(within(sells).getByLabelText('Yes'))
    await user.click(within(await screen.findByRole('group', { name: 'Is your food kosher?' })).getByLabelText('Yes'))
    await user.selectOptions(await screen.findByLabelText('Kosher certifying agency'), 'OU')
    await user.click(within(sells).getByLabelText('No')) // hides everything below
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent!.answers).toEqual({ sells_food: 'no' })
  })

  it('validates required visible questions before continuing', async () => {
    const user = userEvent.setup()
    backend()
    renderAt(wizardRoutes, '/signup/kosher')
    await screen.findByRole('group', { name: 'Do you sell food?' })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Please answer this question.')).toBeInTheDocument()
  })

  it('rejects wrong file types and oversize files on the client', async () => {
    const user = userEvent.setup({ applyAccept: false })
    backend(application({ kosher: { answers: { sells_food: 'yes', is_kosher: 'yes' }, certificate: null } }))
    renderAt(wizardRoutes, '/signup/kosher')
    const input = await screen.findByLabelText('Kosher certificate')
    await user.upload(input, new File(['x'], 'virus.exe', { type: 'application/x-msdownload' }))
    expect(await screen.findByText('Only PDF, PNG or JPG files are allowed.')).toBeInTheDocument()
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 })
    await user.upload(input, big)
    expect(await screen.findByText('File must be 5 MB or smaller.')).toBeInTheDocument()
  })
})

describe('wizard navigation and guards', () => {
  it('redirects to the step saved in the server-side draft when skipping ahead', async () => {
    backend(application({ draftStep: 3 }))
    renderAt(wizardRoutes, '/signup/review')
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/signup/business'))
  })

  it('sends anonymous visitors to login with ?next', async () => {
    renderAt(wizardRoutes, '/signup/business')
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/login?next=%2Fsignup%2Fbusiness'))
  })

  it('review requires the Seller Agreement before submitting, then shows the pending screen', async () => {
    const user = userEvent.setup()
    backend(application({ draftStep: 5, kosher: { answers: { sells_food: 'no' }, certificate: null } }))
    let submitted = false
    server.use(http.post(`${API}/seller/application/submit`, () => { submitted = true; return HttpResponse.json(application({ status: 'PendingReview' })) }))
    renderAt(wizardRoutes, '/signup/review')
    expect(await screen.findByText('Acme Co')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Edit' })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Submit application' }))
    expect(await screen.findByText('You must accept the Seller Agreement to submit.')).toBeInTheDocument()
    expect(submitted).toBe(false)
    await user.click(screen.getByLabelText(/Seller Agreement/))
    await user.click(screen.getByRole('button', { name: 'Submit application' }))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/signup/pending'))
    expect(submitted).toBe(true)
  })

  it('pending screen: friendly message, status tracker and the two buttons', async () => {
    backend(application({ status: 'PendingReview', draftStep: 5 }))
    renderAt(wizardRoutes, '/signup/pending')
    expect(await screen.findByText('Your application is pending')).toBeInTheDocument()
    expect(screen.getByText(/Management will reach out/)).toBeInTheDocument()
    const tracker = screen.getByRole('list', { name: 'Application status' })
    expect(within(tracker).getAllByRole('listitem').map((l) => l.textContent?.replace(/^[✓\d]+/, ''))).toEqual(['Sent', 'Review', 'Approved', 'Live'])
    expect(within(tracker).getByText('Review').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('link', { name: 'Visit marketplace' })).toHaveAttribute('href', 'https://market.example')
    expect(screen.getByRole('link', { name: 'Guest mode' })).toHaveAttribute('href', '/guest')
  })

  it('shows a progress bar for the current step', async () => {
    backend(application({ status: 'PendingReview' }))
    renderAt(wizardRoutes, '/signup/pending')
    const bar = await screen.findByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '6')
  })
})

describe('verify step (public: no session until the mailbox is proven)', () => {
  it('has a one-time-code input, a resend countdown and re-enables resend after it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      sessionStorage.setItem('pendingEmail', 'dana@example.com')
      server.use(http.post(`${API}/auth/resend-code`, () => HttpResponse.json({ resendAfterSeconds: 60 }, { status: 202 })))
      renderAt(wizardRoutes, '/signup/verify')
      const code = await screen.findByLabelText('Verification code')
      expect(code).toHaveAttribute('autocomplete', 'one-time-code')
      expect(screen.getByLabelText('Email')).toHaveValue('dana@example.com')
      const resend = await screen.findByRole('button', { name: /Resend code in \d+s/ })
      expect(resend).toBeDisabled()
      for (let i = 0; i < 60; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      const enabled = await screen.findByRole('button', { name: 'Resend code' })
      expect(enabled).toBeEnabled()
      await act(async () => { enabled.click() })
      expect(await screen.findByRole('button', { name: /Resend code in 60s/ })).toBeDisabled()
    } finally { vi.useRealTimers() }
  })

  it('rejects a non 6-digit code locally and shows server errors', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('pendingEmail', 'dana@example.com')
    server.use(http.post(`${API}/auth/verify-email`, () => HttpResponse.json({ title: 'Bad Request', detail: "That code isn't right or has expired." }, { status: 400 })))
    renderAt(wizardRoutes, '/signup/verify')
    await user.type(await screen.findByLabelText('Verification code'), '123')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('Enter the 6-digit code from your email.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Verification code'), '456')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText("That code isn't right or has expired.")).toBeInTheDocument()
  })

  it('signs the user in after a correct code and continues to the business step', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('pendingEmail', 'seller@example.com')
    let sent: Record<string, unknown> | null = null
    server.use(http.post(`${API}/auth/verify-email`, async ({ request }) => { sent = (await request.json()) as Record<string, unknown>; return HttpResponse.json(loginBody()) }))
    server.use(
      http.get(`${API}/seller/application`, () => HttpResponse.json(application({ draftStep: 3 }))),
      http.get(`${API}/seller/field-config`, () => HttpResponse.json(fieldConfig)),
    )
    renderAt(wizardRoutes, '/signup/verify')
    await user.type(await screen.findByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/signup/business'))
    expect(sent).toEqual({ email: 'seller@example.com', code: '123456' })
    expect(sessionStorage.getItem('pendingEmail')).toBeNull()
  })
})
