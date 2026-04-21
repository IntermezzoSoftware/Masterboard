import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'


vi.mock('react-router', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ state: null }) }))

vi.mock('@/lib/fenUtils', () => ({
  sanToUci: vi.fn((fen: string, san: string) => (san === 'e4' ? 'e2e4' : null)),
  chessFromFen: vi.fn(),
}))

vi.mock('@/components/Dialog', () => ({
  Dialog: ({ children, title, onClose }: { children: React.ReactNode; title: string; onClose: () => void }) => (
    <div data-testid="dialog" role="dialog" aria-label={title}>
      <button onClick={onClose}>Close</button>
      {children}
    </div>
  ),
}))

vi.mock('@/lib/api', () => ({
  api: {
    getSetting:                  vi.fn().mockResolvedValue(''),
    getMasterGameCount:         vi.fn().mockResolvedValue(0),
    getMasterPositionStats:     vi.fn().mockResolvedValue([]),
    getMasterGamesAtPosition:   vi.fn().mockResolvedValue([]),
    getMasterGamePGN:           vi.fn().mockResolvedValue('[Event "Test"]\n1. e4'),
    getPersonalPositionStats:   vi.fn().mockResolvedValue([]),
    getPersonalGamesAtPosition: vi.fn().mockResolvedValue([]),
    listFolders:                vi.fn().mockResolvedValue([]),
    listCollections:            vi.fn().mockResolvedValue([]),
    getPlayerSuggestions:       vi.fn().mockResolvedValue([]),
    getIdentityNames:           vi.fn().mockResolvedValue([]),
    getAllRepertoireMoves:       vi.fn().mockResolvedValue([]),
  },
}))

import { api } from '@/lib/api'
import ExplorerPanelContent from './ExplorerPanelContent'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('ExplorerPanelContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getSetting).mockResolvedValue('')
    vi.mocked(api.getMasterGameCount).mockResolvedValue(0)
    vi.mocked(api.getMasterPositionStats).mockResolvedValue([])
    vi.mocked(api.getMasterGamesAtPosition).mockResolvedValue([])
    vi.mocked(api.getPersonalPositionStats).mockResolvedValue([])
    vi.mocked(api.getPersonalGamesAtPosition).mockResolvedValue([])
    vi.mocked(api.listFolders).mockResolvedValue([])
    vi.mocked(api.listCollections).mockResolvedValue([])
    vi.mocked(api.getPlayerSuggestions).mockResolvedValue([])
    vi.mocked(api.getIdentityNames).mockResolvedValue([])
    vi.mocked(api.getAllRepertoireMoves).mockResolvedValue([])
  })

  it('renders with data-testid="repertoire-database"', () => {
    render(<ExplorerPanelContent fen={START_FEN} />)
    expect(screen.getByTestId('repertoire-database')).toBeInTheDocument()
  })

  it('shows Master DB and My Games tabs', () => {
    render(<ExplorerPanelContent fen={START_FEN} />)
    expect(screen.getByRole('button', { name: 'Master DB' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'My Games' })).toBeInTheDocument()
  })

  it('shows "No master database indexed" when master DB is empty', async () => {
    render(<ExplorerPanelContent fen={START_FEN} />)
    await waitFor(() => {
      expect(screen.getByText(/no master database indexed/i)).toBeInTheDocument()
    })
  })

  it('shows "Go to Settings" link when no master DB', async () => {
    render(<ExplorerPanelContent fen={START_FEN} />)
    await waitFor(() => {
      expect(screen.getByText(/go to settings/i)).toBeInTheDocument()
    })
  })

  it('shows move stats table when master DB has data', async () => {
    vi.mocked(api.getMasterGameCount).mockResolvedValue(100)
    vi.mocked(api.getMasterPositionStats).mockResolvedValue([
      { moveSan: 'e4', whiteWins: 40, draws: 10, blackWins: 50, avgElo: 2400, total: 100 },
    ])
    render(<ExplorerPanelContent fen={START_FEN} />)
    await waitFor(() => {
      expect(screen.getByText('e4')).toBeInTheDocument()
    })
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('switches to My Games tab on click', async () => {
    render(<ExplorerPanelContent fen={START_FEN} />)
    await userEvent.click(screen.getByRole('button', { name: 'My Games' }))
    expect(screen.getByText('All folders')).toBeInTheDocument()
  })

  it('calls onPlayMove with san when move row clicked', async () => {
    vi.mocked(api.getMasterGameCount).mockResolvedValue(100)
    vi.mocked(api.getMasterPositionStats).mockResolvedValue([
      { moveSan: 'e4', whiteWins: 40, draws: 10, blackWins: 50, avgElo: 2400, total: 100 },
    ])
    const onPlayMove = vi.fn()
    render(<ExplorerPanelContent fen={START_FEN} onPlayMove={onPlayMove} />)
    await waitFor(() => screen.getByText('e4'))
    await userEvent.click(screen.getByText('e4'))
    expect(onPlayMove).toHaveBeenCalledWith('e4')
  })

  it('move rows are not clickable when onPlayMove is not provided', async () => {
    vi.mocked(api.getMasterGameCount).mockResolvedValue(100)
    vi.mocked(api.getMasterPositionStats).mockResolvedValue([
      { moveSan: 'e4', whiteWins: 40, draws: 10, blackWins: 50, avgElo: 2400, total: 100 },
    ])
    render(<ExplorerPanelContent fen={START_FEN} />)
    await waitFor(() => screen.getByText('e4'))
    const row = screen.getByText('e4').closest('tr')
    expect(row).not.toHaveClass('cursor-pointer')
  })

  it('shows games list when master games are returned', async () => {
    vi.mocked(api.getMasterGameCount).mockResolvedValue(100)
    vi.mocked(api.getMasterGamesAtPosition).mockResolvedValue([
      { id: 1, white: 'Kasparov', black: 'Karpov', result: '1-0', date: '1985', eloWhite: 2700, eloBlack: 2720, moveSan: 'e4' },
    ])
    render(<ExplorerPanelContent fen={START_FEN} />)
    await waitFor(() => {
      expect(screen.getByText('Kasparov')).toBeInTheDocument()
    })
  })

  it('shows Repertoire tab button', () => {
    render(<ExplorerPanelContent fen={START_FEN} />)
    expect(screen.getByRole('button', { name: 'Repertoire' })).toBeInTheDocument()
  })

  it('switches to Repertoire tab and shows empty state when no repertoires cover position', async () => {
    vi.mocked(api.getAllRepertoireMoves).mockResolvedValue([])
    render(<ExplorerPanelContent fen={START_FEN} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repertoire' }))
    await waitFor(() => {
      expect(screen.getByText(/this position is not in any of your repertoires/i)).toBeInTheDocument()
    })
  })

  it('shows prepared moves grouped by repertoire', async () => {
    vi.mocked(api.getAllRepertoireMoves).mockResolvedValue([
      {
        repertoire: { id: 'rep-1', name: 'Ruy Lopez', colour: 'white', description: '' },
        moves: [
          { id: 'm1', repertoireId: 'rep-1', parentId: null, fromFen: START_FEN,
            toFen: 'after-e4', moveSan: 'e4', moveUci: 'e2e4', moveOrder: 0,
            nag: null, comment: '', shapes: '', isTransposition: false },
        ],
      },
    ])
    render(<ExplorerPanelContent fen={START_FEN} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repertoire' }))
    await waitFor(() => {
      expect(screen.getByText('Ruy Lopez')).toBeInTheDocument()
      expect(screen.getByText('e4')).toBeInTheDocument()
    })
  })

  it('shows NAG annotation alongside move', async () => {
    vi.mocked(api.getAllRepertoireMoves).mockResolvedValue([
      {
        repertoire: { id: 'rep-1', name: 'Test Rep', colour: 'white', description: '' },
        moves: [
          { id: 'm1', repertoireId: 'rep-1', parentId: null, fromFen: START_FEN,
            toFen: 'after-e4', moveSan: 'e4', moveUci: 'e2e4', moveOrder: 0,
            nag: 1, comment: '', shapes: '', isTransposition: false },
        ],
      },
    ])
    render(<ExplorerPanelContent fen={START_FEN} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repertoire' }))
    await waitFor(() => {
      expect(screen.getByText('!')).toBeInTheDocument()
    })
  })

  it('shows comment text alongside move', async () => {
    vi.mocked(api.getAllRepertoireMoves).mockResolvedValue([
      {
        repertoire: { id: 'rep-1', name: 'Test Rep', colour: 'white', description: '' },
        moves: [
          { id: 'm1', repertoireId: 'rep-1', parentId: null, fromFen: START_FEN,
            toFen: 'after-e4', moveSan: 'e4', moveUci: 'e2e4', moveOrder: 0,
            nag: null, comment: 'Best by test', shapes: '', isTransposition: false },
        ],
      },
    ])
    render(<ExplorerPanelContent fen={START_FEN} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repertoire' }))
    await waitFor(() => {
      expect(screen.getByText('Best by test')).toBeInTheDocument()
    })
  })

  it('calls onPlayMove when repertoire move row is clicked', async () => {
    vi.mocked(api.getAllRepertoireMoves).mockResolvedValue([
      {
        repertoire: { id: 'rep-1', name: 'Test Rep', colour: 'white', description: '' },
        moves: [
          { id: 'm1', repertoireId: 'rep-1', parentId: null, fromFen: START_FEN,
            toFen: 'after-e4', moveSan: 'e4', moveUci: 'e2e4', moveOrder: 0,
            nag: null, comment: '', shapes: '', isTransposition: false },
        ],
      },
    ])
    const onPlayMove = vi.fn()
    render(<ExplorerPanelContent fen={START_FEN} onPlayMove={onPlayMove} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repertoire' }))
    await waitFor(() => screen.getByText('e4'))
    await userEvent.click(screen.getByText('e4'))
    expect(onPlayMove).toHaveBeenCalledWith('e4')
  })

  it('shows coverage dot in My Games tab when move is in repertoire', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getMasterGameCount).mockResolvedValue(10)
    vi.mocked(api.getPersonalPositionStats).mockResolvedValue([
      { moveSan: 'e4', total: 5, whiteWins: 3, draws: 1, blackWins: 1, avgElo: 2000, avgAccuracy: 0 },
    ])
    vi.mocked(api.getAllRepertoireMoves).mockResolvedValue([
      {
        repertoire: { id: 'r1', name: 'Test', colour: 'white', description: '' },
        moves: [{
          id: 'm1', repertoireId: 'r1', parentId: null,
          fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          toFen:   'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
          moveSan: 'e4', moveUci: 'e2e4', moveOrder: 0,
          nag: null, comment: '', shapes: '', isTransposition: false,
        }],
      },
    ])
    render(<ExplorerPanelContent fen={START_FEN} />)
    await userEvent.click(screen.getByRole('button', { name: 'My Games' }))
    await waitFor(() => {
      expect(screen.getByTitle('In your repertoire')).toBeInTheDocument()
    })
  })

  it('does not show coverage dot for moves not in repertoire', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getPersonalPositionStats).mockResolvedValue([
      { moveSan: 'd4', total: 3, whiteWins: 2, draws: 0, blackWins: 1, avgElo: 1800, avgAccuracy: 0 },
    ])
    vi.mocked(api.getAllRepertoireMoves).mockResolvedValue([])
    render(<ExplorerPanelContent fen={START_FEN} />)
    await userEvent.click(screen.getByRole('button', { name: 'My Games' }))
    await waitFor(() => {
      expect(screen.getByText('d4')).toBeInTheDocument()
    })
    expect(screen.queryByTitle('In your repertoire')).not.toBeInTheDocument()
  })

  it('hides coverage dot in My Games tab when explorer.showCoverageIndicator is "false"', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockImplementation((key: string) =>
      Promise.resolve(key === 'explorer.showCoverageIndicator' ? 'false' : '')
    )
    vi.mocked(api.getPersonalPositionStats).mockResolvedValue([
      { moveSan: 'e4', total: 5, whiteWins: 3, draws: 1, blackWins: 1, avgElo: 2000, avgAccuracy: 0 },
    ])
    vi.mocked(api.getAllRepertoireMoves).mockResolvedValue([
      {
        repertoire: { id: 'r1', name: 'Test', colour: 'white', description: '' },
        moves: [{
          id: 'm1', repertoireId: 'r1', parentId: null,
          fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          toFen:   'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
          moveSan: 'e4', moveUci: 'e2e4', moveOrder: 0,
          nag: null, comment: '', shapes: '', isTransposition: false,
        }],
      },
    ])
    render(<ExplorerPanelContent fen={START_FEN} />)
    await userEvent.click(screen.getByRole('button', { name: 'My Games' }))
    await waitFor(() => {
      expect(screen.getByText('e4')).toBeInTheDocument()
    })
    expect(screen.queryByTitle('In your repertoire')).not.toBeInTheDocument()
  })
})
