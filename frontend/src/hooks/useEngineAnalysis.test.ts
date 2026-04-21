import { renderHook, act, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { EngineInfo } from '@/lib/api'

// Capture EventsOn callbacks so tests can fire synthetic engine events.
const { capturedCallbacks } = vi.hoisted(() => ({
  capturedCallbacks: {} as Record<string, (data: any) => void>,
}))

vi.mock('@/lib/wailsRuntime', () => ({
  EventsOn: vi.fn((event: string, cb: (data: any) => void) => {
    capturedCallbacks[event] = cb
    return vi.fn() // returns unsubscribe fn
  }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    startAnalysis:    vi.fn().mockResolvedValue(undefined),
    stopAnalysis:     vi.fn().mockResolvedValue(undefined),
    setActiveEngine:  vi.fn().mockResolvedValue(undefined),
    setEngineOption:  vi.fn().mockResolvedValue(undefined),
    getEngineState:   vi.fn().mockResolvedValue({
      isReady: true, isAnalysing: false, activeEngine: '', availableEngines: [],
    }),
  },
}))

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const E4_FEN    = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

function makeInfo(overrides: Partial<EngineInfo> = {}): EngineInfo {
  return {
    depth: 1, selDepth: 1, multiPV: 1, scoreCp: 50,
    isMate: false, scoreMate: 0, nodes: 1000, timeMs: 100, pvUci: ['e2e4'],
    ...overrides,
  }
}

function fireInfo(overrides: Partial<EngineInfo> = {}) {
  act(() => { capturedCallbacks['engine:info']?.(makeInfo(overrides)) })
}

import { useEngineAnalysis } from './useEngineAnalysis'

describe('useEngineAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    delete capturedCallbacks['engine:info']
    delete capturedCallbacks['engine:ready']
  })

  it('1: initial state is not analysing, empty lines, depth 0', () => {
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    expect(result.current.isAnalysing).toBe(false)
    expect(result.current.lines).toEqual([])
    expect(result.current.currentDepth).toBe(0)
  })

  it('2: startAnalysis calls api, sets isAnalysing and analysisFen', async () => {
    const { api } = await import('@/lib/api')
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    await act(async () => { result.current.startAnalysis() })
    expect(result.current.isAnalysing).toBe(true)
    expect(result.current.analysisFen).toBe(START_FEN)
    expect(vi.mocked(api.startAnalysis)).toHaveBeenCalledWith(START_FEN, 1)
  })

  it('3: stopAnalysis calls api, clears isAnalysing', async () => {
    const { api } = await import('@/lib/api')
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    await act(async () => { result.current.startAnalysis() })
    await act(async () => { result.current.stopAnalysis() })
    expect(result.current.isAnalysing).toBe(false)
    expect(vi.mocked(api.stopAnalysis)).toHaveBeenCalled()
  })

  it('4: engine:info event updates lines and currentDepth', async () => {
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    await act(async () => { result.current.startAnalysis() })
    fireInfo({ depth: 10, multiPV: 1 })
    expect(result.current.lines[0]).toMatchObject({ depth: 10 })
    expect(result.current.currentDepth).toBe(10)
  })

  it('5: multiple events at same multiPV replace, not append', async () => {
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    await act(async () => { result.current.startAnalysis() })
    fireInfo({ depth: 5, multiPV: 1, scoreCp: 10 })
    fireInfo({ depth: 10, multiPV: 1, scoreCp: 20 })
    expect(result.current.lines).toHaveLength(1)
    expect(result.current.lines[0]).toMatchObject({ depth: 10, scoreCp: 20 })
  })

  it('6: FEN change while analysing stops then restarts in order', async () => {
    const { api } = await import('@/lib/api')
    const { result, rerender } = renderHook(
      ({ fen }: { fen: string }) => useEngineAnalysis(fen),
      { initialProps: { fen: START_FEN } }
    )
    await act(async () => { result.current.startAnalysis() })
    vi.clearAllMocks()

    await act(async () => { rerender({ fen: E4_FEN }) })
    await waitFor(() => expect(vi.mocked(api.startAnalysis)).toHaveBeenCalled())

    expect(vi.mocked(api.stopAnalysis)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.startAnalysis)).toHaveBeenCalledWith(E4_FEN, 1)
    const stopOrder  = vi.mocked(api.stopAnalysis).mock.invocationCallOrder[0]
    const startOrder = vi.mocked(api.startAnalysis).mock.invocationCallOrder[0]
    expect(stopOrder).toBeLessThan(startOrder)
    expect(result.current.analysisFen).toBe(E4_FEN)
  })

  it('7: FEN change while not analysing makes no API calls', async () => {
    const { api } = await import('@/lib/api')
    const { rerender } = renderHook(
      ({ fen }: { fen: string }) => useEngineAnalysis(fen),
      { initialProps: { fen: START_FEN } }
    )
    await act(async () => { rerender({ fen: E4_FEN }) })
    expect(vi.mocked(api.stopAnalysis)).not.toHaveBeenCalled()
    expect(vi.mocked(api.startAnalysis)).not.toHaveBeenCalled()
  })

  it('8: setMultiPV while analysing stops and restarts with new count', async () => {
    const { api } = await import('@/lib/api')
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    await act(async () => { result.current.startAnalysis() })
    vi.clearAllMocks()

    await act(async () => { result.current.setMultiPV(3) })
    await waitFor(() => expect(vi.mocked(api.startAnalysis)).toHaveBeenCalled())

    expect(vi.mocked(api.stopAnalysis)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.startAnalysis)).toHaveBeenCalledWith(START_FEN, 3)
    expect(result.current.multiPV).toBe(3)
  })

  it('8b: decreasing multiPV discards stale lines from previous setting', async () => {
    const { api } = await import('@/lib/api')

    let resolveStop!: () => void

    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    await act(async () => { result.current.startAnalysis() })

    // Populate 3 lines as if the engine is running with MultiPV=3.
    // Use default instant-resolve mock so the restart cycle completes.
    await act(async () => { result.current.setMultiPV(3) })
    // Flush the two-level fire-and-forget stop→start promise chain
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireInfo({ depth: 20, multiPV: 1, scoreCp: 30, pvUci: ['e2e4'] })
    fireInfo({ depth: 20, multiPV: 2, scoreCp: 15, pvUci: ['d2d4'] })
    fireInfo({ depth: 20, multiPV: 3, scoreCp: 5,  pvUci: ['c2c4'] })
    expect(result.current.lines).toHaveLength(3)

    vi.clearAllMocks()

    // User clicks MultiPV=2.  setMultiPV(2) clears lines and calls stop→start.
    // We hold stopAnalysis open so we can simulate the stale events that the
    // engine's readLoop emits during the stop phase.
    vi.mocked(api.stopAnalysis).mockImplementation(
      () => new Promise<void>(r => { resolveStop = r })
    )

    act(() => { result.current.setMultiPV(2) })

    // Lines should be cleared immediately
    expect(result.current.lines).toHaveLength(0)

    // Simulate stale events from the dying analysis (engine still has MultiPV=3).
    // All should be discarded because isAnalysingRef is false during the stop window.
    fireInfo({ depth: 21, multiPV: 1, scoreCp: 32, pvUci: ['e2e4'] })
    fireInfo({ depth: 21, multiPV: 2, scoreCp: 17, pvUci: ['d2d4'] })
    fireInfo({ depth: 21, multiPV: 3, scoreCp: 7,  pvUci: ['c2c4'] })

    expect(result.current.lines).toHaveLength(0)

    // Complete the stop and let start fire
    await act(async () => { resolveStop() })
    await waitFor(() => expect(vi.mocked(api.startAnalysis)).toHaveBeenCalledWith(START_FEN, 2))

    // New analysis events with only 2 lines — these arrive after restart
    fireInfo({ depth: 1, multiPV: 1, scoreCp: 40, pvUci: ['e2e4'] })
    fireInfo({ depth: 1, multiPV: 2, scoreCp: 20, pvUci: ['d2d4'] })
    expect(result.current.lines).toHaveLength(2)
  })

  it('8c: stale events during stop window are discarded (multiPV change)', async () => {
    const { api } = await import('@/lib/api')

    // Use a delayed stop mock so we can control the timing precisely
    let resolveStop!: () => void
    vi.mocked(api.stopAnalysis).mockImplementation(
      () => new Promise<void>(r => { resolveStop = r })
    )

    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    await act(async () => { result.current.startAnalysis() })

    // Switch to 3 lines — hold stop open
    act(() => { result.current.setMultiPV(3) })

    // Stale events during the stop window should be discarded
    fireInfo({ depth: 20, multiPV: 1, scoreCp: 30, pvUci: ['e2e4'] })
    fireInfo({ depth: 20, multiPV: 2, scoreCp: 15, pvUci: ['d2d4'] })
    fireInfo({ depth: 20, multiPV: 3, scoreCp: 5,  pvUci: ['c2c4'] })
    expect(result.current.lines).toHaveLength(0)

    // Complete the restart
    await act(async () => { resolveStop() })
    await waitFor(() => expect(vi.mocked(api.startAnalysis)).toHaveBeenCalledWith(START_FEN, 3))

    // Fresh events after restart are accepted
    fireInfo({ depth: 1, multiPV: 1, scoreCp: 40, pvUci: ['e2e4'] })
    fireInfo({ depth: 1, multiPV: 2, scoreCp: 20, pvUci: ['d2d4'] })
    fireInfo({ depth: 1, multiPV: 3, scoreCp: 10, pvUci: ['c2c4'] })
    expect(result.current.lines).toHaveLength(3)
    expect(result.current.lines[0]).toMatchObject({ scoreCp: 40 })
  })

  it('9: unmount while analysing calls stopAnalysis', async () => {
    const { api } = await import('@/lib/api')
    const { result, unmount } = renderHook(() => useEngineAnalysis(START_FEN))
    await act(async () => { result.current.startAnalysis() })
    vi.clearAllMocks()
    unmount()
    expect(vi.mocked(api.stopAnalysis)).toHaveBeenCalledTimes(1)
  })

  it('10: unmount while not analysing does not call stopAnalysis', async () => {
    const { api } = await import('@/lib/api')
    const { unmount } = renderHook(() => useEngineAnalysis(START_FEN))
    unmount()
    expect(vi.mocked(api.stopAnalysis)).not.toHaveBeenCalled()
  })

  it('12: hook stores scoreCp as-is — normalization is Go-side', async () => {
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    await act(async () => { result.current.startAnalysis() })
    fireInfo({ depth: 5, multiPV: 1, scoreCp: -31 })
    expect(result.current.lines[0].scoreCp).toBe(-31)
  })

  it('11: engine:ready event sets isReady true even if getEngineState returned false', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getEngineState).mockResolvedValueOnce({
      isReady: false, isAnalysing: false, activeEngine: '', availableEngines: [],
    })
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    // Allow the getEngineState promise to resolve
    await act(async () => {})
    expect(result.current.isReady).toBe(false)
    // Simulate the Go goroutine completing and emitting engine:ready
    act(() => { capturedCallbacks['engine:ready']?.({}) })
    expect(result.current.isReady).toBe(true)
  })

  it('12: availableEngines and activeEngine populated from getEngineState on mount', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getEngineState).mockResolvedValueOnce({
      isReady: true, isAnalysing: false, activeEngine: '/bin/stockfish',
      availableEngines: [
        { path: '/bin/stockfish', name: 'stockfish' },
        { path: '/bin/leela', name: 'leela' },
      ],
    })
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    await act(async () => {})
    expect(result.current.availableEngines).toEqual([
      { path: '/bin/stockfish', name: 'stockfish' },
      { path: '/bin/leela', name: 'leela' },
    ])
    expect(result.current.activeEngine).toBe('/bin/stockfish')
  })

  it('13: setActiveEngine clears isAnalysing, lines, sets isReady false, calls api.setActiveEngine', async () => {
    const { api } = await import('@/lib/api')
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    // Start analysis first
    await act(async () => { result.current.startAnalysis() })
    fireInfo({ depth: 5, multiPV: 1, scoreCp: 30 })
    expect(result.current.lines).toHaveLength(1)

    act(() => { result.current.setActiveEngine('/bin/leela') })
    expect(result.current.isAnalysing).toBe(false)
    expect(result.current.isReady).toBe(false)
    expect(result.current.lines).toHaveLength(0)
    expect(result.current.activeEngine).toBe('/bin/leela')
    expect(vi.mocked(api.setActiveEngine)).toHaveBeenCalledWith('/bin/leela')

    // engine:ready should restore isReady
    act(() => { capturedCallbacks['engine:ready']?.({}) })
    expect(result.current.isReady).toBe(true)
  })

  it('14: showArrows defaults to true', () => {
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    expect(result.current.showArrows).toBe(true)
  })

  it('15: toggleArrows flips showArrows', () => {
    const { result } = renderHook(() => useEngineAnalysis(START_FEN))
    act(() => { result.current.toggleArrows() })
    expect(result.current.showArrows).toBe(false)
    act(() => { result.current.toggleArrows() })
    expect(result.current.showArrows).toBe(true)
  })
})
