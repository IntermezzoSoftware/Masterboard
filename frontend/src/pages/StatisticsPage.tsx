import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { useNavigate } from 'react-router'
import { makeFen } from 'chessops/fen'
import { parseSan } from 'chessops/san'
import { btnPrimary } from '@/lib/classNames'
import { MiniBoardFen } from '@/components/MiniBoardFen'
import { chessFromFen } from '@/lib/fenUtils'
import {
  api,
  StatsFilters,
  PlayerStats,
  PlayerAnalysisStats,
  ColourResults,
  TimeControlResults,
  OpeningRow,
  PersonalMoveStat,
  AccuracyPoint,
  BlunderPosition,
  Folder,
  Collection,
  ExplorerInitialState,
  RepertoireDeviationRow,
} from '@/lib/api'


function pct(n: number, total: number) {
  if (total === 0) return 0
  return Math.round((n / total) * 100)
}

function useDarkMode() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'))
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

// Neutral WDL bar (white / draw / black) matching the Explorer panel style.
function NeutralWDLBar({ whiteWins, draws, blackWins, total }: { whiteWins: number; draws: number; blackWins: number; total: number }) {
  if (total === 0) return null
  const wPct = (whiteWins / total) * 100
  const dPct = (draws     / total) * 100
  const bPct = (blackWins / total) * 100
  type Seg = { pct: number; bg: string; fg: string; label: string }
  const segments: Seg[] = []
  if (wPct > 0) segments.push({ pct: wPct, bg: 'bg-neutral-300', fg: 'text-neutral-700', label: `White ${Math.round(wPct)}%` })
  if (dPct > 0) segments.push({ pct: dPct, bg: 'bg-neutral-500', fg: 'text-white',       label: `Draw ${Math.round(dPct)}%`  })
  if (bPct > 0) segments.push({ pct: bPct, bg: 'bg-neutral-800', fg: 'text-white',       label: `Black ${Math.round(bPct)}%` })
  return (
    <div className="flex flex-col gap-1 w-full">
      <div
        className="flex rounded overflow-hidden h-4 w-full ring-1 ring-neutral-400 dark:ring-neutral-600"
        title={segments.map(s => s.label).join(' / ')}
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
      <div className="flex gap-3 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        <span className="text-neutral-500 dark:text-neutral-400">{whiteWins} White</span>
        <span>{draws} Draw</span>
        <span className="text-neutral-700 dark:text-neutral-300">{blackWins} Black</span>
        <span className="ml-auto">{total} games</span>
      </div>
    </div>
  )
}

// WDL bar with border ring, h-4, green/grey/red colours, % labels when ≥ 15%.
function WDLBar({ wins, draws, losses, total }: ColourResults) {
  if (total === 0)
    return (
      <span className="text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] text-sm">
        No games
      </span>
    )
  const wPct = pct(wins, total)
  const dPct = pct(draws, total)
  const lPct = pct(losses, total)

  // Draws use flex:1 so the bar always fills completely regardless of rounding.
  // Wins anchor the left edge, losses anchor the right edge.
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex rounded overflow-hidden h-4 w-full ring-1 ring-stone-300 dark:ring-stone-700">
        {wPct > 0 && (
          <div
            style={{ width: `${wPct}%` }}
            className="h-full bg-emerald-500 dark:bg-emerald-600 flex items-center justify-center shrink-0"
            title={`Wins: ${wPct}%`}
          >
            {wPct >= 15 && <span className="text-white text-[9px] font-medium leading-none">{wPct}%</span>}
          </div>
        )}
        {dPct > 0 && (
          <div
            style={{ flex: 1 }}
            className="h-full bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] flex items-center justify-center"
            title={`Draws: ${dPct}%`}
          >
            {dPct >= 15 && <span className="text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] text-[9px] font-medium leading-none">{dPct}%</span>}
          </div>
        )}
        {lPct > 0 && (
          <div
            style={{ width: `${lPct}%` }}
            className="h-full bg-red-500 dark:bg-red-700 flex items-center justify-center shrink-0"
            title={`Losses: ${lPct}%`}
          >
            {lPct >= 15 && <span className="text-white text-[9px] font-medium leading-none">{lPct}%</span>}
          </div>
        )}
      </div>
      <div className="flex gap-3 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        <span className="font-medium text-emerald-500 dark:text-emerald-600">{wins}W</span>
        <span>{draws}D</span>
        <span className="text-red-500 dark:text-red-700">{losses}L</span>
        <span className="ml-auto">{total} games</span>
      </div>
    </div>
  )
}


function ColourSection({ asWhite, asBlack }: { asWhite: ColourResults; asBlack: ColourResults }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
        Results by colour
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {(['white', 'black'] as const).map(side => {
          const cr = side === 'white' ? asWhite : asBlack
          return (
            <div
              key={side}
              className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] p-4 flex flex-col gap-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className={[
                    'shrink-0 w-3 h-3 rounded-full border border-gray-500 dark:border-gray-400',
                    side === 'white' ? 'bg-white' : 'bg-neutral-900',
                  ].join(' ')}
                />
                <span className="text-sm font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                  As {side === 'white' ? 'White' : 'Black'}
                </span>
              </div>
              <WDLBar {...cr} />
            </div>
          )
        })}
      </div>
    </section>
  )
}


function TimeControlSection({ data, hasIdentity }: { data: TimeControlResults[]; hasIdentity: boolean }) {
  if (data.length === 0) return null
  const labels: Record<string, string> = {
    bullet: 'Bullet',
    blitz: 'Blitz',
    rapid: 'Rapid',
    classical: 'Classical',
    other: 'Other',
  }
  const headers = hasIdentity
    ? ['Format', 'Games', 'Win %', 'Draw %', 'Loss %']
    : ['Format', 'Games', 'White %', 'Draw %', 'Black %']
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
        Results by time control
      </h2>
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
              {headers.map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-2 font-medium text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] ${i === 0 ? 'text-left' : 'text-right'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(tc => (
              <tr
                key={tc.category}
                className="border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] last:border-0 hover:bg-[var(--color-surface-1)] dark:hover:bg-[var(--color-dark-surface-1)]"
              >
                <td className="px-4 py-2.5 font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                  {labels[tc.category] ?? tc.category}
                </td>
                <td className="px-4 py-2.5 text-right text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                  {tc.results.total}
                </td>
                <td className={`px-4 py-2.5 text-right font-medium ${hasIdentity ? 'text-emerald-500 dark:text-emerald-600' : 'text-neutral-500 dark:text-neutral-400'}`}>
                  {pct(tc.results.wins, tc.results.total)}%
                </td>
                <td className="px-4 py-2.5 text-right text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                  {pct(tc.results.draws, tc.results.total)}%
                </td>
                <td className={`px-4 py-2.5 text-right ${hasIdentity ? 'text-red-500 dark:text-red-700' : 'text-neutral-700 dark:text-neutral-300'}`}>
                  {pct(tc.results.losses, tc.results.total)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}


const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const MOVE_TREE_MIN_GAMES = 3
const MOVE_TREE_MAX_DEPTH = 16

/** Apply a SAN move to a FEN and return the resulting FEN, or null on failure. */
function applyMoveFen(fen: string, san: string): string | null {
  try {
    const chess = chessFromFen(fen)
    const move = parseSan(chess, san)
    if (!move) return null
    chess.play(move)
    return makeFen(chess.toSetup())
  } catch {
    return null
  }
}

function OpeningMoveTree({
  onLoad,
  onNavigate,
  side,
  hasIdentity,
  cacheKey,
}: {
  onLoad: (fen: string, playerSide: string) => Promise<PersonalMoveStat[]>
  onNavigate: (fen: string, pgn: string) => void
  side: 'white' | 'black'
  hasIdentity: boolean
  cacheKey: string
}) {
  const [cache, setCache] = useState<Map<string, PersonalMoveStat[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedOther, setExpandedOther] = useState<Set<string>>(new Set())
  const [loadingFens, setLoadingFens] = useState<Set<string>>(new Set())

  // Reset when filters or side change
  useEffect(() => {
    setCache(new Map())
    setExpanded(new Set())
    setExpandedOther(new Set())
    setLoadingFens(new Set())
  }, [cacheKey])

  const loadFen = useCallback((fen: string, playerSide: string) => {
    setLoadingFens(prev => {
      if (prev.has(fen)) return prev
      const next = new Set(prev)
      next.add(fen)
      return next
    })
    onLoad(fen, playerSide)
      .then(stats => setCache(prev => new Map(prev).set(fen, stats ?? [])))
      .catch(() => setCache(prev => new Map(prev).set(fen, [])))
      .finally(() => setLoadingFens(prev => { const s = new Set(prev); s.delete(fen); return s }))
  }, [onLoad])

  // Load root on mount and after cacheKey/side change
  useEffect(() => {
    const playerSide = hasIdentity ? side : ''
    loadFen(STARTING_FEN, playerSide)
  }, [cacheKey, side, hasIdentity, loadFen])

  function toggleExpand(nodeKey: string, childFen: string, playerSide: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(nodeKey)) {
        next.delete(nodeKey)
      } else {
        next.add(nodeKey)
        if (!cache.has(childFen) && !loadingFens.has(childFen)) {
          loadFen(childFen, playerSide)
        }
      }
      return next
    })
  }

  function renderNode(stat: PersonalMoveStat, parentFen: string, depth: number, playerSide: string, pgnSoFar: string): React.ReactNode {
    const childFen = applyMoveFen(parentFen, stat.moveSan) ?? ''
    const nodeKey = `${parentFen}:${stat.moveSan}`
    const isExpanded = expanded.has(nodeKey)
    const isLoadingChild = loadingFens.has(childFen)
    const canExpand = depth < MOVE_TREE_MAX_DEPTH && stat.total >= MOVE_TREE_MIN_GAMES
    const moveNum = Math.ceil(depth / 2)
    const movePart = depth % 2 === 1 ? `${moveNum}. ${stat.moveSan}` : stat.moveSan
    const childPgn = pgnSoFar ? `${pgnSoFar} ${movePart}` : movePart
    const wins   = hasIdentity ? (side === 'white' ? stat.whiteWins : stat.blackWins)  : stat.whiteWins
    const losses  = hasIdentity ? (side === 'white' ? stat.blackWins  : stat.whiteWins) : stat.blackWins
    const wPct = stat.total > 0 ? Math.round((wins   / stat.total) * 100) : 0
    const dPct = stat.total > 0 ? Math.round((stat.draws / stat.total) * 100) : 0
    const lPct = stat.total > 0 ? Math.round((losses  / stat.total) * 100) : 0
    return (
      <div key={nodeKey}>
        <div
          className="flex items-center gap-2 py-1.5 pr-2 rounded hover:bg-[var(--color-surface-1)] dark:hover:bg-[var(--color-dark-surface-1)] cursor-pointer group"
          onClick={() => childFen && onNavigate(childFen, childPgn)}
        >
          <div
            className="self-stretch -my-1.5 flex items-center shrink-0 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]"
            style={{ paddingLeft: `${8 + (depth - 1) * 20}px` }}
            onClick={e => { e.stopPropagation(); if (canExpand && childFen) toggleExpand(nodeKey, childFen, playerSide) }}
            role={canExpand ? 'button' : undefined}
            aria-label={canExpand ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
          >
            <div className="w-5 flex items-center justify-center">
              {canExpand ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
            </div>
          </div>
          <span className="font-mono text-sm w-12 shrink-0 text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
            {stat.moveSan}
          </span>
          <span className="text-xs w-20 shrink-0 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            {stat.total} games
          </span>
          <div className={`flex rounded overflow-hidden h-4 flex-1 ring-1 ${hasIdentity ? 'ring-stone-300 dark:ring-stone-700' : 'ring-neutral-400 dark:ring-neutral-600'}`}>
            {wPct > 0 && (
              <div style={{ width: `${wPct}%` }} className={`h-full shrink-0 flex items-center justify-center ${hasIdentity ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-neutral-300'}`} title={hasIdentity ? `Wins: ${wPct}%` : `White: ${wPct}%`}>
                {wPct >= 15 && <span className={`text-[9px] font-medium leading-none ${hasIdentity ? 'text-white' : 'text-neutral-700'}`}>{wPct}%</span>}
              </div>
            )}
            {dPct > 0 && (
              <div style={{ flex: 1 }} className={`h-full flex items-center justify-center ${hasIdentity ? 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]' : 'bg-neutral-500'}`} title={`Draws: ${dPct}%`}>
                {dPct >= 15 && <span className={`text-[9px] font-medium leading-none ${hasIdentity ? 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]' : 'text-white'}`}>{dPct}%</span>}
              </div>
            )}
            {lPct > 0 && (
              <div style={{ width: `${lPct}%` }} className={`h-full shrink-0 flex items-center justify-center ${hasIdentity ? 'bg-red-500 dark:bg-red-700' : 'bg-neutral-800'}`} title={hasIdentity ? `Losses: ${lPct}%` : `Black: ${lPct}%`}>
                {lPct >= 15 && <span className="text-[9px] font-medium leading-none text-white">{lPct}%</span>}
              </div>
            )}
          </div>
        </div>
        {isExpanded && isLoadingChild && (
          <div style={{ paddingLeft: `${8 + depth * 20}px` }} className="py-1 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            Loading…
          </div>
        )}
        {isExpanded && !isLoadingChild && renderNodes(childFen, depth + 1, childPgn)}
      </div>
    )
  }

  function renderNodes(parentFen: string, depth: number, pgnSoFar: string): React.ReactNode {
    const moves = cache.get(parentFen)
    if (!moves || moves.length === 0) return null
    const visible = moves.filter(m => m.total >= MOVE_TREE_MIN_GAMES)
    if (visible.length === 0) return null
    const hidden = moves.filter(m => m.total < MOVE_TREE_MIN_GAMES)
    const hiddenGames = hidden.reduce((s, m) => s + m.total, 0)
    const playerSide = hasIdentity ? side : ''
    const otherKey = `${parentFen}:other`
    const otherOpen = expandedOther.has(parentFen)
    return (
      <>
        {visible.map(stat => renderNode(stat, parentFen, depth, playerSide, pgnSoFar))}
        {hiddenGames > 0 && (
          <div key={otherKey}>
            {!otherOpen && (
              <button
                className="text-sm text-[var(--color-accent)] hover:underline cursor-pointer"
                style={{ paddingLeft: `${8 + (depth - 1) * 20}px`, display: 'block', paddingTop: '6px', paddingBottom: '6px' }}
                onClick={() => setExpandedOther(prev => new Set(prev).add(parentFen))}
              >
                {`Show ${hiddenGames} more ${hiddenGames === 1 ? 'game' : 'games'} in rare lines`}
              </button>
            )}
            {otherOpen && hidden.map(stat => renderNode(stat, parentFen, depth, playerSide, pgnSoFar))}
            {otherOpen && (
              <button
                className="text-sm text-[var(--color-accent)] hover:underline cursor-pointer"
                style={{ paddingLeft: `${8 + (depth - 1) * 20}px`, display: 'block', paddingTop: '6px', paddingBottom: '6px' }}
                onClick={() => setExpandedOther(prev => { const next = new Set(prev); next.delete(parentFen); return next })}
              >
                Show less
              </button>
            )}
          </div>
        )}
      </>
    )
  }

  const rootLoading = loadingFens.has(STARTING_FEN)
  const rootMoves = cache.get(STARTING_FEN)

  if (rootLoading) {
    return (
      <div className="py-6 text-center text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        Loading…
      </div>
    )
  }
  if (!rootMoves || rootMoves.filter(m => m.total >= MOVE_TREE_MIN_GAMES).length === 0) {
    return (
      <div className="py-6 text-center text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        No games found.
      </div>
    )
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] overflow-hidden py-1">
      {renderNodes(STARTING_FEN, 1, '')}
    </div>
  )
}


type OpeningSort = 'games' | 'win' | 'loss'
type OpeningSide = 'white' | 'black'
type OpeningMode = 'eco' | 'variation' | 'tree'

function OpeningSection({
  data, hasIdentity, variationRows, onOpeningClick, onEcoClick, onEcoNavigate,
  onLoadMoveTree, onFenNavigate, moveTreeCacheKey,
}: {
  data: OpeningRow[]
  hasIdentity: boolean
  variationRows: OpeningRow[] | null
  onOpeningClick: (row: OpeningRow, side: 'white' | 'black') => void
  onEcoClick: (eco: string) => void
  onEcoNavigate: (eco: string, side: 'white' | 'black') => void
  onLoadMoveTree: (fen: string, playerSide: string) => Promise<PersonalMoveStat[]>
  onFenNavigate: (fen: string, pgn: string) => void
  moveTreeCacheKey: string
}) {
  const [sort, setSort] = useState<OpeningSort>('games')
  const [side, setSide] = useState<OpeningSide>('white')
  const [showAll, setShowAll] = useState(false)
  const [mode, setMode] = useState<OpeningMode>('eco')
  const [ecoFilter, setEcoFilter] = useState('')
  const [pinnedEco, setPinnedEco] = useState<OpeningRow | null>(null)

  function computeRow(row: OpeningRow) {
    const games = hasIdentity ? (side === 'white' ? row.asWhite : row.asBlack) : row.games
    const wins = hasIdentity ? (side === 'white' ? row.whiteWins : row.blackWins) : row.whiteWins
    const draws = hasIdentity ? (side === 'white' ? row.whiteDraws : row.blackDraws) : row.whiteDraws
    const losses = Math.max(0, games - wins - draws)
    const winPct = games > 0 ? (wins / games) * 100 : 0
    const lossPct = games > 0 ? (losses / games) * 100 : 0
    return { row, games, wins, draws, losses, winPct, lossPct }
  }

  const activeData = mode === 'variation' && variationRows
    ? (ecoFilter ? variationRows.filter(r => r.eco.startsWith(ecoFilter)) : variationRows)
    : data

  const sourceData = hasIdentity
    ? activeData.filter(row => (side === 'white' ? row.asWhite > 0 : row.asBlack > 0))
    : activeData

  const withStats = sourceData.map(computeRow)

  const sorted = [...withStats].sort((a, b) => {
    if (sort === 'games') return b.games - a.games
    if (sort === 'win') return b.winPct - a.winPct
    return b.lossPct - a.lossPct
  })
  const visible = showAll ? sorted : sorted.slice(0, 15)

  const pinnedComputed = pinnedEco ? computeRow(pinnedEco) : null

  if (data.length === 0) return null

  function handleRowClick(row: OpeningRow) {
    if (mode === 'eco') {
      // Drill down: switch to variation mode with this ECO pinned
      setPinnedEco(row)
      setEcoFilter(row.eco)
      setMode('variation')
      setShowAll(false)
      onEcoClick(row.eco)
    } else {
      onOpeningClick(row, side)
    }
  }

  function handlePinnedClick() {
    setPinnedEco(null)
    setEcoFilter('')
    setMode('eco')
    setShowAll(false)
  }

  function handleEcoFilterChange(value: string) {
    setEcoFilter(value)
    setShowAll(false)
    if (!value) setPinnedEco(null)
  }

  function handleModeChange(m: OpeningMode) {
    setMode(m)
    setShowAll(false)
    if (m === 'eco') {
      setEcoFilter('')
      setPinnedEco(null)
    } else if (m === 'variation') {
      onEcoClick('')
    }
    // tree mode: OpeningMoveTree self-manages its data
  }

  const SortBtn = ({ s, label }: { s: OpeningSort; label: string }) => (
    <button
      onClick={() => setSort(s)}
      className={[
        'text-xs px-2 py-0.5 rounded cursor-pointer',
        sort === s
          ? 'bg-[var(--color-accent)] text-white'
          : 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
      ].join(' ')}
    >
      {label}
    </button>
  )

  const SideTab = ({ s, label }: { s: OpeningSide; label: string }) => (
    <button
      onClick={() => { setSide(s); setShowAll(false) }}
      className={[
        'text-xs px-3 py-1 rounded cursor-pointer border',
        side === s
          ? 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] font-medium'
          : 'border-transparent text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
      ].join(' ')}
    >
      {label}
    </button>
  )

  const ModeTab = ({ m, label }: { m: OpeningMode; label: string }) => (
    <button
      onClick={() => handleModeChange(m)}
      className={[
        'text-xs px-2.5 py-1 rounded cursor-pointer border',
        mode === m
          ? 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] font-medium'
          : 'border-transparent text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
      ].join(' ')}
    >
      {label}
    </button>
  )

  const colHeaders = hasIdentity
    ? ['ECO', 'Opening', 'Games', 'Win %', 'Draw %', 'Loss %', 'Result']
    : ['ECO', 'Opening', 'Games', 'White %', 'Draw %', 'Black %', 'Result']

  const sortButtons = (
    <div className="flex gap-1">
      <SortBtn s="games" label="Most played" />
      <SortBtn s="win" label={hasIdentity ? 'Best results' : 'Most white wins'} />
      <SortBtn s="loss" label={hasIdentity ? 'Worst results' : 'Most black wins'} />
    </div>
  )

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
        Opening performance
      </h2>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <ModeTab m="eco" label="ECO" />
            <ModeTab m="variation" label="Variations" />
            <ModeTab m="tree" label="Move tree" />
          </div>
          {hasIdentity && (
            <>
              <div className="w-px h-4 bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]" />
              <div className="flex gap-1">
                <SideTab s="white" label="As White" />
                <SideTab s="black" label="As Black" />
              </div>
            </>
          )}
        </div>
        {mode === 'eco' && sortButtons}
      </div>
      {mode === 'variation' && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter by ECO..."
              value={ecoFilter}
              onChange={e => handleEcoFilterChange(e.target.value.toUpperCase())}
              className="text-xs px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-transparent text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] placeholder:text-[var(--color-content-secondary)] dark:placeholder:text-[var(--color-dark-content-secondary)] focus:outline-none focus:border-[var(--color-accent)] w-32"
            />
            {ecoFilter && (
              <button
                onClick={() => handleEcoFilterChange('')}
                className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          {sortButtons}
        </div>
      )}
      {mode === 'tree' && (
        <OpeningMoveTree
          onLoad={onLoadMoveTree}
          onNavigate={onFenNavigate}
          side={side}
          hasIdentity={hasIdentity}
          cacheKey={moveTreeCacheKey + ':' + side}
        />
      )}
      {mode !== 'tree' && <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
              {colHeaders.map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-2 font-medium whitespace-nowrap text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] ${i <= 1 ? 'text-left' : 'text-right'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pinnedComputed && mode === 'variation' && (() => {
              const { row, games, wins, draws, winPct, lossPct } = pinnedComputed
              const wPct = Math.round(winPct)
              const dPct = pct(draws, games)
              const lPct = Math.round(lossPct)
              return (
                <tr
                  key={`pinned-${row.eco}`}
                  className="border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] cursor-pointer font-semibold"
                  onClick={handlePinnedClick}
                >
                  <td
                    className="px-4 py-2.5 font-mono text-xs font-medium text-[var(--color-accent)] hover:underline"
                    onClick={e => { e.stopPropagation(); onEcoNavigate(row.eco, side) }}
                  >
                    {row.eco}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] max-w-81 truncate" title={row.opening}>
                    {row.opening}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">{games}</td>
                  <td className={`px-4 py-2.5 text-right font-medium ${hasIdentity ? 'text-emerald-500 dark:text-emerald-600' : 'text-neutral-500 dark:text-neutral-400'}`}>{wPct}%</td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">{dPct}%</td>
                  <td className={`px-4 py-2.5 text-right ${hasIdentity ? 'text-red-500 dark:text-red-700' : 'text-neutral-700 dark:text-neutral-300'}`}>{lPct}%</td>
                  <td className="px-4 py-2.5">
                    <div className={`flex rounded overflow-hidden h-4 w-24 ml-auto ring-1 ${hasIdentity ? 'ring-stone-300 dark:ring-stone-700' : 'ring-neutral-400 dark:ring-neutral-600'}`}>
                      {wPct > 0 && <div style={{ width: `${wPct}%` }} className={`h-full shrink-0 ${hasIdentity ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-neutral-300'}`} title={hasIdentity ? `Wins: ${wPct}%` : `White: ${wPct}%`} />}
                      {dPct > 0 && <div style={{ flex: 1 }} className={`h-full ${hasIdentity ? 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]' : 'bg-neutral-500'}`} title={`Draws: ${dPct}%`} />}
                      {lPct > 0 && <div style={{ width: `${lPct}%` }} className={`h-full shrink-0 ${hasIdentity ? 'bg-red-500 dark:bg-red-700' : 'bg-neutral-800'}`} title={hasIdentity ? `Losses: ${lPct}%` : `Black: ${lPct}%`} />}
                    </div>
                  </td>
                </tr>
              )
            })()}
            {visible.map(({ row, games, wins, draws, losses, winPct, lossPct }) => {
              const wPct = Math.round(winPct)
              const dPct = pct(draws, games)
              const lPct = Math.round(lossPct)
              return (
                <tr
                  key={`${row.eco}-${row.opening}-${hasIdentity ? side : 'all'}`}
                  className="border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] last:border-0 hover:bg-[var(--color-surface-1)] dark:hover:bg-[var(--color-dark-surface-1)] cursor-pointer"
                  onClick={() => handleRowClick(row)}
                >
                  <td
                    className="px-4 py-2.5 font-mono text-xs font-medium text-[var(--color-accent)] hover:underline"
                    onClick={e => { e.stopPropagation(); onEcoNavigate(row.eco, side) }}
                  >
                    {row.eco}
                  </td>
                  <td
                    className="px-4 py-2.5 text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] max-w-81 truncate"
                    title={row.opening}
                  >
                    {row.opening}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                    {games}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-medium ${hasIdentity ? 'text-emerald-500 dark:text-emerald-600' : 'text-neutral-500 dark:text-neutral-400'}`}>
                    {wPct}%
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                    {dPct}%
                  </td>
                  <td className={`px-4 py-2.5 text-right ${hasIdentity ? 'text-red-500 dark:text-red-700' : 'text-neutral-700 dark:text-neutral-300'}`}>
                    {lPct}%
                  </td>
                  <td className="px-4 py-2.5">
                    <div className={`flex rounded overflow-hidden h-4 w-24 ml-auto ring-1 ${hasIdentity ? 'ring-stone-300 dark:ring-stone-700' : 'ring-neutral-400 dark:ring-neutral-600'}`}>
                      {wPct > 0 && (
                        <div
                          style={{ width: `${wPct}%` }}
                          className={`h-full shrink-0 ${hasIdentity ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-neutral-300'}`}
                          title={hasIdentity ? `Wins: ${wPct}%` : `White: ${wPct}%`}
                        />
                      )}
                      {dPct > 0 && (
                        <div
                          style={{ flex: 1 }}
                          className={`h-full ${hasIdentity ? 'bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]' : 'bg-neutral-500'}`}
                          title={`Draws: ${dPct}%`}
                        />
                      )}
                      {lPct > 0 && (
                        <div
                          style={{ width: `${lPct}%` }}
                          className={`h-full shrink-0 ${hasIdentity ? 'bg-red-500 dark:bg-red-700' : 'bg-neutral-800'}`}
                          title={hasIdentity ? `Losses: ${lPct}%` : `Black: ${lPct}%`}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-4 text-center text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]"
                >
                  {hasIdentity ? `No openings played as ${side === 'white' ? 'White' : 'Black'}.` : 'No openings found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>}
      {mode !== 'tree' && sourceData.length > 15 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="text-sm text-[var(--color-accent)] hover:underline cursor-pointer self-start"
        >
          {showAll ? 'Show less' : `Show all ${sourceData.length} openings`}
        </button>
      )}
    </section>
  )
}


interface CheckNode {
  id: string
  name: string
  children: CheckNode[]
}

function buildCheckTree(flat: Folder[]): CheckNode[] {
  const map = new Map<string, CheckNode>()
  const roots: CheckNode[] = []
  for (const f of flat) map.set(f.id, { id: f.id, name: f.name, children: [] })
  for (const f of flat) {
    const node = map.get(f.id)!
    if (f.parentId && map.has(f.parentId)) {
      map.get(f.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function getDescendantIds(parentId: string, flat: Folder[]): string[] {
  const result: string[] = []
  const queue = [parentId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const f of flat) {
      if (f.parentId === current) {
        result.push(f.id)
        queue.push(f.id)
      }
    }
  }
  return result
}

function FolderTreeNode({
  node, flat, excluded, onToggle,
}: {
  node: CheckNode
  flat: Folder[]
  excluded: Set<string>
  onToggle: (id: string, descendants: string[]) => void
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  const isExcluded = excluded.has(node.id)

  return (
    <div>
      <div
        className={[
          'flex items-center gap-1 px-2 py-1 cursor-pointer select-none rounded-[var(--radius-sm)]',
          isExcluded
            ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]'
            : 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
        ].join(' ')}
        onClick={() => onToggle(node.id, getDescendantIds(node.id, flat))}
      >
        <button
          className="shrink-0 w-3 flex items-center justify-center"
          onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
          tabIndex={-1}
        >
          {hasChildren && (
            <ChevronRight
              size={10}
              className={open ? 'rotate-90 transition-transform' : 'transition-transform'}
            />
          )}
        </button>
        <span className="text-xs truncate">{node.name}</span>
      </div>
      {hasChildren && open && (
        <div className="ml-3">
          {node.children.map(child => (
            <FolderTreeNode
              key={child.id}
              node={child}
              flat={flat}
              excluded={excluded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const filterBtnBase =
  'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-[var(--radius-sm)] border cursor-pointer transition-colors'
const filterBtnIdle =
  'border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] ' +
  'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] ' +
  'hover:border-[var(--color-accent)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]'
const filterBtnActive =
  'border-[var(--color-accent)] dark:border-[var(--color-dark-accent)] ' +
  'text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]'

const popoverContent =
  'z-30 rounded-[var(--radius-sm)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] ' +
  'bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] shadow-lg'

function FolderDropdown({
  folders,
  excluded,
  onToggle,
}: {
  folders: Folder[]
  excluded: Set<string>
  onToggle: (id: string, descendants: string[]) => void
}) {
  const tree = useMemo(() => buildCheckTree(folders), [folders])
  const count = excluded.size

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={`${filterBtnBase} ${count > 0 ? filterBtnActive : filterBtnIdle}`}>
          Folders
          {count > 0 && (
            <span className="bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white rounded-full text-[10px] px-1.5 leading-4">
              {count}
            </span>
          )}
          <ChevronDown size={10} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={`${popoverContent} w-56 max-h-72 overflow-y-auto py-1`}
        >
          {tree.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
              No folders
            </p>
          ) : (
            tree.map(node => (
              <FolderTreeNode
                key={node.id}
                node={node}
                flat={folders}
                excluded={excluded}
                onToggle={onToggle}
              />
            ))
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function CollectionDropdown({
  collections,
  excluded,
  onToggle,
}: {
  collections: Collection[]
  excluded: Set<string>
  onToggle: (id: string) => void
}) {
  const count = excluded.size

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={`${filterBtnBase} ${count > 0 ? filterBtnActive : filterBtnIdle}`}>
          Collections
          {count > 0 && (
            <span className="bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white rounded-full text-[10px] px-1.5 leading-4">
              {count}
            </span>
          )}
          <ChevronDown size={10} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={`${popoverContent} w-48 max-h-64 overflow-y-auto py-1`}
        >
          {collections.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
              No collections
            </p>
          ) : (
            collections.map(c => (
              <div
                key={c.id}
                onClick={() => onToggle(c.id)}
                className={[
                  'px-3 py-1 text-xs cursor-pointer select-none truncate rounded-[var(--radius-sm)]',
                  excluded.has(c.id)
                    ? 'bg-[var(--color-accent-subtle)] dark:bg-[var(--color-dark-accent-subtle)] text-[var(--color-accent)] dark:text-[var(--color-dark-accent)]'
                    : 'text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]',
                ].join(' ')}
              >
                {c.name}
              </div>
            ))
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}


function FilterBar({ onChange }: { onChange: (f: StatsFilters) => void }) {
  const navigate = useNavigate()
  const [identityNames, setIdentityNames] = useState<string[]>([])
  const [useIdentity, setUseIdentity] = useState(true)
  const [folders, setFolders] = useState<Folder[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [excludeFolderIds, setExcludeFolderIds] = useState<Set<string>>(new Set())
  const [excludeCollectionIds, setExcludeCollectionIds] = useState<Set<string>>(new Set())
  // Snapshot of the last-applied selections — stored as state so derived
  // dirty computation re-evaluates whenever either side changes.
  const [committed, setCommitted] = useState({
    useIdentity: true,
    excludeFolderIds: new Set<string>(),
    excludeCollectionIds: new Set<string>(),
  })
  // Prevent showing Update/Cancel before the initial data load completes.
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      api.getIdentityNames().catch(() => [] as string[]),
      api.listFolders().catch(() => [] as Folder[]),
      api.listCollections().catch(() => [] as Collection[]),
    ]).then(([names, fs, cs]) => {
      const resolvedNames = names ?? []
      setIdentityNames(resolvedNames)
      setFolders(fs ?? [])
      setCollections(cs ?? [])
      onChange({ playerNames: resolvedNames.length > 0 ? resolvedNames : [] })
      setLoaded(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false
    for (const v of a) if (!b.has(v)) return false
    return true
  }

  const dirty = loaded && (
    useIdentity !== committed.useIdentity ||
    !setsEqual(excludeFolderIds, committed.excludeFolderIds) ||
    !setsEqual(excludeCollectionIds, committed.excludeCollectionIds)
  )

  function toggleFolder(id: string, descendants: string[]) {
    setExcludeFolderIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        for (const d of descendants) next.delete(d)
      } else {
        next.add(id)
        for (const d of descendants) next.add(d)
      }
      return next
    })
  }

  function toggleCollection(id: string) {
    setExcludeCollectionIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function handleUpdate() {
    const snap = {
      useIdentity,
      excludeFolderIds: new Set(excludeFolderIds),
      excludeCollectionIds: new Set(excludeCollectionIds),
    }
    setCommitted(snap)
    onChange({
      playerNames: useIdentity && identityNames.length > 0 ? identityNames : [],
      excludeFolderIds: excludeFolderIds.size > 0 ? [...excludeFolderIds] : undefined,
      excludeCollectionIds: excludeCollectionIds.size > 0 ? [...excludeCollectionIds] : undefined,
    })
  }

  function handleCancel() {
    setUseIdentity(committed.useIdentity)
    setExcludeFolderIds(new Set(committed.excludeFolderIds))
    setExcludeCollectionIds(new Set(committed.excludeCollectionIds))
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {identityNames.length === 0 ? (
        <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          No identity configured —{' '}
          <button
            onClick={() => navigate('/settings')}
            className="text-[var(--color-accent)] dark:text-[var(--color-dark-accent)] hover:underline cursor-pointer"
          >
            set up identity
          </button>
        </span>
      ) : (
        <button
          onClick={() => setUseIdentity(v => !v)}
          className={`text-xs px-2.5 py-1 rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
            useIdentity
              ? 'border-[var(--color-accent)] dark:border-[var(--color-dark-accent)] bg-[var(--color-accent)] dark:bg-[var(--color-dark-accent)] text-white'
              : 'border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)]'
          }`}
        >
          My games only
        </button>
      )}

      {folders.length > 0 && (
        <FolderDropdown
          folders={folders}
          excluded={excludeFolderIds}
          onToggle={toggleFolder}
        />
      )}

      {collections.length > 0 && (
        <CollectionDropdown
          collections={collections}
          excluded={excludeCollectionIds}
          onToggle={toggleCollection}
        />
      )}

      <div className={`ml-auto flex items-center gap-2 ${dirty ? '' : 'invisible pointer-events-none'}`}>
        <button onClick={handleUpdate} className={btnPrimary}>
          Update
        </button>
        <button
          onClick={handleCancel}
          className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}


function rollingAvg(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

type TimeRange = '1M' | '3M' | '6M' | '1Y' | 'All'
const TIME_RANGES: TimeRange[] = ['1M', '3M', '6M', '1Y', 'All']

function xTicks(minTs: number, maxTs: number): { ts: number; label: string }[] {
  const spanDays = (maxTs - minTs) / 86400000
  const ticks: { ts: number; label: string }[] = []

  if (spanDays <= 50) {
    // Weekly ticks
    const d = new Date(minTs)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)) // next Monday
    while (d.getTime() <= maxTs) {
      ticks.push({ ts: d.getTime(), label: `${d.getMonth() + 1}/${d.getDate()}` })
      d.setDate(d.getDate() + 7)
    }
  } else if (spanDays <= 400) {
    // Monthly ticks
    const d = new Date(minTs)
    d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + 1)
    while (d.getTime() <= maxTs) {
      const label = d.toLocaleString('default', { month: 'short', year: '2-digit' })
      ticks.push({ ts: d.getTime(), label })
      d.setMonth(d.getMonth() + 1)
    }
  } else if (spanDays <= 900) {
    // Quarterly ticks
    const d = new Date(minTs)
    d.setDate(1); d.setHours(0, 0, 0, 0)
    d.setMonth(Math.ceil((d.getMonth() + 1) / 3) * 3)
    while (d.getTime() <= maxTs) {
      const label = d.toLocaleString('default', { month: 'short', year: '2-digit' })
      ticks.push({ ts: d.getTime(), label })
      d.setMonth(d.getMonth() + 3)
    }
  } else {
    // Yearly ticks
    const startY = new Date(minTs).getFullYear() + 1
    const endY = new Date(maxTs).getFullYear()
    for (let y = startY; y <= endY; y++) {
      ticks.push({ ts: new Date(y, 0, 1).getTime(), label: String(y) })
    }
  }
  return ticks
}

const TC_ORDER = ['bullet', 'blitz', 'rapid', 'classical', 'other']
const TC_LABEL: Record<string, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', other: 'Other' }

function AccuracyTrendChart({ points }: { points: AccuracyPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [range, setRange] = useState<TimeRange>('All')
  const [tc, setTc] = useState<string>('All')
  const dark = useDarkMode()

  // Only show TC options that exist in the data.
  const availableTcs = ['All', ...TC_ORDER.filter(cat => points.some(p => p.timeControl === cat))]

  // Exact eval graph palette
  const WHITE_LINE = dark ? '#909090' : '#ffffff'
  const BLACK_LINE = dark ? '#000000' : '#505050'

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w > 0) setWidth(w)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Filter to selected range
  const now = Date.now()
  const cutoffMs: Record<TimeRange, number> = {
    '1M': now - 30 * 86400000,
    '3M': now - 91 * 86400000,
    '6M': now - 182 * 86400000,
    '1Y': now - 365 * 86400000,
    'All': 0,
  }
  const byRange = points.filter(p => new Date(p.date).getTime() >= cutoffMs[range])
  const rangePoints = byRange.length >= 2 ? byRange : points
  const filtered = tc === 'All' ? rangePoints : rangePoints.filter(p => p.timeControl === tc)
  const visiblePoints = filtered.length >= 2 ? filtered : rangePoints

  if (visiblePoints.length < 2) {
    return (
      <div className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        Not enough analysed games for accuracy trend.
      </div>
    )
  }

  const timestamps = visiblePoints.map(p => new Date(p.date).getTime())
  const minTs = Math.min(...timestamps)
  const maxTs = Math.max(...timestamps)

  const height = 160
  const pad = { top: 10, right: 10, bottom: 28, left: 32 }
  const chartW = width - pad.left - pad.right
  const chartH = height - pad.top - pad.bottom

  function tsToX(ts: number) {
    if (maxTs === minTs) return pad.left + chartW / 2
    return pad.left + ((ts - minTs) / (maxTs - minTs)) * chartW
  }

  function toPolyline(pts: AccuracyPoint[]) {
    if (pts.length < 2) return ''
    const values = rollingAvg(pts.map(p => p.playerAcc), 5)
    return values.map((acc, i) => {
      const x = tsToX(new Date(pts[i].date).getTime())
      const y = pad.top + (1 - acc / 100) * chartH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }

  const whitePoints = visiblePoints.filter(p => p.playerSide === 'white')
  const blackPoints = visiblePoints.filter(p => p.playerSide === 'black')
  const axisTicks = xTicks(minTs, maxTs)
  const yLabels = [100, 50, 0]

  return (
    <div className="flex flex-col gap-2">
      {/* Selectors row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* Time control filter */}
        <div className="flex gap-1">
          {availableTcs.map(cat => (
            <button
              key={cat}
              onClick={() => setTc(cat)}
              className={[
                'text-xs px-2 py-0.5 rounded cursor-pointer',
                tc === cat
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-3)] dark:hover:bg-[var(--color-dark-surface-3)]',
              ].join(' ')}
            >
              {cat === 'All' ? 'All' : TC_LABEL[cat]}
            </button>
          ))}
        </div>
        {/* Time range selector */}
        <div className="flex gap-1">
          {TIME_RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                'text-xs px-2 py-0.5 rounded cursor-pointer',
                range === r
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-3)] dark:hover:bg-[var(--color-dark-surface-3)]',
              ].join(' ')}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="w-full text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
        <svg width={width} height={height} className="overflow-visible">
          {/* Y grid lines + labels */}
          {yLabels.map(v => {
            const y = pad.top + (1 - v / 100) * chartH
            return (
              <g key={v}>
                <line x1={pad.left} x2={pad.left + chartW} y1={y} y2={y}
                  stroke="currentColor" strokeWidth={1} opacity={0.2} />
                <text x={pad.left - 4} y={y + 4} textAnchor="end" fontSize={9}
                  fill="currentColor" opacity={0.5}>{v}</text>
              </g>
            )
          })}
          {/* X axis ticks */}
          {axisTicks.map(({ ts, label }) => {
            const x = tsToX(ts)
            if (x < pad.left || x > pad.left + chartW) return null
            return (
              <g key={ts}>
                <line x1={x} x2={x} y1={pad.top + chartH} y2={pad.top + chartH + 4}
                  stroke="currentColor" strokeWidth={1} opacity={0.3} />
                <text x={x} y={pad.top + chartH + 14} textAnchor="middle" fontSize={9}
                  fill="currentColor" opacity={0.5}>{label}</text>
              </g>
            )
          })}
          {/* White line */}
          {whitePoints.length >= 2 && (
            <polyline points={toPolyline(whitePoints)} fill="none"
              stroke={WHITE_LINE} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {/* Black line */}
          {blackPoints.length >= 2 && (
            <polyline points={toPolyline(blackPoints)} fill="none"
              stroke={BLACK_LINE} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        <div className="flex gap-4 mt-1 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 inline-block rounded" style={{ backgroundColor: WHITE_LINE }} />
            As White
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 inline-block rounded" style={{ backgroundColor: BLACK_LINE }} />
            As Black
          </span>
          <span className="ml-2 italic">5-game rolling average</span>
        </div>
      </div>
    </div>
  )
}


function BlunderPositionsList({ positions, onSelectFen }: {
  positions: BlunderPosition[]
  onSelectFen: (fen: string) => void
}) {
  // Only show positions blundered ≥ 3 times.
  const filtered = positions.filter(p => p.count >= 3)
  if (filtered.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        Most common blunder positions (≥3 times) — click to load on board
      </span>
      {filtered.map((pos, i) => (
        <button
          key={i}
          onClick={() => onSelectFen(pos.fen)}
          className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] text-left cursor-pointer hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors w-full"
        >
          <MiniBoardFen fen={pos.fen} />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
              Blundered here {pos.count}×
            </span>
            <span className="text-xs font-mono text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] truncate max-w-64">
              {pos.fen.split(' ').slice(0, 4).join(' ')}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

function AnalysisTier({ filters }: { filters: StatsFilters }) {
  const [data, setData] = useState<PlayerAnalysisStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api
      .getPlayerAnalysisStats(filters)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError('Failed to load analysis stats.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filters])

  if (loading)
    return (
      <div className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        Loading analysis stats…
      </div>
    )
  if (error) return <div className="text-sm text-red-500 dark:text-red-700">{error}</div>
  if (!data) return null

  const { luckStats: ls } = data

  function handleBlunderFen(fen: string) {
    navigate('/board', { state: { fen } })
  }

  return (
    <div className="flex flex-col gap-6">
      {data.accuracyTimeSeries.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
            Accuracy over time
          </h2>
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-2)] dark:bg-[var(--color-dark-surface-2)] p-4">
            <AccuracyTrendChart points={data.accuracyTimeSeries} />
          </div>
        </section>
      )}

      {data.blunderPositions.some(p => p.count >= 3) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
            Recurring blunder positions
          </h2>
          <BlunderPositionsList positions={data.blunderPositions} onSelectFen={handleBlunderFen} />
        </section>
      )}

      {ls.blunderCount > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
            Luck &amp; opportunism
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] p-4 flex flex-col gap-1">
              <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
                Luck rate
              </span>
              <span className="text-2xl font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                {ls.luckRate.toFixed(0)}%
              </span>
              <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                {ls.unpunishedBlunders} of {ls.blunderCount} your blunders went unpunished
              </span>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] p-4 flex flex-col gap-1">
              <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
                Opportunism rate
              </span>
              <span className="text-2xl font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                {ls.opportunismRate.toFixed(0)}%
              </span>
              <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                {ls.exploitedBlunders} of {ls.oppBlunderCount} opponent blunders exploited
              </span>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}


function PersonalDeviationsSection({
  rows,
}: {
  rows: RepertoireDeviationRow[]
}) {
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
          Opening deviations
        </h2>
        <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          Positions where your games diverge from your prepared repertoire.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {rows.map((row, idx) => (
          <div
            key={idx}
            className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] p-3 flex flex-col gap-2 text-left"
          >
            <div className="relative group self-start">
              <MiniBoardFen fen={row.fen} size={80} />
              <div className="absolute bottom-full left-0 mb-2 z-20 pointer-events-none hidden group-hover:block drop-shadow-xl">
                <MiniBoardFen fen={row.fen} size={200} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">Played</span>
                <span className="text-sm font-mono font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">{row.playerMove}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">Prepared</span>
                <span className="text-xs font-mono text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">{row.repertoireMoves.join(', ')}</span>
              </div>
              <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">{row.count}× deviated</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}


export default function StatisticsPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<StatsFilters>({})
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [repDeviations, setRepDeviations] = useState<RepertoireDeviationRow[]>([])

  const [variationRows, setVariationRows] = useState<OpeningRow[] | null>(null)
  const [moveTreeCacheKey, setMoveTreeCacheKey] = useState('init')

  const handleFilterChange = useCallback((f: StatsFilters) => {
    setFilters(f)
    setVariationRows(null)
    setMoveTreeCacheKey(JSON.stringify(f))
    setRepDeviations([])
  }, [])

  function handleEcoClick(_eco: string) {
    // Lazy-fetch variation rows if not yet loaded for these filters
    if (!variationRows) {
      api.getPlayerVariationStats(filters)
        .then(data => setVariationRows(data ?? []))
        .catch(() => setVariationRows([]))
    }
  }

  async function handleOpeningClick(row: OpeningRow, side: 'white' | 'black') {
    const info = await api.getOpeningInfo(row.eco, row.opening)
    const hasIdentity = (filters.playerNames?.length ?? 0) > 0
    const explorerInitialState: ExplorerInitialState = hasIdentity
      ? { tab: 'personal', isMyselfActive: true, playerSide: side }
      : { tab: 'personal', playerSide: 'white' }
    navigate('/board', { state: { masterPgn: info.pgn + ' *', targetFen: info.fen, explorerInitialState } })
  }

  async function handleEcoNavigate(eco: string, side: 'white' | 'black') {
    const info = await api.getOpeningInfoByECO(eco)
    const hasIdentity = (filters.playerNames?.length ?? 0) > 0
    const explorerInitialState: ExplorerInitialState = hasIdentity
      ? { tab: 'personal', isMyselfActive: true, playerSide: side }
      : { tab: 'personal', playerSide: 'white' }
    navigate('/board', { state: { masterPgn: info.pgn + ' *', targetFen: info.fen, explorerInitialState } })
  }

  const handleLoadMoveTree = useCallback((fen: string, playerSide: string) => {
    return api.getMoveTreeStats(fen, filters, playerSide)
  }, [filters])

  function handleFenNavigate(fen: string, pgn: string) {
    const hasIdentity = (filters.playerNames?.length ?? 0) > 0
    const explorerInitialState: ExplorerInitialState = hasIdentity
      ? { tab: 'personal', isMyselfActive: true }
      : { tab: 'personal', playerSide: 'white' }
    navigate('/board', { state: { masterPgn: pgn + ' *', targetFen: fen, explorerInitialState } })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api
      .getPlayerStats(filters)
      .then(data => { if (!cancelled) setStats(data) })
      .catch(() => { if (!cancelled) setError('Failed to load statistics.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filters])

  useEffect(() => {
    const names = filters.playerNames
    if (!names || names.length === 0) { setRepDeviations([]); return }
    let cancelled = false
    api.getRepertoireDeviations(names)
      .then(d => { if (!cancelled) setRepDeviations(d ?? []) })
      .catch(() => { if (!cancelled) setRepDeviations([]) })
    return () => { cancelled = true }
  }, [filters.playerNames])

  return (
    // Gutter wrapper: pr-1.5 keeps the scrollbar away from the window edge
    // (same pattern as SettingsPage) so Wails resize handles remain accessible.
    <div className="h-full overflow-hidden flex flex-col">
      <div className="flex-1 min-h-0 pr-1.5">
        <div className="h-full overflow-auto">
          <div className="max-w-4xl w-full mx-auto px-6 py-6 flex flex-col gap-6">
            <div className="flex items-baseline justify-between">
              <h1 className="text-xl font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                Statistics
              </h1>
              {stats && (
                <span className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                  {stats.totalGames.toLocaleString()} games
                </span>
              )}
            </div>

            <FilterBar onChange={handleFilterChange} />

            {loading && (
              <div className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] py-8 text-center">
                Loading…
              </div>
            )}
            {error && <div className="text-sm text-red-500 dark:text-red-700 py-4">{error}</div>}

            {stats && !loading && (
              <>
                {(() => {
                  const hasIdentity = (filters.playerNames?.length ?? 0) > 0
                  return hasIdentity ? (
                    <>
                      <section className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'Total',    value: stats.totalGames    },
                          { label: 'As White', value: stats.asWhite.total },
                          { label: 'As Black', value: stats.asBlack.total },
                        ].map(card => (
                          <div
                            key={card.label}
                            className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] px-4 py-3 flex flex-col gap-0.5"
                          >
                            <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
                              {card.label}
                            </span>
                            <span className="text-2xl font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                              {card.value.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </section>
                      <ColourSection asWhite={stats.asWhite} asBlack={stats.asBlack} />
                    </>
                  ) : (
                    <>
                      <section className="grid grid-cols-1 max-w-48">
                        <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] px-4 py-3 flex flex-col gap-0.5">
                          <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">Total</span>
                          <span className="text-2xl font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                            {stats.totalGames.toLocaleString()}
                          </span>
                        </div>
                      </section>
                      <section className="flex flex-col gap-3">
                        <h2 className="text-sm font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
                          Results by colour
                        </h2>
                        <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] p-4">
                          <NeutralWDLBar
                            whiteWins={stats.asWhite.wins}
                            draws={stats.asWhite.draws}
                            blackWins={stats.asWhite.losses}
                            total={stats.totalGames}
                          />
                        </div>
                      </section>
                    </>
                  )
                })()}
                <TimeControlSection data={stats.byTimeControl ?? []} hasIdentity={(filters.playerNames?.length ?? 0) > 0} />
                <OpeningSection
                  data={stats.byOpening ?? []}
                  hasIdentity={(filters.playerNames?.length ?? 0) > 0}
                  variationRows={variationRows}
                  onOpeningClick={handleOpeningClick}
                  onEcoClick={handleEcoClick}
                  onEcoNavigate={handleEcoNavigate}
                  onLoadMoveTree={handleLoadMoveTree}
                  onFenNavigate={handleFenNavigate}
                  moveTreeCacheKey={moveTreeCacheKey}
                />

                <PersonalDeviationsSection rows={repDeviations} />

                {stats.analyzedGames < stats.totalGames && (
                  <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] px-4 py-3 text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                    {stats.analyzedGames === 0
                      ? `${stats.totalGames} games not yet analysed — run batch analysis from the Games page to unlock accuracy trends and luck/opportunism stats.`
                      : `${stats.totalGames - stats.analyzedGames} of ${stats.totalGames} games not yet analysed. Analysis stats below cover only the ${stats.analyzedGames} analysed games.`}
                  </div>
                )}

                {stats.analyzedGames > 0 && <AnalysisTier filters={filters} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
