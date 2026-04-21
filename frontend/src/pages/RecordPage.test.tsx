import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import RecordPage from './RecordPage'

vi.mock('@/context/TitlebarContext', () => ({
  useTitlebarBreadcrumb: vi.fn(),
  TitlebarToolbarPortal: ({ children }: any) => children,
  TitlebarToolbarLeftPortal: ({ children }: any) => children,
  useTitlebar: () => ({ breadcrumb: [], setBreadcrumb: vi.fn(), toolbarPortalTarget: null, setToolbarPortalTarget: vi.fn() }),
}))

// Mock chessground and its CSS to avoid import errors
vi.mock('@lichess-org/chessground', () => ({ Chessground: vi.fn(() => ({ set: vi.fn(), destroy: vi.fn() })) }))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

// Mock chessops with all required exports — use vi.hoisted so the mock factory
// can reference constants without top-level variable hoisting issues
const { mockChessInstance } = vi.hoisted(() => {
  const mockChessInstance = {
    isCheck: () => false,
    isEnd: () => false,
    play: () => {},
    get turn() { return 'white' },
    board: { get: () => ({ role: 'pawn', color: 'white' }) },
    toSetup: () => ({}),
  }
  return { mockChessInstance }
})

vi.mock('chessops/chess', () => ({
  Chess: {
    fromSetup: vi.fn(() => ({ unwrap: () => mockChessInstance })),
  },
}))
vi.mock('chessops/fen', () => ({
  parseFen: vi.fn(() => ({ unwrap: () => ({}) })),
  makeFen: vi.fn(() => 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
  INITIAL_FEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
}))
vi.mock('chessops/compat', () => ({ chessgroundDests: vi.fn(() => new Map()) }))
vi.mock('chessops/san', () => ({ makeSan: vi.fn(() => 'e4'), parseSan: vi.fn(() => undefined) }))
vi.mock('chessops/util', () => ({ parseUci: vi.fn((uci: string) => ({ uci })), parseSquare: vi.fn(), makeUci: vi.fn(() => 'e2e4') }))

vi.mock('@/lib/api', () => ({
  api: {
    saveGame: vi.fn().mockResolvedValue('game-id'),
    listFolders: vi.fn().mockResolvedValue([]),
    listCollections: vi.fn().mockResolvedValue([]),
    moveGameToFolder: vi.fn().mockResolvedValue(undefined),
    addGameToCollection: vi.fn().mockResolvedValue(undefined),
  },
}))

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/record', element: <RecordPage /> }, { path: '/games', element: <div>games</div> }],
    { initialEntries: ['/record'] }
  )
  return render(<RouterProvider router={router} />)
}

describe('RecordPage', () => {
  it('renders without crashing', () => {
    renderPage()
    expect(screen.getByPlaceholderText('White player')).toBeInTheDocument()
  })

  it('renders player name inputs', () => {
    renderPage()
    expect(screen.getByPlaceholderText('White player')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Black player')).toBeInTheDocument()
  })

  it('renders New game and Finish & save buttons', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /New game/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Finish & save/i })).toBeInTheDocument()
  })

  it('renders date input and event field in the sidebar', () => {
    renderPage()
    expect(screen.getByPlaceholderText('YYYY.MM.DD')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Tournament or event')).toBeInTheDocument()
  })

  it('saves directly when Finish & save is clicked', async () => {
    const { api } = await import('@/lib/api')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Finish & save/i }))
    expect(api.saveGame).toHaveBeenCalled()
  })

  it('navigates to /games when back button is clicked', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Back to Games/i }))
    expect(screen.getByText('games')).toBeInTheDocument()
  })
})
