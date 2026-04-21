import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSettings } from './useSettings'

vi.mock('@/lib/api', () => ({
  api: {
    getSetting: vi.fn(),
    setSetting: vi.fn(),
  },
}))

describe('useSettings', () => {
  beforeEach(async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockResolvedValue('')
    vi.mocked(api.setSetting).mockResolvedValue(undefined)
  })

  it('starts in loading state', () => {
    const { result } = renderHook(() => useSettings(['a']))
    expect(result.current.loading).toBe(true)
  })

  it('resolves values after load', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockImplementation((key: string) =>
      Promise.resolve(key === 'a' ? 'hello' : '')
    )
    const { result } = renderHook(() => useSettings(['a']))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.values['a']).toBe('hello')
  })

  it('provides empty string for missing keys', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockResolvedValue('')
    const { result } = renderHook(() => useSettings(['missing']))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.values['missing']).toBe('')
  })

  it('swallows getSetting errors and provides empty string', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockRejectedValue(new Error('db error'))
    const { result } = renderHook(() => useSettings(['a']))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.values['a']).toBe('')
  })

  it('setValue optimistically updates local state', async () => {
    const { result } = renderHook(() => useSettings(['x']))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.setValue('x', 'newval') })
    expect(result.current.values['x']).toBe('newval')
  })

  it('setValue updates state even when API call fails', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.setSetting).mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useSettings(['x']))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.setValue('x', 'val') })
    expect(result.current.values['x']).toBe('val')
  })

  it('re-fetches when keys change', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockResolvedValue('')
    const { result, rerender } = renderHook(
      ({ keys }: { keys: string[] }) => useSettings(keys),
      { initialProps: { keys: ['a'] } }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    const callCount = vi.mocked(api.getSetting).mock.calls.length
    rerender({ keys: ['b'] })
    await waitFor(() => expect(vi.mocked(api.getSetting).mock.calls.length).toBeGreaterThan(callCount))
  })
})
