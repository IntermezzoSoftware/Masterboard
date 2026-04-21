import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { useMasterDB, estimateImport, formatImportDuration } from '@/hooks/useMasterDB'
import { api, type EngineEntry, type EngineState } from '@/lib/api'
import { EventsOn } from '@/lib/wailsRuntime'
import { formInput, formLabel, btnGhost, btnPrimary, btnSecondary, btnDanger } from '@/lib/classNames'
import { useTheme, type Palette, type BoardTheme, BOARD_THEME_COLORS, VALID_BOARD_THEMES, type PieceSet, VALID_PIECE_SETS, PIECE_SET_LABELS } from '@/context/ThemeContext'
import { PIECE_SET_KNIGHT_PREVIEWS } from '@/assets/pieces/previews'
import { setSoundEnabled, isSoundEnabled } from '@/lib/soundManager'
import { useTitlebarBreadcrumb } from '@/context/TitlebarContext'
import { EngineDownloadDialog } from '@/components/EngineDownloadDialog'

const PALETTE_OPTIONS: { id: Palette; label: string; color: string }[] = [
  { id: 'walnut',   label: 'Walnut',   color: '#6b5540' },
  { id: 'slate',    label: 'Slate',    color: '#4a5a78' },
  { id: 'forest',   label: 'Forest',   color: '#2d6a4f' },
  { id: 'navy',     label: 'Navy',     color: '#1e3a6e' },
  { id: 'burgundy', label: 'Burgundy', color: '#6b2232' },
]

const BOARD_THEME_LABELS: Record<BoardTheme, string> = {
  brown:  'Brown',
  blue:   'Blue',
  green:  'Green',
  purple: 'Purple',
}

const SETTING_KEYS = [
  'lichess.username', 'chesscom.username', 'identity.displayName',
  'engine.hash', 'engine.threads', 'engine.analysisDepth',
  'explorer.showCoverageIndicator', 'repertoire.showHeatmap',
  'app.splashEnabled', 'sound.enabled',
] as const

const ENGINE_HASH_DEFAULT    = 16
const ENGINE_THREADS_DEFAULT = 1
const ENGINE_DEPTH_DEFAULT   = 22

export default function SettingsPage() {
  useTitlebarBreadcrumb([])
  const { palette, setPalette, boardTheme, setBoardTheme, pieceSet, setPieceSet } = useTheme()
  const { values, setValue, loading } = useSettings([...SETTING_KEYS])
  const {
    uiState: masterUIState,
    status: masterStatus,
    progress: masterProgress,
    selectedFiles: masterSelectedFiles,
    selectFiles: selectMasterFiles,
    startImport: startMasterImport,
    cancelImport: cancelMasterImport,
    clearDB: clearMasterDB,
    dbExists: masterDBExists,
  } = useMasterDB()
  // Track import intent when files are selected from the indexed state.
  const [importIntent, setImportIntent] = useState<'append' | 'replace'>('replace')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [masterDBDir, setMasterDBDir] = useState<string>('')
  const [masterDBPathError, setMasterDBPathError] = useState<string>('')

  // Local state per input — pre-seeded once settings load
  const [nameVariants,    setNameVariants]    = useState<string[]>([''])
  const [lichessUsername, setLichessUsername] = useState('')
  const [chesscomUsername, setChesscomUsername] = useState('')
  const [customEngines, setCustomEngines] = useState<string[]>([])
  const [availableEngines, setAvailableEngines] = useState<EngineEntry[]>([])
  const [activeEngine, setActiveEngineState] = useState('')
  const [showDownloadDialog, setShowDownloadDialog] = useState(false)
  const [engineToDelete, setEngineToDelete] = useState<string | null>(null)
  // Local string states for numeric engine inputs (allows clearing before re-typing)
  const [engineHashStr,    setEngineHashStr]    = useState('')
  const [engineThreadsStr, setEngineThreadsStr] = useState('')
  const [engineDepthStr,   setEngineDepthStr]   = useState('')
  const engineHashFocused    = useRef(false)
  const engineThreadsFocused = useRef(false)
  const engineDepthFocused   = useRef(false)

  const [lichessOAuthUsername, setLichessOAuthUsername] = useState<string | null>(null)
  const [oauthConnecting, setOAuthConnecting] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)

  const [showCoverageIndicator, setShowCoverageIndicator] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [showSplash, setShowSplash] = useState(true)
  const [soundEnabled, setSoundEnabledState] = useState(isSoundEnabled)

  // Position index state
  const [indexedGames, setIndexedGames]   = useState<number | null>(null)
  const [totalGames,   setTotalGames]     = useState<number | null>(null)
  const [indexing,     setIndexing]       = useState(false)
  const indexPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!loading) {
      const stored = values['identity.displayName'] ?? ''
      setNameVariants(stored ? stored.split('\n') : [''])
      setLichessUsername(values['lichess.username'] ?? '')
      setChesscomUsername(values['chesscom.username'] ?? '')
      setShowCoverageIndicator(values['explorer.showCoverageIndicator'] !== 'false')
      setShowHeatmap(values['repertoire.showHeatmap'] !== 'false')
      api.lichessOAuthStatus().then(u => setLichessOAuthUsername(u || null)).catch(() => {})
      const splashEnabled = values['app.splashEnabled'] !== 'false'
      setShowSplash(splashEnabled)
      localStorage.setItem('masterboard-splashEnabled', splashEnabled ? 'true' : 'false')
      const next = values['sound.enabled'] !== 'false'
      setSoundEnabledState(next)
      setSoundEnabled(next)  // keep soundManager in sync with DB value
    }
  }, [loading, values])

  useEffect(() => {
    api.getCustomEngines().then(list => setCustomEngines(list ?? [])).catch(() => {})
    api.getEngineState().then(s => {
      setAvailableEngines(s.availableEngines ?? [])
      setActiveEngineState(s.activeEngine)
    }).catch(() => {})
  }, [])

  // Keep active engine in sync when the engine finishes launching (async handshake).
  useEffect(() => {
    return EventsOn('engine:ready', (state?: EngineState) => {
      if (state?.activeEngine) setActiveEngineState(state.activeEngine)
      if (state?.availableEngines) setAvailableEngines(state.availableEngines)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the engine list in sync when engines are added/removed.
  useEffect(() => {
    return EventsOn('engine:engines-changed', (engines?: EngineEntry[]) => {
      if (engines) setAvailableEngines(engines)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Seed the numeric engine input strings once settings load.
  useEffect(() => {
    if (loading) return
    if (!engineHashFocused.current)
      setEngineHashStr(values['engine.hash'] || String(ENGINE_HASH_DEFAULT))
    if (!engineThreadsFocused.current)
      setEngineThreadsStr(values['engine.threads'] || String(ENGINE_THREADS_DEFAULT))
    if (!engineDepthFocused.current)
      setEngineDepthStr(values['engine.analysisDepth'] || String(ENGINE_DEPTH_DEFAULT))
  }, [loading, values]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load master DB storage directory.
  useEffect(() => {
    api.getMasterDBDir().then(d => setMasterDBDir(d)).catch(() => {})
  }, [])

  // Load initial indexing status.
  useEffect(() => {
    api.getPersonalIndexingStatus()
      .then(s => { setIndexedGames(s.indexed); setTotalGames(s.total) })
      .catch(() => { setIndexedGames(0); setTotalGames(0) })
    return () => { if (indexPollRef.current) clearInterval(indexPollRef.current) }
  }, [])

  function handleReindex() {
    setIndexing(true)
    api.reindexPersonalGames().catch(() => {})
    if (indexPollRef.current) clearInterval(indexPollRef.current)
    indexPollRef.current = setInterval(() => {
      api.getPersonalIndexingStatus().then(s => {
        setIndexedGames(s.indexed)
        setTotalGames(s.total)
        if (s.total > 0 && s.indexed >= s.total) {
          setIndexing(false)
          if (indexPollRef.current) clearInterval(indexPollRef.current)
        }
      }).catch(() => {})
    }, 500)
  }

  async function handleChangeMasterDBLocation() {
    setMasterDBPathError('')
    const dir = await api.openMasterDBDirectoryDialog()
    if (!dir) return
    try {
      await api.setMasterDBStorageDir(dir)
      const newDir = await api.getMasterDBDir()
      setMasterDBDir(newDir)
    } catch (e: unknown) {
      setMasterDBPathError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleAddEngine() {
    const path = await api.browseForEngine()
    if (!path) return
    await api.addCustomEngine(path)
    setCustomEngines(prev => prev.includes(path) ? prev : [...prev, path])
  }

  async function handleRemoveEngine(path: string) {
    await api.removeCustomEngine(path)
    setCustomEngines(prev => prev.filter(p => p !== path))
  }

  async function handleActiveEngineChange(path: string) {
    setActiveEngineState(path)
    await api.setActiveEngine(path).catch(() => {})
  }

  function handleEngineHashBlur() {
    engineHashFocused.current = false
    const n = parseInt(engineHashStr, 10)
    const value = isNaN(n) || n < 1 ? ENGINE_HASH_DEFAULT : n
    setEngineHashStr(String(value))
    setValue('engine.hash', String(value))
    api.setEngineOption('Hash', String(value)).catch(() => {})
  }

  function handleEngineThreadsBlur() {
    engineThreadsFocused.current = false
    const n = parseInt(engineThreadsStr, 10)
    const value = isNaN(n) || n < 1 ? ENGINE_THREADS_DEFAULT : n
    setEngineThreadsStr(String(value))
    setValue('engine.threads', String(value))
    api.setEngineOption('Threads', String(value)).catch(() => {})
  }

  function handleEngineDepthBlur() {
    engineDepthFocused.current = false
    const n = parseInt(engineDepthStr, 10)
    const value = isNaN(n) || n < 1 ? ENGINE_DEPTH_DEFAULT : n
    setEngineDepthStr(String(value))
    setValue('engine.analysisDepth', String(value))
  }

  function saveNameVariants(variants: string[]) {
    setValue('identity.displayName', variants.map(v => v.trim()).filter(Boolean).join('\n'))
  }

  function updateVariant(index: number, value: string) {
    setNameVariants(prev => prev.map((v, i) => i === index ? value : v))
  }

  function removeVariant(index: number) {
    const next = nameVariants.filter((_, i) => i !== index)
    setNameVariants(next)
    saveNameVariants(next)
  }

  function addVariant() {
    setNameVariants(prev => prev[prev.length - 1] === '' ? prev : [...prev, ''])
  }

  const totalEstimatedGames = masterSelectedFiles.reduce((s, f) => s + f.estimatedGames, 0)
  const { seconds: importSeconds, dbSizeGB } = estimateImport(totalEstimatedGames)
  const importSizeLabel = dbSizeGB < 1
    ? `~${Math.round(dbSizeGB * 1024)} MB`
    : `~${dbSizeGB.toFixed(1)} GB`
  const importGamesLabel = totalEstimatedGames >= 1000000
    ? `~${(totalEstimatedGames / 1000000).toFixed(1)}M`
    : `~${totalEstimatedGames.toLocaleString()}`

  return (
    // Take ownership of the page scroll (instead of relying on AppLayout's
    // <main> overflow-auto) and wrap it in a pr-1.5 gutter so the
    // scrollbar doesn't sit flush with the window edge and swallow the
    // mouse events Wails's frameless-resize handler needs.
    <div className="h-full overflow-hidden flex flex-col">
    <div className="flex-1 min-h-0 pr-1.5">
    <div className="h-full overflow-auto">
    <div className="flex flex-col gap-2 p-8">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
        Settings
      </h1>
      <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        Application configuration · Changes are saved automatically when you leave a field.
      </p>

      {/* General */}
      <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <h2 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">General</h2>
        </div>
        <div className="divide-y divide-[var(--color-surface-3)] dark:divide-[var(--color-dark-surface-3)]">
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <label htmlFor="setting-splash-screen" className={`${formLabel} cursor-pointer`}>
                Show splash screen on startup
              </label>
              <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
                Display the Masterboard logo when the application launches.
              </p>
            </div>
            <button
              id="setting-splash-screen"
              role="switch"
              aria-checked={showSplash}
              aria-label="Splash screen"
              disabled={loading}
              onClick={() => {
                const next = !showSplash
                setShowSplash(next)
                setValue('app.splashEnabled', next ? 'true' : 'false')
                localStorage.setItem('masterboard-splashEnabled', next ? 'true' : 'false')
              }}
              className={[
                'relative shrink-0 inline-flex h-5 w-9 rounded-full border-2 border-transparent',
                'transition-colors duration-200 focus-visible:outline focus-visible:outline-2',
                'focus-visible:outline-[var(--color-accent)] disabled:opacity-40 disabled:cursor-not-allowed',
                showSplash
                  ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)]'
                  : 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]',
              ].join(' ')}
            >
              <span className={[
                'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                showSplash ? 'translate-x-4' : 'translate-x-0',
              ].join(' ')} />
            </button>
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <label htmlFor="setting-sound-effects" className={`${formLabel} cursor-pointer`}>
                Sound effects
              </label>
              <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
                Play a sound when moves are made on the board.
              </p>
            </div>
            <button
              id="setting-sound-effects"
              role="switch"
              aria-checked={soundEnabled}
              aria-label="Sound effects"
              disabled={loading}
              onClick={() => {
                const next = !soundEnabled
                setSoundEnabledState(next)
                setSoundEnabled(next)
                setValue('sound.enabled', next ? 'true' : 'false')
              }}
              className={[
                'relative shrink-0 inline-flex h-5 w-9 rounded-full border-2 border-transparent',
                'transition-colors duration-200 focus-visible:outline focus-visible:outline-2',
                'focus-visible:outline-[var(--color-accent)] disabled:opacity-40 disabled:cursor-not-allowed',
                soundEnabled
                  ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)]'
                  : 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]',
              ].join(' ')}
            >
              <span className={[
                'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                soundEnabled ? 'translate-x-4' : 'translate-x-0',
              ].join(' ')} />
            </button>
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <h2 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">Appearance</h2>
          <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
            Choose an accent colour palette for the application.
          </p>
        </div>
        <div className="px-4 py-4">
          <div role="radiogroup" aria-label="Colour palette" className="flex gap-4 flex-wrap">
            {PALETTE_OPTIONS.map(({ id, label, color }) => {
              const selected = palette === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={label}
                  data-testid={`palette-${id}`}
                  onClick={() => setPalette(id)}
                  className={[
                    'flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
                    selected ? 'ring-2 ring-offset-2 ring-[var(--color-accent)] dark:ring-offset-[var(--color-dark-surface-1)]' : '',
                  ].join(' ')}
                >
                  <span
                    className="block w-8 h-8 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                    {label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Board Appearance */}
      <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <h2 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">Board Appearance</h2>
          <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
            Choose a board colour scheme and piece style.
          </p>
        </div>
        <div className="px-4 py-4">
          <div role="radiogroup" aria-label="Board colour scheme" className="flex gap-4 flex-wrap">
            {VALID_BOARD_THEMES.map(id => {
              const { light, dark } = BOARD_THEME_COLORS[id]
              const label = BOARD_THEME_LABELS[id]
              const selected = boardTheme === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={label}
                  data-testid={`board-theme-${id}`}
                  onClick={() => setBoardTheme(id)}
                  className={[
                    'flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
                    selected ? 'ring-2 ring-offset-2 ring-[var(--color-accent)] dark:ring-offset-[var(--color-dark-surface-1)]' : '',
                  ].join(' ')}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      width: 32,
                      height: 32,
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ background: light }} />
                    <div style={{ background: dark }} />
                    <div style={{ background: dark }} />
                    <div style={{ background: light }} />
                  </div>
                  <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                    {label}
                  </span>
                </button>
              )
            })}
          </div>
          {/* Piece set */}
          <div className="mt-4">
            <p className={`${formLabel} mb-2`}>Piece set</p>
            <div role="radiogroup" aria-label="Piece set" className="flex gap-4 flex-wrap">
              {VALID_PIECE_SETS.map(id => {
                const label    = PIECE_SET_LABELS[id]
                const selected = pieceSet === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={label}
                    data-testid={`piece-set-${id}`}
                    onClick={() => setPieceSet(id)}
                    className={[
                      'flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
                      selected ? 'ring-2 ring-offset-2 ring-[var(--color-accent)] dark:ring-offset-[var(--color-dark-surface-1)]' : '',
                    ].join(' ')}
                  >
                    <div
                      className="rounded-sm border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]"
                      style={{
                        width: 45,
                        height: 45,
                        backgroundImage: `url(${PIECE_SET_KNIGHT_PREVIEWS[id] ?? ''})`,
                        backgroundSize: 'cover',
                      }}
                    />
                    <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                      {label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Openings */}
      {!loading && <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <h2 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">Openings</h2>
          <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
            Configure what is shown in analysis panels and the repertoire tree.
          </p>
        </div>
        <div className="divide-y divide-[var(--color-surface-3)] dark:divide-[var(--color-dark-surface-3)]">
          {/* Coverage indicator toggle */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <label htmlFor="setting-coverage-indicator" className={`${formLabel} cursor-pointer`}>
                Coverage indicator
              </label>
              <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
                Show a green dot next to moves that exist in your repertoires when browsing your games in the Explorer panel.
              </p>
            </div>
            <button
              id="setting-coverage-indicator"
              role="switch"
              aria-checked={showCoverageIndicator}
              aria-label="Coverage indicator"
              disabled={loading}
              onClick={() => {
                const next = !showCoverageIndicator
                setShowCoverageIndicator(next)
                setValue('explorer.showCoverageIndicator', next ? 'true' : 'false')
              }}
              className={[
                'relative shrink-0 inline-flex h-5 w-9 rounded-full border-2 border-transparent',
                'transition-colors duration-200 focus-visible:outline focus-visible:outline-2',
                'focus-visible:outline-[var(--color-accent)] disabled:opacity-40 disabled:cursor-not-allowed',
                showCoverageIndicator
                  ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)]'
                  : 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]',
              ].join(' ')}
            >
              <span className={[
                'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                showCoverageIndicator ? 'translate-x-4' : 'translate-x-0',
              ].join(' ')} />
            </button>
          </div>
          {/* Move heatmap toggle */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <label htmlFor="setting-move-heatmap" className={`${formLabel} cursor-pointer`}>
                Move heatmap
              </label>
              <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
                Show colour-coded review-state dots on moves in the Repertoire Builder tree (green = well-learned, yellow = due, red = lapsed).
              </p>
            </div>
            <button
              id="setting-move-heatmap"
              role="switch"
              aria-checked={showHeatmap}
              aria-label="Move heatmap"
              disabled={loading}
              onClick={() => {
                const next = !showHeatmap
                setShowHeatmap(next)
                setValue('repertoire.showHeatmap', next ? 'true' : 'false')
              }}
              className={[
                'relative shrink-0 inline-flex h-5 w-9 rounded-full border-2 border-transparent',
                'transition-colors duration-200 focus-visible:outline focus-visible:outline-2',
                'focus-visible:outline-[var(--color-accent)] disabled:opacity-40 disabled:cursor-not-allowed',
                showHeatmap
                  ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)]'
                  : 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]',
              ].join(' ')}
            >
              <span className={[
                'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                showHeatmap ? 'translate-x-4' : 'translate-x-0',
              ].join(' ')} />
            </button>
          </div>
        </div>
      </div>}

      {/* Engine Configuration */}
      <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <h2 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">Engine Configuration</h2>
          <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
            Settings apply to both live analysis and full game analysis.
          </p>
        </div>
        <div className="px-4 py-4 flex flex-col gap-4">

          {/* Engine list */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={formLabel}>Engines</label>
              <button
                type="button"
                data-testid="engine-rescan-btn"
                onClick={() => {
                  api.rescanEngines()
                    .then(() => api.getEngineState())
                    .then(s => {
                      setAvailableEngines(s.availableEngines ?? [])
                      setActiveEngineState(s.activeEngine)
                    })
                    .catch(() => {})
                }}
                className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]"
              >
                Refresh
              </button>
            </div>
            {availableEngines.length > 0 ? (
              <div className="flex flex-col gap-1">
                {availableEngines.map((e, i) => {
                  const isActive = e.path === activeEngine
                  return (
                    <div
                      key={e.path}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] border cursor-pointer ${
                        isActive
                          ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] dark:bg-[var(--color-dark-surface-2)]'
                          : 'border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]'
                      }`}
                      onClick={() => handleActiveEngineChange(e.path)}
                    >
                      <div className={`w-2 h-2 rounded-full flex-none ${isActive ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]'}`} />
                      <span className="flex-1 truncate text-sm text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]" title={e.path}>
                        {e.name}
                      </span>
                      <button
                        type="button"
                        data-testid={`engine-delete-${i}`}
                        onClick={ev => { ev.stopPropagation(); setEngineToDelete(e.path) }}
                        className="flex-none text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-danger-strong)] dark:hover:text-[var(--color-danger-strong)] px-1"
                        aria-label="Delete engine"
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">No engines found in the engines folder.</p>
            )}
          </div>

          {/* Hash / Threads / Depth */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="engine-hash" className={formLabel}>Hash (MB)</label>
              <input
                id="engine-hash"
                data-testid="engine-hash-input"
                type="text"
                inputMode="numeric"
                value={engineHashStr}
                disabled={loading}
                onChange={e => setEngineHashStr(e.target.value)}
                onFocus={() => { engineHashFocused.current = true }}
                onBlur={handleEngineHashBlur}
                className={formInput}
                aria-label="Hash table size in MB"
              />
            </div>
            <div>
              <label htmlFor="engine-threads" className={formLabel}>Threads</label>
              <input
                id="engine-threads"
                data-testid="engine-threads-input"
                type="text"
                inputMode="numeric"
                value={engineThreadsStr}
                disabled={loading}
                onChange={e => setEngineThreadsStr(e.target.value)}
                onFocus={() => { engineThreadsFocused.current = true }}
                onBlur={handleEngineThreadsBlur}
                className={formInput}
                aria-label="CPU threads for live analysis"
              />
            </div>
            <div>
              <label htmlFor="engine-depth" className={formLabel}>Full game analysis depth</label>
              <input
                id="engine-depth"
                data-testid="engine-depth-input"
                type="text"
                inputMode="numeric"
                value={engineDepthStr}
                disabled={loading}
                onChange={e => setEngineDepthStr(e.target.value)}
                onFocus={() => { engineDepthFocused.current = true }}
                onBlur={handleEngineDepthBlur}
                className={formInput}
                aria-label="Search depth for full game analysis"
              />
            </div>
          </div>

          <div className="flex gap-4">
            <button
              type="button"
              data-testid="engine-download-btn"
              onClick={() => setShowDownloadDialog(true)}
              className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]"
            >
              + Download engine…
            </button>
            <button
              type="button"
              data-testid="engine-add-btn"
              onClick={handleAddEngine}
              className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]"
            >
              + Add local engine…
            </button>
          </div>
        </div>
      </div>

      {/* Player Profile */}
      <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <h2 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">Player Profile</h2>
          <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
            Your name as it appears in manually imported PGN files. Used alongside your online usernames to identify which games are yours when computing personal statistics.
          </p>
        </div>

        <div className="px-4 py-4 flex flex-col gap-2">
          <label className={formLabel}>Your name</label>
          {nameVariants.map((variant, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={formInput}
                value={variant}
                disabled={loading}
                onChange={e => updateVariant(i, e.target.value)}
                onBlur={() => saveNameVariants(nameVariants)}
                placeholder={i === 0 ? 'e.g. Carlsen, Magnus' : 'e.g. Magnus Carlsen'}
                autoComplete="off"
                aria-label={i === 0 ? 'Your name' : `Your name variant ${i + 1}`}
              />
              {nameVariants.length > 1 && (
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => removeVariant(i)}
                  aria-label="Remove variant"
                  disabled={loading}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {!loading && nameVariants[nameVariants.length - 1] !== '' && (
            <button
              type="button"
              className="self-start text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]"
              onClick={addVariant}
            >
              + Add variant
            </button>
          )}
        </div>
      </div>

      {/* Connected Accounts */}
      <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <h2 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">Connected Accounts</h2>
          <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
            Saved usernames are used to pre-fill import dialogs and enable one-click sync on the Games page.
          </p>
        </div>

        <div className="px-4 py-4 flex flex-col gap-4">
          <div>
            <label htmlFor="lichess-username" className={formLabel}>Lichess username</label>
            <input
              id="lichess-username"
              className={formInput}
              value={lichessUsername}
              disabled={loading}
              onChange={e => setLichessUsername(e.target.value)}
              onBlur={() => setValue('lichess.username', lichessUsername.trim())}
              placeholder="e.g. DrNykterstein"
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="chesscom-username" className={formLabel}>Chess.com username</label>
            <input
              id="chesscom-username"
              className={formInput}
              value={chesscomUsername}
              disabled={loading}
              onChange={e => setChesscomUsername(e.target.value)}
              onBlur={() => setValue('chesscom.username', chesscomUsername.trim())}
              placeholder="e.g. MagnusCarlsen"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Lichess OAuth (for private studies)</span>
            {lichessOAuthUsername ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--color-text-muted)]">
                  Connected as <strong>{lichessOAuthUsername}</strong>
                </span>
                <button
                  className={btnSecondary}
                  onClick={async () => {
                    await api.lichessOAuthDisconnect()
                    setLichessOAuthUsername(null)
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <button
                    className={btnSecondary}
                    disabled={oauthConnecting}
                    onClick={async () => {
                      setOAuthConnecting(true)
                      setOauthError(null)
                      try {
                        await api.lichessOAuthConnect()
                        const u = await api.lichessOAuthStatus()
                        setLichessOAuthUsername(u || null)
                      } catch (e: unknown) {
                        const msg = e instanceof Error ? e.message : String(e)
                        if (!msg.includes('cancelled')) {
                          setOauthError(msg.includes('timed out') ? 'Authorization timed out. Try again.' : 'Authorization failed. Try again.')
                        }
                      } finally {
                        setOAuthConnecting(false)
                      }
                    }}
                  >
                    {oauthConnecting ? 'Connecting\u2026' : 'Connect Lichess Account'}
                  </button>
                  {oauthConnecting && (
                    <button
                      className={btnSecondary}
                      onClick={() => { api.lichessOAuthCancel().catch(() => {}) }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {oauthConnecting && (
                  <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                    Authorize in the browser tab that just opened. Lichess will show &ldquo;Grant access to io.masterboard.app://oauth&rdquo; &mdash; this is expected.
                  </p>
                )}
                {oauthError && (
                  <p className="text-xs text-red-500 dark:text-red-400">{oauthError}</p>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Master Game Database */}
      <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <h2 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">Master Game Database</h2>
          <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
            Import a large PGN collection to see move popularity overlays on the board.
          </p>
        </div>
        <div className="px-4 py-4 space-y-3">

          {/* ── Storage location ── */}
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mb-0.5">Storage location</p>
              <p
                className="text-xs font-mono text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] truncate"
                title={masterDBDir}
              >
                {masterDBDir || '—'}
              </p>
              {masterDBPathError && (
                <p className="text-xs text-red-500 mt-0.5">{masterDBPathError}</p>
              )}
            </div>
            <button
              type="button"
              className={`shrink-0 ${btnSecondary}`}
              onClick={handleChangeMasterDBLocation}
              disabled={masterUIState === 'importing'}
            >
              Change…
            </button>
          </div>

          {/* ── State: indexed ── */}
          {masterUIState === 'indexed' && masterStatus && (
            <div className="space-y-3">
              <p
                className="text-sm text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] cursor-default"
                title={masterStatus.filenames.length > 0 ? masterStatus.filenames.join('\n') : undefined}
              >
                <span className="font-semibold">{masterStatus.totalGames.toLocaleString()}</span>
                {' '}games from{' '}
                <span className="font-semibold">{masterStatus.fileCount}</span>
                {' '}file{masterStatus.fileCount !== 1 ? 's' : ''} indexed
                {masterStatus.lastImport && (
                  <span className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                    {' '}· last imported {new Date(masterStatus.lastImport).toLocaleDateString()}
                  </span>
                )}
              </p>
              {masterSelectedFiles.length === 0 && (
                <div className="flex gap-2">
                  <button className={btnSecondary} onClick={() => { setImportIntent('append'); selectMasterFiles() }}>
                    Import More Files
                  </button>
                  <button className={btnSecondary} onClick={() => { setImportIntent('replace'); selectMasterFiles() }}>
                    Replace Database
                  </button>
                  <button className={btnDanger} onClick={() => setShowClearConfirm(true)}>
                    Clear Database
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── State: not-configured, no files chosen yet ── */}
          {masterUIState === 'not-configured' && masterSelectedFiles.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                Import a PGN collection to power the opening explorer. We recommend{' '}
                <a
                  href="https://lumbrasgigabase.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-[var(--color-accent)] hover:opacity-80"
                >
                  Lumbra's Gigabase
                </a>
                {' '}as a free source of master games (10M+ games).
              </p>
              <button className={btnSecondary} onClick={selectMasterFiles}>
                Select PGN Files
              </button>
            </div>
          )}

          {/* ── Files selected, not yet importing ── */}
          {masterUIState !== 'importing' && masterSelectedFiles.length > 0 && (
            <div className="space-y-3">
              <MasterFileTable files={masterSelectedFiles} />
              <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                {importGamesLabel} games estimated · {importSizeLabel} · {formatImportDuration(importSeconds)}
                {' · '}<span className="opacity-60">benchmark estimate, varies by hardware</span>
              </p>
              <div className="flex gap-2">
                <button className={btnSecondary} onClick={selectMasterFiles}>
                  Change Selection
                </button>
                {masterDBExists ? (
                  <>
                    <button className={btnPrimary} onClick={() => startMasterImport(importIntent === 'replace')}>
                      {importIntent === 'replace' ? 'Replace Database' : 'Import More'}
                    </button>
                  </>
                ) : (
                  <button className={btnPrimary} onClick={() => startMasterImport(true)}>
                    Start Import
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── State: importing, waiting for first progress event ── */}
          {masterUIState === 'importing' && !masterProgress && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
              <Loader2 size={14} className="animate-spin shrink-0" />
              Import in progress…
            </div>
          )}

          {/* ── State: importing ── */}
          {masterUIState === 'importing' && masterProgress && (() => {
            const phase = masterProgress.phase
            const phaseLabel =
              phase === 'processing' ? 'Processing games'
              : phase === 'building-stats' ? 'Building statistics'
              : phase === 'building-index' ? 'Building position index'
              : 'Optimizing database'
            const phaseNum = phase === 'processing' ? 1 : phase === 'building-stats' ? 2 : phase === 'building-index' ? 3 : 4
            const phasePercent = masterProgress.phaseTotal > 0
              ? Math.round((masterProgress.phaseDone / masterProgress.phaseTotal) * 100)
              : 0
            // Overall progress: processing=0-50%, stats=50-75%, index=75-90%, optimizing=90-100%
            const overallBase = phase === 'processing' ? 0 : phase === 'building-stats' ? 50 : phase === 'building-index' ? 75 : 90
            const overallSpan = phase === 'processing' ? 50 : phase === 'building-stats' ? 25 : phase === 'building-index' ? 15 : 10
            const processingPercent = masterProgress.estimatedTotalGames > 0
              ? Math.min((masterProgress.gamesProcessed / masterProgress.estimatedTotalGames) * 100, 100)
              : masterProgress.totalFiles > 0
                ? (masterProgress.fileIndex / masterProgress.totalFiles) * 100
                : 0
            const innerPercent = phase === 'processing' ? processingPercent : (masterProgress.phaseTotal > 0 ? phasePercent : 0)
            const overallPercent = Math.min(overallBase + (innerPercent / 100) * overallSpan, 100)

            return (
              <div className="space-y-3">
                {/* Overall progress */}
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                      Importing… {masterProgress.gamesProcessed.toLocaleString()} games
                    </p>
                    <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                      Step {phaseNum} of 4
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] overflow-hidden">
                    {phase === 'optimizing' && masterProgress.phaseTotal === 0 ? (
                      <div className="h-full rounded-full bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] animate-pulse w-full" />
                    ) : (
                      <div
                        className="h-full rounded-full bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] transition-all duration-500"
                        style={{ width: `${Math.round(overallPercent)}%` }}
                      />
                    )}
                  </div>
                </div>
                {/* Current step detail */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                    {phaseLabel}
                  </p>
                  {phase === 'processing' ? (
                    <>
                      {masterProgress.estimatedTotalGames > 0 && (
                        <div className="w-full h-1 rounded-full bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] transition-all duration-300 opacity-60"
                            style={{ width: `${Math.round(processingPercent)}%` }}
                          />
                        </div>
                      )}
                      <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                        File {masterProgress.fileIndex} of {masterProgress.totalFiles}: {masterProgress.currentFile}
                      </p>
                    </>
                  ) : phase === 'optimizing' ? (
                    <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                      This may take a few minutes for large databases
                    </p>
                  ) : masterProgress.phaseTotal > 0 ? (
                    <>
                      <div className="w-full h-1 rounded-full bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] transition-all duration-300 opacity-60"
                          style={{ width: `${phasePercent}%` }}
                        />
                      </div>
                      <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                        {masterProgress.phaseDone.toLocaleString()} / {masterProgress.phaseTotal.toLocaleString()} rows
                      </p>
                    </>
                  ) : null}
                </div>
                <button className={btnGhost} onClick={cancelMasterImport}>
                  Cancel
                </button>
              </div>
            )
          })()}

        </div>
      </div>

      {/* Position Index */}
      <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
          <h2 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">Position Index</h2>
          <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
            Indexes positions from your games to power the Explorer panel.
          </p>
        </div>
        <div className="px-4 py-4 flex items-center gap-4">
          <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] flex-1">
            {indexing
              ? `Indexing… ${indexedGames ?? 0} / ${totalGames ?? 0} games`
              : indexedGames !== null && totalGames !== null
                ? `${indexedGames.toLocaleString()} of ${totalGames.toLocaleString()} games indexed`
                : 'Loading…'
            }
          </p>
          <button
            className={btnPrimary}
            disabled={indexing}
            onClick={handleReindex}
          >
            {indexing ? 'Indexing…' : 'Re-index all games'}
          </button>
        </div>
      </div>

      {/* Remove engine confirmation modal */}
      {engineToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEngineToDelete(null)}>
          <div
            className="w-96 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] shadow-xl p-5 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}
          >
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                Remove engine?
              </h3>
              <p className="mt-1 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                Remove <span className="font-medium">{availableEngines.find(e => e.path === engineToDelete)?.name ?? engineToDelete.split(/[\\/]/).pop()}</span> from Masterboard, or delete the files from disk entirely?
              </p>
              <p className="mt-2 text-xs font-mono text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] break-all">{engineToDelete}</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button className={btnGhost} onClick={() => setEngineToDelete(null)}>
                Cancel
              </button>
              <button
                className={btnSecondary}
                onClick={() => {
                  const path = engineToDelete
                  setEngineToDelete(null)
                  api.unregisterEngine(path)
                    .then(() => api.getEngineState())
                    .then(s => {
                      setAvailableEngines(s.availableEngines ?? [])
                      setActiveEngineState(s.activeEngine)
                    })
                    .catch(() => {})
                }}
              >
                Keep files
              </button>
              <button
                className={btnDanger}
                onClick={() => {
                  const path = engineToDelete
                  setEngineToDelete(null)
                  api.deleteEngine(path)
                    .then(() => api.getEngineState())
                    .then(s => {
                      setAvailableEngines(s.availableEngines ?? [])
                      setActiveEngineState(s.activeEngine)
                    })
                    .catch(() => {})
                }}
              >
                Delete from disk
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Database confirmation modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowClearConfirm(false)}>
          <div
            className="w-80 rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] shadow-xl p-5 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}
          >
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                Clear master game database?
              </h3>
              <p className="mt-1 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                This will permanently delete the indexed master game database. You will need to re-import PGN files to restore it. This cannot be undone.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setShowClearConfirm(false)}>
                Cancel
              </button>
              <button
                className={btnDanger}
                onClick={() => { setShowClearConfirm(false); clearMasterDB() }}
              >
                Clear Database
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </div>{/* end scroll */}
    </div>{/* end gutter */}

    {showDownloadDialog && (
      <EngineDownloadDialog
        onClose={() => {
          setShowDownloadDialog(false)
          api.rescanEngines()
            .then(() => api.getEngineState())
            .then(s => {
              setAvailableEngines(s.availableEngines ?? [])
              setActiveEngineState(s.activeEngine)
            })
            .catch(() => {})
        }}
        availableEngines={availableEngines}
      />
    )}
    </div>
  )
}

function MasterFileTable({ files }: { files: { name: string; sizeBytes: number; estimatedGames: number }[] }) {
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="text-left text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
          <th className="pb-1 font-medium">File</th>
          <th className="pb-1 font-medium text-right">Est. games</th>
        </tr>
      </thead>
      <tbody>
        {files.map((f, i) => (
          <tr key={i} className="border-t border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
            <td className="py-1 pr-4 text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] font-mono truncate max-w-[260px]">
              {f.name}
            </td>
            <td className="py-1 text-right text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
              {f.estimatedGames > 0 ? `~${f.estimatedGames.toLocaleString()}` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
