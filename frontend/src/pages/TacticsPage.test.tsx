import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import TacticsPage from './TacticsPage'


vi.mock('@lichess-org/chessground', () => ({
  Chessground: vi.fn(() => null),
}))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

vi.mock('chessops/chess', () => ({
  Chess: {
    default: vi.fn(),
    fromSetup: vi.fn(() => ({ unwrap: () => ({ turn: 'white', play: vi.fn(), toSetup: vi.fn(() => ({})) }) })),
  },
}))

vi.mock('chessops/fen', () => ({
  INITIAL_FEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  parseFen: vi.fn(() => ({ unwrap: () => ({}) })),
  makeFen: vi.fn(() => 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
}))

vi.mock('chessops/compat', () => ({
  chessgroundDests: vi.fn(() => new Map()),
}))

vi.mock('chessops/san', () => ({
  makeSan: vi.fn(() => 'e4'),
}))

vi.mock('chessops/util', () => ({
  parseUci: vi.fn(() => ({ from: 4, to: 20 })),
}))

vi.mock('@/context/TitlebarContext', () => ({
  useTitlebarBreadcrumb: vi.fn(),
  TitlebarToolbarPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TitlebarToolbarLeftPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTitlebar: () => ({ compact: false, breadcrumb: [], setBreadcrumb: vi.fn(), toolbarPortalTarget: null, setToolbarPortalTarget: vi.fn() }),
}))

vi.mock('@/context/ChessGameContext', () => ({
  useChessGameContext: vi.fn(() => ({
    currentNode: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
    navigateToPV: vi.fn(),
    savedGameId: null,
  })),
  ChessGameProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/context/AnalysisContext', () => ({
  useAnalysisContext: vi.fn(() => ({
    analysisRecord: null,
    isAnalysing: false,
  })),
  AnalysisProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock Chessboard component to avoid chessground DOM requirements
vi.mock('@/components/Chessboard', () => ({
  default: ({ config }: { config: { fen?: string } }) => (
    <div data-testid="chessboard" data-fen={config.fen} />
  ),
}))

const mockGetSetting = vi.fn()
const mockSetSetting = vi.fn()
const mockGetTacticsLobbyStats = vi.fn()
const mockGetPuzzleSession = vi.fn()
const mockRecordPuzzleResult = vi.fn()
const mockGetPuzzleSummary = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    getSetting:           (...args: unknown[]) => mockGetSetting(...args),
    setSetting:           (...args: unknown[]) => mockSetSetting(...args),
    getTacticsLobbyStats: (...args: unknown[]) => mockGetTacticsLobbyStats(...args),
    getPuzzleSession:     (...args: unknown[]) => mockGetPuzzleSession(...args),
    recordPuzzleResult:   (...args: unknown[]) => mockRecordPuzzleResult(...args),
    getPuzzleSummary:     (...args: unknown[]) => mockGetPuzzleSummary(...args),
  },
}))


const LOBBY_STATS_WITH_DUE = { totalPuzzles: 1, dueCount: 1, lifetimeCorrect: 0, lifetimeTotal: 0 }

const SAMPLE_PUZZLE = {
  id: 'puz-1',
  gameId: 'game-1',
  ply: 20,
  fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  solutionUci: ['f3g5'],
  solutionSan: ['Ng5'],
  playedMove: 'Nc3',
  classification: 'blunder' as const,
  playerColour: 'white' as const,
  playedCp: -180,
  bestCp: 50,
  white: '',
  black: '',
  date: '',
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/', element: <TacticsPage /> }],
    { initialEntries: ['/'] }
  )
  return render(<RouterProvider router={router} />)
}

async function renderAndStartSession() {
  renderPage()
  await waitFor(() => {
    const btn = screen.getByRole('button', { name: 'Start session' })
    expect(btn).not.toBeDisabled()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
}


describe('TacticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSetting.mockResolvedValue('')
    mockSetSetting.mockResolvedValue(undefined)
    mockGetTacticsLobbyStats.mockResolvedValue(LOBBY_STATS_WITH_DUE)
    mockRecordPuzzleResult.mockResolvedValue(undefined)
    mockGetPuzzleSummary.mockResolvedValue({
      totalReviewed: 0,
      correctCount: 0,
      incorrectCount: 0,
      newToLearning: 0,
      lapsedToRelearn: 0,
    })
  })

  it('shows loading state while lobby stats are pending', () => {
    // Stats never resolve — lobby shows Loading… in initial render
    mockGetTacticsLobbyStats.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows empty state when getPuzzleSession resolves to empty array', async () => {
    mockGetPuzzleSession.mockResolvedValue([])
    await renderAndStartSession()
    await waitFor(() => expect(screen.getByText('No puzzles due')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Go to Games' })).toBeInTheDocument()
  })

  it('shows puzzle FEN on the board after session loads', async () => {
    mockGetPuzzleSession.mockResolvedValue([SAMPLE_PUZZLE])
    await renderAndStartSession()
    await waitFor(() => {
      const board = screen.getByTestId('chessboard')
      expect(board.getAttribute('data-fen')).toBe(SAMPLE_PUZZLE.fen)
    })
  })

  it('shows classification badge and played-move context strip', async () => {
    mockGetPuzzleSession.mockResolvedValue([SAMPLE_PUZZLE])
    await renderAndStartSession()
    await waitFor(() => expect(screen.getByText('Blunder')).toBeInTheDocument())
    expect(screen.getByText('Nc3')).toBeInTheDocument()
  })

  it('shows Mistake badge for mistake classification', async () => {
    const mistakePuzzle = { ...SAMPLE_PUZZLE, classification: 'mistake' as const }
    mockGetPuzzleSession.mockResolvedValue([mistakePuzzle])
    await renderAndStartSession()
    await waitFor(() => expect(screen.getByText('Mistake')).toBeInTheDocument())
  })
})
