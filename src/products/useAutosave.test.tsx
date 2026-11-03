import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutosave } from './useAutosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useAutosave', () => {
  it('debounces rapid changes into one save and reports Saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave(save, 1000))
    act(() => { result.current.touch(); result.current.touch() })
    await act(async () => { await vi.advanceTimersByTimeAsync(500); result.current.touch() })
    expect(result.current.status).toBe('dirty'); expect(result.current.unsaved).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(999) }); expect(save).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(2) })
    expect(save).toHaveBeenCalledTimes(1); expect(result.current.status).toBe('saved'); expect(result.current.unsaved).toBe(false)
  })

  it('a change made while saving triggers exactly one more save', async () => {
    let release!: () => void
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { release = r })).mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave(save, 100))
    act(() => result.current.touch())
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(result.current.status).toBe('saving')
    act(() => result.current.touch())
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(10) })
    expect(save).toHaveBeenCalledTimes(2); expect(result.current.status).toBe('saved')
  })

  it('a failed save keeps the error status (nothing is discarded) and the next change retries', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave(save, 100))
    act(() => result.current.touch())
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(result.current.status).toBe('error'); expect(result.current.unsaved).toBe(true)
    act(() => result.current.touch())
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(save).toHaveBeenCalledTimes(2); expect(result.current.status).toBe('saved')
  })

  it('flush saves immediately, and manual mode never auto-saves', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave(save, 100, true))
    act(() => result.current.touch())
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) }); expect(save).not.toHaveBeenCalled(); expect(result.current.status).toBe('dirty')
    await act(async () => { await result.current.flush() })
    expect(save).toHaveBeenCalledTimes(1); expect(result.current.status).toBe('saved')
  })
})
