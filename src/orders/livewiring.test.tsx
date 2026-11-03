import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../auth'
import SellerLayout from '../products/SellerLayout'
import { renderAt, signedIn } from '../test/utils'
import { server } from '../test/server'
import { API } from './testkit'

const streams: AbortSignal[] = []
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), readEvents: vi.fn((signal: AbortSignal) => { streams.push(signal); return new Promise<void>(() => undefined) }) }))

const A = 'a0000000-0000-0000-0000-000000000001'; const B = 'b0000000-0000-0000-0000-000000000002'
const acct = (id: string, name: string) => ({ sellerId: id, vendorName: name, role: 'Owner', accountStatus: 'Approved', brandCount: 1 })
function Switch() { const { switchAccount } = useAuth(); return <button onClick={() => void switchAccount(B)}>Switch to B</button> }

afterEach(() => { streams.length = 0 })

describe('SellerLayout and the event stream', () => {
  it('a new active account on the mounted layout aborts the old stream and opens a new one', async () => {
    signedIn({ activeAccountId: A, sellerId: A, accounts: [acct(A, 'Acme'), acct(B, 'Beta')] })
    server.use(
      http.get(`${API}/brands`, () => HttpResponse.json([])),
      http.post(`${API}/session/account`, () => HttpResponse.json({ accessToken: 'tok-2', body: { activeAccountId: B, vendorName: 'Beta', accountStatus: 'Approved', role: 'Owner', accounts: [acct(A, 'Acme'), acct(B, 'Beta')] } })),
    )
    renderAt(<Routes><Route element={<SellerLayout />}><Route path="/orders" element={<Switch />} /></Route></Routes>, '/orders')
    const btn = await screen.findByRole('button', { name: 'Switch to B' })
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    const before = streams.length; const forA = streams.at(-1)!
    expect(forA.aborted).toBe(false)
    await userEvent.click(btn)
    await waitFor(() => expect(streams.length).toBeGreaterThan(before))
    expect(forA.aborted).toBe(true)                       // the stream the server bound to account A is gone
    expect(streams.at(-1)!.aborted).toBe(false)           // and one for account B is open
    await act(async () => undefined)
  })
})
