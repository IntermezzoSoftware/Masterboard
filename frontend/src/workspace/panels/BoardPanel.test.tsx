import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { EngineInfo } from '@/lib/api'

const { mockUseEngineContext, mockUseChessGameContext, mockUseAnalysisContext, mockChessboard, mockSetAutoShapes } = vi.hoisted(() => {
  const mockSetAutoShapes = vi.fn()
  return {
    mockUseEngineContext: vi.fn(),
    mockUseChessGameContext: vi.fn(),
    mockUseAnalysisContext: vi.fn(),
    mockSetAutoShapes,
    mockChessboard: vi.fn((props: any) => {
      // Populate cgApiRef so BoardPanel's imperative arrow effect works.
      if (props.cgApiRef) props.cgApiRef.current = { setAutoShapes: mockSetAutoShapes }
      return <div data-testid="mock-chessboard" />
    }),
  }
})

vi.mock('@/context/EngineContext', () => ({
  useEngineContext: mockUseEngineContext,
}))

vi.mock('@/context/ChessGameContext', () => ({
  useChessGameContext: mockUseChessGameContext,
}))

vi.mock('@/context/AnalysisContext', () => ({
  useAnalysisContext: mockUseAnalysisContext,
}))

vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', palette: 'walnut' }),
  getAccentColor: () => 'oklch(40% 0.12 47)',
}))

vi.mock('@/components/Chessboard', () => ({
  default: mockChessboard,
}))

vi.mock('@/components/BoardControls', () => ({
  default: () => <div data-testid="mock-board-controls" />,
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn(),
}))

vi.mock('@lichess-org/chessground', () => ({
  Chessground: vi.fn(() => ({ destroy: vi.fn(), set: vi.fn() })),
}))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

global.ResizeObserver = vi.fn().mockImplementation((callback) => ({
  observe: () => callback([{ contentRect: { width: 600, height: 600 } }]),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

function makeInfo(overrides: Partial<EngineInfo> = {}): EngineInfo {
  return {
    depth: 1, selDepth: 1, multiPV: 1, scoreCp: 0,
    isMate: false, scoreMate: 0, nodes: 1000, timeMs: 100, pvUci: [],
    ...overrides,
  }
}

const rootNode = { id: '0', parent: null, children: [] as any[] }

const defaultChessCtx = {
  boardConfig: {},
  currentNode: rootNode,
  rootNode,
  orientation: 'white' as const,
  goBack: vi.fn(), goForward: vi.fn(), goToStart: vi.fn(), goToEnd: vi.fn(), flipOrientation: vi.fn(),
}

const defaultAnalysisCtx = {
  isAnalysing: false,
  progress: null,
  result: null,
  startAnalysis: vi.fn(),
  cancelAnalysis: vi.fn(),
}

const defaultEngineCtx = {
  isReady: false, isAnalysing: false, lines: [], currentDepth: 0,
  analysisFen: '', multiPV: 1, showArrows: true,
  availableEngines: [{ path: 'stockfish', name: 'Stockfish' }], activeEngine: 'stockfish',
  startAnalysis: vi.fn(), stopAnalysis: vi.fn(), setMultiPV: vi.fn(),
  toggleArrows: vi.fn(), setActiveEngine: vi.fn(),
}

import BoardPanel from './BoardPanel'

describe('BoardPanel — eval bar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseChessGameContext.mockReturnValue({ ...defaultChessCtx })
    mockUseEngineContext.mockReturnValue({ ...defaultEngineCtx })
    mockUseAnalysisContext.mockReturnValue({ ...defaultAnalysisCtx })
  })

  it('1: isAnalysing:false → eval bar in DOM but invisible (space reserved)', () => {
    render(<BoardPanel />)
    const bar = screen.getByTestId('engine-eval-bar')
    expect(bar).toBeInTheDocument()
    expect(bar.className).toContain('invisible')
  })

  it('2: isAnalysing:true but no lines → eval bar in DOM but invisible', () => {
    mockUseEngineContext.mockReturnValue({ ...defaultEngineCtx, isAnalysing: true, lines: [] })
    render(<BoardPanel />)
    const bar = screen.getByTestId('engine-eval-bar')
    expect(bar).toBeInTheDocument()
    expect(bar.className).toContain('invisible')
  })

  it('3: isAnalysing:true with lines → eval bar visible with correct aria-valuenow', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultEngineCtx,
      isAnalysing: true,
      lines: [makeInfo({ scoreCp: 50 })],
    })
    render(<BoardPanel />)
    const bar = screen.getByTestId('engine-eval-bar')
    expect(bar.className).not.toContain('invisible')
    expect(bar.getAttribute('aria-valuenow')).toBe('55')
  })

  it('4: hover tooltip shows formatted score when visible', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultEngineCtx,
      isAnalysing: true,
      lines: [makeInfo({ scoreCp: 50 })],
    })
    render(<BoardPanel />)
    expect(screen.getByTestId('engine-eval-bar-tooltip').textContent).toBe('+0.50')
  })

  it('4b: tooltip not rendered when eval bar is invisible', () => {
    render(<BoardPanel />)
    expect(screen.queryByTestId('engine-eval-bar-tooltip')).not.toBeInTheDocument()
  })

  it('5: orientation:white → inner bar uses flex-col-reverse (white at bottom)', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultEngineCtx,
      isAnalysing: true,
      lines: [makeInfo({ scoreCp: 50 })],
    })
    render(<BoardPanel />)
    expect(screen.getByTestId('engine-eval-bar-inner').className).toContain('flex-col-reverse')
  })

  it('6: orientation:black → inner bar uses flex-col (white at top)', () => {
    mockUseChessGameContext.mockReturnValue({ ...defaultChessCtx, orientation: 'black' })
    mockUseEngineContext.mockReturnValue({
      ...defaultEngineCtx,
      isAnalysing: true,
      lines: [makeInfo({ scoreCp: 50 })],
    })
    render(<BoardPanel />)
    const inner = screen.getByTestId('engine-eval-bar-inner')
    expect(inner.className).toContain('flex-col')
    expect(inner.className).not.toContain('flex-col-reverse')
  })
})

describe('BoardPanel — best-move arrows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseChessGameContext.mockReturnValue({
      ...defaultChessCtx,
      boardConfig: { drawable: { shapes: [] } },
    })
    mockUseAnalysisContext.mockReturnValue({ ...defaultAnalysisCtx })
  })

  it('7: showArrows+isAnalysing+line → setAutoShapes called with engineBest arrow for first move', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultEngineCtx,
      isAnalysing: true,
      showArrows: true,
      lines: [makeInfo({ pvUci: ['e2e4'] })],
    })
    render(<BoardPanel />)
    const lastCall = mockSetAutoShapes.mock.calls.at(-1)![0]
    expect(lastCall).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'engineBest' },
    ])
  })

  it('8: showArrows:false → setAutoShapes called with empty array', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultEngineCtx,
      isAnalysing: true,
      showArrows: false,
      lines: [makeInfo({ pvUci: ['e2e4'] })],
    })
    render(<BoardPanel />)
    const lastCall = mockSetAutoShapes.mock.calls.at(-1)![0]
    expect(lastCall).toEqual([])
  })

  it('9: isAnalysing:false → setAutoShapes called with empty array even with showArrows+lines', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultEngineCtx,
      isAnalysing: false,
      showArrows: true,
      lines: [makeInfo({ pvUci: ['e2e4'] })],
    })
    render(<BoardPanel />)
    const lastCall = mockSetAutoShapes.mock.calls.at(-1)![0]
    expect(lastCall).toEqual([])
  })

  it('10: three lines → best arrow uses engineBest, alternatives use engineAlt', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultEngineCtx,
      isAnalysing: true,
      showArrows: true,
      lines: [
        makeInfo({ pvUci: ['e2e4'], multiPV: 1 }),
        makeInfo({ pvUci: ['d2d4'], multiPV: 2 }),
        makeInfo({ pvUci: ['c2c4'], multiPV: 3 }),
      ],
    })
    render(<BoardPanel />)
    const lastCall = mockSetAutoShapes.mock.calls.at(-1)![0]
    expect(lastCall).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'engineBest' },
      { orig: 'd2', dest: 'd4', brush: 'engineAlt' },
      { orig: 'c2', dest: 'c4', brush: 'engineAlt' },
    ])
  })

  it('11: more than 3 lines → capped at 3 arrows', () => {
    mockUseEngineContext.mockReturnValue({
      ...defaultEngineCtx,
      isAnalysing: true,
      showArrows: true,
      lines: [
        makeInfo({ pvUci: ['e2e4'], multiPV: 1 }),
        makeInfo({ pvUci: ['d2d4'], multiPV: 2 }),
        makeInfo({ pvUci: ['c2c4'], multiPV: 3 }),
        makeInfo({ pvUci: ['g1f3'], multiPV: 4 }),
        makeInfo({ pvUci: ['b1c3'], multiPV: 5 }),
      ],
    })
    render(<BoardPanel />)
    const lastCall = mockSetAutoShapes.mock.calls.at(-1)![0]
    expect(lastCall).toHaveLength(3)
  })
})

describe('BoardPanel — game analysis eval bar', () => {
  const moveNode = { id: '1', parent: rootNode, children: [] }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEngineContext.mockReturnValue({ ...defaultEngineCtx })
  })

  it('shows eval bar from game analysis when engine is off', () => {
    const treeRoot = { ...rootNode, children: [moveNode] }
    mockUseChessGameContext.mockReturnValue({
      ...defaultChessCtx,
      rootNode: treeRoot,
      currentNode: moveNode,
    })
    mockUseAnalysisContext.mockReturnValue({
      ...defaultAnalysisCtx,
      result: {
        status: 'complete',
        evals: [{ ply: 1, bestCp: 30, bestMate: null, playedCp: 20, playedMate: null, bestPv: 'e2e4', accuracy: 95, nag: null }],
        whiteAccuracy: 95, blackAccuracy: 95, whiteAcpl: 5, blackAcpl: 5,
      },
    })
    render(<BoardPanel />)
    const bar = screen.getByTestId('engine-eval-bar')
    expect(bar.className).not.toContain('invisible')
    // playedCp=20 → whitePct = 50 + 20/10 = 52
    expect(bar.getAttribute('aria-valuenow')).toBe('52')
  })

  it('shows bestCp from ply 1 when at root position', () => {
    const treeRoot = { ...rootNode, children: [moveNode] }
    mockUseChessGameContext.mockReturnValue({
      ...defaultChessCtx,
      rootNode: treeRoot,
      currentNode: treeRoot,
    })
    mockUseAnalysisContext.mockReturnValue({
      ...defaultAnalysisCtx,
      result: {
        status: 'complete',
        evals: [{ ply: 1, bestCp: 30, bestMate: null, playedCp: 20, playedMate: null, bestPv: 'e2e4', accuracy: 95, nag: null }],
        whiteAccuracy: 95, blackAccuracy: 95, whiteAcpl: 5, blackAcpl: 5,
      },
    })
    render(<BoardPanel />)
    const bar = screen.getByTestId('engine-eval-bar')
    expect(bar.className).not.toContain('invisible')
    // bestCp=30 → whitePct = 50 + 30/10 = 53
    expect(bar.getAttribute('aria-valuenow')).toBe('53')
  })

  it('live engine eval takes priority over game analysis', () => {
    const treeRoot = { ...rootNode, children: [moveNode] }
    mockUseChessGameContext.mockReturnValue({
      ...defaultChessCtx,
      rootNode: treeRoot,
      currentNode: moveNode,
    })
    mockUseEngineContext.mockReturnValue({
      ...defaultEngineCtx,
      isAnalysing: true,
      lines: [makeInfo({ scoreCp: 150 })],
    })
    mockUseAnalysisContext.mockReturnValue({
      ...defaultAnalysisCtx,
      result: {
        status: 'complete',
        evals: [{ ply: 1, bestCp: 30, bestMate: null, playedCp: 20, playedMate: null, bestPv: 'e2e4', accuracy: 95, nag: null }],
        whiteAccuracy: 95, blackAccuracy: 95, whiteAcpl: 5, blackAcpl: 5,
      },
    })
    render(<BoardPanel />)
    const bar = screen.getByTestId('engine-eval-bar')
    // scoreCp=150 → whitePct = 50 + 150/10 = 65
    expect(bar.getAttribute('aria-valuenow')).toBe('65')
  })

  it('eval bar invisible when no engine and no game analysis', () => {
    mockUseChessGameContext.mockReturnValue({ ...defaultChessCtx })
    mockUseAnalysisContext.mockReturnValue({ ...defaultAnalysisCtx })
    render(<BoardPanel />)
    const bar = screen.getByTestId('engine-eval-bar')
    expect(bar.className).toContain('invisible')
  })
})
