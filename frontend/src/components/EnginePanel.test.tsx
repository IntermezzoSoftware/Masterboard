import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { EngineAnalysisHook } from '@/hooks/useEngineAnalysis'
import type { EngineInfo } from '@/lib/api'

const { mockUseEngineContext, mockUseEngineAnalysis } = vi.hoisted(() => ({
  mockUseEngineContext: vi.fn(),
  mockUseEngineAnalysis: vi.fn(),
}))

vi.mock('@/context/EngineContext', () => ({
  useEngineContext: mockUseEngineContext,
}))

vi.mock('@/hooks/useEngineAnalysis', () => ({
  useEngineAnalysis: mockUseEngineAnalysis,
}))

function makeInfo(overrides: Partial<EngineInfo> = {}): EngineInfo {
  return {
    depth: 1, selDepth: 1, multiPV: 1, scoreCp: 0,
    isMate: false, scoreMate: 0, nodes: 1000, timeMs: 100, pvUci: [],
    ...overrides,
  }
}

const defaultCtx: EngineAnalysisHook & { navigateToPV?: (fen: string, uciMoves: string[]) => void } = {
  isReady: true,
  isAnalysing: false,
  lines: [],
  currentDepth: 0,
  analysisFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  multiPV: 1,
  showArrows: true,
  availableEngines: [{ path: 'stockfish', name: 'Stockfish' }],
  activeEngine: 'stockfish',
  engineName: 'Stockfish 17',
  engineType: 'ab',
  startAnalysis: vi.fn(),
  stopAnalysis: vi.fn(),
  setMultiPV: vi.fn(),
  toggleArrows: vi.fn(),
  setActiveEngine: vi.fn(),
  navigateToPV: vi.fn(),
}

import EnginePanel from './EnginePanel'

describe('EnginePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEngineContext.mockReturnValue({ ...defaultCtx })
    mockUseEngineAnalysis.mockReturnValue({ ...defaultCtx })
  })

  it('1: isReady:false → Start button is disabled', () => {
    mockUseEngineContext.mockReturnValue({ ...defaultCtx, isReady: false })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-start-btn')).toBeDisabled()
  })

  it('2: isReady:true, not analysing → Start active; click calls startAnalysis', () => {
    const startAnalysis = vi.fn()
    mockUseEngineContext.mockReturnValue({ ...defaultCtx, isReady: true, isAnalysing: false, startAnalysis })
    render(<EnginePanel />)
    const btn = screen.getByTestId('engine-start-btn')
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(startAnalysis).toHaveBeenCalledTimes(1)
  })

  it('3: isAnalysing:true → Stop button visible; click calls stopAnalysis', () => {
    const stopAnalysis = vi.fn()
    mockUseEngineContext.mockReturnValue({ ...defaultCtx, isAnalysing: true, stopAnalysis })
    render(<EnginePanel />)
    const btn = screen.getByTestId('engine-stop-btn')
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(stopAnalysis).toHaveBeenCalledTimes(1)
  })

  it('4: scoreCp:25 depth:18 → score "+0.25", depth "18"', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      lines: [makeInfo({ scoreCp: 25, depth: 18 })],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-score').textContent).toBe('+0.25')
    expect(screen.getByTestId('engine-depth').textContent).toBe('18')
  })

  it('5: scoreCp:-130 → score "-1.30"', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      lines: [makeInfo({ scoreCp: -130 })],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-score').textContent).toBe('-1.30')
  })

  it('6: isMate:true scoreMate:3 → score "M3"', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      lines: [makeInfo({ isMate: true, scoreMate: 3 })],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-score').textContent).toBe('M3')
  })

  it('7: isMate:true scoreMate:-2 → score "-M2"', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      lines: [makeInfo({ isMate: true, scoreMate: -2 })],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-score').textContent).toBe('-M2')
  })

  it('8: pvUci moves → engine-pv-0 shows SAN notation', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      lines: [makeInfo({ pvUci: ['e2e4', 'e7e5'] })],
    })
    render(<EnginePanel />)
    const pvRow = screen.getByTestId('engine-pv-0')
    // SAN output: "1. e4 e5"
    expect(pvRow.textContent).toContain('e4')
    expect(pvRow.textContent).toContain('e5')
    expect(pvRow.textContent).not.toContain('e2e4')
  })

  it('9: two lines → two engine-pv-* rows', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      lines: [
        makeInfo({ multiPV: 1, pvUci: ['e2e4'] }),
        makeInfo({ multiPV: 2, pvUci: ['d2d4'] }),
      ],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-pv-0')).toBeInTheDocument()
    expect(screen.getByTestId('engine-pv-1')).toBeInTheDocument()
  })

  it('10: click pv text span calls navigateToPV', () => {
    const navigateToPV = vi.fn()
    const analysisFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      analysisFen,
      lines: [makeInfo({ pvUci: ['e2e4', 'e7e5'] })],
      navigateToPV,
    })
    render(<EnginePanel />)
    fireEvent.click(screen.getByTestId('engine-pv-text-0'))
    expect(navigateToPV).toHaveBeenCalledWith(analysisFen, ['e2e4', 'e7e5'])
  })

  it('11: click engine-multipv-btn-3 calls setMultiPV(3)', () => {
    const setMultiPV = vi.fn()
    mockUseEngineContext.mockReturnValue({ ...defaultCtx, setMultiPV })
    render(<EnginePanel />)
    fireEvent.click(screen.getByTestId('engine-multipv-btn-3'))
    expect(setMultiPV).toHaveBeenCalledWith(3)
  })

  it('14a: stopAnalysis called on unmount', () => {
    const stopAnalysis = vi.fn()
    mockUseEngineContext.mockReturnValue({ ...defaultCtx, isAnalysing: true, stopAnalysis })
    const { unmount } = render(<EnginePanel />)
    unmount()
    expect(stopAnalysis).toHaveBeenCalled()
  })

  it('15: multiPV===1 → no score badge in engine-pv-0 row', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      multiPV: 1,
      lines: [makeInfo({ scoreCp: 30, pvUci: ['e2e4'] })],
    })
    render(<EnginePanel />)
    expect(screen.queryByTestId('engine-line-score-0')).not.toBeInTheDocument()
  })

  it('16: two lines → engine-line-score-0 and engine-line-score-1 both visible', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      multiPV: 2,
      lines: [
        makeInfo({ multiPV: 1, scoreCp: 30, pvUci: ['e2e4'] }),
        makeInfo({ multiPV: 2, scoreCp: -75, pvUci: ['d2d4'] }),
      ],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-line-score-0')).toBeInTheDocument()
    expect(screen.getByTestId('engine-line-score-1')).toBeInTheDocument()
  })

  it('17: lines[1].scoreCp=-75 → engine-line-score-1 shows "-0.75"', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      multiPV: 2,
      lines: [
        makeInfo({ multiPV: 1, scoreCp: 30, pvUci: ['e2e4'] }),
        makeInfo({ multiPV: 2, scoreCp: -75, pvUci: ['d2d4'] }),
      ],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-line-score-1').textContent).toBe('-0.75')
  })

  it('18: lines[1].isMate=true scoreMate=-2 → engine-line-score-1 shows "-M2"', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      multiPV: 2,
      lines: [
        makeInfo({ multiPV: 1, scoreCp: 0, pvUci: ['e2e4'] }),
        makeInfo({ multiPV: 2, isMate: true, scoreMate: -2, pvUci: ['d2d4'] }),
      ],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-line-score-1').textContent).toBe('-M2')
  })

  // 11-ply Ruy Lopez main line (legal from initial position)
  const RUY_LOPEZ_11 = ['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6','e1g1','f8e7','f1e1']

  it('19: line with ≤10 ply → no expand button', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      lines: [makeInfo({ pvUci: RUY_LOPEZ_11.slice(0, 10) })],
    })
    render(<EnginePanel />)
    expect(screen.queryByTestId('engine-pv-expand-0')).not.toBeInTheDocument()
  })

  it('20: line with 11 ply → expand button shown; text shows only first 10 ply', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      lines: [makeInfo({ pvUci: RUY_LOPEZ_11 })],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-pv-expand-0')).toBeInTheDocument()
    const text = screen.getByTestId('engine-pv-text-0').textContent ?? ''
    expect(text).not.toContain('Re1')
    expect(text).toContain('Be7')
  })

  it('21: clicking expand shows full line; clicking again collapses', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      lines: [makeInfo({ pvUci: RUY_LOPEZ_11 })],
    })
    render(<EnginePanel />)
    const btn = screen.getByTestId('engine-pv-expand-0')

    fireEvent.click(btn)
    expect(screen.getByTestId('engine-pv-text-0').textContent).toContain('Re1')

    fireEvent.click(btn)
    expect(screen.getByTestId('engine-pv-text-0').textContent).not.toContain('Re1')
  })

  it('22: arrow toggle button renders with aria-pressed=true by default', () => {
    render(<EnginePanel />)
    const btn = screen.getByTestId('engine-arrows-btn')
    expect(btn).toBeInTheDocument()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('23: clicking arrow toggle button calls toggleArrows', () => {
    const toggleArrows = vi.fn()
    mockUseEngineContext.mockReturnValue({ ...defaultCtx, toggleArrows })
    render(<EnginePanel />)
    fireEvent.click(screen.getByTestId('engine-arrows-btn'))
    expect(toggleArrows).toHaveBeenCalledTimes(1)
  })

  it('24: when showArrows is false, arrow button aria-pressed is false', () => {
    mockUseEngineContext.mockReturnValue({ ...defaultCtx, showArrows: false })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-arrows-btn').getAttribute('aria-pressed')).toBe('false')
  })

  it('25: clicking text span calls navigateToPV; clicking expand button does not', () => {
    const navigateToPV = vi.fn()
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      analysisFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      lines: [makeInfo({ pvUci: RUY_LOPEZ_11 })],
      navigateToPV,
    })
    render(<EnginePanel />)

    fireEvent.click(screen.getByTestId('engine-pv-text-0'))
    expect(navigateToPV).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('engine-pv-expand-0'))
    expect(navigateToPV).toHaveBeenCalledTimes(1)
  })

  it('28a: MCTS engine shows nodes in header instead of depth', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      engineType: 'mcts',
      lines: [makeInfo({ depth: 12, nodes: 1500000 })],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-nodes').textContent).toBe('1.5M')
    expect(screen.queryByTestId('engine-depth')).not.toBeInTheDocument()
  })

  it('28b: AB engine shows depth in header (no nodes testid)', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      engineType: 'ab',
      lines: [makeInfo({ depth: 28, nodes: 5000000 })],
    })
    render(<EnginePanel />)
    expect(screen.getByTestId('engine-depth').textContent).toBe('28')
    expect(screen.queryByTestId('engine-nodes')).not.toBeInTheDocument()
  })

  it('28c: MCTS status line shows nodes first, then depth', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultCtx,
      engineType: 'mcts',
      lines: [makeInfo({ depth: 12, nodes: 1500000, timeMs: 1000 })],
    })
    render(<EnginePanel />)
    const status = screen.getByTestId('engine-status').textContent ?? ''
    expect(status).toMatch(/^1\.5M nodes/)
    expect(status).toContain('depth 12')
  })

  it('26: enabling dual mode when primary is not analysing → secondary startAnalysis not called', () => {
    const startAnalysis2 = vi.fn()
    mockUseEngineContext.mockReturnValue({ ...defaultCtx, isAnalysing: false })
    mockUseEngineAnalysis.mockReturnValue({ ...defaultCtx, isReady: true, startAnalysis: startAnalysis2 })
    render(<EnginePanel />)
    fireEvent.click(screen.getByTestId('engine-dual-btn'))
    expect(startAnalysis2).not.toHaveBeenCalled()
  })

  it('27: enabling dual mode when primary is analysing → secondary startAnalysis called once', () => {
    const startAnalysis2 = vi.fn()
    mockUseEngineContext.mockReturnValue({ ...defaultCtx, isAnalysing: true })
    mockUseEngineAnalysis.mockReturnValue({ ...defaultCtx, isReady: true, startAnalysis: startAnalysis2 })
    render(<EnginePanel />)
    fireEvent.click(screen.getByTestId('engine-dual-btn'))
    expect(startAnalysis2).toHaveBeenCalledTimes(1)
  })

})
