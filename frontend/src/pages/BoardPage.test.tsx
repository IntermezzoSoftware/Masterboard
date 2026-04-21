import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'

// Mock ChessGameContext so BoardPage tests are independent of chess logic
// (ChessGameProvider is now in AppLayout, not inside BoardPage itself)
const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const rootNode = { id: '0', fen: INITIAL_FEN, move: null, san: null, parent: null, children: [] }

const mockContextValue = {
  rootNode,
  hasContent: false,
  currentNode: rootNode,
  mainlineEnd: rootNode,
  orientation: 'white' as const,
  treeRevision: 0,
  boardConfig: {},
  gameMetadata: null,
  savedGameId: null,
  isDirty: false,
  pendingDestructiveAction: null,
  confirmPendingDestructiveAction: vi.fn(),
  cancelPendingDestructiveAction: vi.fn(),
  makeMove: vi.fn(),
  loadFromPGN: vi.fn(),
  loadFromFEN: vi.fn(),
  loadGame: vi.fn(),
  resetGame: vi.fn(),
  markSaved: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  goToStart: vi.fn(),
  goToEnd: vi.fn(),
  goToNode: vi.fn(),
  flipOrientation: vi.fn(),
  deleteFrom: vi.fn(),
  promoteVariation: vi.fn(),
  setNodeNag: vi.fn(),
  setNodeComment: vi.fn(),
  setNodeShapes: vi.fn(),
  toPGN: vi.fn(() => ''),
  navigateToPV: vi.fn(),
}

vi.mock('@/context/TitlebarContext', () => ({
  useTitlebarBreadcrumb: vi.fn(),
  TitlebarToolbarPortal: ({ children }: any) => children,
  TitlebarToolbarLeftPortal: ({ children }: any) => children,
  useTitlebar: () => ({ breadcrumb: [], setBreadcrumb: vi.fn(), toolbarPortalTarget: null, setToolbarPortalTarget: vi.fn() }),
}))

vi.mock('@/context/ChessGameContext', () => ({
  ChessGameProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useChessGameContext: () => mockContextValue,
}))

const mockShowToast = vi.hoisted(() => vi.fn())
vi.mock('@/context/ToastContext', () => ({
  useToast: () => mockShowToast,
}))

// Mock api — getGame will not be called (no gameId in test state)
vi.mock('@/lib/api', () => ({
  api: {
    getGame: vi.fn(),
    getIdentityNames: vi.fn().mockResolvedValue([]),
    getSetting: vi.fn().mockResolvedValue(''),
    setSetting: vi.fn().mockResolvedValue(undefined),
    saveGame: vi.fn(),
    listFolders: vi.fn().mockResolvedValue([]),
    listCollections: vi.fn().mockResolvedValue([]),
    moveGameToFolder: vi.fn().mockResolvedValue(undefined),
    addGameToCollection: vi.fn().mockResolvedValue(undefined),
    classifyPosition: vi.fn().mockResolvedValue(null),
    getGameAnalysis: vi.fn().mockResolvedValue(null),
    listEngines: vi.fn().mockResolvedValue([]),
    getEngineState: vi.fn().mockResolvedValue({ isReady: false, isAnalysing: false, activeEngine: '', availableEngines: [], engineName: '', engineType: 'ab' }),
    getEngineState2: vi.fn().mockResolvedValue({ isReady: false, isAnalysing: false, activeEngine: '', availableEngines: [], engineName: '', engineType: 'ab' }),
    startAnalysis2: vi.fn().mockResolvedValue(undefined),
    stopAnalysis2: vi.fn().mockResolvedValue(undefined),
    setActiveEngine: vi.fn().mockResolvedValue(undefined),
    setActiveEngine2: vi.fn().mockResolvedValue(undefined),
    setEngineOption: vi.fn().mockResolvedValue(undefined),
    updateGame: vi.fn().mockResolvedValue(undefined),
    analyseGame: vi.fn().mockResolvedValue(undefined),
    cancelAnalysis: vi.fn().mockResolvedValue(undefined),
    getQueueStatus: vi.fn().mockResolvedValue({ remaining: 0, active: 0 }),
    listRepertoires: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@lichess-org/chessground', () => ({
  Chessground: vi.fn(() => ({ destroy: vi.fn(), set: vi.fn() })),
}))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

// Mock AnalysisContext — controllable via mockAnalysisValue
const mockAnalysisValue = vi.hoisted(() => ({
  isAnalysing: false,
  progress: null as { ply: number; totalPlies: number } | null,
  result: null as { gameId?: string; status: string; evals: any[]; errorMsg?: string; whiteAccuracy: number | null; blackAccuracy: number | null; whiteAcpl: number | null; blackAcpl: number | null; pgnAnnotated?: boolean } | null,
  startAnalysis: vi.fn(),
  cancelAnalysis: vi.fn(),
  markAnnotated: vi.fn(),
}))
vi.mock('@/context/AnalysisContext', () => ({
  useAnalysisContext: () => mockAnalysisValue,
}))

// Mock EngineContext — EnginePanel reads from this
vi.mock('@/context/EngineContext', () => ({
  useEngineContext: () => ({
    fen: '', isReady: false, isAnalysing: false, lines: [], currentDepth: 0,
    analysisFen: '', multiPV: 1, showArrows: false, availableEngines: [],
    activeEngine: '', engineName: '', engineType: 'ab' as const,
    startAnalysis: vi.fn(), stopAnalysis: vi.fn(), setMultiPV: vi.fn(),
    toggleArrows: vi.fn(), setActiveEngine: vi.fn(), navigateToPV: undefined,
  }),
}))

vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', palette: 'walnut' }),
  getAccentColor: () => 'oklch(40% 0.12 47)',
}))

import { api } from '@/lib/api'
import BoardPage from './BoardPage'

function renderPage(locationState?: Record<string, unknown>) {
  const router = createMemoryRouter(
    [{ path: '/', element: <BoardPage /> }],
    { initialEntries: [{ pathname: '/', state: locationState ?? null }] }
  )
  return render(<RouterProvider router={router} />)
}

describe('BoardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnalysisValue.isAnalysing = false
    mockAnalysisValue.progress = null
    mockAnalysisValue.result = null
  })

  it('renders without crashing', () => {
    const { container } = renderPage()
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders BoardControls', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Flip board' })).toBeInTheDocument()
  })

  it('renders MoveList', () => {
    renderPage()
    expect(screen.getByText(/no moves yet/i)).toBeInTheDocument()
  })

  it('renders EnginePanel', () => {
    renderPage()
    expect(screen.getByText(/press start to start engine/i)).toBeInTheDocument()
  })

  it('renders Notation panel with no moves', () => {
    renderPage()
    expect(screen.getByText(/no moves yet/i)).toBeInTheDocument()
  })

  // "New" dropdown is now rendered in the unified titlebar via TitlebarToolbarPortal,
  // not inside BoardPage's own render tree. Tested via E2E instead.

  it('does not show toast when loading a previously-analyzed game', () => {
    // Simulate opening a game that already has completed analysis.
    mockAnalysisValue.result = {
      status: 'complete', evals: [], pgnAnnotated: true,
      whiteAccuracy: 85, blackAccuracy: 90, whiteAcpl: 20, blackAcpl: 15,
    }
    renderPage()
    expect(mockShowToast).not.toHaveBeenCalled()
  })

  it('shows toast when analysis completes after being initiated', () => {
    // When isAnalysing is true and result arrives with status 'complete',
    // the wasAnalysingRef effect fires first (setting it true), then the
    // analysis status effect fires and shows the toast.
    mockAnalysisValue.isAnalysing = true
    mockAnalysisValue.result = {
      gameId: 'test-game-1',
      status: 'complete', evals: [],
      whiteAccuracy: 85, blackAccuracy: 90, whiteAcpl: 20, blackAcpl: 15,
    }
    mockContextValue.savedGameId = 'test-game-1'
    renderPage()
    expect(mockShowToast).toHaveBeenCalledWith('Analysis complete')

    // Cleanup
    mockContextValue.savedGameId = null
  })

  it('does not create variation when best PV is same castling move with different encoding', () => {
    // Simulate a game tree with one mainline move: O-O (chessops encoding e1h1)
    const castleNode = {
      id: '1', fen: 'after-castle-fen',
      move: { from: 'e1', to: 'h1' }, // chessops king-to-rook encoding
      san: 'O-O', parent: rootNode, children: [],
    }
    const treeRoot = { ...rootNode, children: [castleNode] }
    castleNode.parent = treeRoot

    mockContextValue.rootNode = treeRoot as any
    mockContextValue.currentNode = treeRoot as any
    mockContextValue.savedGameId = 'test-castle-game'

    // Analysis result where bestPv starts with e1g1 (engine encoding for O-O)
    mockAnalysisValue.result = {
      gameId: 'test-castle-game',
      status: 'complete', evals: [{
        ply: 1, nag: 6, bestPv: 'e1g1 d7d5 d2d4',
        bestCp: 30, bestMate: null, playedCp: -70, playedMate: null, accuracy: 50,
      }], pgnAnnotated: false,
      whiteAccuracy: 50, blackAccuracy: 50, whiteAcpl: 50, blackAcpl: 50,
    }

    renderPage()

    // navigateToPV should NOT be called because e1g1 normalizes to match e1h1
    expect(mockContextValue.navigateToPV).not.toHaveBeenCalled()
    // Should reset to game start after annotations
    expect(mockContextValue.goToStart).toHaveBeenCalled()

    // Cleanup
    mockContextValue.rootNode = rootNode
    mockContextValue.currentNode = rootNode
    mockContextValue.savedGameId = null
  })

  it('shows error toast when analysis fails after being initiated', () => {
    // When isAnalysing is true and result has error status, the wasAnalysingRef
    // pattern should show the error toast.
    mockAnalysisValue.isAnalysing = true
    mockAnalysisValue.result = {
      gameId: 'test-game-1',
      status: 'error', evals: [], errorMsg: 'engine crashed',
      whiteAccuracy: null, blackAccuracy: null, whiteAcpl: null, blackAcpl: null,
    }
    mockContextValue.savedGameId = 'test-game-1'
    renderPage()
    expect(mockShowToast).toHaveBeenCalledWith('engine crashed', 'error')

    // Cleanup
    mockContextValue.savedGameId = null
  })

  describe('auto-flip on game load', () => {
    const gameRecord = {
      id: 'game-1', pgn: '1. e4 e5',
      white: 'Opponent', black: 'Magnus Carlsen',
      whiteElo: 2700, blackElo: 2882,
      result: '0-1', date: '2024-01-01',
      source: 'lichess', folderId: null,
      event: '', site: '', round: '', eco: '', opening: '', timeControl: '',
    }

    it('flips board when user identity matches the black player', async () => {
      vi.mocked(api.getGame).mockResolvedValue(gameRecord as any)
      vi.mocked(api.getIdentityNames).mockResolvedValue(['Magnus Carlsen'])

      renderPage({ gameId: 'game-1' })

      await waitFor(() => expect(api.getGame).toHaveBeenCalledWith('game-1'))
      await waitFor(() => expect(mockContextValue.flipOrientation).toHaveBeenCalled())
    })

    it('does not flip board when user identity matches the white player', async () => {
      vi.mocked(api.getGame).mockResolvedValue({ ...gameRecord, white: 'Magnus Carlsen', black: 'Opponent' } as any)
      vi.mocked(api.getIdentityNames).mockResolvedValue(['Magnus Carlsen'])

      renderPage({ gameId: 'game-1' })

      await waitFor(() => expect(api.getGame).toHaveBeenCalledWith('game-1'))
      await waitFor(() => expect(mockContextValue.loadGame).toHaveBeenCalled())
      expect(mockContextValue.flipOrientation).not.toHaveBeenCalled()
    })

    it('does not flip board when user has no configured identity', async () => {
      vi.mocked(api.getGame).mockResolvedValue(gameRecord as any)
      vi.mocked(api.getIdentityNames).mockResolvedValue([])

      renderPage({ gameId: 'game-1' })

      await waitFor(() => expect(mockContextValue.loadGame).toHaveBeenCalled())
      expect(mockContextValue.flipOrientation).not.toHaveBeenCalled()
    })

    it('matches identity case-insensitively', async () => {
      vi.mocked(api.getGame).mockResolvedValue(gameRecord as any)
      vi.mocked(api.getIdentityNames).mockResolvedValue(['magnus carlsen'])

      renderPage({ gameId: 'game-1' })

      await waitFor(() => expect(mockContextValue.flipOrientation).toHaveBeenCalled())
    })
  })

  it('does not apply annotations from a different game (stale analysisResult race)', () => {
    // Simulate the race condition: analysisResult belongs to game1 but
    // savedGameId/rootNode have already switched to game2.
    const game2Root = { id: '0', fen: INITIAL_FEN, move: null, san: null, parent: null, children: [] }
    mockContextValue.rootNode = game2Root as any
    mockContextValue.savedGameId = 'game2'

    mockAnalysisValue.result = {
      gameId: 'game1',
      status: 'complete',
      evals: [{
        ply: 1, nag: 2, bestPv: 'e2e4', bestCp: 30, bestMate: null,
        playedCp: -70, playedMate: null, accuracy: 50,
      }],
      pgnAnnotated: false,
      whiteAccuracy: 50, blackAccuracy: 50, whiteAcpl: 50, blackAcpl: 50,
    }

    renderPage()

    expect(mockContextValue.setNodeNag).not.toHaveBeenCalled()
    expect(api.updateGame).not.toHaveBeenCalled()

    // Cleanup
    mockContextValue.rootNode = rootNode
    mockContextValue.savedGameId = null
  })
})
