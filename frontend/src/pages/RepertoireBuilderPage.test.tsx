import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import type { RepertoireBuilderHook } from '@/hooks/useRepertoireBuilder'


const mockHook: RepertoireBuilderHook = {
  repertoire: { id: 'rep-1', name: 'Ruy Lopez', colour: 'white', description: '' },
  moves: [],
  currentFen: 'startpos',
  currentMoveId: null,
  boardConfig: {},
  orientation: 'white',
  isLoading: false,
  error: '',
  existingMoveSans: new Set<string>(),
  heatmap: null,
  loadHeatmap: vi.fn(),
  makeMove: vi.fn(),
  navigateTo: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  goToStart: vi.fn(),
  goToEnd: vi.fn(),
  flipOrientation: vi.fn(),
  deleteMove: vi.fn(),
  updateAnnotation: vi.fn(),
  importPGN: vi.fn().mockResolvedValue(0),
  importPolyglotBook: vi.fn().mockResolvedValue(0),
  reorderSiblings: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@/context/TitlebarContext', () => ({
  useTitlebarBreadcrumb: vi.fn(),
  TitlebarToolbarPortal: ({ children }: any) => children,
  TitlebarToolbarLeftPortal: ({ children }: any) => children,
  useTitlebar: () => ({ breadcrumb: [], setBreadcrumb: vi.fn(), toolbarPortalTarget: null, setToolbarPortalTarget: vi.fn() }),
}))

vi.mock('@/hooks/useRepertoireBuilder', () => ({
  useRepertoireBuilder: vi.fn(() => mockHook),
}))


vi.mock('@lichess-org/chessground', () => ({
  Chessground: vi.fn(() => ({ destroy: vi.fn(), set: vi.fn() })),
}))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn(),
}))

vi.mock('@/context/EngineContext', () => ({
  useEngineContext: vi.fn(() => ({
    isReady: false, isAnalysing: false, lines: [], currentDepth: 0,
    analysisFen: '', multiPV: 1, showArrows: true,
    availableEngines: [{ path: 'stockfish', name: 'Stockfish' }], activeEngine: 'stockfish',
    startAnalysis: vi.fn(), stopAnalysis: vi.fn(), setMultiPV: vi.fn(),
    toggleArrows: vi.fn(), setActiveEngine: vi.fn(),
  })),
}))

vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', palette: 'walnut' }),
  getAccentColor: () => 'oklch(40% 0.12 47)',
}))

vi.mock('@/lib/api', () => ({
  api: {
    getSetting:                   vi.fn().mockResolvedValue(''),
    setSetting:                   vi.fn().mockResolvedValue(undefined),
    listFolders:                  vi.fn().mockResolvedValue([]),
    listCollections:              vi.fn().mockResolvedValue([]),
    getMasterGameCount:           vi.fn().mockResolvedValue(0),
    getMasterPositionStats:       vi.fn().mockResolvedValue([]),
    getMasterGamesAtPosition:     vi.fn().mockResolvedValue([]),
    getPersonalPositionStats:     vi.fn().mockResolvedValue([]),
    getPersonalGamesAtPosition:   vi.fn().mockResolvedValue([]),
    getPlayerSuggestions:         vi.fn().mockResolvedValue([]),
    getIdentityNames:             vi.fn().mockResolvedValue([]),
    getEngineState:               vi.fn().mockResolvedValue({ running: false, engineName: '', enginePath: '' }),
    startAnalysis:                vi.fn().mockResolvedValue(undefined),
    stopAnalysis:                 vi.fn().mockResolvedValue(undefined),
    setEngineOption:              vi.fn().mockResolvedValue(undefined),
    listEngines:                  vi.fn().mockResolvedValue([]),
    setActiveEngine:              vi.fn().mockResolvedValue(undefined),
    listRepertoires:              vi.fn().mockResolvedValue([]),
    getDrillCount:                vi.fn().mockResolvedValue(0),
    resetDrillScope:              vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/context/ToastContext', () => ({
  useToast: () => vi.fn(),
}))

vi.mock('wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(() => vi.fn()),
}))

import RepertoireBuilderPage from './RepertoireBuilderPage'

function renderPage(id = 'rep-1') {
  const router = createMemoryRouter(
    [{ path: '/openings/:id', element: <RepertoireBuilderPage /> }],
    { initialEntries: [`/openings/${id}`] }
  )
  return render(<RouterProvider router={router} />)
}

describe('RepertoireBuilderPage', () => {
  beforeEach(() => {
    // Reset hook mock to default (loaded, no moves)
    Object.assign(mockHook, {
      repertoire: { id: 'rep-1', name: 'Ruy Lopez', colour: 'white', description: '' },
      moves: [],
      isLoading: false,
      error: '',
    })
  })

  it('renders without crashing', () => {
    const { container } = renderPage()
    expect(container.firstChild).toBeInTheDocument()
  })

  // Back button and repertoire name are now in the unified titlebar breadcrumb
  // (set via useTitlebarBreadcrumb), not in RepertoireBuilderPage's render tree.
  // Verified via E2E tests instead.

  it('shows board area', () => {
    renderPage()
    expect(screen.getByTestId('repertoire-board')).toBeInTheDocument()
  })

  it('shows tree panel with empty-move hint', () => {
    renderPage()
    expect(screen.getByTestId('repertoire-tree')).toBeInTheDocument()
    expect(screen.getByText(/play a move on the board/i)).toBeInTheDocument()
  })

  it('shows loading state', () => {
    Object.assign(mockHook, { isLoading: true, repertoire: null })
    renderPage()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows error state', () => {
    Object.assign(mockHook, { isLoading: false, error: 'Failed to load repertoire.' })
    renderPage()
    expect(screen.getByText('Failed to load repertoire.')).toBeInTheDocument()
  })

  // Import PGN button and panel toggles are now in the unified titlebar
  // (set via TitlebarToolbarPortal), not in RepertoireBuilderPage's render tree.
  // Verified via E2E tests instead.

  it('renders the explorer panel', () => {
    renderPage()
    expect(screen.getByTestId('repertoire-database')).toBeInTheDocument()
  })
})
