import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'


const mockListRepertoires   = vi.fn()
const mockCreateRepertoire  = vi.fn()
const mockDeleteRepertoire  = vi.fn()
const mockRenameRepertoire  = vi.fn()
const mockGetDrillCount     = vi.fn()
const mockResetDrillScope   = vi.fn()

vi.mock('@lichess-org/chessground', () => ({
  Chessground: vi.fn(() => ({ set: vi.fn(), destroy: vi.fn() })),
}))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))
vi.mock('chessops/fen', () => ({
  INITIAL_FEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  makeFen: vi.fn(() => 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'),
}))
vi.mock('chessops/san', () => ({ parseSan: vi.fn(() => ({ from: 12, to: 28 })) }))
vi.mock('chessops/util', () => ({ makeUci: vi.fn(() => 'e2e4') }))
vi.mock('chessops/compat', () => ({ chessgroundDests: vi.fn(() => new Map()) }))
vi.mock('@/lib/fenUtils', () => ({
  chessFromFen: vi.fn(() => ({ turn: 'white', toSetup: vi.fn(() => ({})), play: vi.fn() })),
}))

vi.mock('@/context/TitlebarContext', () => ({
  useTitlebarBreadcrumb: vi.fn(),
  TitlebarToolbarPortal: ({ children }: any) => children,
  TitlebarToolbarLeftPortal: ({ children }: any) => children,
  useTitlebar: () => ({ breadcrumb: [], setBreadcrumb: vi.fn(), toolbarPortalTarget: null, setToolbarPortalTarget: vi.fn() }),
}))

vi.mock('@/context/ToastContext', () => ({
  useToast: () => vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    listRepertoires:          (...args: unknown[]) => mockListRepertoires(...args),
    createRepertoire:         (...args: unknown[]) => mockCreateRepertoire(...args),
    deleteRepertoire:         (...args: unknown[]) => mockDeleteRepertoire(...args),
    renameRepertoire:         (...args: unknown[]) => mockRenameRepertoire(...args),
    getDrillCount:            (...args: unknown[]) => mockGetDrillCount(...args),
    resetDrillScope:          (...args: unknown[]) => mockResetDrillScope(...args),
    getIdentityNames:         vi.fn().mockResolvedValue([]),
    exportRepertoireToPGN:    vi.fn().mockResolvedValue(undefined),
    loadRepertoire:           vi.fn().mockResolvedValue(null),
  },
}))

const MOCK_REPERTOIRES = [
  { id: 'rep-1', name: 'Ruy Lopez', colour: 'white', description: '' },
  { id: 'rep-2', name: 'Sicilian', colour: 'black', description: '' },
]

function setup() {
  mockListRepertoires.mockResolvedValue(MOCK_REPERTOIRES)
  mockRenameRepertoire.mockResolvedValue(undefined)
  mockDeleteRepertoire.mockResolvedValue(undefined)
  mockGetDrillCount.mockResolvedValue(0)
  mockResetDrillScope.mockResolvedValue(undefined)
}

import OpeningsPage from './OpeningsPage'
import RepertoireBuilderPage from './RepertoireBuilderPage'

// Stub builder page so navigation tests don't need the full hook
vi.mock('./RepertoireBuilderPage', () => ({
  default: () => <div data-testid="builder-page">Builder</div>,
}))

// Mock the hook used by the real RepertoireBuilderPage (needed if not stubbed)
vi.mock('@/hooks/useRepertoireBuilder', () => ({
  useRepertoireBuilder: vi.fn(() => ({
    repertoire: null, moves: [], currentFen: '', currentMoveId: null,
    boardConfig: {}, orientation: 'white', isLoading: true, error: '',
    existingMoveSans: new Set(), heatmap: null, loadHeatmap: vi.fn(),
    makeMove: vi.fn(), navigateTo: vi.fn(), goBack: vi.fn(),
    goForward: vi.fn(), goToStart: vi.fn(), goToEnd: vi.fn(),
    flipOrientation: vi.fn(), deleteMove: vi.fn(),
    updateAnnotation: vi.fn(), importPGN: vi.fn(),
  })),
}))

function renderWithRouter() {
  const router = createMemoryRouter(
    [
      { path: '/openings',     element: <OpeningsPage /> },
      { path: '/openings/:id', element: <RepertoireBuilderPage /> },
    ],
    { initialEntries: ['/openings'] }
  )
  return { ...render(<RouterProvider router={router} />), router }
}


beforeEach(() => {
  vi.clearAllMocks()
  setup()
})

describe('OpeningsPage', () => {
  it('renders without crashing', async () => {
    renderWithRouter()
    // Page heading moved to unified titlebar; verify repertoire list renders.
    await waitFor(() => expect(screen.getByText('Ruy Lopez')).toBeInTheDocument())
  })

  it('lists repertoires grouped by colour', async () => {
    renderWithRouter()
    await waitFor(() => expect(screen.getByText('Ruy Lopez')).toBeInTheDocument())
    expect(screen.getByText('Sicilian')).toBeInTheDocument()
    expect(screen.getByText('White')).toBeInTheDocument()
    expect(screen.getByText('Black')).toBeInTheDocument()
  })

  it('clicking a row navigates to /openings/:id', async () => {
    const { router } = renderWithRouter()
    await waitFor(() => expect(screen.getByText('Ruy Lopez')).toBeInTheDocument())

    await userEvent.click(screen.getByText('Ruy Lopez'))

    expect(router.state.location.pathname).toBe('/openings/rep-1')
  })

  it('rename: clicking pencil shows input with current name', async () => {
    renderWithRouter()
    await waitFor(() => expect(screen.getByText('Ruy Lopez')).toBeInTheDocument())

    const renameBtn = screen.getByRole('button', { name: /rename ruy lopez/i })
    await userEvent.click(renameBtn)

    const input = screen.getByTestId('repertoire-rename-input')
    expect(input).toBeInTheDocument()
    expect((input as HTMLInputElement).value).toBe('Ruy Lopez')
  })

  it('rename: pressing Enter submits the new name', async () => {
    renderWithRouter()
    await waitFor(() => expect(screen.getByText('Ruy Lopez')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /rename ruy lopez/i }))
    const input = screen.getByTestId('repertoire-rename-input')
    await userEvent.clear(input)
    await userEvent.type(input, 'Italian Game')
    await userEvent.keyboard('{Enter}')

    expect(mockRenameRepertoire).toHaveBeenCalledWith('rep-1', 'Italian Game')
    await waitFor(() => expect(screen.getByText('Italian Game')).toBeInTheDocument())
  })

  it('rename: pressing Escape cancels', async () => {
    renderWithRouter()
    await waitFor(() => expect(screen.getByText('Ruy Lopez')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /rename ruy lopez/i }))
    const input = screen.getByTestId('repertoire-rename-input')
    await userEvent.clear(input)
    await userEvent.type(input, 'Should Not Save')
    await userEvent.keyboard('{Escape}')

    expect(mockRenameRepertoire).not.toHaveBeenCalled()
    expect(screen.getByText('Ruy Lopez')).toBeInTheDocument()
  })

})
