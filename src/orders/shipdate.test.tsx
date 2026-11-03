// A zone far from UTC, so "today" differs between the local date and toISOString() for part of the day.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'America/Los_Angeles'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShipDialog } from './Dialogs'
import { mount, order } from './testkit'

describe('ship dialog date', () => {
  it('defaults to the local date, not the UTC date', async () => {
    const now = new Date(2026, 5, 15, 23, 30)          // 23:30 on 15 Jun local = 16 Jun in UTC
    expect(now.toISOString().slice(0, 10)).toBe('2026-06-16')
    mount(<ShipDialog order={order()} now={now} onClose={vi.fn()} onDone={vi.fn()} />, '/')
    expect(await screen.findByLabelText(/Ship date|Shipped on|Date/i)).toHaveValue('2026-06-15')
  })
})
