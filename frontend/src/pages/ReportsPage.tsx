import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { Search, X, ChevronRight, ChevronDown } from 'lucide-react'
import { makeFen } from 'chessops/fen'
import { parseSan } from 'chessops/san'
import { api, PlayerStats, PlayerAnalysisStats, DeviationRow, OpeningRow, PersonalMoveStat, BlunderPosition, LuckStats, ColourResults, ExplorerInitialState } from '@/lib/api'
import { chessFromFen } from '@/lib/fenUtils'
import { Dialog } from '@/components/Dialog'
import { MiniBoardFen } from '@/components/MiniBoardFen'


function pct(n: number, total: number) {
  if (total === 0) return 0
  return Math.round((n / total) * 100)
}


function WDLBar({ wins, draws, losses, total }: ColourResults) {
  if (total === 0) return null
  const wPct = Math.round((wins / total) * 100)
  const dPct = pct(draws, total)
  const lPct = Math.round((losses / total) * 100)
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex rounded overflow-hidden h-4 w-full ring-1 ring-stone-300 dark:ring-stone-700">
        {wPct > 0 && (
          <div style={{ width: `${wPct}%` }} className="h-full shrink-0 bg-emerald-500 dark:bg-emerald-600 flex items-center justify-center overflow-hidden" title={`Wins: ${wPct}%`}>
            {wPct >= 15 && <span className="text-[9px] font-medium text-white leading-none select-none">{wPct}%</span>}
          </div>
        )}
        {dPct > 0 && (
          <div style={{ flex: 1 }} className="h-full bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] flex items-center justify-center overflow-hidden" title={`Draws: ${dPct}%`}>
            {dPct >= 15 && <span className="text-[9px] font-medium text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] leading-none select-none">{dPct}%</span>}
          </div>
        )}
        {lPct > 0 && (
          <div style={{ width: `${lPct}%` }} className="h-full shrink-0 bg-red-500 dark:bg-red-700 flex items-center justify-center overflow-hidden" title={`Losses: ${lPct}%`}>
            {lPct >= 15 && <span className="text-[9px] font-medium text-white leading-none select-none">{lPct}%</span>}
          </div>
        )}
      </div>
      <div className="flex gap-3 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
        <span className="text-emerald-500 dark:text-emerald-600">{wins}W</span>
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
              <WDLBar wins={cr.wins} draws={cr.draws} losses={cr.losses} total={cr.total} />
            </div>
          )
        })}
      </div>
    </section>
  )
}



const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const MOVE_TREE_MIN_GAMES = 3
const MOVE_TREE_MAX_DEPTH = 16

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
  cacheKey,
}: {
  onLoad: (fen: string, playerSide: string) => Promise<PersonalMoveStat[]>
  onNavigate: (fen: string, pgn: string) => void
  side: 'white' | 'black'
  cacheKey: string
}) {
  const [cache, setCache] = useState<Map<string, PersonalMoveStat[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedOther, setExpandedOther] = useState<Set<string>>(new Set())
  const [loadingFens, setLoadingFens] = useState<Set<string>>(new Set())

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

  useEffect(() => {
    loadFen(STARTING_FEN, side)
  }, [cacheKey, side, loadFen])

  function toggleExpand(nodeKey: string, childFen: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(nodeKey)) {
        next.delete(nodeKey)
      } else {
        next.add(nodeKey)
        if (!cache.has(childFen) && !loadingFens.has(childFen)) {
          loadFen(childFen, side)
        }
      }
      return next
    })
  }

  function renderNode(stat: PersonalMoveStat, parentFen: string, depth: number, pgnSoFar: string): React.ReactNode {
    const childFen = applyMoveFen(parentFen, stat.moveSan) ?? ''
    const nodeKey = `${parentFen}:${stat.moveSan}`
    const isExpanded = expanded.has(nodeKey)
    const isLoadingChild = loadingFens.has(childFen)
    const canExpand = depth < MOVE_TREE_MAX_DEPTH && stat.total >= MOVE_TREE_MIN_GAMES
    const moveNum = Math.ceil(depth / 2)
    const movePart = depth % 2 === 1 ? `${moveNum}. ${stat.moveSan}` : stat.moveSan
    const childPgn = pgnSoFar ? `${pgnSoFar} ${movePart}` : movePart
    const wins   = side === 'white' ? stat.whiteWins : stat.blackWins
    const losses  = side === 'white' ? stat.blackWins  : stat.whiteWins
    const wPct = stat.total > 0 ? Math.round((wins   / stat.total) * 100) : 0
    const dPct = stat.total > 0 ? Math.round((stat.draws / stat.total) * 100) : 0
    const lPct = stat.total > 0 ? Math.round((losses  / stat.total) * 100) : 0
    return (
      <div key={nodeKey}>
        <div
          className="flex items-center gap-2 py-1.5 pr-2 rounded hover:bg-[var(--color-surface-1)] dark:hover:bg-[var(--color-dark-surface-1)] cursor-pointer"
          onClick={() => childFen && onNavigate(childFen, childPgn)}
        >
          <div
            className="self-stretch -my-1.5 flex items-center shrink-0 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)]"
            style={{ paddingLeft: `${8 + (depth - 1) * 20}px` }}
            onClick={e => { e.stopPropagation(); if (canExpand && childFen) toggleExpand(nodeKey, childFen) }}
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
          <div className="flex rounded overflow-hidden h-4 flex-1 ring-1 ring-stone-300 dark:ring-stone-700">
            {wPct > 0 && (
              <div style={{ width: `${wPct}%` }} className="h-full shrink-0 bg-emerald-500 dark:bg-emerald-600 flex items-center justify-center" title={`Wins: ${wPct}%`}>
                {wPct >= 15 && <span className="text-[9px] font-medium leading-none text-white">{wPct}%</span>}
              </div>
            )}
            {dPct > 0 && (
              <div style={{ flex: 1 }} className="h-full bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)] flex items-center justify-center" title={`Draws: ${dPct}%`}>
                {dPct >= 15 && <span className="text-[9px] font-medium leading-none text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">{dPct}%</span>}
              </div>
            )}
            {lPct > 0 && (
              <div style={{ width: `${lPct}%` }} className="h-full shrink-0 bg-red-500 dark:bg-red-700 flex items-center justify-center" title={`Losses: ${lPct}%`}>
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
    const otherKey = `${parentFen}:other`
    const otherOpen = expandedOther.has(parentFen)
    return (
      <>
        {visible.map(stat => renderNode(stat, parentFen, depth, pgnSoFar))}
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
            {otherOpen && hidden.map(stat => renderNode(stat, parentFen, depth, pgnSoFar))}
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
  data, variationRows, onOpeningClick, onEcoClick, onEcoNavigate,
  onLoadMoveTree, onFenNavigate, moveTreeCacheKey,
}: {
  data: OpeningRow[]
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
    const games = side === 'white' ? row.asWhite : row.asBlack
    const wins = side === 'white' ? row.whiteWins : row.blackWins
    const draws = side === 'white' ? row.whiteDraws : row.blackDraws
    const losses = Math.max(0, games - wins - draws)
    const winPct = games > 0 ? (wins / games) * 100 : 0
    const lossPct = games > 0 ? (losses / games) * 100 : 0
    return { row, games, wins, draws, losses, winPct, lossPct }
  }

  const activeData = mode === 'variation' && variationRows
    ? (ecoFilter ? variationRows.filter(r => r.eco.startsWith(ecoFilter)) : variationRows)
    : data

  const sourceData = activeData.filter(row => side === 'white' ? row.asWhite > 0 : row.asBlack > 0)

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

  const sortButtons = (
    <div className="flex gap-1">
      <SortBtn s="games" label="Most played" />
      <SortBtn s="win" label="Best results" />
      <SortBtn s="loss" label="Worst results" />
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
          <div className="w-px h-4 bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]" />
          <div className="flex gap-1">
            <SideTab s="white" label="As White" />
            <SideTab s="black" label="As Black" />
          </div>
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
          cacheKey={moveTreeCacheKey + ':' + side}
        />
      )}
      {mode !== 'tree' && <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
              {['ECO', 'Opening', 'Games', 'Win %', 'Draw %', 'Loss %', 'Result'].map((h, i) => (
                <th key={h} className={`px-4 py-2 font-medium text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] ${i <= 1 ? 'text-left' : 'text-right'}`}>
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
                  <td className="px-4 py-2.5 text-right font-medium text-emerald-500 dark:text-emerald-600">{wPct}%</td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">{dPct}%</td>
                  <td className="px-4 py-2.5 text-right text-red-500 dark:text-red-700">{lPct}%</td>
                  <td className="px-4 py-2.5">
                    <div className="flex rounded overflow-hidden h-4 w-24 ml-auto ring-1 ring-stone-300 dark:ring-stone-700">
                      {wPct > 0 && <div style={{ width: `${wPct}%` }} className="h-full shrink-0 bg-emerald-500 dark:bg-emerald-600" title={`Wins: ${wPct}%`} />}
                      {dPct > 0 && <div style={{ flex: 1 }} className="h-full bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]" title={`Draws: ${dPct}%`} />}
                      {lPct > 0 && <div style={{ width: `${lPct}%` }} className="h-full shrink-0 bg-red-500 dark:bg-red-700" title={`Losses: ${lPct}%`} />}
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
                  key={`${row.eco}-${row.opening}-${side}`}
                  className="border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] last:border-0 hover:bg-[var(--color-surface-1)] dark:hover:bg-[var(--color-dark-surface-1)] cursor-pointer"
                  onClick={() => handleRowClick(row)}
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
                  <td className="px-4 py-2.5 text-right font-medium text-emerald-500 dark:text-emerald-600">{wPct}%</td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">{dPct}%</td>
                  <td className="px-4 py-2.5 text-right text-red-500 dark:text-red-700">{lPct}%</td>
                  <td className="px-4 py-2.5">
                    <div className="flex rounded overflow-hidden h-4 w-24 ml-auto ring-1 ring-stone-300 dark:ring-stone-700">
                      {wPct > 0 && <div style={{ width: `${wPct}%` }} className="h-full shrink-0 bg-emerald-500 dark:bg-emerald-600" title={`Wins: ${wPct}%`} />}
                      {dPct > 0 && <div style={{ flex: 1 }} className="h-full bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]" title={`Draws: ${dPct}%`} />}
                      {lPct > 0 && <div style={{ width: `${lPct}%` }} className="h-full shrink-0 bg-red-500 dark:bg-red-700" title={`Losses: ${lPct}%`} />}
                    </div>
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-center text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                  No openings played as {side === 'white' ? 'White' : 'Black'}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>}
      {mode !== 'tree' && sourceData.length > 15 && (
        <button onClick={() => setShowAll(v => !v)} className="text-sm text-[var(--color-accent)] hover:underline cursor-pointer self-start">
          {showAll ? 'Show less' : `Show all ${sourceData.length} openings`}
        </button>
      )}
    </section>
  )
}


function DeviationsSection({ rows, onSelect }: { rows: DeviationRow[]; onSelect: (fen: string, move: string) => void }) {
  if (rows.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
        Theory deviations
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {rows.map((row, idx) => (
          <button
            key={idx}
            onClick={() => onSelect(row.fen, row.playerMove)}
            className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] p-3 flex flex-col gap-2 text-left cursor-pointer hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] transition-colors"
          >
            {/* miniboard with hover-to-enlarge */}
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
                <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">Theory</span>
                <span className="text-xs font-mono text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">{row.theoryMoves.join(', ')}</span>
              </div>
              <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">{row.count}× deviated</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}


function BlunderPositionsSection({ positions, onSelectFen }: {
  positions: BlunderPosition[]
  onSelectFen: (fen: string) => void
}) {
  const filtered = positions.filter(p => p.count >= 3)
  if (filtered.length === 0) return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider">
        Recurring blunder positions
      </h2>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          Positions blundered ≥3 times — click to load on board
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
    </section>
  )
}


function LuckSection({ ls }: { ls: LuckStats }) {
  if (ls.blunderCount === 0) return null
  return (
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
            How often their blunders go unpunished
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
            How often they punish your mistakes
          </span>
        </div>
      </div>
    </section>
  )
}


function AnalysisTier({ data, onSelectFen }: { data: PlayerAnalysisStats; onSelectFen: (fen: string) => void }) {
  const hasBlunders = (data.blunderPositions?.filter(p => p.count >= 3).length ?? 0) > 0
  const hasLuck = (data.luckStats?.blunderCount ?? 0) > 0
  if (!hasBlunders && !hasLuck) return null
  return (
    <div className="flex flex-col gap-6">
      {hasBlunders && <BlunderPositionsSection positions={data.blunderPositions} onSelectFen={onSelectFen} />}
      {hasLuck && <LuckSection ls={data.luckStats} />}
    </div>
  )
}


function AnalysisModal({
  playerName,
  queued,
  onClose,
  onRefreshStats,
}: {
  playerName: string
  queued: number
  onClose: () => void
  onRefreshStats: () => void
}) {
  const [remaining, setRemaining] = useState(queued)
  const [active, setActive] = useState(0)
  const [autoRefreshed, setAutoRefreshed] = useState(false)

  const progress = queued > 0 ? Math.max(0, 1 - (remaining + active) / queued) : 1

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const status = await api.getQueueStatus()
        setRemaining(status.remaining)
        setActive(status.active)
      } catch {
        // ignore poll failures
      }
    }, 2000)
    return () => clearInterval(id)
  }, [])

  // Auto-refresh stats once when queue empties
  useEffect(() => {
    if (progress >= 1 && !autoRefreshed) {
      setAutoRefreshed(true)
      onRefreshStats()
    }
  }, [progress, autoRefreshed, onRefreshStats])

  const done = remaining + active === 0

  return (
    <Dialog
      onClose={onClose}
      title={`Analysing ${playerName}'s games`}
      maxWidth="sm"
    >
      <div className="px-4 py-4 flex flex-col gap-4">
        <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
          Queued {queued} game{queued !== 1 ? 's' : ''} for analysis. Analysis is running in the background — you can close this dialog and return later.
        </p>

        {/* Progress bar */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            <span>{done ? 'Complete' : `${remaining + active} remaining`}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-[var(--color-surface-3)] dark:bg-[var(--color-dark-surface-3)]">
            <div
              className="h-full bg-[var(--color-accent)] transition-all duration-500 rounded-full"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={() => { onRefreshStats(); onClose() }}
            className="px-3 py-1.5 rounded-[var(--radius-md)] text-sm font-medium border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] cursor-pointer"
          >
            Refresh Stats
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-[var(--radius-md)] text-sm font-medium bg-[var(--color-accent)] text-white hover:opacity-90 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </Dialog>
  )
}


export default function ReportsPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(
    () => localStorage.getItem('reports:selectedPlayer')
  )
  const [statsLoading, setStatsLoading] = useState(false)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [deviations, setDeviations] = useState<DeviationRow[] | null>(null)
  const [analysisStats, setAnalysisStats] = useState<PlayerAnalysisStats | null>(null)
  const [analyzeModal, setAnalyzeModal] = useState<{ open: boolean; queued: number }>({ open: false, queued: 0 })
  const [allAnalysedMessage, setAllAnalysedMessage] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  const [variationRows, setVariationRows] = useState<OpeningRow[] | null>(null)
  const [moveTreeCacheKey, setMoveTreeCacheKey] = useState('init')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Clear debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Debounced autocomplete
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (value.length < 1) {
      setSuggestions([])
      setDropdownOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const names = await api.getPlayerNames(value)
        setSuggestions(names)
        setDropdownOpen(names.length > 0)
      } catch {
        setSuggestions([])
        setDropdownOpen(false)
      }
    }, 300)
  }, [])

  // Clear selection and reset state
  const handleClear = useCallback(() => {
    setQuery('')
    setSuggestions([])
    setDropdownOpen(false)
    setSelectedPlayer(null)
    localStorage.removeItem('reports:selectedPlayer')
    setStats(null)
    setDeviations(null)
    setAnalysisStats(null)
    setAllAnalysedMessage(false)
    setExportLoading(false)
    setVariationRows(null)
    setMoveTreeCacheKey('init')
    inputRef.current?.focus()
  }, [])

  function handleEcoClick(_eco: string) {
    if (!variationRows && selectedPlayer) {
      api.getPlayerVariationStats({ playerNames: [selectedPlayer] })
        .then(data => setVariationRows(data ?? []))
        .catch(() => setVariationRows([]))
    }
  }

  async function handleOpeningClick(row: OpeningRow, side: 'white' | 'black') {
    const info = await api.getOpeningInfo(row.eco, row.opening)
    const explorerInitialState: ExplorerInitialState = {
      tab: 'personal',
      playerFilter: selectedPlayer ?? undefined,
      playerSide: side,
    }
    navigate('/board', { state: { masterPgn: info.pgn + ' *', targetFen: info.fen, explorerInitialState } })
  }

  async function handleEcoNavigate(eco: string, side: 'white' | 'black') {
    const info = await api.getOpeningInfoByECO(eco)
    const explorerInitialState: ExplorerInitialState = {
      tab: 'personal',
      playerFilter: selectedPlayer ?? undefined,
      playerSide: side,
    }
    navigate('/board', { state: { masterPgn: info.pgn + ' *', targetFen: info.fen, explorerInitialState } })
  }

  const handleLoadMoveTree = useCallback((fen: string, playerSide: string) => {
    const filters = selectedPlayer ? { playerNames: [selectedPlayer] } : {}
    return api.getMoveTreeStats(fen, filters, playerSide)
  }, [selectedPlayer])

  function handleFenNavigate(fen: string, pgn: string) {
    const explorerInitialState: ExplorerInitialState = {
      tab: 'personal',
      playerFilter: selectedPlayer ?? undefined,
    }
    navigate('/board', { state: { masterPgn: pgn + ' *', targetFen: fen, explorerInitialState } })
  }

  // Select a player from the dropdown
  const handleSelect = useCallback((name: string) => {
    setSelectedPlayer(name)
    localStorage.setItem('reports:selectedPlayer', name)
    setQuery('')
    setSuggestions([])
    setVariationRows(null)
    setMoveTreeCacheKey(name)
    setDropdownOpen(false)
  }, [])

  // Load data when selectedPlayer changes
  useEffect(() => {
    if (!selectedPlayer) return

    let cancelled = false
    setStatsLoading(true)
    setStats(null)
    setDeviations(null)
    setAnalysisStats(null)
    setAllAnalysedMessage(false)

    async function load() {
      try {
        const [s, d, a] = await Promise.all([
          api.getPlayerStats({ playerNames: [selectedPlayer!] }),
          api.getDeviationPositions([selectedPlayer!]),
          api.getPlayerAnalysisStats({ playerNames: [selectedPlayer!] }),
        ])
        if (!cancelled) {
          setStats(s)
          setDeviations(d)
          setAnalysisStats(a)
        }
      } catch {
        // silent — no data shown
      } finally {
        if (!cancelled) setStatsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedPlayer])

  const refreshAnalysisStats = useCallback(async () => {
    if (!selectedPlayer) return
    try {
      const a = await api.getPlayerAnalysisStats({ playerNames: [selectedPlayer] })
      setAnalysisStats(a)
    } catch {
      // silent
    }
  }, [selectedPlayer])

  const handleAnalyse = useCallback(async () => {
    if (!selectedPlayer) return
    try {
      const n = await api.analyzeOpponentGames([selectedPlayer])
      if (n === 0) {
        setAllAnalysedMessage(true)
        return
      }
      setAnalyzeModal({ open: true, queued: n })
    } catch {
      // silent
    }
  }, [selectedPlayer])

  const handleExport = useCallback(async () => {
    if (!selectedPlayer || exportLoading) return
    setExportLoading(true)
    try {
      const pgn = await api.getExportOpponentReport([selectedPlayer])
      const blob = new Blob([pgn], { type: 'application/x-chess-pgn' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)
      const safeName = selectedPlayer.replace(/[^a-zA-Z0-9_-]/g, '_')
      a.href = url
      a.download = `opponent-report-${safeName}-${date}.pgn`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setExportLoading(false)
    }
  }, [selectedPlayer, exportLoading])

  return (
    <div data-testid="page-reports" className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-8">

        {/* Page title */}
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
            Reports
          </h1>
          <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            Search for an opponent to view their opening tendencies and theory deviations.
          </p>
        </div>

        {/* Search box */}
        <div className="relative w-full max-w-md">
          <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] focus-within:ring-2 focus-within:ring-[var(--color-accent)] focus-within:border-transparent">
            <Search size={14} className="shrink-0 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search opponent name..."
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              onFocus={() => { if (suggestions.length > 0) setDropdownOpen(true) }}
              onBlur={() => { setTimeout(() => setDropdownOpen(false), 150) }}
              className="flex-1 bg-transparent text-sm text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] placeholder:text-[var(--color-content-secondary)] dark:placeholder:text-[var(--color-dark-content-secondary)] outline-none"
            />
            {(query || selectedPlayer) && (
              <button
                onClick={handleClear}
                aria-label="Clear search"
                className="shrink-0 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] cursor-pointer"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Autocomplete dropdown */}
          {dropdownOpen && suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-50 mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-0)] dark:bg-[var(--color-dark-surface-0)] shadow-lg overflow-hidden"
            >
              {suggestions.map(name => (
                <li key={name}>
                  <button
                    role="option"
                    aria-selected={false}
                    onMouseDown={() => handleSelect(name)}
                    className="w-full text-left px-3 py-2 text-sm text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] cursor-pointer"
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Selected player chip */}
        {selectedPlayer && !query && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] uppercase tracking-wider font-semibold">
              Showing:
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-sm font-medium bg-[var(--color-surface-2)] dark:bg-[var(--color-dark-surface-2)] text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
              {selectedPlayer}
              <button
                onClick={handleClear}
                aria-label={`Remove ${selectedPlayer}`}
                className="text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:text-[var(--color-content-primary)] dark:hover:text-[var(--color-dark-content-primary)] cursor-pointer"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          </div>
        )}

        {/* Loading state */}
        {statsLoading && (
          <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            Loading report...
          </p>
        )}

        {/* Report content — shown after player selected and data loaded */}
        {selectedPlayer && stats && !statsLoading && (
          <>
            {/* Summary header */}
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                {selectedPlayer}
              </h2>
              <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                {stats.totalGames} games in database
              </p>
            </div>

            <ColourSection asWhite={stats.asWhite} asBlack={stats.asBlack} />

            <OpeningSection
              data={stats.byOpening}
              variationRows={variationRows}
              onOpeningClick={handleOpeningClick}
              onEcoClick={handleEcoClick}
              onEcoNavigate={handleEcoNavigate}
              onLoadMoveTree={handleLoadMoveTree}
              onFenNavigate={handleFenNavigate}
              moveTreeCacheKey={moveTreeCacheKey}
            />

            {deviations && deviations.length > 0 && (
              <DeviationsSection
                rows={deviations}
                onSelect={(fen, move) => {
                  const parts = fen.split(' ')
                  const side = parts[1]
                  const fullMove = parts[5] ?? '1'
                  const prefix = side === 'w' ? `${fullMove}.` : `${fullMove}...`
                  navigate('/board', { state: { masterPgn: `[FEN "${fen}"]\n[SetUp "1"]\n\n${prefix} ${move} *`, targetFen: fen } })
                }}
              />
            )}

            {/* Analysis availability info */}
            {stats.analyzedGames < stats.totalGames && (
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)] px-4 py-3 text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                {stats.analyzedGames === 0
                  ? `${stats.totalGames} games not yet analysed — click Analyse to unlock blunder patterns and luck stats.`
                  : `${stats.totalGames - stats.analyzedGames} of ${stats.totalGames} games not yet analysed. Blunder and luck stats below cover only the ${stats.analyzedGames} analysed games.`}
              </div>
            )}

            {/* Analysis tier */}
            {analysisStats && (
              <AnalysisTier data={analysisStats} onSelectFen={fen => navigate('/board', { state: { fen } })} />
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex gap-3">
                <button
                  onClick={handleExport}
                  disabled={exportLoading}
                  className="px-4 py-2 rounded-[var(--radius-md)] text-sm font-medium border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-dark-surface-2)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {exportLoading ? 'Exporting...' : 'Export Report as PGN'}
                </button>
                <button
                  onClick={handleAnalyse}
                  className="px-4 py-2 rounded-[var(--radius-md)] text-sm font-medium bg-[var(--color-accent)] text-white hover:opacity-90 cursor-pointer"
                >
                  Analyse {selectedPlayer}'s games
                </button>
              </div>
              {allAnalysedMessage && (
                <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                  All games already analysed.
                </p>
              )}
            </div>
          </>
        )}

        {/* No data state */}
        {selectedPlayer && !stats && !statsLoading && (
          <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
            No data found for {selectedPlayer}.
          </p>
        )}
      </div>

      {/* Analysis progress modal */}
      {analyzeModal.open && selectedPlayer && (
        <AnalysisModal
          playerName={selectedPlayer}
          queued={analyzeModal.queued}
          onClose={() => setAnalyzeModal({ open: false, queued: 0 })}
          onRefreshStats={refreshAnalysisStats}
        />
      )}
    </div>
  )
}
