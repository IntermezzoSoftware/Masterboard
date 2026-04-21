import { render, screen, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import GamesPage from './GamesPage'

vi.mock('@/context/TitlebarContext', () => ({
  useTitlebarBreadcrumb: vi.fn(),
  TitlebarToolbarPortal: ({ children }: any) => children,
  TitlebarToolbarLeftPortal: ({ children }: any) => children,
  useTitlebar: () => ({ breadcrumb: [], setBreadcrumb: vi.fn(), toolbarPortalTarget: null, setToolbarPortalTarget: vi.fn() }),
}))

vi.mock('@/context/ToastContext', () => ({
  useToast: () => vi.fn(),
}))

// Mock the api module — Wails bridge is not available in tests
vi.mock('@/lib/api', () => ({
  api: {
    listGames:            vi.fn().mockResolvedValue([]),
    listCollections:      vi.fn().mockResolvedValue([]),
    listFolders:          vi.fn().mockResolvedValue([]),
    moveGameToFolder:     vi.fn().mockResolvedValue(undefined),
    addGameToCollection:  vi.fn().mockResolvedValue(undefined),
    openFileDialog:       vi.fn(),
    openDirectoryDialog:  vi.fn(),
    importPGNFile:        vi.fn(),
    importPGNFolder:      vi.fn(),
    importFromLichess:    vi.fn(),
    importFromChessCom:   vi.fn(),
    previewFromLichess:   vi.fn().mockResolvedValue([]),
    previewFromChessCom:  vi.fn().mockResolvedValue([]),
    importSelectedGames:  vi.fn().mockResolvedValue(0),
    deleteGame:           vi.fn(),
    getIdentityNames:     vi.fn().mockResolvedValue([]),
    getSetting:           vi.fn().mockResolvedValue(''),
    setSetting:           vi.fn().mockResolvedValue(undefined),
  },
}))

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/', element: <GamesPage /> }],
    { initialEntries: ['/'] }
  )
  return render(<RouterProvider router={router} />)
}

describe('GamesPage', () => {
  it('renders without crashing', async () => {
    renderPage()
    // Page header moved to unified titlebar; verify page body renders instead.
    expect(await screen.findByText('Filters')).toBeInTheDocument()
  })

  // Lichess quick-sync button is now rendered in the unified titlebar via
  // TitlebarToolbarPortal, not inside GamesPage's own render tree. Tested via E2E.
  it.skip('shows Lichess quick-sync button when username is configured', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockImplementation((key: string) =>
      Promise.resolve(key === 'lichess.username' ? 'myuser' : '')
    )
    renderPage()
    const btn = await screen.findByTitle(/Import recent Lichess games for myuser/)
    expect(btn).toBeInTheDocument()
  })

  it('shows empty state message when no games are loaded', async () => {
    renderPage()
    expect(await screen.findByText('No games found')).toBeInTheDocument()
  })

  it('shows bulk action bar when a game row checkbox is selected', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.listGames).mockResolvedValue([
      { id: '1', white: 'Alice', black: 'Bob', result: '1-0', date: '2024.01.01', event: 'Test', eco: '', timeControl: '600+0', source: 'manual', whiteElo: 0, blackElo: 0, collectionNames: [] },
    ])
    renderPage()
    // Wait for row to appear, then toggle select-all (header checkbox) to select the game
    const checkboxes = await screen.findAllByRole('checkbox')
    // checkboxes[0] is the select-all header checkbox; click it to select all (the one row)
    fireEvent.click(checkboxes[0])
    expect(await screen.findByText(/1 game selected/)).toBeInTheDocument()
  })
})
