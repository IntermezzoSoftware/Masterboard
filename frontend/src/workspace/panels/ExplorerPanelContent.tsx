import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ChevronDown, ChevronLeft } from 'lucide-react'
import { useColumnResize } from '@/hooks/useColumnResize'
import { useSettings } from '@/hooks/useSettings'
import { useNavigate, useLocation } from 'react-router'
import { api } from '@/lib/api'
import type {
  MasterMoveStat, MasterGameSummary,
  PersonalMoveStat, PersonalGameSummary,
  PersonalPositionFilters,
  Folder, Collection,
  RepertoireData,
  ExplorerInitialState,
  DeviationResult,
} from '@/lib/api'
import { formatTimeControl } from '@/lib/gameFormatters'
import { Select } from '@/components/Select'

interface ExplorerPanelContentProps {
  fen: string
  orientation?: 'white' | 'black'
  excludeRepertoireId?: string
  onLoadPgn?: (pgn: string, game: MasterGameSummary) => void
  onPlayMove?: (san: string) => void
  deviationResult?: DeviationResult | null
  onJumpToDeviation?: () => void
}

type Tab = 'master' | 'personal' | 'repertoire'
type SortCol = 'total' | 'perf' | 'avgElo'
type GameSortBy = 'elo' | 'date'

function whiteScore(whiteWins: number, draws: number, total: number): number {
  if (total === 0) return 0
  return Math.round((whiteWins + draws * 0.5) / total * 100)
}

function nagSymbol(nag: number | null | undefined): string {
  if (!nag) return ''
  const map: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' }
  return map[nag] ?? ''
}

function fmtElo(elo: number | null | undefined): string {
  if (!elo) return '—'
  return String(elo)
}

type MoveColKey = 'move' | 'games' | 'results' | 'white' | 'elo'
const MOVE_COL_DEFAULTS: Record<MoveColKey, number> = {
  move: 48, games: 52, results: 120, white: 48, elo: 44,
}
const MOVE_COL_ORDER: MoveColKey[] = ['move', 'games', 'results', 'white', 'elo']
const MOVE_LS_KEY = 'masterboard.explorerMoveColWidths'

interface MoveStatsTableProps {
  stats: (MasterMoveStat | PersonalMoveStat)[]
  sortCol: SortCol
  sortDir: 'asc' | 'desc'
  onSort: (col: SortCol) => void
  onPlayMove?: (san: string) => void
  coverageSet?: Set<string>
  showCoverage?: boolean
}

function MoveStatsTable({ stats, sortCol, sortDir, onSort, onPlayMove, coverageSet, showCoverage }: MoveStatsTableProps) {
  const { colWidths, tableRef, startResize } = useColumnResize(
    MOVE_COL_ORDER, MOVE_COL_DEFAULTS, MOVE_LS_KEY,
  )

  if (stats.length === 0) {
    return (
      <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] text-center py-4">
        No moves found at this position.
      </p>
    )
  }

  const totalUnits = MOVE_COL_ORDER.reduce((a, k) => a + colWidths[k], 0)
  const pct = (w: number) => `${(w / totalUnits * 100).toFixed(3)}%`

  const sorted = [...stats].sort((a, b) => {
    let av = 0, bv = 0
    if (sortCol === 'total') { av = a.total; bv = b.total }
    else if (sortCol === 'avgElo') { av = a.avgElo; bv = b.avgElo }
    else if (sortCol === 'perf') {
      av = whiteScore(a.whiteWins, a.draws, a.total)
      bv = whiteScore(b.whiteWins, b.draws, b.total)
    }
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const rHandle = (col: MoveColKey) => {
    if (MOVE_COL_ORDER.indexOf(col) >= MOVE_COL_ORDER.length - 1) return null
    return (
      <div
        className="group absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-10"
        onMouseDown={e => { e.stopPropagation(); startResize(col, e) }}
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] opacity-0 group-hover:opacity-100 group-active:opacity-100" />
      </div>
    )
  }

  const thTertiary = 'text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]'
  const thBase = `relative px-1 py-1 ${thTertiary}`
  const thSort = `${thBase} cursor-pointer select-none hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] transition-colors`

  const active = (col: SortCol) => sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''

  return (
    <table ref={tableRef} className="w-full text-xs border-separate border-spacing-0" style={{ tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: pct(colWidths.move) }} />
        <col style={{ width: pct(colWidths.games) }} />
        <col style={{ width: pct(colWidths.results) }} />
        <col style={{ width: pct(colWidths.white) }} />
        <col style={{ width: pct(colWidths.elo) }} />
      </colgroup>
      <thead>
        <tr className={`${thTertiary} border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]`}>
          <th className={`${thBase} text-left`}>
            Move{rHandle('move')}
          </th>
          <th className={`${thSort} text-right`} onClick={() => onSort('total')}>
            Games{active('total')}{rHandle('games')}
          </th>
          <th className={`${thBase} text-left pl-3 pr-1`}>
            Results{rHandle('results')}
          </th>
          <th
            className={`${thSort} text-right`}
            title="White's score: wins + ½ draws, as a percentage"
            onClick={() => onSort('perf')}
          >
            White %{active('perf')}{rHandle('white')}
          </th>
          <th className={`${thSort} text-right`} onClick={() => onSort('avgElo')}>
            Elo{active('avgElo')}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(s => {
          const wPct = s.total > 0 ? (s.whiteWins / s.total) * 100 : 0
          const dPct = s.total > 0 ? (s.draws      / s.total) * 100 : 0
          const bPct = s.total > 0 ? (s.blackWins  / s.total) * 100 : 0
          const scorePct = whiteScore(s.whiteWins, s.draws, s.total)

          // Only render segments with non-zero width so the container's
          // rounded corners always clip the first and last visible segment.
          // Show the percentage label inside a segment when it is wide enough.
          type Seg = { pct: number; bg: string; fg: string }
          const segments: Seg[] = []
          if (wPct > 0) segments.push({ pct: wPct, bg: 'bg-neutral-300', fg: 'text-neutral-700' })
          if (dPct > 0) segments.push({ pct: dPct, bg: 'bg-neutral-500', fg: 'text-white' })
          if (bPct > 0) segments.push({ pct: bPct, bg: 'bg-neutral-800', fg: 'text-white' })

          return (
            <tr
              key={s.moveSan}
              onClick={onPlayMove ? () => onPlayMove(s.moveSan) : undefined}
              className={`border-b border-[var(--color-surface-2)] dark:border-[var(--color-dark-surface-2)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]${onPlayMove ? ' cursor-pointer' : ''}`}
            >
              <td className="px-1 py-1 font-mono font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                <div className="flex items-center gap-1 truncate">
                  {showCoverage && coverageSet?.has(s.moveSan) && (
                    <span
                      className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400"
                      title="In your repertoire"
                    />
                  )}
                  <span className="truncate">{s.moveSan}</span>
                </div>
              </td>
              <td className="text-right px-1 tabular-nums truncate">
                {s.total.toLocaleString()}
              </td>
              <td className="pl-3 pr-1 py-1 overflow-hidden">
                <div
                  className="flex rounded overflow-hidden h-4 w-full ring-1 ring-neutral-400 dark:ring-neutral-600"
                  title={`White ${Math.round(wPct)}% / Draw ${Math.round(dPct)}% / Black ${Math.round(bPct)}%`}
                >
                  {segments.map((seg, i) => (
                    <div
                      key={i}
                      className={`${seg.bg} flex items-center justify-center overflow-hidden`}
                      style={{ width: `${seg.pct}%` }}
                    >
                      {seg.pct >= 15 && (
                        <span className={`${seg.fg} text-[9px] font-medium leading-none select-none`}>
                          {Math.round(seg.pct)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </td>
              <td className="text-right px-1 tabular-nums overflow-hidden">{scorePct}%</td>
              <td className="text-right px-1 tabular-nums text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] truncate">
                {s.avgElo > 0 ? s.avgElo : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

interface GamesListProps {
  fen: string
  masterGames?: MasterGameSummary[]
  personalGames?: PersonalGameSummary[]
  onOpenMasterGame: (g: MasterGameSummary) => void
}

function GamesList({ fen, masterGames, personalGames, onOpenMasterGame }: GamesListProps) {
  const navigate = useNavigate()
  const games = masterGames ?? personalGames ?? []

  if (games.length === 0) {
    return (
      <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] text-center py-2">
        No games found at this position.
      </p>
    )
  }

  const ResultBadge = ({ result }: { result: string }) => {
    if (result === '1-0') return (
      <span className="inline-block ml-1 px-1 rounded text-[10px] font-semibold leading-4 bg-white text-black border border-neutral-400">
        1-0
      </span>
    )
    if (result === '0-1') return (
      <span className="inline-block ml-1 px-1 rounded text-[10px] font-semibold leading-4 bg-neutral-800 text-white border border-neutral-500">
        0-1
      </span>
    )
    return (
      <span className="inline-block ml-1 px-1 rounded text-[10px] font-semibold leading-4 bg-neutral-400 dark:bg-neutral-500 text-white border border-neutral-500 dark:border-neutral-400">
        ½-½
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {masterGames?.map(g => (
        <button
          key={g.id}
          onClick={() => onOpenMasterGame(g)}
          className="text-left px-1 py-1 rounded text-xs hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors"
        >
          <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
            {g.white}
          </span>
          <span className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]"> vs </span>
          <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
            {g.black}
          </span>
          <ResultBadge result={g.result} />
          <span className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] ml-1">
            {g.date} · {g.eloWhite > 0 ? g.eloWhite : '?'}/{g.eloBlack > 0 ? g.eloBlack : '?'}
          </span>
          {g.moveSan && (
            <span className="text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] font-mono ml-1">
              {g.moveSan}
            </span>
          )}
        </button>
      ))}
      {personalGames?.map(g => (
        <button
          key={g.id}
          onClick={() => navigate('/board', { state: { gameId: g.id, targetFen: fen } })}
          className="text-left px-1 py-1 rounded text-xs hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors"
        >
          <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
            {g.white}
          </span>
          <span className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]"> vs </span>
          <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
            {g.black}
          </span>
          <ResultBadge result={g.result} />
          <span className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] ml-1">
            {g.date} · {fmtElo(g.whiteElo)}/{fmtElo(g.blackElo)} · {formatTimeControl(g.timeControl)}
          </span>
          {g.moveSan && (
            <span className="text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] font-mono ml-1">
              {g.moveSan}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

const inputClass = 'text-xs bg-[var(--color-surface-2)] dark:bg-[var(--color-dark-surface-2)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] rounded px-1 py-0.5 text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]'

interface PlayerAutocompleteProps {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

function PlayerAutocomplete({ value, onChange, disabled }: PlayerAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleInput(v: string) {
    onChange(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.length < 1) { setSuggestions([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api.getPlayerSuggestions(v)
        setSuggestions(results ?? [])
        setOpen((results ?? []).length > 0)
      } catch { /* ignore */ }
    }, 200)
  }

  return (
    <div className="relative flex-1 min-w-0">
      <input
        type="text"
        placeholder="Player…"
        value={value}
        disabled={disabled}
        onChange={e => handleInput(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={`${inputClass} w-full ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      />
      {open && !disabled && (
        <div className="absolute top-full left-0 right-0 z-50 mt-0.5 rounded border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] shadow-md overflow-hidden">
          {suggestions.map(s => (
            <button
              key={s}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(s); setOpen(false) }}
              className="w-full text-left text-xs px-2 py-1 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type PlayerSide = 'white' | 'black' | ''

interface SideSelectorProps {
  value: PlayerSide
  onChange: (v: PlayerSide) => void
  disabled?: boolean
}

function SideSelector({ value, onChange, disabled }: SideSelectorProps) {
  const btn = (val: PlayerSide, label: string, title: string) => {
    const active = value === val
    return (
      <button
        title={title}
        disabled={disabled}
        onClick={() => onChange(active ? '' : val)}
        className={`px-1.5 py-0.5 text-xs rounded transition-colors disabled:opacity-40 disabled:cursor-default ${
          active
            ? 'bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white'
            : `text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] ${disabled ? '' : 'hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]'}`
        }`}
      >
        {label}
      </button>
    )
  }
  return (
    <div
      className="flex shrink-0 border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] rounded px-0.5 gap-0.5"
      title={disabled ? 'Select a player to filter by side' : 'Filter by side played'}
    >
      {btn('white', 'W', 'As White')}
      {btn('black', 'B', 'As Black')}
    </div>
  )
}

interface PersonalFiltersProps {
  folders: Folder[]
  collections: Collection[]
  folderFilter: string
  collectionFilter: string
  playerFilter: string
  playerSide: PlayerSide
  isMyselfActive: boolean
  hasMyselfOption: boolean
  onFolderChange: (id: string) => void
  onCollectionChange: (id: string) => void
  onPlayerChange: (name: string) => void
  onPlayerSideChange: (side: PlayerSide) => void
  onMyselfToggle: () => void
}

function PersonalFilters({
  folders, collections,
  folderFilter, collectionFilter, playerFilter, playerSide,
  isMyselfActive, hasMyselfOption,
  onFolderChange, onCollectionChange, onPlayerChange, onPlayerSideChange, onMyselfToggle,
}: PersonalFiltersProps) {
  return (
    <div className="flex flex-col gap-1 px-2 py-1.5 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] shrink-0">
      {/* Row 1: folder + collection */}
      <div className="flex gap-1">
        <Select
          value={folderFilter}
          onValueChange={onFolderChange}
          size="xs"
          className="flex-1 min-w-0"
          options={[
            { value: '', label: 'All folders' },
            ...folders.map(f => ({ value: f.id, label: f.name })),
          ]}
        />
        <Select
          value={collectionFilter}
          onValueChange={onCollectionChange}
          size="xs"
          className="flex-1 min-w-0"
          options={[
            { value: '', label: 'All collections' },
            ...collections.map(c => ({ value: c.id, label: c.name })),
          ]}
        />
      </div>
      {/* Row 2: Myself + player autocomplete + side selector */}
      <div className="flex gap-1 items-center">
        <button
          onClick={onMyselfToggle}
          disabled={!hasMyselfOption && !isMyselfActive}
          title={hasMyselfOption ? 'Filter by your configured identities' : 'Configure your identity in Settings to use this filter'}
          className={`text-xs px-1.5 py-0.5 rounded border shrink-0 transition-colors ${
            isMyselfActive
              ? 'border-[var(--color-accent)] dark:border-[var(--color-dark-accent)] bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white'
              : 'border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          Myself
        </button>
        <PlayerAutocomplete
          value={isMyselfActive ? '' : playerFilter}
          onChange={onPlayerChange}
          disabled={isMyselfActive}
        />
        <SideSelector value={playerSide} onChange={onPlayerSideChange} disabled={!isMyselfActive && playerFilter === ''} />
      </div>
    </div>
  )
}


function DeviationBanner({ deviation, open, onToggle, onJump }: {
  deviation: DeviationResult
  open: boolean
  onToggle: () => void
  onJump?: () => void
}) {
  const fullMove = Math.ceil((deviation.deviationPly + 1) / 2)
  const who = deviation.playerWentOffBook ? 'You' : 'Opponent'
  const whoLower = deviation.playerWentOffBook ? 'you' : 'they'
  return (
    <div className="border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] shrink-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors cursor-pointer"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
          Deviation
        </span>
        {open
          ? <ChevronDown size={12} className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]" />
          : <ChevronLeft size={12} className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]" />
        }
      </button>
      {open && (
        <div className="px-3 pb-2">
          <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] leading-snug">
            {who} left your repertoire at move {fullMove}.
            {deviation.expectedMoves.length > 0 && deviation.playedMove && (
              <>
                {' '}Preparation expected{' '}
                <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                  {deviation.expectedMoves.join('/')}
                </span>
                {'; '}{whoLower} played{' '}
                <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                  {deviation.playedMove}
                </span>.
              </>
            )}
          </p>
          {onJump && (
            <button
              className="mt-1 text-xs text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] hover:underline cursor-pointer transition-colors"
              onClick={onJump}
            >
              Jump to deviation
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const tabBtnBase = 'flex-1 py-1.5 text-xs font-medium border-b-2 transition-colors'
const tabActive  = 'border-[var(--color-accent)] dark:border-[var(--color-dark-accent)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]'
const tabInactive = 'border-transparent text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-secondary)] dark:hover:text-[var(--color-dark-content-secondary)]'

export default function ExplorerPanelContent({ fen, orientation = 'white', excludeRepertoireId, onLoadPgn, onPlayMove, deviationResult, onJumpToDeviation }: ExplorerPanelContentProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const init = (location.state as { explorerInitialState?: ExplorerInitialState } | null)?.explorerInitialState
  const [tab, setTab] = useState<Tab>(init?.tab ?? 'master')

  const [deviationOpen, setDeviationOpen] = useState(() =>
    localStorage.getItem('masterboard.explorerDeviationOpen') !== 'false'
  )
  function toggleDeviation() {
    const next = !deviationOpen
    setDeviationOpen(next)
    localStorage.setItem('masterboard.explorerDeviationOpen', String(next))
  }

  const { values: uiSettings } = useSettings(['explorer.showCoverageIndicator'])
  const showCoverageIndicator = uiSettings['explorer.showCoverageIndicator'] !== 'false'

  // Master DB state
  const [masterGameCount, setMasterGameCount] = useState<number | null>(null)
  const [masterStats, setMasterStats] = useState<MasterMoveStat[]>([])
  const [masterGames, setMasterGames] = useState<MasterGameSummary[]>([])
  const [masterLoading, setMasterLoading] = useState(false)
  const [masterError, setMasterError] = useState('')

  // Personal state
  const [personalStats, setPersonalStats] = useState<PersonalMoveStat[]>([])
  const [personalGames, setPersonalGames] = useState<PersonalGameSummary[]>([])
  const [personalLoading, setPersonalLoading] = useState(false)
  const [personalError, setPersonalError] = useState('')

  // Repertoire tab state
  const [repertoireData, setRepertoireData] = useState<RepertoireData[]>([])
  const [repertoireLoading, setRepertoireLoading] = useState(false)
  const [repertoireError, setRepertoireError] = useState('')
  const repertoireReqId = useRef(0)

  // Coverage state (personal tab)
  const [coverageData, setCoverageData] = useState<RepertoireData[]>([])
  const coverageReqId = useRef(0)

  const [folders, setFolders] = useState<Folder[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [folderFilter, setFolderFilter] = useState('')
  const [collectionFilter, setCollectionFilter] = useState('')
  const [playerFilter, setPlayerFilter] = useState(init?.playerFilter ?? '')
  const [playerSide, setPlayerSide] = useState<PlayerSide>(init?.playerSide ?? '')
  const [isMyselfActive, setIsMyselfActive] = useState(init?.isMyselfActive ?? false)
  const [identityNames, setIdentityNames] = useState<string[]>([])

  // Sort
  const [sortCol, setSortCol] = useState<SortCol>('total')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [gameSortBy, setGameSortBy] = useState<GameSortBy>('elo')

  // Resizable split between stats and games sections
  const containerRef = useRef<HTMLDivElement>(null)
  const [splitPct, setSplitPct] = useState(55)

  // Stale-request guards
  const masterReqId = useRef(0)
  const personalReqId = useRef(0)
  const filterDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const blackToMove = fen.split(' ')[1] === 'b'

  // On mount: load folders, collections, identity names, and master DB presence.
  useEffect(() => {
    api.listFolders().then(setFolders).catch(() => {})
    api.listCollections().then(setCollections).catch(() => {})
    api.getIdentityNames().then(names => setIdentityNames(names ?? [])).catch(() => {})
    api.getMasterGameCount()
      .then(n => setMasterGameCount(n ?? 0))
      .catch(() => setMasterGameCount(-1))
  }, [])

  // Drag-to-resize handler
  function handleDragStart(e: React.MouseEvent) {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const c = container
    function onMouseMove(ev: MouseEvent) {
      const rect = c.getBoundingClientRect()
      const pct = Math.min(80, Math.max(20, ((ev.clientY - rect.top) / rect.height) * 100))
      setSplitPct(pct)
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // Build filter object from current state.
  function buildFilters(): PersonalPositionFilters {
    return {
      folderId: folderFilter,
      collectionId: collectionFilter,
      playerName: isMyselfActive ? '' : playerFilter,
      playerNames: isMyselfActive ? identityNames : [],
      playerSide,
      sortBy: gameSortBy,
    }
  }

  // Fetch master DB data when fen changes (master tab).
  useEffect(() => {
    if (tab !== 'master') return
    const id = ++masterReqId.current
    setMasterLoading(true)
    setMasterError('')
    Promise.all([
      api.getMasterPositionStats(fen),
      api.getMasterGamesAtPosition(fen, 10),
    ]).then(([stats, games]) => {
      if (masterReqId.current !== id) return
      setMasterStats(stats ?? [])
      setMasterGames(games ?? [])
    }).catch(err => {
      if (masterReqId.current !== id) return
      setMasterError(String(err?.message ?? 'Failed to load'))
    }).finally(() => {
      if (masterReqId.current === id) setMasterLoading(false)
    })
  }, [fen, tab])

  // Fetch personal data when fen or tab changes.
  const fetchPersonal = useCallback((currentFen: string, filters: PersonalPositionFilters) => {
    const id = ++personalReqId.current
    setPersonalLoading(true)
    setPersonalError('')
    Promise.all([
      api.getPersonalPositionStats(currentFen, filters),
      api.getPersonalGamesAtPosition(currentFen, 10, filters),
    ]).then(([stats, games]) => {
      if (personalReqId.current !== id) return
      setPersonalStats(stats ?? [])
      setPersonalGames(games ?? [])
    }).catch(err => {
      if (personalReqId.current !== id) return
      setPersonalError(String(err?.message ?? 'Failed to load'))
    }).finally(() => {
      if (personalReqId.current === id) setPersonalLoading(false)
    })
  }, [])

  useEffect(() => {
    if (tab !== 'personal') return
    fetchPersonal(fen, buildFilters())
  }, [fen, tab, fetchPersonal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce filter changes.
  useEffect(() => {
    if (tab !== 'personal') return
    if (filterDebounce.current) clearTimeout(filterDebounce.current)
    filterDebounce.current = setTimeout(() => {
      fetchPersonal(fen, buildFilters())
    }, 300)
    return () => { if (filterDebounce.current) clearTimeout(filterDebounce.current) }
  }, [folderFilter, collectionFilter, playerFilter, playerSide, isMyselfActive, gameSortBy, identityNames]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch coverage data for personal tab (which moves are in repertoire).
  useEffect(() => {
    if (tab !== 'personal') return
    const id = ++coverageReqId.current
    api.getAllRepertoireMoves(fen)
      .then(data => {
        if (coverageReqId.current !== id) return
        setCoverageData(data ?? [])
      })
      .catch(() => {})
  }, [fen, tab])

  const coverageSans = useMemo(() => {
    const s = new Set<string>()
    for (const rd of coverageData) {
      for (const m of rd.moves) {
        if (m.fromFen === fen) s.add(m.moveSan)
      }
    }
    return s
  }, [coverageData, fen])

  // Fetch repertoire data when fen or tab changes.
  useEffect(() => {
    if (tab !== 'repertoire') return
    const id = ++repertoireReqId.current
    setRepertoireLoading(true)
    setRepertoireError('')
    api.getAllRepertoireMoves(fen)
      .then(data => {
        if (repertoireReqId.current !== id) return
        setRepertoireData(data ?? [])
      })
      .catch(err => {
        if (repertoireReqId.current !== id) return
        setRepertoireError(String(err?.message ?? 'Failed to load'))
      })
      .finally(() => {
        if (repertoireReqId.current === id) setRepertoireLoading(false)
      })
  }, [fen, tab])

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function handleOpenMasterGame(g: MasterGameSummary) {
    api.getMasterGamePGN(g.id)
      .then(pgn => {
        if (onLoadPgn) {
          onLoadPgn(pgn, g)
        } else {
          navigate('/board', { state: { masterPgn: pgn, masterGame: g } })
        }
      })
      .catch(console.error)
  }

  function handleMyselfToggle() {
    setIsMyselfActive(prev => !prev)
    if (!isMyselfActive) setPlayerFilter('')
  }

  const masterAbsent = masterGameCount !== null && masterGameCount <= 0

  // Only show the split layout when there are games to display in the bottom section.
  const showSplit =
    (tab === 'master' && !masterAbsent && !masterLoading && !masterError && masterGames.length > 0) ||
    (tab === 'personal' && !personalLoading && !personalError && personalGames.length > 0)

  // Loading indicator (shared)
  const loadingMsg = (
    <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] text-center py-4">
      Loading…
    </p>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden text-sm" data-testid="repertoire-database">
      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
        <button className={`${tabBtnBase} ${tab === 'master' ? tabActive : tabInactive}`} onClick={() => setTab('master')}>
          Master DB
        </button>
        <button className={`${tabBtnBase} ${tab === 'personal' ? tabActive : tabInactive}`} onClick={() => setTab('personal')}>
          My Games
        </button>
        <button className={`${tabBtnBase} ${tab === 'repertoire' ? tabActive : tabInactive}`} onClick={() => setTab('repertoire')}>
          Repertoire
        </button>
      </div>

      {/* Personal filters */}
      {tab === 'personal' && (
        <PersonalFilters
          folders={folders}
          collections={collections}
          folderFilter={folderFilter}
          collectionFilter={collectionFilter}
          playerFilter={playerFilter}
          playerSide={playerSide}
          isMyselfActive={isMyselfActive}
          hasMyselfOption={identityNames.length > 0}
          onFolderChange={setFolderFilter}
          onCollectionChange={setCollectionFilter}
          onPlayerChange={setPlayerFilter}
          onPlayerSideChange={setPlayerSide}
          onMyselfToggle={handleMyselfToggle}
        />
      )}

      {/* Deviation banner — repertoire tab only, when a deviation was detected */}
      {tab === 'repertoire' && deviationResult && deviationResult.deviationPly >= 0 && (
        <DeviationBanner
          deviation={deviationResult}
          open={deviationOpen}
          onToggle={toggleDeviation}
          onJump={onJumpToDeviation}
        />
      )}

      {/* Two-section layout with drag handle */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden" ref={containerRef}>

        {/* Stats section — fills all space when no games, splits when games exist */}
        <div
          style={showSplit ? { height: `${splitPct}%` } : undefined}
          className={`min-h-0 overflow-y-auto p-2 ${showSplit ? '' : 'flex-1'}`}
        >
          {tab === 'master' && (
            <>
              {masterAbsent && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                    No master database indexed.
                  </p>
                  <button
                    onClick={() => navigate('/settings')}
                    className="text-xs text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] hover:underline"
                  >
                    Go to Settings to import one
                  </button>
                </div>
              )}
              {!masterAbsent && masterLoading && loadingMsg}
              {!masterAbsent && masterError && (
                <p className="text-xs text-red-500 dark:text-red-400 text-center py-4">{masterError}</p>
              )}
              {!masterAbsent && !masterLoading && !masterError && (
                <MoveStatsTable
                  stats={masterStats}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={handleSort}
                  onPlayMove={onPlayMove}
                />
              )}
            </>
          )}
          {tab === 'personal' && (
            <>
              {personalLoading && loadingMsg}
              {personalError && (
                <p className="text-xs text-red-500 dark:text-red-400 text-center py-4">{personalError}</p>
              )}
              {!personalLoading && !personalError && (
                <MoveStatsTable
                  stats={personalStats}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={handleSort}
                  onPlayMove={onPlayMove}
                  coverageSet={coverageSans}
                  showCoverage={showCoverageIndicator}
                />
              )}
            </>
          )}
          {tab === 'repertoire' && (
            <>
              {repertoireLoading && loadingMsg}
              {repertoireError && (
                <p className="text-xs text-red-500 dark:text-red-400 text-center py-4">{repertoireError}</p>
              )}
              {!repertoireLoading && !repertoireError && repertoireData.filter(s => s.repertoire.id !== excludeRepertoireId).length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-6">
                  <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                    This position is not in any of your repertoires.
                  </p>
                  <button
                    onClick={() => navigate('/openings')}
                    className="text-xs text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] hover:underline"
                  >
                    Go to Openings to add it
                  </button>
                </div>
              )}
              {!repertoireLoading && !repertoireError && repertoireData.filter(s => s.repertoire.id !== excludeRepertoireId).sort((a, b) => {
                  // Repertoires matching board orientation come first
                  const aMatch = a.repertoire.colour === orientation ? 0 : 1
                  const bMatch = b.repertoire.colour === orientation ? 0 : 1
                  return aMatch - bMatch
                }).map(summary => (
                <div key={summary.repertoire.id} className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`shrink-0 inline-block w-2.5 h-2.5 rounded-full border border-gray-500 dark:border-gray-400 ${
                        summary.repertoire.colour === 'white' ? 'bg-white' : 'bg-neutral-900'
                      }`} />
                      <span className="text-xs font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] truncate">
                        {summary.repertoire.name}
                      </span>
                    </div>
                    <button
                      onClick={() => navigate(`/openings/${summary.repertoire.id}`, { state: { targetFen: fen } })}
                      className="text-[10px] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] hover:underline cursor-pointer shrink-0 ml-2"
                    >
                      Open
                    </button>
                  </div>
                  {summary.moves.map(move => (
                    <div
                      key={move.id}
                      className={`flex items-start gap-1.5 px-1.5 py-1 rounded text-xs ${onPlayMove ? 'cursor-pointer hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]' : ''}`}
                      onClick={() => onPlayMove?.(move.moveSan)}
                    >
                      <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] shrink-0">
                        {move.moveSan}
                        {nagSymbol(move.nag) && (
                          <span className="ml-0.5">{nagSymbol(move.nag)}</span>
                        )}
                      </span>
                      {move.comment && (
                        <span className="text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] italic truncate">
                          {move.comment}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Drag handle + games section — only rendered when there are games */}
        {showSplit && (
          <>
            <div
              className="h-1 shrink-0 cursor-row-resize select-none bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] hover:bg-[var(--color-accent)] dark:hover:bg-[var(--color-dark-accent)] transition-colors"
              onMouseDown={handleDragStart}
            />
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-xs font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                  Games
                </h4>
                {tab === 'personal' && (
                  <div className="flex gap-0.5 text-[10px]">
                    <button
                      onClick={() => setGameSortBy('elo')}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        gameSortBy === 'elo'
                          ? 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] font-medium'
                          : 'text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-secondary)] dark:hover:text-[var(--color-dark-content-secondary)]'
                      }`}
                    >
                      Top rated
                    </button>
                    <button
                      onClick={() => setGameSortBy('date')}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        gameSortBy === 'date'
                          ? 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] font-medium'
                          : 'text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] hover:text-[var(--color-content-secondary)] dark:hover:text-[var(--color-dark-content-secondary)]'
                      }`}
                    >
                      Recent
                    </button>
                  </div>
                )}
              </div>
              {tab === 'master' && (
                <GamesList fen={fen} masterGames={masterGames} onOpenMasterGame={handleOpenMasterGame} />
              )}
              {tab === 'personal' && (
                <GamesList fen={fen} personalGames={personalGames} onOpenMasterGame={handleOpenMasterGame} />
              )}
            </div>
          </>
        )}
      </div>

    </div>
  )
}
