import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

let role: string | null = 'Owner'
vi.mock('../auth', () => ({ useAuth: () => ({ user: role ? { role, email: 'sam@x.com' } : null, logout: vi.fn() }) }))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn(() => new Promise(() => undefined)) }))

import Home from '../pages/Home'

afterEach(() => { role = 'Owner'; vi.restoreAllMocks() })

describe('Home', () => {
  it('survives the role changing to Driver while it is mounted (no conditional return before a hook)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ui = () => <MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<Home />} /><Route path="/driver" element={<div>driver home</div>} /></Routes></MemoryRouter>
    const { rerender, queryByText } = render(ui())
    role = 'Driver'
    expect(() => rerender(ui())).not.toThrow()                                                       // old code: "Rendered fewer hooks than expected"
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/hooks/i)
    expect(queryByText('driver home')).not.toBeNull()
  })
})
