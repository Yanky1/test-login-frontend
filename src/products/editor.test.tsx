import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import ProductEditorPage from './ProductEditor'
import { API, detail, mockCatalog, mount } from './testkit'

const open = (d = detail()) => { const m = mockCatalog(d); mount(<ProductEditorPage />, '/products/:id', '/products/p1'); return m }
const ready = async () => { await screen.findByRole('heading', { name: 'Sourdough loaf', level: 1 }) }

describe('product editor sections', () => {
  it('shows every section, hides advanced fields until they are relevant', async () => {
    open(); await ready()
    for (const name of ['Basics', 'Photos', 'Description', 'Price & stock', 'Identifiers', 'Variations', 'Product details', 'Shipping', 'Q&A', 'Policies', 'Search & SEO'])
      expect(screen.getByRole('heading', { name, level: 2 })).toBeInTheDocument()
    expect(screen.queryByLabelText('Condition notes')).toBeNull()                    // New: no notes
    expect(screen.queryByLabelText('Sale price (USD)')).toBeNull()                    // sale fields appear on demand
    expect(screen.queryByLabelText('Option name')).toBeNull()                         // variations hidden until switched on
    expect(screen.queryByLabelText('UPC, EAN, GTIN or ISBN')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Condition'), 'Used')
    expect(screen.getByLabelText('Condition notes')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Put this product on sale'))
    expect(screen.getByLabelText('Sale price (USD)')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('This product has no barcode'))
    expect(screen.queryByLabelText('UPC, EAN, GTIN or ISBN')).toBeNull()
    expect(screen.getByText(/Good titles are 60-150 characters/)).toBeInTheDocument()
  })

  it('autosaves edits after a pause (debounced, one PUT) and shows Saved', async () => {
    const { calls } = open(); await ready()
    const title = screen.getByLabelText('Title')
    fireEvent.change(title, { target: { value: 'Sourdough loaf 800 g' } }); fireEvent.change(title, { target: { value: 'Sourdough loaf 800 g, organic' } })
    expect(screen.getByTestId('save-indicator')).toHaveTextContent('Saving soon')
    await waitFor(() => expect(screen.getByTestId('save-indicator')).toHaveTextContent('All changes saved'), { timeout: 4000 })
    const puts = calls.filter((c) => c.method === 'PUT')
    expect(puts).toHaveLength(1); expect(puts[0].body).toMatchObject({ title: 'Sourdough loaf 800 g, organic', version: 1 })
  })

  it('keeps the input and says so when saving fails, then retries', async () => {
    open(); await ready()
    let n = 0
    server.use(http.put(`${API}/seller/products/:id`, async ({ request }) => { n++; if (n === 1) return HttpResponse.json({ errors: { price: ['Enter an amount between 0.01 and 999999.99.'] } }, { status: 400 }); return HttpResponse.json({ ...detail(), ...(await request.json() as object), version: 2 }) }))
    fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '-4' } })
    await waitFor(() => expect(screen.getByTestId('save-indicator')).toHaveTextContent("Couldn't save"), { timeout: 4000 })
    expect(screen.getByLabelText('Price (USD)')).toHaveValue('-4')                       // never lose input
    expect(screen.getAllByText(/Enter an amount between/).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTestId('save-indicator')).toHaveTextContent('All changes saved'))
  })

  it('validates barcodes live with check digits', async () => {
    open(); await ready()
    const bc = screen.getByLabelText('UPC, EAN, GTIN or ISBN')
    fireEvent.change(bc, { target: { value: '036000291453' } })
    expect(await screen.findByText(/invalid check digit/)).toBeInTheDocument(); expect(bc).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(bc, { target: { value: '036000291452' } })
    expect(await screen.findByText('✓ Valid UPC-A')).toBeInTheDocument()
  })

  it('renders category attributes from server config and clears them when the category changes', async () => {
    const { calls } = open(detail({ attributes: { ingredients: 'Flour, water, salt', allergens: ['Wheat'] } })); await ready()
    expect(screen.getByLabelText(/Ingredients/)).toHaveValue('Flour, water, salt')
    expect(screen.getByRole('checkbox', { name: 'Wheat' })).toBeChecked()
    expect(screen.getByLabelText(/Shelf life \(days\)/)).toBeInTheDocument()
    // change the category: the old category's details disappear immediately and the new ones are rendered
    const combo = screen.getByRole('combobox', { name: 'Category' })
    await userEvent.click(combo); await userEvent.type(combo, 'kitchen')
    await userEvent.click(await screen.findByRole('option', { name: /Kitchen & Dining/ }))
    expect(await screen.findByLabelText(/Material/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Ingredients/)).toBeNull(); expect(screen.queryByRole('checkbox', { name: 'Wheat' })).toBeNull()
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && (c.body as { categoryId: string }).categoryId === 'c-kitchen')).toBe(true), { timeout: 4000 })
    const put = calls.filter((c) => c.method === 'PUT').at(-1)!.body as { attributes: object }
    expect(put.attributes).toEqual({})
  })

  it('data-driven details only appear once a category is chosen', async () => {
    open(detail({ categoryId: null, attributeConfig: null })); await ready()
    expect(screen.getByText(/Choose a category in Basics/)).toBeInTheDocument()
  })

  it('shows the readiness checklist and moves focus to the missing field', async () => {
    open(); await ready()
    const list = screen.getByRole('list', { name: 'Required' })
    expect(within(list).getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('img', { name: /Listing quality 20 out of 100: Needs work/ })).toBeInTheDocument()
    await userEvent.click(within(list).getByRole('button', { name: /Set a price/ }))
    expect(screen.getByLabelText('Price (USD)')).toHaveFocus()
    await userEvent.click(within(list).getByRole('button', { name: /Allergens is required/ }))
    expect(document.activeElement?.id).toBe('f-attr-allergens')
    await userEvent.click(screen.getByText(/1 suggestion/))
    expect(screen.getByRole('button', { name: /Add 3-5 key feature bullets/ })).toBeInTheDocument()
  })

  it('a ready listing says so', async () => {
    open(detail({ canPublish: true, qualityScore: 88, issues: [] })); await ready()
    expect(screen.getByText(/All required items are done/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /88 out of 100: Great/ })).toBeInTheDocument()
  })

  it('variations: hidden until switched on, generates the combination grid and saves it', async () => {
    const { calls } = open(); await ready()
    await userEvent.click(screen.getByLabelText('This product comes in different options'))
    const values = await screen.findByLabelText(/Add Size values/)
    await userEvent.type(values, 'S, M{Enter}')
    expect(await screen.findByRole('heading', { name: '2 variations' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Color' }))                  // second option
    await userEvent.type(await screen.findByLabelText(/Add Color values/), 'Red, Blue{Enter}')
    expect(await screen.findByRole('heading', { name: '4 variations' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('SKU for S / Red'), 'MUG-S-R')
    await userEvent.type(screen.getByLabelText('Stock for S / Red'), '7')
    await userEvent.click(screen.getByLabelText('M / Blue enabled'))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/variants'))).toBe(true), { timeout: 5000 })
    const sent = calls.filter((c) => c.url.endsWith('/variants')).at(-1)!.body as { variants: { values: string[]; sku: string | null; quantity: number; enabled: boolean }[]; options: unknown[] }
    expect(sent.options).toHaveLength(2); expect(sent.variants).toHaveLength(4)
    expect(sent.variants.find((v) => v.values.join() === 'S,Red')).toMatchObject({ sku: 'MUG-S-R', enabled: true })
    expect(sent.variants.find((v) => v.values.join() === 'M,Blue')).toMatchObject({ enabled: false })
  })

  it('limits bullets to five and keeps the Markdown preview safe', async () => {
    open(); await ready()
    for (let i = 0; i < 6; i++) { const b = screen.queryByRole('button', { name: 'Add a feature' }); if (b) await userEvent.click(b) }
    expect(screen.queryByRole('button', { name: 'Add a feature' })).toBeNull()
    expect(screen.getAllByLabelText(/^Feature \d$/)).toHaveLength(5)
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Hello **world** <script>x</script>' } })
    const prev = screen.getByRole('region', { name: 'Description preview' })
    expect(within(prev).getByText('world').tagName).toBe('STRONG'); expect(prev.querySelector('script')).toBeNull()
  })

  it('FAQ pairs can be added and reordered', async () => {
    const { calls } = open(); await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Add a question' })); await userEvent.click(screen.getByRole('button', { name: 'Add a question' }))
    const qs = screen.getAllByLabelText('Question'); const as = screen.getAllByLabelText('Answer')
    await userEvent.type(qs[0], 'First?'); await userEvent.type(as[0], 'One.'); await userEvent.type(qs[1], 'Second?'); await userEvent.type(as[1], 'Two.')
    await userEvent.click(screen.getByRole('button', { name: 'Move question 2 up' }))
    expect(screen.getAllByLabelText('Question').map((i) => (i as HTMLInputElement).value)).toEqual(['Second?', 'First?'])
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/faqs'))).toBe(true), { timeout: 5000 })
  })
})

describe('unsaved-changes guard', () => {
  it('asks before in-app navigation while edits are unsaved (live listing = manual save)', async () => {
    const { calls } = open(detail({ status: 'Active', canPublish: true, issues: [] })); await ready()
    expect(screen.getByText(/This listing is live/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sourdough loaf, new recipe' } })
    expect(screen.getByTestId('save-indicator')).toHaveTextContent('Unsaved changes')
    await userEvent.click(screen.getByRole('link', { name: '← Products' }))
    const dlg = await screen.findByRole('dialog', { name: 'You have unsaved changes' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Stay on this page' }))
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText('elsewhere')).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: '← Products' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save and leave' }))
    expect(await screen.findByText('elsewhere')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
  })

  it('leaves without saving when asked, and does not interfere when nothing changed', async () => {
    const { calls } = open(detail({ status: 'Active', canPublish: true, issues: [] })); await ready()
    await userEvent.click(screen.getByRole('link', { name: '← Products' }))              // nothing changed: navigates straight away
    expect(await screen.findByText('elsewhere')).toBeInTheDocument(); expect(calls).toHaveLength(0)
  })

  it('Leave without saving navigates and discards', async () => {
    open(detail({ status: 'Active', canPublish: true, issues: [] })); await ready()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } })
    await userEvent.click(screen.getByRole('link', { name: '← Products' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave without saving' }))
    expect(await screen.findByText('elsewhere')).toBeInTheDocument()
  })

  it('the browser is asked before closing the tab while unsaved', async () => {
    open(detail({ status: 'Active', canPublish: true, issues: [] })); await ready()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } })
    const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('a version conflict offers to keep mine or load the latest', async () => {
    open(); await ready()
    server.use(http.put(`${API}/seller/products/:id`, () => HttpResponse.json({ code: 'version_conflict', title: 'changed elsewhere' }, { status: 409 })))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My edit' } })
    expect(await screen.findByText(/changed somewhere else/, undefined, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('My edit')
    expect(screen.getByRole('button', { name: 'Load the latest' })).toBeInTheDocument()
  })
})

