import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import ReportsPage from './ReportsPage'

vi.mock('@/lib/api', () => ({
  api: {
    getPlayerNames: vi.fn().mockResolvedValue(['Carlsen, Magnus', 'Caruana, Fabiano']),
    getPlayerStats: vi.fn().mockResolvedValue({
      totalGames: 55,
      analyzedGames: 0,
      asWhite: { wins: 10, draws: 5, losses: 5, total: 20 },
      asBlack: { wins: 8, draws: 7, losses: 20, total: 35 },
      byTimeControl: [],
      byOpening: [
        {
          eco: 'E10',
          opening: 'Queens Pawn Game',
          games: 20,
          winPct: 40,
          drawPct: 30,
          lossPct: 30,
          asWhite: 12,
          asBlack: 8,
          whiteWins: 5,
          whiteDraws: 4,
          blackWins: 3,
          blackDraws: 3,
        },
        {
          eco: 'B20',
          opening: 'Sicilian Defence',
          games: 5,
          winPct: 20,
          drawPct: 20,
          lossPct: 60,
          asWhite: 3,
          asBlack: 2,
          whiteWins: 1,
          whiteDraws: 1,
          blackWins: 0,
          blackDraws: 1,
        },
      ],
    }),
    getDeviationPositions: vi.fn().mockResolvedValue([
      {
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        playerMove: 'c5',
        theoryMoves: ['e5', 'e6', 'c5'],
        count: 12,
      },
    ]),
    getPlayerAnalysisStats: vi.fn().mockResolvedValue({
      accuracyTimeSeries: [],
      blunderHeatmap: [],
      blunderPositions: [
        { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', count: 5 },
      ],
      luckStats: {
        blunderCount: 10,
        unpunishedBlunders: 3,
        luckRate: 30,
        oppBlunderCount: 8,
        exploitedBlunders: 6,
        opportunismRate: 75,
      },
    }),
    analyzeOpponentGames: vi.fn().mockResolvedValue(5),
    getQueueStatus: vi.fn().mockResolvedValue({ remaining: 5, active: 0 }),
    getExportOpponentReport: vi.fn().mockResolvedValue('[Event "Test"]\n\n*\n'),
  },
}))

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/', element: <ReportsPage /> }],
    { initialEntries: ['/'] }
  )
  return render(<RouterProvider router={router} />)
}

describe('ReportsPage', () => {
  it('renders page title', () => {
    renderPage()
    expect(screen.getByText('Reports')).toBeInTheDocument()
  })

  it('has data-testid page-reports on root', () => {
    renderPage()
    expect(screen.getByTestId('page-reports')).toBeInTheDocument()
  })

  it('shows search input', () => {
    renderPage()
    expect(screen.getByPlaceholderText('Search opponent name...')).toBeInTheDocument()
  })

  it('shows autocomplete suggestions when typing', async () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => {
      expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument()
      expect(screen.getByText('Caruana, Fabiano')).toBeInTheDocument()
    })
  })

  it('shows player stats after selecting a suggestion', async () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByText('Carlsen, Magnus'))
    await waitFor(() => {
      expect(screen.getByText('55 games in database')).toBeInTheDocument()
    })
  })

  it('shows colour result sections after player selected', async () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByText('Carlsen, Magnus'))
    await waitFor(() => {
      expect(screen.getAllByText(/As White/).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/As Black/).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows ECO code in Opening performance table', async () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByText('Carlsen, Magnus'))
    await waitFor(() => {
      expect(screen.getAllByText('E10').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows theory deviations table', async () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByText('Carlsen, Magnus'))
    await waitFor(() => {
      expect(screen.getByText('Theory deviations')).toBeInTheDocument()
      expect(screen.getByText('c5')).toBeInTheDocument()
    })
  })

  it('shows enabled Export Report button when player is selected', async () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByText('Carlsen, Magnus'))
    await waitFor(() => {
      const btn = screen.getByText('Export Report as PGN')
      expect(btn).not.toBeDisabled()
    })
  })

  it('shows blunder positions section when analysis stats available', async () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByText('Carlsen, Magnus'))
    await waitFor(() => {
      expect(screen.getByText('Recurring blunder positions')).toBeInTheDocument()
    })
  })

  it('shows luck and opportunism section when analysis stats available', async () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByText('Carlsen, Magnus'))
    await waitFor(() => {
      expect(screen.getByText('Luck & opportunism')).toBeInTheDocument()
      expect(screen.getByText('Luck rate')).toBeInTheDocument()
      expect(screen.getByText('Opportunism rate')).toBeInTheDocument()
    })
  })

  it('shows Analyse button as active after player selected', async () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByText('Carlsen, Magnus'))
    await waitFor(() => {
      const btn = screen.getByText("Analyse Carlsen, Magnus's games")
      expect(btn).not.toBeDisabled()
    })
  })

  it('opens analysis modal when Analyse button clicked and games are queued', async () => {
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByText('Carlsen, Magnus'))
    await waitFor(() => expect(screen.getByText("Analyse Carlsen, Magnus's games")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Analyse Carlsen, Magnus's games"))
    await waitFor(() => {
      expect(screen.getByText("Analysing Carlsen, Magnus's games")).toBeInTheDocument()
    })
  })

  it('shows all analysed message when analyzeOpponentGames returns 0', async () => {
    const { api: mockApi } = await import('@/lib/api')
    ;(mockApi.analyzeOpponentGames as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0)
    renderPage()
    const input = screen.getByPlaceholderText('Search opponent name...')
    fireEvent.change(input, { target: { value: 'Car' } })
    await waitFor(() => expect(screen.getByText('Carlsen, Magnus')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByText('Carlsen, Magnus'))
    await waitFor(() => expect(screen.getByText("Analyse Carlsen, Magnus's games")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Analyse Carlsen, Magnus's games"))
    await waitFor(() => {
      expect(screen.getByText('All games already analysed.')).toBeInTheDocument()
    })
  })
})
