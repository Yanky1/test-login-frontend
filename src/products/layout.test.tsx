import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { renderAt, signedIn } from '../test/utils'
import ProductEditorPage from './ProductEditor'
import SellerLayout from './SellerLayout'
import { detail, mockCatalog, mount } from './testkit'

const acct = (role: string) => ({ activeAccountId: 'a1', role, accounts: [{ sellerId: 'a1', vendorName: 'Acme Co', role, accountStatus: 'Approved', brandCount: 1 }] })
const shell = (role: string | null) => {
  signedIn(role ? acct(role) : {})
  renderAt(<Routes><Route element={<SellerLayout />}><Route path="/products" element={<h1>Catalog page</h1>} /></Route></Routes>, '/products')
}

describe('seller shell', () => {
  it('has a labelled sidebar with Products, Bulk upload, Questions and the account links; marks the current page', async () => {
    shell('Owner')
    await screen.findByRole('navigation', { name: 'Seller' })
    expect(screen.getByRole('heading', { name: 'Catalog page' })).toBeInTheDocument()
    for (const n of ['Products', 'Bulk upload', 'Questions', 'Account & security', 'Team', 'Brands']) expect(screen.getByRole('link', { name: n })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/settings/team')
  })
  it('hides Team and Brands from roles that cannot manage them', async () => {
    shell('Manager')
    await screen.findByRole('navigation', { name: 'Seller' })
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull(); expect(screen.queryByRole('link', { name: 'Brands' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Account & security' })).toBeInTheDocument()
  })
  it('the mobile menu button toggles the drawer and Escape closes it', async () => {
    shell('Owner')
    const btn = await screen.findByRole('button', { name: /Menu/ })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(btn); expect(btn).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByRole('navigation', { name: 'Seller' })).toHaveClass('open')
    await userEvent.keyboard('{Escape}'); expect(btn).toHaveAttribute('aria-expanded', 'false'); expect(btn).toHaveFocus()
  })
})

describe('editor for a Viewer', () => {
  it('is view-only: fields disabled, no activate/delete, explanation shown', async () => {
    mockCatalog(detail())
    mount(<ProductEditorPage />, '/products/:id', '/products/p1', acct('Viewer'))
    await screen.findByRole('heading', { name: 'Sourdough loaf', level: 1 })
    expect(screen.getByText(/view-only access to this listing/)).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Preview as buyer' })).toBeEnabled()
  })
})
