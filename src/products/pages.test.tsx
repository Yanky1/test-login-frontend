import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import CsvPage from './CsvPage'
import NewProductPage from './NewProduct'
import ProductsListPage from './ProductsList'
import QuestionsPage from './Questions'
import { API, CATS, detail, mount } from './testkit'
import type { ListItem, ListResult, Question } from './types'

const item = (o: Partial<ListItem> = {}): ListItem => ({
  id: 'p1', title: 'Blue mug', sku: 'MUG-1', status: 'Active', brandId: 'b1', brandName: 'Acme', categoryId: 'c', price: 10, currentPrice: 10, onSale: false, quantity: 5, hasVariants: false, variantCount: 0,
  qualityScore: 82, canPublish: true, needsAttention: false, lowStock: false, version: 1, updatedAt: '2026-11-01T00:00:00Z', thumbnailUrl: null, ...o,
})
const counts = { all: 3, draft: 1, active: 1, inactive: 1, archived: 0, outOfStock: 1, attention: 1 }
const list = (items: ListItem[], total = items.length): ListResult => ({ items, total, page: 1, pageSize: 20, counts })

function mockList(items: ListItem[] = [item()], extra: (urls: URL[]) => void = () => undefined) {
  const urls: URL[] = []
  server.use(
    http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }, { id: 'b2', name: 'Beta' }])),
    http.get(`${API}/seller/products`, ({ request }) => { const u = new URL(request.url); urls.push(u); extra(urls); return HttpResponse.json(list(items)) }),
  )
  return urls
}

describe('catalog list', () => {
  it('shows a friendly empty state with an Add-your-first-product call to action', async () => {
    mockList([]); server.use(http.get(`${API}/seller/products`, () => HttpResponse.json({ ...list([]), counts: { ...counts, all: 0, draft: 0, active: 0, inactive: 0, outOfStock: 0, attention: 0 } })))
    mount(<ProductsListPage />, '/products')
    expect(await screen.findByRole('heading', { name: 'Add your first product' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add your first product' })).toHaveAttribute('href', '/products/new')
  })

  it('renders a skeleton while loading, then rows with status, quality and price', async () => {
    mockList([item(), item({ id: 'p2', title: 'Draft bowl', status: 'Draft', qualityScore: 30, needsAttention: true, canPublish: false })])
    mount(<ProductsListPage />, '/products')
    expect(screen.getByLabelText('Loading products')).toBeInTheDocument()
    const rows = await screen.findAllByRole('row')
    expect(rows.length).toBe(3)
    expect(within(rows[1]).getByText('Active')).toBeInTheDocument(); expect(within(rows[1]).getByText(/Great/)).toBeInTheDocument()
    expect(within(rows[2]).getByText('Needs attention')).toBeInTheDocument(); expect(within(rows[2]).getByText(/Needs work/)).toBeInTheDocument()
  })

  it('status tabs, out-of-stock and needs-attention filters, search, sort and brand filter hit the API', async () => {
    const urls = mockList()
    mount(<ProductsListPage />, '/products')
    await screen.findAllByRole('link', { name: 'Blue mug' })
    const last = () => urls.at(-1)!.searchParams
    await userEvent.click(screen.getByRole('tab', { name: /Drafts/ })); await waitFor(() => expect(last().get('status')).toBe('Draft'))
    await userEvent.click(screen.getByRole('tab', { name: /Out of stock/ })); await waitFor(() => expect(last().get('filter')).toBe('outofstock'))
    expect(last().get('status')).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: /Needs attention/ })); await waitFor(() => expect(last().get('filter')).toBe('attention'))
    await userEvent.click(screen.getByRole('tab', { name: /^All/ }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search products' }), 'mug'); await waitFor(() => expect(last().get('q')).toBe('mug'))
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'price:asc'); await waitFor(() => { expect(last().get('sort')).toBe('price'); expect(last().get('dir')).toBe('asc') })
    await userEvent.selectOptions(screen.getByLabelText('Brand'), 'b2'); await waitFor(() => expect(last().get('brandId')).toBe('b2'))
  })

  it('paginates', async () => {
    const urls = mockList([item()]); server.use(http.get(`${API}/seller/products`, ({ request }) => { urls.push(new URL(request.url)); return HttpResponse.json({ ...list([item()], 45), pageSize: 20 }) }))
    mount(<ProductsListPage />, '/products')
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next' })); await waitFor(() => expect(urls.at(-1)!.searchParams.get('page')).toBe('2'))
  })

  it('inline quick edit saves the price and reverts with a message when refused', async () => {
    mockList([item()])
    let body: unknown
    server.use(http.patch(`${API}/seller/products/p1/quick`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...detail(), price: 12.5, currentPrice: 12.5, available: 5, version: 2 }) }))
    mount(<ProductsListPage />, '/products')
    const price = await screen.findByLabelText('Price for Blue mug')
    await userEvent.clear(price); await userEvent.type(price, '12.5'); await userEvent.tab()
    await waitFor(() => expect(body).toEqual({ version: 1, price: 12.5 }))
    await waitFor(() => expect(price).toHaveValue('12.5'))
    server.use(http.patch(`${API}/seller/products/p1/quick`, () => HttpResponse.json({ errors: { price: ['The price must stay above the sale price.'] } }, { status: 400 })))
    await userEvent.clear(price); await userEvent.type(price, '1'); await userEvent.tab()
    expect(await screen.findByText(/must stay above the sale price/)).toBeInTheDocument()
    await waitFor(() => expect(price).toHaveValue('12.5'))
  })

  it('bulk actions send the selected ids and report listings that could not change', async () => {
    mockList([item(), item({ id: 'p2', title: 'Second mug' })])
    let sent: unknown
    server.use(http.post(`${API}/seller/products/bulk-status`, async ({ request }) => { sent = await request.json(); return HttpResponse.json({ updated: 1, ids: ['p1'], failed: [{ id: 'p2', title: 'Second mug', message: 'Listing isn\'t ready or the change isn\'t allowed.' }] }) }))
    mount(<ProductsListPage />, '/products')
    await userEvent.click(await screen.findByLabelText('Select all on this page'))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(sent).toEqual({ ids: ['p1', 'p2'], status: 'active' }))
    expect(await screen.findByText(/1 listing activated\..*Second mug/)).toBeInTheDocument()
  })

  it('duplicates a listing and opens the copy', async () => {
    mockList([item()])
    server.use(http.post(`${API}/seller/products/p1/duplicate`, () => HttpResponse.json(detail({ id: 'copy' }), { status: 201 })))
    mount(<ProductsListPage />, '/products')
    await userEvent.click(await screen.findByRole('button', { name: /Duplicate/ }))
    expect(await screen.findByText('elsewhere')).toBeInTheDocument()
  })
})

describe('what are you selling', () => {
  it('needs a title, picks a category from the searchable list with the keyboard, and creates the draft', async () => {
    let created: unknown
    server.use(http.get(`${API}/categories`, () => HttpResponse.json(CATS)), http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme', isDefault: true }])),
      http.post(`${API}/seller/products`, async ({ request }) => { created = await request.json(); return HttpResponse.json(detail({ id: 'new1' }), { status: 201 }) }))
    mount(<NewProductPage />, '/products/new')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Enter what you are selling.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Product title'), 'Rye bread')
    const combo = screen.getByRole('combobox', { name: 'Category' })
    await userEvent.type(combo, 'bak'); expect(await screen.findByRole('option', { name: /Bakery/ })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(created).toMatchObject({ title: 'Rye bread', categoryId: 'c-bakery' }))
  })
})

const q = (o: Partial<Question> = {}): Question => ({ id: 'q1', productId: 'p1', productTitle: 'Blue mug', askerName: 'Sam', text: 'Is it dishwasher safe?', answer: null, state: 'Pending', answered: false, askedAt: '2026-11-01T00:00:00Z', answeredAt: null, ...o })

describe('questions inbox', () => {
  it('filters by answered state and product, answers inline, and can hide', async () => {
    const urls: URL[] = []; let answered: unknown
    server.use(
      http.get(`${API}/seller/products`, () => HttpResponse.json(list([item()]))),
      http.get(`${API}/seller/questions`, ({ request }) => { urls.push(new URL(request.url)); return HttpResponse.json({ items: [q()], total: 1, page: 1, pageSize: 50, counts: { unanswered: 1, answered: 4, hidden: 0 } }) }),
      http.put(`${API}/seller/questions/q1/answer`, async ({ request }) => { answered = await request.json(); return HttpResponse.json(q({ answer: 'Yes', answered: true, state: 'Published' })) }),
      http.post(`${API}/seller/questions/q1/hide`, () => HttpResponse.json(q({ state: 'Hidden' }))),
    )
    mount(<QuestionsPage />, '/questions')
    expect(await screen.findByText(/Is it dishwasher safe\?/)).toBeInTheDocument()
    expect(urls.at(-1)!.searchParams.get('state')).toBe('unanswered')
    await userEvent.click(screen.getByRole('tab', { name: /^Answered/ })); await waitFor(() => expect(urls.at(-1)!.searchParams.get('state')).toBe('answered'))
    await userEvent.selectOptions(await screen.findByLabelText('Product'), 'p1'); await waitFor(() => expect(urls.at(-1)!.searchParams.get('productId')).toBe('p1'))
    expect(screen.getByRole('button', { name: 'Publish answer' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Your answer'), 'Yes')
    await userEvent.click(screen.getByRole('button', { name: 'Publish answer' }))
    await waitFor(() => expect(answered).toEqual({ answer: 'Yes', publish: true }))
    await userEvent.click(screen.getByRole('button', { name: /Hide/ }))
  })

  it('shows a caught-up empty state', async () => {
    server.use(http.get(`${API}/seller/products`, () => HttpResponse.json(list([]))), http.get(`${API}/seller/questions`, () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 50, counts: { unanswered: 0, answered: 0, hidden: 0 } })))
    mount(<QuestionsPage />, '/questions')
    expect(await screen.findByRole('heading', { name: "You're all caught up" })).toBeInTheDocument()
  })
})

describe('bulk upload', () => {
  it('validates a CSV, shows row-level errors, and imports only after the preview', async () => {
    server.use(
      http.post(`${API}/seller/products/csv/validate`, () => HttpResponse.json({ total: 3, valid: 2, invalid: 1, ignoredColumns: ['mystery'], rows: [
        { row: 2, ok: true, title: 'Good', sku: 'A', errors: [] }, { row: 3, ok: true, title: 'Fine', sku: 'B', errors: [] },
        { row: 4, ok: false, title: 'Bad bowl', sku: 'C', errors: [{ field: 'barcode', message: 'This UPC-A has an invalid check digit.' }] }] })),
      http.post(`${API}/seller/products/csv/import`, () => HttpResponse.json({ imported: 2, skipped: 1, created: [] }, { status: 201 })),
    )
    mount(<CsvPage />, '/products/import')
    const file = new File(['title\nGood\n'], 'products.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } })
    expect(await screen.findByText(/ready to import/)).toHaveTextContent('2 of 3 rows ready to import')
    expect(screen.getByRole('table', { name: /Rows with problems/ })).toBeInTheDocument(); expect(screen.getByText(/invalid check digit/)).toBeInTheDocument()
    expect(screen.getByText(/Ignored columns: mystery/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 products as drafts' }))
    expect(await screen.findByText(/Imported 2 products as drafts \(1 skipped\)/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View your drafts' })).toBeInTheDocument()
  })

  it('rejects non-CSV and oversized files before uploading', async () => {
    mount(<CsvPage />, '/products/import')
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [new File(['x'], 'notes.txt')] } })
    expect(await screen.findByText('Choose a .csv file.')).toBeInTheDocument()
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'big.csv'); fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [big] } })
    expect(await screen.findByText(/larger than 1 MB/)).toBeInTheDocument()
  })
})
