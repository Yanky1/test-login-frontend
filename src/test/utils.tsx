import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import { http, HttpResponse } from 'msw'
import { AuthProvider } from '../auth'
import { defaultConfig, type RuntimeConfig } from '../config'
import { API, loginBody, server } from './server'

export function LocationProbe() {
  const l = useLocation()
  return <div data-testid="loc">{l.pathname + l.search}</div>
}

/** Makes the session bootstrap succeed (user is signed in on first render). */
export const signedIn = (over: Record<string, unknown> = {}) =>
  server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.json(loginBody(over))))

export function renderAt(ui: ReactElement, route = '/', config: Partial<RuntimeConfig> = {}) {
  const cfg = { ...defaultConfig, turnstileSiteKey: 'stub', ...config }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider initialConfig={cfg}>
        {ui}
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  )
}
