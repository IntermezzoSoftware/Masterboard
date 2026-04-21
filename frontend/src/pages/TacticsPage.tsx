import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import * as Popover from '@radix-ui/react-popover'
import { makeFen } from 'chessops/fen'
import { parseUci } from 'chessops/util'
import { chessgroundDests } from 'chessops/compat'
import type { Config } from '@lichess-org/chessground/config'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import Chessboard from '@/components/Chessboard'
import { Checkbox } from '@/components/Checkbox'
import { chessFromFen } from '@/lib/fenUtils'
import { api, type PersonalPuzzle, type PuzzleFilters, type PuzzleSummary, type TacticsLobbyStats, type PuzzleHistoryEntry } from '@/lib/api'
import { btnPrimary, btnSecondary, btnTitlebarGhost } from '@/lib/classNames'
import { useSettings } from '@/hooks/useSettings'
import { useTitlebarBreadcrumb, TitlebarToolbarPortal, TitlebarToolbarLeftPortal, useTitlebar } from '@/context/TitlebarContext'
import { ArrowLeft, ExternalLink, Settings } from 'lucide-react'


// Format a solution line with move numbers, e.g. "8. Bxf7+ Ke7 9. Nd5+"
// ply is 1-indexed; odd ply = white to move.
function formatSolutionLine(sans: string[], ply: number): string {
  if (sans.length === 0) return ''
  let moveNum = Math.ceil(ply / 2)
  let whiteToPlay = ply % 2 === 1
  const parts: string[] = []
  for (let i = 0; i < sans.length; i++) {
    if (whiteToPlay) {
      parts.push(`${moveNum}.`)
    } else if (i === 0) {
      parts.push(`${moveNum}...`)
    }
    parts.push(sans[i])
    if (!whiteToPlay) moveNum++
    whiteToPlay = !whiteToPlay
  }
  return parts.join(' ')
}

// Format a centipawn value as a signed pawn string, e.g. "+0.5" or "−1.8".
function formatEval(cp: number | null): string | null {
  if (cp === null) return null
  const pawns = (cp / 100).toFixed(1)
  return cp >= 0 ? `+${pawns}` : `−${Math.abs(cp / 100).toFixed(1)}`
}

// Format an ISO date string as a short date, e.g. "Apr 18, 2026".
function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Derive the opponent name from a puzzle given the player's colour.
function opponentName(puzzle: { playerColour: string; white: string; black: string }): string {
  return puzzle.playerColour === 'white' ? puzzle.black : puzzle.white
}

const HISTORY_PAGE = 30


type TacticsPhase = 'lobby' | 'loading' | 'waiting' | 'correct' | 'incorrect' | 'complete' | 'empty' | 'history'


function ClassificationBadge({ classification }: { classification: string }) {
  const isBlunder = classification === 'blunder'
  return (
    <span className={[
      'inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] text-xs font-semibold',
      isBlunder
        ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
        : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800',
    ].join(' ')}>
      {isBlunder ? 'Blunder' : 'Mistake'}
    </span>
  )
}


export default function TacticsPage() {
  const navigate = useNavigate()

  const [phase, setPhase]                       = useState<TacticsPhase>('lobby')
  const [lobbyStats, setLobbyStats]             = useState<TacticsLobbyStats | null>(null)
  const [lobbyError, setLobbyError]             = useState(false)
  const [puzzles, setPuzzles]                   = useState<PersonalPuzzle[]>([])
  const [index, setIndex]                       = useState(0)
  const [totalReviewed, setTotalReviewed]       = useState(0)
  const [displayFen, setDisplayFen]             = useState('')
  const [lastMove, setLastMove]                 = useState<Key[] | undefined>(undefined)
  const [arrows, setArrows]                     = useState<DrawShape[]>([])
  const [feedbackSans, setFeedbackSans]         = useState<string[]>([])
  const [feedbackCorrectSan, setFeedbackCorrectSan] = useState<string>('')
  const [feedbackEval, setFeedbackEval]         = useState<string | null>(null)
  const [summary, setSummary]                   = useState<PuzzleSummary | null>(null)
  const [history, setHistory]                   = useState<PuzzleHistoryEntry[]>([])
  const [historyOffset, setHistoryOffset]       = useState(0)
  const [historyLoading, setHistoryLoading]     = useState(false)
  const [historyExhausted, setHistoryExhausted] = useState(false)
  const [historyError, setHistoryError]         = useState(false)
  const sessionStartRef                         = useRef<string | null>(null)
  const recordedRef                             = useRef<Set<string>>(new Set())

  useTitlebarBreadcrumb([{ label: 'Tactics' }])
  const { compact } = useTitlebar()

  const { values: sv, setValue: setSV } = useSettings([
    'tactics.linger',
    'tactics.showBlunders',
    'tactics.showMistakes',
    'tactics.showInaccuracies',
    'tactics.excludeAlreadyLosing',
  ])
  const linger               = sv['tactics.linger']               ?? '2'
  const showBlunders         = (sv['tactics.showBlunders']         ?? 'true') === 'true'
  const showMistakes         = (sv['tactics.showMistakes']         ?? 'true') === 'true'
  const showInaccuracies     = (sv['tactics.showInaccuracies']     ?? 'false') === 'true'
  const excludeAlreadyLosing = (sv['tactics.excludeAlreadyLosing'] ?? 'false') === 'true'

  const activeClassifications = [
    ...(showBlunders     ? ['blunder']    : []),
    ...(showMistakes     ? ['mistake']    : []),
    ...(showInaccuracies ? ['inaccuracy'] : []),
  ]
  const puzzleFilters: PuzzleFilters = {
    classifications: activeClassifications.length > 0 ? activeClassifications : ['blunder', 'mistake', 'inaccuracy'],
    excludeAlreadyLosing,
    alreadyLosingCp: -200,
  }

  // Load lobby stats on mount and whenever filters change.
  useEffect(() => {
    api.getTacticsLobbyStats(puzzleFilters)
      .then(stats => { setLobbyStats(stats); setLobbyError(false) })
      .catch(() => setLobbyError(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBlunders, showMistakes, showInaccuracies, excludeAlreadyLosing])

  // Fetch summary when session ends.
  useEffect(() => {
    if (phase === 'complete' && sessionStartRef.current) {
      api.getPuzzleSummary(sessionStartRef.current).then(setSummary).catch(() => {})
    }
  }, [phase])

  const puzzle = puzzles[index] ?? null

  const stateRef = useRef({ phase, puzzle, index, puzzles, linger })
  stateRef.current = { phase, puzzle, index, puzzles, linger }

  function showPuzzleAt(nextIndex: number, ps: PersonalPuzzle[]) {
    if (nextIndex >= ps.length) {
      setPhase('complete')
      return
    }
    const p = ps[nextIndex]
    setIndex(nextIndex)
    setArrows([])
    setFeedbackSans([])
    setFeedbackCorrectSan('')
    setFeedbackEval(null)
    setDisplayFen(p.fen)
    setLastMove(undefined)
    setPhase('waiting')
  }

  function advancePuzzle() {
    showPuzzleAt(stateRef.current.index + 1, stateRef.current.puzzles)
  }

  function startSession() {
    sessionStartRef.current = new Date().toISOString()
    setPhase('loading')
    api.getPuzzleSession(10, puzzleFilters)
      .then(loaded => {
        const ps = loaded ?? []
        setPuzzles(ps)
        if (ps.length === 0) {
          setPhase('empty')
        } else {
          showPuzzleAt(0, ps)
        }
      })
      .catch(() => setPhase('empty'))
  }

  function openHistory() {
    setHistory([])
    setHistoryOffset(0)
    setHistoryExhausted(false)
    setHistoryError(false)
    setPhase('history')
    setHistoryLoading(true)
    api.getPuzzleHistory(HISTORY_PAGE, 0)
      .then(entries => {
        setHistory(entries ?? [])
        setHistoryExhausted((entries ?? []).length < HISTORY_PAGE)
      })
      .catch(() => setHistoryError(true))
      .finally(() => setHistoryLoading(false))
  }

  function loadMoreHistory() {
    const nextOffset = historyOffset + HISTORY_PAGE
    setHistoryLoading(true)
    api.getPuzzleHistory(HISTORY_PAGE, nextOffset)
      .then(entries => {
        setHistory(prev => [...prev, ...(entries ?? [])])
        setHistoryOffset(nextOffset)
        setHistoryExhausted((entries ?? []).length < HISTORY_PAGE)
      })
      .catch(() => setHistoryError(true))
      .finally(() => setHistoryLoading(false))
  }

  function backToLobby() {
    setPhase('lobby')
    // Refresh lobby stats so due count reflects any reviews just done.
    api.getTacticsLobbyStats(puzzleFilters)
      .then(stats => { setLobbyStats(stats); setLobbyError(false) })
      .catch(() => {})
  }

  function handleMove(orig: string, dest: string) {
    const { phase: p, puzzle: pz } = stateRef.current
    if ((p !== 'waiting' && p !== 'incorrect') || !pz) return

    const played = orig + dest
    const correctUci = pz.solutionUci[0]
    const correctBase = correctUci.slice(0, 4)

    if (played === correctBase || played === correctUci) {
      if (p === 'waiting' && !recordedRef.current.has(pz.id)) {
        recordedRef.current.add(pz.id)
        void api.recordPuzzleResult(pz.id, true)
        setTotalReviewed(prev => prev + 1)
      }

      let afterFen = pz.fen
      try {
        const chess = chessFromFen(pz.fen)
        const move = parseUci(correctUci)
        if (move) chess.play(move)
        afterFen = makeFen(chess.toSetup())
      } catch {
        // keep original FEN on error
      }

      setPhase('correct')
      setDisplayFen(afterFen)
      setLastMove([orig as Key, dest as Key])
      setArrows([])
      setFeedbackSans([formatSolutionLine(pz.solutionSan, pz.ply)])
      setFeedbackCorrectSan(pz.solutionSan[0] ?? '')
      const playedStr = formatEval(pz.playedCp)
      const bestStr = formatEval(pz.bestCp)
      setFeedbackEval(playedStr !== null && bestStr !== null ? `${playedStr} → ${bestStr}` : null)
      const currentLinger = stateRef.current.linger
      const lingerMs = currentLinger === 'manual' ? null : parseInt(currentLinger, 10) * 1000
      if (lingerMs !== null) setTimeout(advancePuzzle, lingerMs)
    } else {
      if (p === 'waiting' && !recordedRef.current.has(pz.id)) {
        recordedRef.current.add(pz.id)
        void api.recordPuzzleResult(pz.id, false)
      }
      setPhase('incorrect')
      setDisplayFen(pz.fen)
      setLastMove(undefined)
      setArrows([{
        orig: correctUci.slice(0, 2) as Key,
        dest: correctUci.slice(2, 4) as Key,
        brush: 'green',
      }])
      setFeedbackSans([pz.solutionSan[0]])
    }
  }

  // Board config
  const boardConfig = useMemo((): Config => {
    let dests: Map<Key, Key[]> = new Map()
    let turn: 'white' | 'black' = 'white'
    const isInteractive = phase === 'waiting' || phase === 'incorrect'
    if (displayFen) {
      try {
        const chess = chessFromFen(displayFen)
        turn = chess.turn === 'white' ? 'white' : 'black'
        if (isInteractive && puzzle) {
          dests = chessgroundDests(chess)
        }
      } catch {
        // invalid FEN — static board
      }
    }
    return {
      fen: displayFen || undefined,
      orientation: puzzle?.playerColour ?? 'white',
      turnColor: turn,
      lastMove,
      movable: {
        color: isInteractive && puzzle ? puzzle.playerColour : undefined,
        free: false,
        dests,
        events: { after: (orig, dest) => handleMove(orig, dest) },
      },
      drawable: {
        enabled: false,
        visible: true,
        autoShapes: arrows,
      },
      animation: { enabled: true, duration: 150 },
    }
  }, [displayFen, phase, lastMove, arrows, puzzle]) // eslint-disable-line react-hooks/exhaustive-deps


  const toolbarPortal = (
    <>
      <TitlebarToolbarLeftPortal>
        {phase !== 'lobby' && (
          <button onClick={backToLobby} className={btnTitlebarGhost} aria-label="Back" title={compact ? 'Back' : undefined}>
            <ArrowLeft size={14} />
            {!compact && 'Back'}
          </button>
        )}
      </TitlebarToolbarLeftPortal>
      {phase !== 'lobby' && phase !== 'loading' && phase !== 'empty' && phase !== 'complete' && phase !== 'history' && puzzles.length > 0 && (
        <TitlebarToolbarPortal>
          <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
            {index + 1} / {puzzles.length}
          </span>
        </TitlebarToolbarPortal>
      )}
    </>
  )


  if (phase === 'lobby') {
    const dueCount = lobbyStats?.dueCount ?? 0
    const totalPuzzles = lobbyStats?.totalPuzzles ?? 0
    const lifetimePct = lobbyStats && lobbyStats.lifetimeTotal > 0
      ? Math.round((lobbyStats.lifetimeCorrect / lobbyStats.lifetimeTotal) * 100)
      : null

    return (
      <>
        {toolbarPortal}
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-xs w-full px-4">
              {lobbyError ? (
                <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                  Failed to load tactics data.
                </p>
              ) : lobbyStats === null ? (
                <p className="text-sm text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                  Loading…
                </p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                    {dueCount}
                  </p>
                  <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] mt-0.5">
                    puzzle{dueCount === 1 ? '' : 's'} due
                  </p>
                  {lifetimePct !== null && (
                    <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-1">
                      Lifetime accuracy: {lifetimePct}%
                    </p>
                  )}
                  <div className="flex justify-center gap-2 mt-5">
                    <button
                      className={btnPrimary}
                      disabled={dueCount === 0}
                      onClick={startSession}
                    >
                      Start session
                    </button>
                    <button className={btnSecondary} onClick={openHistory}>
                      History
                    </button>
                    <Popover.Root>
                      <Popover.Trigger asChild>
                        <button className={btnSecondary} aria-label="Tactics settings">
                          <Settings size={15} />
                        </button>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          side="top"
                          align="center"
                          sideOffset={6}
                          className="z-50 w-64 p-3 rounded-[var(--radius-md)] shadow-lg border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)] bg-[var(--color-surface-1)] dark:bg-[var(--color-dark-surface-1)]"
                        >
                          {/* Linger slider */}
                          <div className="mb-3">
                            <p className="text-xs font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] mb-1.5">Solution linger</p>
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min={0}
                                max={6}
                                step={1}
                                value={linger === 'manual' ? 6 : parseInt(linger, 10)}
                                onChange={e => {
                                  const v = parseInt(e.target.value, 10)
                                  void setSV('tactics.linger', v === 6 ? 'manual' : String(v))
                                }}
                                className="flex-1 cursor-pointer"
                                style={{ accentColor: 'var(--color-accent)' }}
                              />
                              <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] w-12 text-right">
                                {linger === 'manual' ? 'Manual' : `${linger} s`}
                              </span>
                            </div>
                            <div className="flex justify-between text-[10px] text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5 px-0.5">
                              <span>0 s</span>
                              <span>Manual</span>
                            </div>
                          </div>

                          {/* Classification filter */}
                          <div className="mb-3">
                            <p className="text-xs font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] mb-1.5">Show puzzles for</p>
                            <div className="flex flex-col gap-1.5">
                              {([
                                { key: 'tactics.showBlunders',     label: 'Blunders',     checked: showBlunders },
                                { key: 'tactics.showMistakes',     label: 'Mistakes',     checked: showMistakes },
                                { key: 'tactics.showInaccuracies', label: 'Inaccuracies', checked: showInaccuracies },
                              ] as const).map(({ key, label, checked }) => (
                                <label key={key} className="flex items-center gap-2 cursor-pointer text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={v => void setSV(key, v === true ? 'true' : 'false')}
                                    aria-label={label}
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* Exclude already losing */}
                          <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                            <Checkbox
                              checked={excludeAlreadyLosing}
                              onCheckedChange={v => void setSV('tactics.excludeAlreadyLosing', v === true ? 'true' : 'false')}
                              aria-label="Exclude from bad to worse"
                            />
                            Exclude "from bad to worse"
                          </label>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </div>
                  {totalPuzzles > 0 && (
                    <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-4">
                      {totalPuzzles} total puzzle{totalPuzzles === 1 ? '' : 's'} in database
                    </p>
                  )}
                  {totalPuzzles === 0 && (
                    <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-4">
                      No puzzles yet — analyse your games to generate tactics.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </>
    )
  }


  if (phase === 'loading') {
    return (
      <>
        {toolbarPortal}
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
              Loading…
            </p>
          </div>
        </div>
      </>
    )
  }


  if (phase === 'empty') {
    return (
      <>
        {toolbarPortal}
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                No puzzles due
              </p>
              <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] mt-1">
                Analyse your games to generate tactics.
              </p>
              <div className="flex justify-center gap-2 mt-4">
                <button className={btnSecondary} onClick={() => navigate('/games')}>
                  Go to Games
                </button>
                <button className={btnSecondary} onClick={backToLobby}>
                  Back
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }


  if (phase === 'complete') {
    const pct = summary && summary.totalReviewed > 0
      ? Math.round((summary.correctCount / summary.totalReviewed) * 100)
      : null
    const reviewed = summary?.totalReviewed ?? totalReviewed
    return (
      <>
        {toolbarPortal}
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                Session complete
              </p>
              <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] mt-1">
                {reviewed} puzzle{reviewed === 1 ? '' : 's'} reviewed
                {pct !== null ? ` · ${pct}% correct` : ''}
              </p>
              <div className="flex justify-center gap-2 mt-4">
                <button className={btnSecondary} onClick={backToLobby}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }


  if (phase === 'history') {
    return (
      <>
        {toolbarPortal}
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
            <button
              onClick={backToLobby}
              className={btnTitlebarGhost}
              aria-label="Back to lobby"
            >
              <ArrowLeft size={14} />
              {!compact && 'Back'}
            </button>
            <span className="text-sm font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
              Drill History
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {historyLoading && history.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-sm text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                  Loading…
                </p>
              </div>
            ) : historyError ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                  Failed to load history.
                </p>
              </div>
            ) : history.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-sm text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                  No puzzles reviewed yet.
                </p>
              </div>
            ) : (
              <>
                <table className="w-full text-xs">
                  <tbody>
                    {history.map((entry, i) => {
                      const opponent = entry.playerColour === 'white' ? entry.black : entry.white
                      const dateStr = formatDate(entry.reviewedAt)
                      return (
                        <tr
                          key={`${entry.puzzleId}-${i}`}
                          className="border-b border-[var(--color-surface-2)] dark:border-[var(--color-dark-surface-2)] hover:bg-[var(--color-surface-1)] dark:hover:bg-[var(--color-dark-surface-1)]"
                        >
                          <td className="px-4 py-2.5 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] whitespace-nowrap">
                            {dateStr}
                          </td>
                          <td className="px-2 py-2.5 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                            {opponent ? `vs. ${opponent}` : '—'}
                          </td>
                          <td className="px-2 py-2.5">
                            <ClassificationBadge classification={entry.classification} />
                          </td>
                          <td className="px-2 py-2.5 font-semibold" aria-label={entry.correct ? 'Correct' : 'Incorrect'}>
                            <span className={entry.correct
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-600 dark:text-red-400'
                            }>
                              {entry.correct ? '✓' : '✗'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline cursor-pointer"
                              onClick={() => navigate('/board', { state: { gameId: entry.gameId, targetFen: entry.fen } })}
                            >
                              View game
                              <ExternalLink size={11} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {!historyExhausted && (
                  <div className="flex justify-center py-4">
                    <button
                      className={btnSecondary}
                      disabled={historyLoading}
                      onClick={loadMoreHistory}
                    >
                      {historyLoading ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </>
    )
  }


  const opponent = puzzle ? opponentName(puzzle) : ''

  return (
    <>
      {toolbarPortal}
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-0 overflow-hidden">
          <div className="relative w-full max-w-[560px]">
            {/* Puzzle context strip */}
            {puzzle && (
              <div className="mb-2 flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <ClassificationBadge classification={puzzle.classification} />
                  <span className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                    You played <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">{puzzle.playedMove}</span>
                    {' '}— find the best move.
                  </span>
                </div>
                {opponent && (
                  <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] flex items-center gap-1.5">
                    vs. {opponent}{puzzle.date ? ` · ${formatDate(puzzle.date)}` : ''}
                    <button
                      className="inline-flex items-center gap-0.5 text-[var(--color-accent)] hover:underline text-xs cursor-pointer"
                      onClick={() => navigate('/board', { state: { gameId: puzzle.gameId, targetFen: puzzle.fen } })}
                      title="Open source game"
                    >
                      View game
                      <ExternalLink size={11} />
                    </button>
                  </span>
                )}
              </div>
            )}

            {/* Board */}
            <div className="aspect-square">
              <Chessboard config={boardConfig} />
            </div>

            {/* Feedback strip */}
            <div className="absolute left-0 right-0 top-full pt-2">
              {phase === 'correct' && feedbackSans.length > 0 && (
                <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                  {feedbackEval !== null && (
                    <p className="text-sm font-bold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] mb-0.5">
                      {feedbackEval}
                    </p>
                  )}
                  <p className="text-xs text-green-700 dark:text-green-300">
                    {(() => {
                      const line = feedbackSans[0]
                      const idx = feedbackCorrectSan ? line.indexOf(feedbackCorrectSan) : -1
                      if (idx < 0) return line
                      return (
                        <>
                          {line.slice(0, idx)}
                          <strong className="text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">{feedbackCorrectSan}</strong>
                          {line.slice(idx + feedbackCorrectSan.length)}
                        </>
                      )
                    })()}
                  </p>
                  {linger === 'manual' && (
                    <button
                      className={btnSecondary + ' mt-2 text-xs py-0.5 cursor-pointer'}
                      onClick={advancePuzzle}
                    >
                      Continue
                    </button>
                  )}
                </div>
              )}
              {phase === 'incorrect' && feedbackSans.length > 0 && (
                <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
                  <span className="text-red-700 dark:text-red-300 text-xs font-medium">
                    Best move: {feedbackSans[0]} — play it to continue.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
