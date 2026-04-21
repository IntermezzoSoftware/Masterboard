import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { ToastProvider } from '@/context/ToastContext'
import type { GameMetadata } from '@/hooks/useChessGame'
vi.mock('@/hooks/useChessGame', () => ({ useChessGame: vi.fn() }))
vi.mock('@lichess-org/chessground', () => ({
  Chessground: vi.fn(() => ({ destroy: vi.fn(), set: vi.fn() })),
}))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

const mockClassifyPosition = vi.fn(() => Promise.resolve(null))
vi.mock('@/lib/api', () => ({
  api: {
    classifyPosition: (...args: unknown[]) => mockClassifyPosition(...args),
    listRepertoires: () => Promise.resolve([]),
  },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>
}

const mockCtx = {
  rootNode: { id: 'root', fen: 'startpos', move: null, san: null, parent: null, children: [] },
  get currentNode() { return this.rootNode },
  treeRevision: 0,
  gameMetadata: null as GameMetadata | null,
  savedGameId: null as string | null,
  loadGame: vi.fn(),
  goToNode: vi.fn(),
  deleteFrom: vi.fn(),
  promoteVariation: vi.fn(),
  setNodeNag: vi.fn(),
  setNodeComment: vi.fn(),
}

vi.mock('@/context/ChessGameContext', () => ({
  useChessGameContext: () => mockCtx,
}))

vi.mock('@/context/AnalysisContext', () => ({
  useAnalysisContext: () => ({ deviationResult: null }),
}))

import NotationPanel from './NotationPanel'

beforeEach(() => {
  mockCtx.gameMetadata = null
  mockCtx.savedGameId  = null
  mockClassifyPosition.mockResolvedValue(null)
  vi.clearAllMocks()
})

describe('NotationPanel', () => {
  it('renders move list with no header when no game is loaded', () => {
    render(<NotationPanel />, { wrapper })
    expect(screen.getByText(/no moves yet/i)).toBeInTheDocument()
    expect(screen.queryByText('White')).not.toBeInTheDocument()
  })

  it('renders player names when game metadata is present', () => {
    mockCtx.gameMetadata = { white: 'Kasparov', black: 'Karpov' }
    render(<NotationPanel />, { wrapper })
    expect(screen.getByText('Kasparov')).toBeInTheDocument()
    expect(screen.getByText('Karpov')).toBeInTheDocument()
  })

  it('renders result badge when result is available', () => {
    mockCtx.gameMetadata = { white: 'A', black: 'B', result: '1-0' }
    render(<NotationPanel />, { wrapper })
    expect(screen.getByText('1-0')).toBeInTheDocument()
  })

  it('renders Elo ratings in parens when present', () => {
    mockCtx.gameMetadata = { white: 'Magnus', black: 'Hikaru', whiteElo: 2852, blackElo: 2760 }
    render(<NotationPanel />, { wrapper })
    expect(screen.getByText('Magnus (2852)')).toBeInTheDocument()
    expect(screen.getByText('Hikaru (2760)')).toBeInTheDocument()
  })

  it('renders detail line with event, date, ECO', () => {
    mockCtx.gameMetadata = {
      white: 'A', black: 'B',
      event: 'World Championship', date: '2024.03.15', eco: 'B20',
    }
    render(<NotationPanel />, { wrapper })
    const detail = screen.getByText(/World Championship/)
    expect(detail.textContent).toContain('2024.03.15')
    expect(detail.textContent).toContain('B20')
  })

  it('omits detail line when no event, date, or ECO available', () => {
    mockCtx.gameMetadata = { white: 'A', black: 'B' }
    render(<NotationPanel />, { wrapper })
    // No detail line text should appear between the player row and move list
    expect(screen.queryByText(/·/)).not.toBeInTheDocument()
  })

  it('renders opening name combined with ECO when both present', () => {
    mockCtx.gameMetadata = { white: 'A', black: 'B', opening: 'Sicilian Defense', eco: 'B90' }
    render(<NotationPanel />, { wrapper })
    expect(screen.getByText(/Sicilian Defense \(B90\)/)).toBeInTheDocument()
  })

  it('renders opening name only when no ECO', () => {
    mockCtx.gameMetadata = { white: 'A', black: 'B', opening: 'King\'s Indian Defense' }
    render(<NotationPanel />, { wrapper })
    expect(screen.getByText(/King's Indian Defense/)).toBeInTheDocument()
  })

  it('renders ECO only when no opening name', () => {
    mockCtx.gameMetadata = { white: 'A', black: 'B', eco: 'D30' }
    render(<NotationPanel />, { wrapper })
    expect(screen.getByText(/D30/)).toBeInTheDocument()
  })

  it('shows live ECO from classifyPosition when in book', async () => {
    mockClassifyPosition.mockResolvedValue({ eco: 'C60', name: 'Ruy Lopez' })
    mockCtx.gameMetadata = { white: 'A', black: 'B' }
    render(<NotationPanel />, { wrapper })
    await waitFor(() =>
      expect(screen.getByText(/Ruy Lopez \(C60\)/)).toBeInTheDocument()
    )
  })

  it('falls back to stored metadata when classifyPosition returns null', () => {
    mockClassifyPosition.mockResolvedValue(null)
    mockCtx.gameMetadata = { white: 'A', black: 'B', opening: 'Sicilian Defense', eco: 'B20' }
    render(<NotationPanel />, { wrapper })
    expect(screen.getByText(/Sicilian Defense \(B20\)/)).toBeInTheDocument()
  })
})

