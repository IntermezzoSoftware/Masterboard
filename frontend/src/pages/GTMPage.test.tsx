import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'

// ── chessground mocks ────────────────────────────────────────────────────────
vi.mock('@lichess-org/chessground', () => ({ Chessground: vi.fn(() => ({ set: vi.fn(), destroy: vi.fn() })) }))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

// ── chessops mocks ────────────────────────────────────────────────────────────
vi.mock('chessops/chess', () => ({ Chess: { fromSetup: vi.fn() } }))
vi.mock('chessops/fen', () => ({ INITIAL_FEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', parseFen: vi.fn(), makeFen: vi.fn() }))
vi.mock('chessops/compat', () => ({ chessgroundDests: vi.fn(() => new Map()) }))
vi.mock('chessops/util', () => ({ parseUci: vi.fn() }))
vi.mock('chessops/san', () => ({ parseSan: vi.fn(), makeSan: vi.fn() }))

// ── api mock ──────────────────────────────────────────────────────────────────
const mockGetGtmGame = vi.fn()
const mockRecordGtmResult = vi.fn()
const mockGetGtmRating = vi.fn()
vi.mock('@/lib/api', () => ({
  api: {
    getGtmGame:      (...args: unknown[]) => mockGetGtmGame(...args),
    recordGtmResult: (...args: unknown[]) => mockRecordGtmResult(...args),
    getGtmRating:    (...args: unknown[]) => mockGetGtmRating(...args),
  },
}))

// ── context mocks ─────────────────────────────────────────────────────────────
vi.mock('@/context/TitlebarContext', () => ({
  useTitlebarBreadcrumb: vi.fn(),
  useTitlebar: () => ({ compact: false }),
  TitlebarToolbarPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TitlebarToolbarLeftPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import GTMPage, { tierPoints, cpLossForPlayer } from './GTMPage'
import type { GTMGame } from '@/lib/api'

function makeMove(ply: number, colour: 'white' | 'black', uci: string, san: string, analysed = false) {
  return {
    ply,
    fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    toFen:   'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    san,
    uci,
    colour,
    bestUci:  analysed ? uci : null,
    bestCp:   analysed ? 30 : null,
    playedCp: analysed ? 30 : null,
  }
}

function makeGame(overrides: Partial<GTMGame> = {}): GTMGame {
  return {
    gameId: 'game-1',
    white: 'Alice',
    black: 'Bob',
    date: '2024.01.01',
    result: '1-0',
    analysed: false,
    moves: [
      makeMove(1, 'white', 'e2e4', 'e4'),
      makeMove(2, 'black', 'e7e5', 'e5'),
    ],
    ...overrides,
  }
}

function renderGTMPage(colour: 'white' | 'black' = 'white') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/guess-the-move', state: { gameId: 'game-1', colour } }]}>
      <Routes>
        <Route path="/guess-the-move" element={<GTMPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('scoring helpers', () => {
  describe('tierPoints', () => {
    it('unanalysed: correct move = 1pt', () => {
      expect(tierPoints('good', false)).toBe(1)
    })
    it('unanalysed: wrong move = 0pt', () => {
      expect(tierPoints('miss', false)).toBe(0)
    })
    it('analysed: best = 2pt', () => {
      expect(tierPoints('best', true)).toBe(2)
    })
    it('analysed: good = 1pt', () => {
      expect(tierPoints('good', true)).toBe(1)
    })
    it('analysed: miss = 0pt', () => {
      expect(tierPoints('miss', true)).toBe(0)
    })
  })

  describe('cpLossForPlayer', () => {
    const baseMove = {
      ply: 1, fromFen: '', toFen: '', san: 'e4', uci: 'e2e4',
      colour: 'white' as const, bestUci: null, bestCp: null, playedCp: null,
    }
    it('returns null when evals missing', () => {
      expect(cpLossForPlayer(baseMove, 'white')).toBeNull()
    })
    it('white perspective: loss = bestCp - playedCp', () => {
      const move = { ...baseMove, bestCp: 50, playedCp: 20 }
      expect(cpLossForPlayer(move, 'white')).toBe(30)
    })
    it('black perspective: loss = playedCp - bestCp', () => {
      const move = { ...baseMove, bestCp: 50, playedCp: 20 }
      expect(cpLossForPlayer(move, 'black')).toBe(-30)
    })
  })
})

describe('GTMPage', () => {
  beforeEach(() => {
    mockGetGtmGame.mockResolvedValue(makeGame())
    mockRecordGtmResult.mockResolvedValue({ rating: 1523, gamesPlayed: 1 })
    mockGetGtmRating.mockResolvedValue({ rating: 1500, gamesPlayed: 0 })
  })

  it('shows loading state initially', () => {
    renderGTMPage()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('calls getGtmGame with the gameId from location state', async () => {
    renderGTMPage('white')
    await act(async () => { await Promise.resolve() })
    expect(mockGetGtmGame).toHaveBeenCalledWith('game-1')
  })

  it('shows complete screen when all moves are exhausted', async () => {
    mockGetGtmGame.mockResolvedValue(makeGame({ moves: [] }))
    renderGTMPage()
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText(/session complete/i)).toBeInTheDocument()
  })

  it('calls recordGtmResult on complete', async () => {
    mockGetGtmGame.mockResolvedValue(makeGame({ moves: [] }))
    renderGTMPage()
    await act(async () => { await Promise.resolve() })
    expect(mockRecordGtmResult).toHaveBeenCalled()
  })
})
