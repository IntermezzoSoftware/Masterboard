import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { INITIAL_FEN } from 'chessops/fen'
import { chessgroundDests } from 'chessops/compat'
import type { Config } from '@lichess-org/chessground/config'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import Chessboard from '@/components/Chessboard'
import { chessFromFen } from '@/lib/fenUtils'
import { api, type GTMGame, type GTMMove, type GTMRating } from '@/lib/api'
import { btnSecondary, btnTitlebarGhost } from '@/lib/classNames'
import { useTitlebarBreadcrumb, TitlebarToolbarPortal, TitlebarToolbarLeftPortal, useTitlebar } from '@/context/TitlebarContext'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GTMPhase = 'loading' | 'animating' | 'waiting' | 'scored' | 'complete'
type ScoreTier = 'best' | 'good' | 'miss'

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function normCastle(uci: string): string {
  const map: Record<string, string> = {
    e1h1: 'e1g1', e1a1: 'e1c1',
    e8h8: 'e8g8', e8a8: 'e8c8',
  }
  const base = uci.slice(0, 4)
  return (map[base] ?? base) + uci.slice(4)
}

export function cpLossForPlayer(move: GTMMove, playerColour: 'white' | 'black'): number | null {
  if (move.bestCp === null || move.playedCp === null) return null
  return playerColour === 'white'
    ? move.bestCp - move.playedCp
    : move.playedCp - move.bestCp
}

function gameMoveTier(move: GTMMove, playerColour: 'white' | 'black'): ScoreTier {
  const loss = cpLossForPlayer(move, playerColour)
  if (loss === null) return 'best'
  if (loss <= 5) return 'best'
  if (loss <= 25) return 'good'
  return 'miss'
}

export function tierPoints(tier: ScoreTier, analysed: boolean): number {
  if (!analysed) return tier === 'miss' ? 0 : 1
  if (tier === 'best') return 2
  if (tier === 'good') return 1
  return 0
}

function tierLabel(tier: ScoreTier, analysed: boolean): string {
  if (!analysed) return tier === 'miss' ? 'Wrong move' : 'Correct'
  if (tier === 'best') return 'Best move'
  if (tier === 'good') return 'Good move'
  return 'Miss'
}

// ---------------------------------------------------------------------------
// GTMPage
// ---------------------------------------------------------------------------

export default function GTMPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state    = location.state as { gameId: string; colour: 'white' | 'black' } | null
  const gameId   = state?.gameId ?? ''
  const playerColour = state?.colour ?? 'white'

  const [game, setGame]               = useState<GTMGame | null>(null)
  const [moveIndex, setMoveIndex]     = useState(0)
  const [phase, setPhase]             = useState<GTMPhase>('loading')
  const [displayFen, setDisplayFen]   = useState(INITIAL_FEN)
  const [lastMove, setLastMove]       = useState<Key[] | undefined>(undefined)
  const [arrows, setArrows]           = useState<DrawShape[]>([])
  const [points, setPoints]           = useState(0)
  const [maxPoints, setMaxPoints]     = useState(0)
  const [scoredTier, setScoredTier]   = useState<ScoreTier | null>(null)
  const [scoredSan, setScoredSan]     = useState('')
  const [scoredCpLoss, setScoredCpLoss] = useState<number | null>(null)
  const [ratingBefore, setRatingBefore] = useState<number | null>(null)
  const [ratingAfter, setRatingAfter]   = useState<GTMRating | null>(null)

  useTitlebarBreadcrumb([{ label: 'Games', to: '/games' }, { label: 'Guess the Move' }])
  const { compact } = useTitlebar()

  const stateRef = useRef({ phase, game, moveIndex })
  stateRef.current = { phase, game, moveIndex }

  const pointsRef = useRef({ earned: 0, max: 0 })

  useEffect(() => {
    if (!gameId) { setPhase('complete'); return }
    Promise.all([api.getGtmGame(gameId), api.getGtmRating()])
      .then(([g, r]) => {
        setGame(g)
        setRatingBefore(r?.rating ?? 1500)
        if (g.moves.length === 0) {
          finishSession(g, 0, 0)
        } else {
          advanceToMove(0, g)
        }
      })
      .catch(() => setPhase('complete'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function finishSession(g: GTMGame, earned: number, max: number) {
    setPhase('complete')
    api.recordGtmResult(g.gameId, playerColour, earned, max, g.moves.filter(m => m.colour === playerColour).length, g.analysed)
      .then(r => { if (r) setRatingAfter(r) })
      .catch(() => {})
  }

  function advanceToMove(index: number, g: GTMGame, earnedSoFar = 0, maxSoFar = 0) {
    if (index >= g.moves.length) {
      finishSession(g, earnedSoFar, maxSoFar)
      return
    }
    const m = g.moves[index]
    if (m.colour !== playerColour) {
      setDisplayFen(m.fromFen)
      setLastMove(undefined)
      setPhase('animating')
      setTimeout(() => {
        setDisplayFen(m.toFen)
        setLastMove([m.uci.slice(0, 2) as Key, m.uci.slice(2, 4) as Key])
        advanceToMove(index + 1, g, earnedSoFar, maxSoFar)
      }, 600)
    } else {
      setMoveIndex(index)
      setDisplayFen(m.fromFen)
      setLastMove(undefined)
      setArrows([])
      setScoredTier(null)
      setScoredSan('')
      setScoredCpLoss(null)
      setPhase('waiting')
    }
  }

  function handleMove(orig: string, dest: string) {
    const { phase: p, game: g, moveIndex: mi } = stateRef.current
    if (p !== 'waiting' || !g) return
    const m = g.moves[mi]
    const played = normCastle(orig + dest).slice(0, 4)

    let tier: ScoreTier
    if (g.analysed) {
      if (m.bestUci && normCastle(m.bestUci).slice(0, 4) === played) {
        tier = 'best'
      } else if (normCastle(m.uci).slice(0, 4) === played) {
        tier = gameMoveTier(m, playerColour)
      } else {
        tier = 'miss'
      }
    } else {
      tier = normCastle(m.uci).slice(0, 4) === played ? 'good' : 'miss'
    }

    const earned = tierPoints(tier, g.analysed)
    const maxForMove = g.analysed ? 2 : 1

    const newEarned = pointsRef.current.earned + earned
    const newMax    = pointsRef.current.max    + maxForMove
    pointsRef.current = { earned: newEarned, max: newMax }
    setPoints(newEarned)
    setMaxPoints(newMax)

    setScoredTier(tier)
    setScoredSan(m.san)
    setScoredCpLoss(tier !== 'best' ? cpLossForPlayer(m, playerColour) : null)
    setDisplayFen(tier === 'miss' ? m.fromFen : m.toFen)
    setLastMove(tier === 'miss' ? undefined : [orig as Key, dest as Key])
    if (tier === 'miss') {
      const correctUci = m.bestUci ?? m.uci
      setArrows([{ orig: correctUci.slice(0, 2) as Key, dest: correctUci.slice(2, 4) as Key, brush: 'green' }])
    } else {
      setArrows([])
    }
    setPhase('scored')

    const gameRef = g
    const nextIndex = mi + 1
    setTimeout(() => {
      const { earned: e, max: mx } = pointsRef.current
      advanceToMove(nextIndex, gameRef, e, mx)
    }, 1200)
  }

  const boardConfig = useMemo((): Config => {
    const isInteractive = phase === 'waiting'
    let dests: Map<Key, Key[]> = new Map()
    let turn: 'white' | 'black' = 'white'
    try {
      const chess = chessFromFen(displayFen)
      turn = chess.turn === 'white' ? 'white' : 'black'
      if (isInteractive) dests = chessgroundDests(chess)
    } catch { /* invalid FEN */ }
    return {
      fen: displayFen,
      orientation: playerColour,
      turnColor: turn,
      lastMove,
      movable: {
        color: isInteractive ? playerColour : undefined,
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
  }, [displayFen, phase, lastMove, arrows]) // eslint-disable-line react-hooks/exhaustive-deps

  const toolbarPortal = (
    <>
      <TitlebarToolbarLeftPortal>
        <button onClick={() => navigate('/games')} className={btnTitlebarGhost} aria-label="Back to Games" title={compact ? 'Back' : undefined}>
          <ArrowLeft size={14} />
          {!compact && 'Back'}
        </button>
      </TitlebarToolbarLeftPortal>
      {phase !== 'loading' && phase !== 'complete' && game && (
        <TitlebarToolbarPortal>
          <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
            {points} / {game.moves.filter(m => m.colour === playerColour).length * (game.analysed ? 2 : 1)} pts
          </span>
        </TitlebarToolbarPortal>
      )}
    </>
  )

  if (phase === 'loading') {
    return (
      <>
        {toolbarPortal}
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">Loading…</p>
          </div>
        </div>
      </>
    )
  }

  if (phase === 'complete') {
    const pct = maxPoints > 0 ? Math.round((points / maxPoints) * 100) : null
    const ratingChange = ratingAfter !== null && ratingBefore !== null
      ? ratingAfter.rating - ratingBefore
      : null
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
                {points} / {maxPoints} points{pct !== null ? ` · ${pct}%` : ''}
              </p>
              {ratingAfter !== null && ratingBefore !== null && (
                <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
                  Rating: {ratingBefore} → {ratingAfter.rating}
                  {ratingChange !== null && (
                    <span className={ratingChange >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
                      {' '}({ratingChange >= 0 ? '+' : ''}{ratingChange})
                    </span>
                  )}
                </p>
              )}
              <div className="flex justify-center mt-4">
                <button className={btnSecondary} onClick={() => navigate('/games')}>
                  Back to Games
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  const currentMove = game?.moves[moveIndex] ?? null

  return (
    <>
      {toolbarPortal}
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-0 overflow-hidden">
          <div className="relative w-full max-w-[560px]">
            {currentMove && (
              <div className="mb-2 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                Move {Math.ceil(currentMove.ply / 2)} · {currentMove.colour === 'white' ? 'White' : 'Black'} to play
              </div>
            )}
            <div className="aspect-square">
              <Chessboard config={boardConfig} />
            </div>
            <div className="absolute left-0 right-0 top-full pt-2">
              {phase === 'scored' && scoredTier !== null && (
                <div className={[
                  'px-3 py-2 rounded-[var(--radius-sm)] border',
                  scoredTier === 'miss'
                    ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
                    : scoredTier === 'good'
                    ? 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800'
                    : 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800',
                ].join(' ')}>
                  <div className="flex items-center justify-between">
                    <span className={[
                      'text-xs font-medium',
                      scoredTier === 'miss' ? 'text-red-700 dark:text-red-300'
                        : scoredTier === 'good' ? 'text-yellow-700 dark:text-yellow-300'
                        : 'text-green-700 dark:text-green-300',
                    ].join(' ')}>
                      {tierLabel(scoredTier, game?.analysed ?? false)}
                    </span>
                    <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                      +{tierPoints(scoredTier, game?.analysed ?? false)} pt{tierPoints(scoredTier, game?.analysed ?? false) !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {scoredTier === 'miss' && (
                    <p className="text-xs mt-0.5 text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)]">
                      Game move: {scoredSan}
                    </p>
                  )}
                  {scoredCpLoss !== null && scoredCpLoss > 0 && (
                    <p className="text-xs mt-0.5 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                      {(scoredCpLoss / 100).toFixed(1)} pawn{scoredCpLoss !== 100 ? 's' : ''} below best
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
