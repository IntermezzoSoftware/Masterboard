import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import StatisticsPage from './StatisticsPage'

vi.mock('@/lib/api', () => ({
  api: {
    getIdentityNames: vi.fn().mockResolvedValue(['Magnus']),
    listFolders: vi.fn().mockResolvedValue([]),
    listCollections: vi.fn().mockResolvedValue([]),
    getPlayerStats: vi.fn().mockResolvedValue({
      totalGames: 42,
      analyzedGames: 10,
      asWhite: { wins: 8, draws: 3, losses: 5, total: 16 },
      asBlack: { wins: 6, draws: 4, losses: 16, total: 26 },
      byTimeControl: [
        { category: 'rapid', results: { wins: 10, draws: 5, losses: 7, total: 22 } },
        { category: 'blitz', results: { wins: 4, draws: 2, losses: 14, total: 20 } },
      ],
      byOpening: [
        {
          eco: 'C65',
          opening: 'Spanish Game',
          games: 10,
          winPct: 50,
          drawPct: 20,
          lossPct: 30,
          asWhite: 6,
          asBlack: 4,
          whiteWins: 3,
          whiteDraws: 1,
          blackWins: 2,
          blackDraws: 1,
        },
      ],
    }),
    getPlayerAnalysisStats: vi.fn().mockResolvedValue({
      accuracyTimeSeries: [],
      blunderHeatmap: [],
      blunderPositions: [],
      luckStats: {
        blunderCount: 0,
        unpunishedBlunders: 0,
        luckRate: 0,
        oppBlunderCount: 0,
        exploitedBlunders: 0,
        opportunismRate: 0,
      },
    }),
  },
}))

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/', element: <StatisticsPage /> }],
    { initialEntries: ['/'] }
  )
  return render(<RouterProvider router={router} />)
}

describe('StatisticsPage', () => {
  it('shows total game count from stats', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument())
  })

  it('shows colour result sections for white and black', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByText(/As White/).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/As Black/).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows time control rows', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Rapid')).toBeInTheDocument()
      expect(screen.getByText('Blitz')).toBeInTheDocument()
    })
  })

  it('shows ECO codes in opening table', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('C65')).toBeInTheDocument())
  })

  it('shows analysis gate when not all games analyzed', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/not yet analysed/)).toBeInTheDocument())
  })

  it('shows identity filter checkbox when identity is configured', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/My games only/)).toBeInTheDocument())
  })
})
