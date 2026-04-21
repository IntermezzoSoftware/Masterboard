import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsPage from './SettingsPage'
import { useMasterDB } from '@/hooks/useMasterDB'

const mockSetPalette = vi.fn()
const mockSetBoardTheme = vi.fn()
const mockSetPieceSet = vi.fn()

vi.mock('@/context/TitlebarContext', () => ({
  useTitlebarBreadcrumb: vi.fn(),
  TitlebarToolbarPortal: ({ children }: any) => children,
  TitlebarToolbarLeftPortal: ({ children }: any) => children,
  useTitlebar: () => ({ breadcrumb: [], setBreadcrumb: vi.fn(), toolbarPortalTarget: null, setToolbarPortalTarget: vi.fn() }),
}))

vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    toggleTheme: vi.fn(),
    palette: 'walnut',
    setPalette: mockSetPalette,
    boardTheme: 'brown',
    setBoardTheme: mockSetBoardTheme,
    pieceSet: 'cburnett',
    setPieceSet: mockSetPieceSet,
  }),
  BOARD_THEME_COLORS: {
    brown:  { light: '#f0d9b5', dark: '#b58863' },
    blue:   { light: '#dee3e6', dark: '#8ca2ad' },
    green:  { light: '#ffffdd', dark: '#86a666' },
    purple: { light: '#f0e4cf', dark: '#9b72af' },
  },
  VALID_BOARD_THEMES: ['brown', 'blue', 'green', 'purple'],
  VALID_PIECE_SETS: ['cburnett', 'merida', 'alpha', 'california', 'staunty'],
  PIECE_SET_LABELS: { cburnett: 'Cburnett', merida: 'Merida', alpha: 'Alpha', california: 'California', staunty: 'Staunty' },
}))

vi.mock('@/assets/pieces/previews', () => ({
  PIECE_SET_KNIGHT_PREVIEWS: {
    cburnett:   'data:mock/cburnett',
    merida:     'data:mock/merida',
    alpha:      'data:mock/alpha',
    california: 'data:mock/california',
    staunty:    'data:mock/staunty',
  },
}))

vi.mock('@/lib/api', () => ({
  api: {
    getSetting:                 vi.fn().mockResolvedValue(''),
    setSetting:                 vi.fn().mockResolvedValue(undefined),
    openDirectoryDialog:        vi.fn().mockResolvedValue(''),
    getCustomEngines:           vi.fn().mockResolvedValue([]),
    getEngineState:             vi.fn().mockResolvedValue({ isReady: false, isAnalysing: false, activeEngine: '', availableEngines: [], engineName: '', engineType: 'ab' }),
    setActiveEngine:            vi.fn().mockResolvedValue(undefined),
    setEngineOption:            vi.fn().mockResolvedValue(undefined),
    browseForEngine:            vi.fn().mockResolvedValue(''),
    addCustomEngine:            vi.fn().mockResolvedValue(undefined),
    removeCustomEngine:         vi.fn().mockResolvedValue(undefined),
    rescanEngines:              vi.fn().mockResolvedValue(undefined),
    deleteEngine:               vi.fn().mockResolvedValue(undefined),
    unregisterEngine:           vi.fn().mockResolvedValue(undefined),
    getMasterDBStatus:          vi.fn().mockResolvedValue({ state: 'not-configured', totalGames: 0, fileCount: 0, lastImport: '', filenames: [] }),
    openMasterDBFileDialog:     vi.fn().mockResolvedValue(null),
    getFileSizes:               vi.fn().mockResolvedValue([]),
    startMasterDBImport:        vi.fn().mockResolvedValue(undefined),
    cancelMasterDBImport:       vi.fn().mockResolvedValue(undefined),
    getMasterPositionStats:       vi.fn().mockResolvedValue([]),
    getMasterGamesAtPosition:     vi.fn().mockResolvedValue([]),
    getMasterDBPath:              vi.fn().mockResolvedValue('/path/to/masterboard_master.db'),
    getMasterDBDir:               vi.fn().mockResolvedValue('/path/to'),
    openMasterDBDirectoryDialog:  vi.fn().mockResolvedValue(''),
    setMasterDBStorageDir:        vi.fn().mockResolvedValue(undefined),
    getPersonalIndexingStatus:    vi.fn().mockResolvedValue({ indexed: 0, total: 0 }),
    reindexPersonalGames:         vi.fn().mockResolvedValue(undefined),
    lichessOAuthStatus:           vi.fn().mockResolvedValue(''),
    lichessOAuthConnect:          vi.fn().mockResolvedValue(undefined),
    lichessOAuthDisconnect:       vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/hooks/useMasterDB', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/hooks/useMasterDB')>()
  return {
    ...real,
    useMasterDB: vi.fn(() => ({
      uiState: 'not-configured' as const,
      status: null,
      progress: null,
      selectedFiles: [],
      selectFiles: vi.fn(),
      startImport: vi.fn(),
      cancelImport: vi.fn(),
      clearDB: vi.fn(),
      dbExists: false,
    })),
  }
})

vi.mock('wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(() => vi.fn()),
}))

vi.mock('@/lib/soundManager', () => ({ setSoundEnabled: vi.fn(), isSoundEnabled: vi.fn(() => true) }))

describe('SettingsPage', () => {
  it('renders without crashing', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('renders name and username inputs', async () => {
    render(<SettingsPage />)
    expect(await screen.findByLabelText(/Your name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Lichess username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Chess\.com username/i)).toBeInTheDocument()
  })

  it('pre-fills inputs from saved settings', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockImplementation((key: string) =>
      Promise.resolve(
        key === 'lichess.username'     ? 'myuser'    :
        key === 'chesscom.username'    ? 'comuser'   :
        key === 'identity.displayName' ? 'Smith, J'  : ''
      )
    )
    render(<SettingsPage />)
    expect(await screen.findByDisplayValue('myuser')).toBeInTheDocument()
    expect(screen.getByDisplayValue('comuser')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Smith, J')).toBeInTheDocument()
  })

  it('pre-fills multiple name variants from newline-separated stored value', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockImplementation((key: string) =>
      Promise.resolve(key === 'identity.displayName' ? 'Carlsen, Magnus\nMagnus Carlsen' : '')
    )
    render(<SettingsPage />)
    expect(await screen.findByDisplayValue('Carlsen, Magnus')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Magnus Carlsen')).toBeInTheDocument()
  })

  it('calls api.setSetting on input blur', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockResolvedValue('')
    render(<SettingsPage />)
    const lichessInput = await screen.findByLabelText(/Lichess username/i)
    await userEvent.type(lichessInput, 'newuser')
    await userEvent.tab()
    expect(vi.mocked(api.setSetting)).toHaveBeenCalledWith('lichess.username', 'newuser')
  })

  it('saves name variant on blur', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockResolvedValue('')
    render(<SettingsPage />)
    const nameInput = await screen.findByLabelText(/Your name/i)
    await userEvent.type(nameInput, 'Carlsen, Magnus')
    await userEvent.tab()
    expect(vi.mocked(api.setSetting)).toHaveBeenCalledWith('identity.displayName', 'Carlsen, Magnus')
  })

  it('hides Add variant button when the last row is empty', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockResolvedValue('')
    render(<SettingsPage />)
    await screen.findByLabelText(/Your name/i)
    expect(screen.queryByRole('button', { name: /add variant/i })).not.toBeInTheDocument()
  })

  it('adds a second variant row when Add variant is clicked after filling the first', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockResolvedValue('')
    render(<SettingsPage />)
    await userEvent.type(await screen.findByLabelText(/Your name/i), 'Carlsen, Magnus')
    await userEvent.click(screen.getByRole('button', { name: /add variant/i }))
    expect(screen.getByLabelText('Your name variant 2')).toBeInTheDocument()
  })

  it('removes a variant row and saves when × is clicked', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockImplementation((key: string) =>
      Promise.resolve(key === 'identity.displayName' ? 'Carlsen, Magnus\nMagnus Carlsen' : '')
    )
    render(<SettingsPage />)
    await screen.findByDisplayValue('Carlsen, Magnus')
    const removeButtons = screen.getAllByRole('button', { name: /remove variant/i })
    await userEvent.click(removeButtons[0])
    expect(screen.queryByDisplayValue('Carlsen, Magnus')).not.toBeInTheDocument()
    expect(vi.mocked(api.setSetting)).toHaveBeenCalledWith('identity.displayName', 'Magnus Carlsen')
  })

  describe('palette picker', () => {
    it('renders all five palette swatches', () => {
      render(<SettingsPage />)
      expect(screen.getByTestId('palette-walnut')).toBeInTheDocument()
      expect(screen.getByTestId('palette-slate')).toBeInTheDocument()
      expect(screen.getByTestId('palette-forest')).toBeInTheDocument()
      expect(screen.getByTestId('palette-navy')).toBeInTheDocument()
      expect(screen.getByTestId('palette-burgundy')).toBeInTheDocument()
    })

    it('marks the active palette swatch as checked', () => {
      render(<SettingsPage />)
      expect(screen.getByTestId('palette-walnut')).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByTestId('palette-slate')).toHaveAttribute('aria-checked', 'false')
    })

    it('calls setPalette when a swatch is clicked', async () => {
      render(<SettingsPage />)
      await userEvent.click(screen.getByTestId('palette-slate'))
      expect(mockSetPalette).toHaveBeenCalledWith('slate')
    })

    it('selected swatch has ring class', () => {
      render(<SettingsPage />)
      expect(screen.getByTestId('palette-walnut').className).toContain('ring-2')
      expect(screen.getByTestId('palette-slate').className).not.toContain('ring-2')
    })
  })

  describe('board appearance', () => {
    it('renders Board Appearance section heading', () => {
      render(<SettingsPage />)
      expect(screen.getByRole('heading', { name: 'Board Appearance' })).toBeInTheDocument()
    })

    it('renders swatches for all four board themes', () => {
      render(<SettingsPage />)
      expect(screen.getByTestId('board-theme-brown')).toBeInTheDocument()
      expect(screen.getByTestId('board-theme-blue')).toBeInTheDocument()
      expect(screen.getByTestId('board-theme-green')).toBeInTheDocument()
      expect(screen.getByTestId('board-theme-purple')).toBeInTheDocument()
    })

    it('marks the active board theme as checked', () => {
      render(<SettingsPage />)
      expect(screen.getByTestId('board-theme-brown')).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByTestId('board-theme-blue')).toHaveAttribute('aria-checked', 'false')
    })

    it('calls setBoardTheme when a swatch is clicked', async () => {
      render(<SettingsPage />)
      await userEvent.click(screen.getByTestId('board-theme-blue'))
      expect(mockSetBoardTheme).toHaveBeenCalledWith('blue')
    })

    it('selected board theme swatch has ring class', () => {
      render(<SettingsPage />)
      expect(screen.getByTestId('board-theme-brown').className).toContain('ring-2')
      expect(screen.getByTestId('board-theme-blue').className).not.toContain('ring-2')
    })

    it('renders piece set selector with all five options', () => {
      render(<SettingsPage />)
      expect(screen.getByTestId('piece-set-cburnett')).toBeInTheDocument()
      expect(screen.getByTestId('piece-set-merida')).toBeInTheDocument()
      expect(screen.getByTestId('piece-set-alpha')).toBeInTheDocument()
      expect(screen.getByTestId('piece-set-california')).toBeInTheDocument()
      expect(screen.getByTestId('piece-set-staunty')).toBeInTheDocument()
      expect(screen.queryByTestId('piece-set-ocean')).not.toBeInTheDocument()
    })
  })

  describe('engine configuration', () => {
    it('renders Engine Configuration section heading', () => {
      render(<SettingsPage />)
      expect(screen.getByRole('heading', { name: 'Engine Configuration' })).toBeInTheDocument()
    })
  })

  describe('master game database', () => {
    it('renders Master Game Database section heading', () => {
      render(<SettingsPage />)
      expect(screen.getByRole('heading', { name: 'Master Game Database' })).toBeInTheDocument()
    })

    it('shows "Select PGN Files" button in not-configured state', () => {
      render(<SettingsPage />)
      expect(screen.getByRole('button', { name: /select pgn files/i })).toBeInTheDocument()
    })

    it('shows progress bar in importing state', () => {
      vi.mocked(useMasterDB).mockReturnValueOnce({
        uiState: 'importing',
        status: null,
        progress: { gamesProcessed: 500, currentFile: 'games.pgn', fileIndex: 1, totalFiles: 2 },
        selectedFiles: [],
        selectFiles: vi.fn(),
        startImport: vi.fn(),
        cancelImport: vi.fn(),
        clearDB: vi.fn(),
        dbExists: false,
      })
      render(<SettingsPage />)
      expect(screen.getByText(/500/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('shows game count summary in indexed state', () => {
      vi.mocked(useMasterDB).mockReturnValueOnce({
        uiState: 'indexed',
        status: { state: 'indexed', totalGames: 5000000, fileCount: 3, lastImport: '2026-04-06T12:00:00Z', filenames: ['a.pgn', 'b.pgn', 'c.pgn'] },
        progress: null,
        selectedFiles: [],
        selectFiles: vi.fn(),
        startImport: vi.fn(),
        cancelImport: vi.fn(),
        clearDB: vi.fn(),
        dbExists: true,
      })
      render(<SettingsPage />)
      expect(screen.getByText(/5,000,000/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /import more files/i })).toBeInTheDocument()
    })

    it('shows file table when files are selected', () => {
      vi.mocked(useMasterDB).mockReturnValueOnce({
        uiState: 'not-configured',
        status: null,
        progress: null,
        selectedFiles: [{ name: 'games.pgn', path: '/tmp/games.pgn', sizeBytes: 500000, estimatedGames: 1000 }],
        selectFiles: vi.fn(),
        startImport: vi.fn(),
        cancelImport: vi.fn(),
        clearDB: vi.fn(),
        dbExists: false,
      })
      render(<SettingsPage />)
      expect(screen.getByText('games.pgn')).toBeInTheDocument()
      expect(screen.getAllByText(/~1,000/).length).toBeGreaterThan(0)
    })

    it('clear database button uses danger style in indexed state', () => {
      vi.mocked(useMasterDB).mockReturnValueOnce({
        uiState: 'indexed',
        status: { state: 'indexed', totalGames: 100, fileCount: 1, lastImport: '', filenames: ['a.pgn'] },
        progress: null,
        selectedFiles: [],
        selectFiles: vi.fn(),
        startImport: vi.fn(),
        cancelImport: vi.fn(),
        clearDB: vi.fn(),
        dbExists: true,
      })
      render(<SettingsPage />)
      const clearBtn = screen.getByRole('button', { name: /clear database/i })
      expect(clearBtn.className).toContain('danger')
    })

    it('clicking Clear Database opens confirmation modal without calling clearDB', async () => {
      const clearDB = vi.fn()
      vi.mocked(useMasterDB).mockReturnValue({
        uiState: 'indexed',
        status: { state: 'indexed', totalGames: 100, fileCount: 1, lastImport: '', filenames: ['a.pgn'] },
        progress: null,
        selectedFiles: [],
        selectFiles: vi.fn(),
        startImport: vi.fn(),
        cancelImport: vi.fn(),
        clearDB,
        dbExists: true,
      })
      render(<SettingsPage />)
      await userEvent.click(screen.getByRole('button', { name: /clear database/i }))
      expect(screen.getByText(/permanently delete/i)).toBeInTheDocument()
      expect(clearDB).not.toHaveBeenCalled()
    })

    it('confirming in modal calls clearDB and closes modal', async () => {
      const clearDB = vi.fn()
      vi.mocked(useMasterDB).mockReturnValue({
        uiState: 'indexed',
        status: { state: 'indexed', totalGames: 100, fileCount: 1, lastImport: '', filenames: ['a.pgn'] },
        progress: null,
        selectedFiles: [],
        selectFiles: vi.fn(),
        startImport: vi.fn(),
        cancelImport: vi.fn(),
        clearDB,
        dbExists: true,
      })
      render(<SettingsPage />)
      await userEvent.click(screen.getByRole('button', { name: /clear database/i }))
      const confirmBtns = screen.getAllByRole('button', { name: /clear database/i })
      // The modal's confirm button is the last one rendered
      await userEvent.click(confirmBtns[confirmBtns.length - 1])
      expect(clearDB).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(/permanently delete/i)).not.toBeInTheDocument()
    })

    it('cancelling the modal does not call clearDB', async () => {
      const clearDB = vi.fn()
      vi.mocked(useMasterDB).mockReturnValue({
        uiState: 'indexed',
        status: { state: 'indexed', totalGames: 100, fileCount: 1, lastImport: '', filenames: ['a.pgn'] },
        progress: null,
        selectedFiles: [],
        selectFiles: vi.fn(),
        startImport: vi.fn(),
        cancelImport: vi.fn(),
        clearDB,
        dbExists: true,
      })
      render(<SettingsPage />)
      await userEvent.click(screen.getByRole('button', { name: /clear database/i }))
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(clearDB).not.toHaveBeenCalled()
      expect(screen.queryByText(/permanently delete/i)).not.toBeInTheDocument()
    })

    it('hover title on indexed summary lists source filenames', () => {
      vi.mocked(useMasterDB).mockReturnValueOnce({
        uiState: 'indexed',
        status: { state: 'indexed', totalGames: 100, fileCount: 2, lastImport: '', filenames: ['a.pgn', 'b.pgn'] },
        progress: null,
        selectedFiles: [],
        selectFiles: vi.fn(),
        startImport: vi.fn(),
        cancelImport: vi.fn(),
        clearDB: vi.fn(),
        dbExists: true,
      })
      render(<SettingsPage />)
      const summary = screen.getByText(/100/).closest('[title]')
      expect(summary).toHaveAttribute('title', 'a.pgn\nb.pgn')
    })
  })

  it('renders the Openings section with both toggle switches', async () => {
    render(<SettingsPage />)
    expect(await screen.findByText('Openings')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /coverage indicator/i })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /move heatmap/i })).toBeInTheDocument()
  })

  it('coverage indicator toggle defaults to checked when setting not set', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockResolvedValue('')
    render(<SettingsPage />)
    const toggle = await screen.findByRole('switch', { name: /coverage indicator/i })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('coverage indicator toggle reflects false when setting is "false"', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockImplementation((key: string) =>
      Promise.resolve(key === 'explorer.showCoverageIndicator' ? 'false' : '')
    )
    render(<SettingsPage />)
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /coverage indicator/i }))
        .toHaveAttribute('aria-checked', 'false')
    })
  })

  it('clicking coverage indicator toggle calls api.setSetting with toggled value', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockResolvedValue('')
    render(<SettingsPage />)
    const toggle = await screen.findByRole('switch', { name: /coverage indicator/i })
    await userEvent.click(toggle)
    expect(vi.mocked(api.setSetting)).toHaveBeenCalledWith('explorer.showCoverageIndicator', 'false')
  })

  it('clicking move heatmap toggle calls api.setSetting with toggled value', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSetting).mockResolvedValue('')
    render(<SettingsPage />)
    const toggle = await screen.findByRole('switch', { name: /move heatmap/i })
    await userEvent.click(toggle)
    expect(vi.mocked(api.setSetting)).toHaveBeenCalledWith('repertoire.showHeatmap', 'false')
  })

  describe('General section', () => {
    beforeEach(async () => {
      vi.clearAllMocks()
      const { api } = await import('@/lib/api')
      vi.mocked(api.getSetting).mockResolvedValue('')
      vi.mocked(api.setSetting).mockResolvedValue(undefined)
    })

    it('renders the General section with splash screen toggle', async () => {
      render(<SettingsPage />)
      expect(await screen.findByText('General')).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: /splash screen/i })).toBeInTheDocument()
    })

    it('splash toggle defaults to checked when setting not set', async () => {
      render(<SettingsPage />)
      const toggle = await screen.findByRole('switch', { name: /splash screen/i })
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })

    it('splash toggle reflects false when setting is "false"', async () => {
      const { api } = await import('@/lib/api')
      vi.mocked(api.getSetting).mockImplementation((key: string) =>
        Promise.resolve(key === 'app.splashEnabled' ? 'false' : '')
      )
      render(<SettingsPage />)
      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /splash screen/i }))
          .toHaveAttribute('aria-checked', 'false')
      })
    })

    it('clicking splash toggle calls api.setSetting with toggled value', async () => {
      const { api } = await import('@/lib/api')
      render(<SettingsPage />)
      const toggle = await screen.findByRole('switch', { name: /splash screen/i })
      await userEvent.click(toggle)
      expect(vi.mocked(api.setSetting)).toHaveBeenCalledWith('app.splashEnabled', 'false')
    })

    it('renders sound effects toggle', async () => {
      render(<SettingsPage />)
      expect(await screen.findByRole('switch', { name: 'Sound effects' })).toBeInTheDocument()
    })
  })

  describe('Engine Configuration', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('Add engine button is present', () => {
      render(<SettingsPage />)
      expect(screen.getByTestId('engine-add-btn')).toBeInTheDocument()
    })

    it('clicking Add engine calls browseForEngine then addCustomEngine when a path is returned', async () => {
      const { api } = await import('@/lib/api')
      vi.mocked(api.browseForEngine).mockResolvedValueOnce('/usr/bin/leela')
      render(<SettingsPage />)
      await userEvent.click(screen.getByTestId('engine-add-btn'))
      expect(vi.mocked(api.browseForEngine)).toHaveBeenCalled()
      expect(vi.mocked(api.addCustomEngine)).toHaveBeenCalledWith('/usr/bin/leela')
    })

    it('cancelling Browse (empty string returned) does not call addCustomEngine', async () => {
      const { api } = await import('@/lib/api')
      vi.mocked(api.browseForEngine).mockResolvedValueOnce('')
      render(<SettingsPage />)
      await userEvent.click(screen.getByTestId('engine-add-btn'))
      expect(vi.mocked(api.addCustomEngine)).not.toHaveBeenCalled()
    })

    it('shows all available engines with delete buttons', async () => {
      const { api } = await import('@/lib/api')
      vi.mocked(api.getEngineState).mockResolvedValueOnce({
        isReady: false, isAnalysing: false, activeEngine: '', engineName: '', engineType: 'ab',
        availableEngines: [
          { path: '/usr/bin/stockfish', name: 'stockfish' },
          { path: '/usr/bin/leela', name: 'leela' },
        ],
      })
      render(<SettingsPage />)
      expect(await screen.findByTestId('engine-delete-0')).toBeInTheDocument()
      expect(screen.getByTestId('engine-delete-1')).toBeInTheDocument()
    })

    it('clicking delete opens confirm dialog then calls deleteEngine on "Delete from disk"', async () => {
      const { api } = await import('@/lib/api')
      vi.mocked(api.getEngineState).mockResolvedValue({
        isReady: false, isAnalysing: false, activeEngine: '', engineName: '', engineType: 'ab',
        availableEngines: [{ path: '/usr/bin/stockfish', name: 'Stockfish' }],
      })
      render(<SettingsPage />)
      const deleteBtn = await screen.findByTestId('engine-delete-0')
      await userEvent.click(deleteBtn)
      expect(screen.getByText('Remove engine?')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Delete from disk' }))
      expect(vi.mocked(api.deleteEngine)).toHaveBeenCalledWith('/usr/bin/stockfish')
    })

    it('clicking "Remove from Masterboard" calls unregisterEngine', async () => {
      const { api } = await import('@/lib/api')
      vi.mocked(api.getEngineState).mockResolvedValue({
        isReady: false, isAnalysing: false, activeEngine: '', engineName: '', engineType: 'ab',
        availableEngines: [{ path: '/usr/bin/stockfish', name: 'Stockfish' }],
      })
      render(<SettingsPage />)
      const deleteBtn = await screen.findByTestId('engine-delete-0')
      await userEvent.click(deleteBtn)
      expect(screen.getByText('Remove engine?')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Keep files' }))
      expect(vi.mocked(api.unregisterEngine)).toHaveBeenCalledWith('/usr/bin/stockfish')
    })
  })
})
