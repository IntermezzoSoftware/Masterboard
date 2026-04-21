import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import React from 'react'
import type { EngineAnalysisHook } from '@/hooks/useEngineAnalysis'

const { mockUseEngineAnalysis } = vi.hoisted(() => ({
  mockUseEngineAnalysis: vi.fn(),
}))

vi.mock('@/hooks/useEngineAnalysis', () => ({
  useEngineAnalysis: mockUseEngineAnalysis,
}))

const mockEngineHook: EngineAnalysisHook = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  isAnalysing: false,
  isReady: true,
  lines: [],
  currentDepth: 0,
  analysisFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  multiPV: 1,
  showArrows: true,
  availableEngines: [],
  activeEngine: '',
  engineName: '',
  engineType: 'ab',
  startAnalysis: vi.fn(),
  stopAnalysis: vi.fn(),
  setMultiPV: vi.fn(),
  toggleArrows: vi.fn(),
  setActiveEngine: vi.fn(),
}

mockUseEngineAnalysis.mockReturnValue(mockEngineHook)

import { EngineProvider, useEngineContext } from './EngineContext'

describe('EngineContext', () => {
  it('1: useEngineContext() outside provider throws', () => {
    function Consumer() {
      useEngineContext()
      return null
    }
    expect(() => render(<Consumer />)).toThrow('useEngineContext must be used inside EngineProvider')
  })

  it('2: EngineProvider forwards fen to useEngineAnalysis and exposes values', () => {
    const TEST_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

    function Consumer() {
      const ctx = useEngineContext()
      return (
        <div>
          <span data-testid="isReady">{String(ctx.isReady)}</span>
          <span data-testid="isAnalysing">{String(ctx.isAnalysing)}</span>
          <span data-testid="currentDepth">{ctx.currentDepth}</span>
          <span data-testid="multiPV">{ctx.multiPV}</span>
        </div>
      )
    }

    render(
      <EngineProvider fen={TEST_FEN}>
        <Consumer />
      </EngineProvider>
    )

    expect(mockUseEngineAnalysis).toHaveBeenCalledWith(TEST_FEN)
    expect(screen.getByTestId('isReady').textContent).toBe('true')
    expect(screen.getByTestId('isAnalysing').textContent).toBe('false')
    expect(screen.getByTestId('currentDepth').textContent).toBe('0')
    expect(screen.getByTestId('multiPV').textContent).toBe('1')
  })

  it('3: child components receive isAnalysing, lines, startAnalysis, stopAnalysis', () => {
    const startFn = vi.fn()
    const stopFn = vi.fn()
    mockUseEngineAnalysis.mockReturnValueOnce({
      ...mockEngineHook,
      isAnalysing: true,
      lines: [{ depth: 10, selDepth: 12, multiPV: 1, scoreCp: 25, isMate: false, scoreMate: 0, nodes: 5000, timeMs: 200, pvUci: ['e2e4'] }],
      startAnalysis: startFn,
      stopAnalysis: stopFn,
    })

    function Consumer() {
      const ctx = useEngineContext()
      return (
        <div>
          <span data-testid="isAnalysing">{String(ctx.isAnalysing)}</span>
          <span data-testid="lineCount">{ctx.lines.length}</span>
          <button data-testid="start" onClick={ctx.startAnalysis}>start</button>
          <button data-testid="stop" onClick={ctx.stopAnalysis}>stop</button>
        </div>
      )
    }

    const { getByTestId } = render(
      <EngineProvider fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1">
        <Consumer />
      </EngineProvider>
    )

    expect(getByTestId('isAnalysing').textContent).toBe('true')
    expect(getByTestId('lineCount').textContent).toBe('1')
    getByTestId('start').click()
    expect(startFn).toHaveBeenCalledTimes(1)
    getByTestId('stop').click()
    expect(stopFn).toHaveBeenCalledTimes(1)
  })
})
