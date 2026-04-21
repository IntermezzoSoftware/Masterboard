import { renderHook, act, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { capturedCallbacks } = vi.hoisted(() => ({
  capturedCallbacks: {} as Record<string, (data: any) => void>,
}))

vi.mock('@/lib/wailsRuntime', () => ({
  EventsOn: vi.fn((event: string, cb: (data: any) => void) => {
    capturedCallbacks[event] = cb
    return vi.fn()
  }),
}))

const mockApi = vi.hoisted(() => ({
  getGameAnalysis:  vi.fn().mockResolvedValue(null),
  analyseGame:      vi.fn().mockResolvedValue(undefined),
  cancelAnalysis:   vi.fn().mockResolvedValue(undefined),
  detectDeviation:  vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/api', () => ({
  api: mockApi,
}))

import { useGameAnalysis } from './useGameAnalysis'

describe('useGameAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete capturedCallbacks['analysis:progress']
    delete capturedCallbacks['analysis:complete']
  })

  it('returns idle state when gameId is null', () => {
    const { result } = renderHook(() => useGameAnalysis(null))
    expect(result.current.isAnalysing).toBe(false)
    expect(result.current.progress).toBeNull()
    expect(result.current.result).toBeNull()
  })

  it('loads existing analysis on mount', async () => {
    const analysisResult = {
      gameId: 'g1', depth: 18, whiteAccuracy: 85, blackAccuracy: 90,
      whiteAcpl: 20, blackAcpl: 15, status: 'complete' as const,
      errorMsg: '', analysedAt: '', evals: [],
    }
    mockApi.getGameAnalysis.mockResolvedValueOnce(analysisResult)

    const { result } = renderHook(() => useGameAnalysis('g1'))

    await waitFor(() => {
      expect(result.current.result).toEqual(analysisResult)
    })
  })

  it('starts analysis and tracks progress', async () => {
    const { result } = renderHook(() => useGameAnalysis('g1'))

    act(() => { result.current.startAnalysis() })
    expect(result.current.isAnalysing).toBe(true)
    expect(mockApi.analyseGame).toHaveBeenCalledWith('g1')

    act(() => {
      capturedCallbacks['analysis:progress']?.({
        gameId: 'g1', ply: 5, totalPlies: 20,
      })
    })
    expect(result.current.progress).toEqual({ ply: 5, totalPlies: 20 })
  })

  it('ignores progress for other games', () => {
    const { result } = renderHook(() => useGameAnalysis('g1'))

    act(() => { result.current.startAnalysis() })
    act(() => {
      capturedCallbacks['analysis:progress']?.({
        gameId: 'other-game', ply: 5, totalPlies: 20,
      })
    })
    expect(result.current.progress).toBeNull()
  })

  it('handles completion event', async () => {
    const completedResult = {
      gameId: 'g1', depth: 18, whiteAccuracy: 85, blackAccuracy: 90,
      whiteAcpl: 20, blackAcpl: 15, status: 'complete' as const,
      errorMsg: '', analysedAt: '', evals: [],
    }
    mockApi.getGameAnalysis.mockResolvedValueOnce(null) // initial load
    mockApi.getGameAnalysis.mockResolvedValueOnce(completedResult) // after complete

    const { result } = renderHook(() => useGameAnalysis('g1'))

    act(() => { result.current.startAnalysis() })
    act(() => {
      capturedCallbacks['analysis:complete']?.({ gameId: 'g1' })
    })

    expect(result.current.isAnalysing).toBe(false)
    expect(result.current.progress).toBeNull()

    await waitFor(() => {
      expect(result.current.result).toEqual(completedResult)
    })
  })

  it('resets isAnalysing and progress when gameId changes', async () => {
    const { result, rerender } = renderHook(
      ({ gameId }) => useGameAnalysis(gameId),
      { initialProps: { gameId: 'g1' as string | null } },
    )

    // Start analysis on g1.
    act(() => { result.current.startAnalysis() })
    expect(result.current.isAnalysing).toBe(true)

    // Fire a progress event.
    act(() => {
      capturedCallbacks['analysis:progress']?.({
        gameId: 'g1', ply: 5, totalPlies: 20,
      })
    })
    expect(result.current.progress).toEqual({ ply: 5, totalPlies: 20 })

    // Switch to g2.
    mockApi.getGameAnalysis.mockResolvedValueOnce(null)
    rerender({ gameId: 'g2' })

    expect(result.current.isAnalysing).toBe(false)
    expect(result.current.progress).toBeNull()
    expect(result.current.result).toBeNull()
  })

  it('resets isAnalysing when switching from a game with running status', async () => {
    const runningResult = {
      gameId: 'g1', depth: 18, whiteAccuracy: null, blackAccuracy: null,
      whiteAcpl: null, blackAcpl: null, status: 'running' as const,
      errorMsg: '', analysedAt: '', evals: [],
    }
    mockApi.getGameAnalysis.mockResolvedValueOnce(runningResult)

    const { result, rerender } = renderHook(
      ({ gameId }) => useGameAnalysis(gameId),
      { initialProps: { gameId: 'g1' as string | null } },
    )

    // Wait for the running status to be loaded.
    await waitFor(() => {
      expect(result.current.isAnalysing).toBe(true)
    })

    // Switch to g2.
    mockApi.getGameAnalysis.mockResolvedValueOnce(null)
    rerender({ gameId: 'g2' })

    // Should immediately reset.
    expect(result.current.isAnalysing).toBe(false)
    expect(result.current.progress).toBeNull()
  })

  it('cancels analysis and clears result', () => {
    const { result } = renderHook(() => useGameAnalysis('g1'))

    act(() => { result.current.startAnalysis() })
    act(() => { result.current.cancelAnalysis() })

    expect(result.current.isAnalysing).toBe(false)
    expect(result.current.result).toBeNull()
    expect(mockApi.cancelAnalysis).toHaveBeenCalled()
  })

  it('fetches DB after cancel to restore previous results if any', async () => {
    const restored = { gameId: 'g1', status: 'complete', whiteAccuracy: 85, blackAccuracy: 90,
      whiteAcpl: 12, blackAcpl: 15, depth: 22, analysedAt: '', pgnAnnotated: false, evals: [], appliedEvals: [] }
    mockApi.getGameAnalysis
      .mockResolvedValueOnce(null)      // initial load
      .mockResolvedValueOnce(restored)  // post-cancel fetch

    const { result } = renderHook(() => useGameAnalysis('g1'))

    act(() => { result.current.startAnalysis() })
    act(() => { result.current.cancelAnalysis() })

    await act(async () => {
      capturedCallbacks['analysis:complete']?.({ gameId: 'g1', status: 'cancelled' })
      await Promise.resolve()
    })

    // Should have fetched to check for restored results.
    expect(mockApi.getGameAnalysis).toHaveBeenCalledTimes(2)
    expect(result.current.result).toEqual(restored)
  })

  it('leaves result null after cancel when no previous analysis existed', async () => {
    mockApi.getGameAnalysis
      .mockResolvedValueOnce(null)  // initial load
      .mockResolvedValueOnce(null)  // post-cancel fetch (fresh analysis — no record restored)

    const { result } = renderHook(() => useGameAnalysis('g1'))

    act(() => { result.current.startAnalysis() })
    act(() => { result.current.cancelAnalysis() })

    await act(async () => {
      capturedCallbacks['analysis:complete']?.({ gameId: 'g1', status: 'cancelled' })
      await Promise.resolve()
    })

    expect(result.current.result).toBeNull()
  })

  it('surfaces error status from completion event without fetching', async () => {
    mockApi.getGameAnalysis.mockResolvedValueOnce(null) // initial load

    const { result } = renderHook(() => useGameAnalysis('g1'))

    act(() => { result.current.startAnalysis() })
    act(() => {
      capturedCallbacks['analysis:complete']?.({
        gameId: 'g1', status: 'error', errorMsg: 'engine crashed',
      })
    })

    expect(result.current.isAnalysing).toBe(false)
    expect(result.current.result).not.toBeNull()
    expect(result.current.result?.status).toBe('error')
    expect(result.current.result?.errorMsg).toBe('engine crashed')
    // Should NOT have called getGameAnalysis after the error event —
    // only the initial load call.
    expect(mockApi.getGameAnalysis).toHaveBeenCalledTimes(1)
  })

  it('cancelAnalysis awaits the backend call', async () => {
    let resolveCancel!: () => void
    const cancelPromise = new Promise<void>(r => { resolveCancel = r })
    mockApi.cancelAnalysis.mockReturnValueOnce(cancelPromise)

    const { result } = renderHook(() => useGameAnalysis('g1'))

    act(() => { result.current.startAnalysis() })

    // cancelAnalysis should return a promise that resolves after the backend.
    let cancelResolved = false
    let returnedPromise: Promise<void> | undefined
    act(() => {
      returnedPromise = result.current.cancelAnalysis() as Promise<void> | undefined
      returnedPromise?.then(() => { cancelResolved = true })
    })

    // UI should be updated immediately (optimistic).
    expect(result.current.isAnalysing).toBe(false)

    // But the returned promise should not have resolved yet.
    await Promise.resolve() // flush microtasks
    expect(cancelResolved).toBe(false)

    // Resolve the backend call.
    await act(async () => { resolveCancel() })

    // Now the promise should resolve.
    await act(async () => { await returnedPromise })
    expect(cancelResolved).toBe(true)
  })
})
