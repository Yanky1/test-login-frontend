import { lazy, Suspense } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeaderContext, Shell, ThemeToggle } from './ui'
import { ErrorBoundary } from './ErrorBoundary'
import { RecoveryCodes } from '../pages/Settings'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); delete document.documentElement.dataset.theme })

describe('theme', () => {
  it('applies the saved choice when the inline script has not set data-theme (CSP blocks it)', () => {
    localStorage.setItem('solvelt-theme', 'dark')
    delete document.documentElement.dataset.theme
    render(<ThemeToggle />)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('recovery codes download', () => {
  it('puts every code in the file, clicks an attached link and revokes the URL only afterwards', async () => {
    vi.useFakeTimers()
    const codes = ['AAAAA-11111', 'BBBBB-22222', 'CCCCC-33333']
    let blob: Blob | undefined
    const order: string[] = []
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:test' })
    URL.revokeObjectURL = vi.fn(() => { order.push('revoke') })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      order.push(document.body.contains(this) ? 'click-attached' : 'click-detached')
    })
    render(<RecoveryCodes codes={codes} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Download/ }))
    expect(order).toEqual(['click-attached'])
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(order).toEqual(['click-attached', 'revoke'])
    vi.useRealTimers() // FileReader needs real timers
    const text = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob!) })
    for (const c of codes) expect(text).toContain(c)
    expect(document.querySelector('a[download]')).toBeNull() // cleaned up
  })
})

describe('error boundary', () => {
  it('shows a Reload fallback when a lazy route chunk fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    render(<ErrorBoundary><Suspense fallback="loading"><Broken /></Suspense></ErrorBoundary>)
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i)
  })
})

describe('signed-in layout', () => {
  const shell = (inHeader: boolean) => render(
    <MemoryRouter><AppHeaderContext.Provider value={inHeader}><Shell><p>x</p></Shell></AppHeaderContext.Provider></MemoryRouter>)
  it('renders one theme toggle and one logo under the app header', () => {
    shell(true)
    expect(screen.queryByRole('button', { name: 'Dark mode' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Solvelt home' })).toBeNull()
  })
  it('renders them in the public shell', () => {
    shell(false)
    expect(screen.getAllByRole('button', { name: 'Dark mode' })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: 'Solvelt home' })).toHaveLength(1)
  })
})
