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
import { api, type DrillCard, type DrillScope, type DrillSummary } from '@/lib/api'
import { btnGhost, btnSecondary, btnTitlebarGhost } from '@/lib/classNames'
import { useTitlebarBreadcrumb, TitlebarToolbarPortal, TitlebarToolbarLeftPortal, useTitlebar } from '@/context/TitlebarContext'


function nagSymbol(nag: number | null): string {
  if (nag === null) return ''
  const symbols: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' }
  return symbols[nag] ?? `$${nag}`
}


type DrillPhase = 'loading' | 'animating' | 'waiting' | 'correct' | 'incorrect' | 'complete' | 'empty'


export default function DrillPage() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const scope     = ((location.state as Record<string, unknown>)?.scope ?? {}) as DrillScope
  const returnTo  = ((location.state as Record<string, unknown>)?.returnTo as string | undefined) ?? '/openings'

  const [cards, setCards]                       = useState<DrillCard[]>([])
  const [index, setIndex]                       = useState(0)
  const [totalReviewed, setTotalReviewed]       = useState(0)
  const [phase, setPhase]                       = useState<DrillPhase>('loading')
  const [displayFen, setDisplayFen]             = useState(INITIAL_FEN)
  const [lastMove, setLastMove]                 = useState<Key[] | undefined>(undefined)
  const [arrows, setArrows]                     = useState<DrawShape[]>([])
  const [feedbackSans, setFeedbackSans]         = useState<string[]>([])
  const [alreadyDrilledSan, setAlreadyDrilledSan] = useState<string | null>(null)
  const [summary, setSummary]                   = useState<DrillSummary | null>(null)
  const sessionStartRef                         = useRef<string | null>(null)

  useTitlebarBreadcrumb([{ label: 'Openings', to: '/openings' }, { label: 'Drill' }])
  const { compact } = useTitlebar()

  // Load drill session once on mount.
  useEffect(() => {
    api.getDrillSession(scope)
      .then(loaded => {
        const cs = loaded ?? []
        // Record session start after cards arrive so the summary window is tight.
        if (sessionStartRef.current === null) {
          sessionStartRef.current = new Date().toISOString()
        }
        setCards(cs)
        if (cs.length === 0) {
          setPhase('empty')
        } else {
          showCardAt(0, cs)
        }
      })
      .catch(() => setPhase('empty'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch summary when drill session ends.
  useEffect(() => {
    if (phase === 'complete' && sessionStartRef.current) {
      api.getDrillSummary(sessionStartRef.current).then(setSummary).catch(() => {})
    }
  }, [phase])

  const card = cards[index] ?? null

  // Refs so chessground callbacks always see the current value without
  // causing boardConfig to rebuild unnecessarily.
  const stateRef = useRef({ phase, card, index, cards })
  stateRef.current = { phase, card, index, cards }

  // Tracks moveIds answered correctly in the current session batch.
  // The due flag on sibling moves is computed at session-fetch time and can be stale
  // by the time a later card in the same batch is shown — so we also check this ref.
  const answeredMoveIdsRef = useRef<Set<string>>(new Set())

  // Show card at nextIndex, animating the preceding opponent move first if present.
  // When the batch is exhausted, re-query for newly due cards (incorrectly answered
  // moves are immediately re-queued) and continue; only show 'complete' when the
  // server returns nothing.
  // In ignoreSchedule mode the session ends immediately when all cards are shown.
  function showCardAt(nextIndex: number, cs: DrillCard[]) {
    if (nextIndex >= cs.length) {
      if (scope.ignoreSchedule) {
        setPhase('complete')
        return
      }
      api.getDrillSession(scope)
        .then(more => {
          const next = more ?? []
          if (next.length === 0) {
            setPhase('complete')
          } else {
            answeredMoveIdsRef.current = new Set()
            setCards(next)
            showCardAt(0, next)
          }
        })
        .catch(() => setPhase('complete'))
      return
    }
    const c = cs[nextIndex]
    setIndex(nextIndex)
    setArrows([])
    setFeedbackSans([])
    setAlreadyDrilledSan(null)
    if (c.precedingMove) {
      setDisplayFen(c.precedingMove.fromFen)
      setLastMove(undefined)
      setPhase('animating')
      setTimeout(() => {
        setDisplayFen(c.fromFen)
        setLastMove([c.precedingMove!.uci.slice(0, 2) as Key, c.precedingMove!.uci.slice(2, 4) as Key])
        setPhase('waiting')
      }, 600)
    } else {
      setDisplayFen(c.fromFen)
      setLastMove(undefined)
      setPhase('waiting')
    }
  }

  function advanceCard(nextIndex: number) {
    showCardAt(nextIndex, stateRef.current.cards)
  }

  // Normalise castling UCI to king-to-destination form (e1g1/e1c1/e8g8/e8c8)
  // so that king-to-rook (e1h1/e1a1/e8h8/e8a8) and king-to-destination variants
  // are treated as equivalent regardless of which form the database or chessground uses.
  function normCastle(uci: string): string {
    const map: Record<string, string> = {
      e1h1: 'e1g1', e1a1: 'e1c1',
      e8h8: 'e8g8', e8a8: 'e8c8',
    }
    const base = uci.slice(0, 4)
    return (map[base] ?? base) + uci.slice(4)
  }

  function handleMove(orig: string, dest: string) {
    const { phase: p, card: c, index: i, cards: cs } = stateRef.current
    if ((p !== 'waiting' && p !== 'incorrect') || !c) return

    setAlreadyDrilledSan(null)

    const played = normCastle(orig + dest)

    // Helper: does a UCI string match the played move?
    const matches = (uci: string) => {
      const n = normCastle(uci)
      return n === played || n.slice(0, 4) === played
    }

    if (matches(c.correctMove.uci)) {
      if (p === 'waiting') {
        answeredMoveIdsRef.current.add(c.correctMove.moveId)
        void api.recordDrillResult([c.correctMove.moveId], true)
        setTotalReviewed(prev => prev + 1)
      }
      setPhase('correct')
      setDisplayFen(c.correctMove.toFen)
      setLastMove([orig as Key, dest as Key])
      setFeedbackSans([c.correctMove.san])
      setArrows([])
      setTimeout(() => advanceCard(i + 1), (c.correctMove.comment || c.correctMove.nag !== null) ? 2000 : 800)
      return
    }

    const siblings = c.siblingMoves ?? []
    const matchedSibling = siblings.find(s => matches(s.uci))

    // A sibling is effectively due only if the DB said so AND it hasn't already
    // been answered earlier in this same session batch (the due flag is stale once
    // a card from the same position is answered).
    const siblingIsDue = (s: typeof matchedSibling) =>
      s !== undefined && s.due && !answeredMoveIdsRef.current.has(s.moveId)

    if (siblingIsDue(matchedSibling)) {
      answeredMoveIdsRef.current.add(matchedSibling!.moveId)
      void api.recordDrillResult([matchedSibling!.moveId], true)
      setTotalReviewed(prev => prev + 1)
      const newCards = cs.filter(card => card.correctMove.moveId !== matchedSibling!.moveId)
      setCards(newCards)
      setPhase('correct')
      setDisplayFen(matchedSibling!.toFen)
      setLastMove([orig as Key, dest as Key])
      setFeedbackSans([matchedSibling!.san])
      setArrows([])
      setTimeout(() => showCardAt(i + 1, newCards), 800)
      return
    }

    if (matchedSibling) {
      setDisplayFen(c.fromFen)
      setLastMove(undefined)
      setAlreadyDrilledSan(matchedSibling.san)
      return
    }

    // 4. Not in repertoire at all.
    if (p === 'waiting') {
      const allValid = [c.correctMove, ...siblings]
      const correctArrows: DrawShape[] = allValid.map(m => ({
        orig: m.uci.slice(0, 2) as Key,
        dest: m.uci.slice(2, 4) as Key,
        brush: 'green',
      }))
      setPhase('incorrect')
      setArrows(correctArrows)
      setFeedbackSans(allValid.map(m => m.san))
      void api.recordDrillResult([c.correctMove.moveId], false, played)
      setDisplayFen(c.fromFen)
      setLastMove(undefined)
    }
    // Wrong move while already in 'incorrect' phase: ignore (board snaps back via fen).
  }

  // Board config — rebuilt only when position or interaction state changes.
  const boardConfig = useMemo((): Config => {
    let dests: Map<Key, Key[]> = new Map()
    let turn: 'white' | 'black' = 'white'
    try {
      const chess = chessFromFen(displayFen)
      turn = chess.turn === 'white' ? 'white' : 'black'
      if ((phase === 'waiting' || phase === 'incorrect') && card) {
        dests = chessgroundDests(chess)
      }
    } catch {
      // invalid FEN — show static board
    }
    return {
      fen: displayFen,
      orientation: card?.colour ?? 'white',
      turnColor: turn,
      lastMove,
      movable: {
        color: (phase === 'waiting' || phase === 'incorrect') && card ? card.colour : undefined,
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
  }, [displayFen, phase, lastMove, arrows, card]) // eslint-disable-line react-hooks/exhaustive-deps


  const toolbarPortal = (
    <>
      <TitlebarToolbarLeftPortal>
        <button onClick={() => navigate(returnTo)} className={btnTitlebarGhost} aria-label="Stop training" title={compact ? 'Stop' : undefined}>
          <ArrowLeft size={14} />
          {!compact && 'Stop'}
        </button>
      </TitlebarToolbarLeftPortal>
      {phase !== 'loading' && phase !== 'empty' && phase !== 'complete' && cards.length > 0 && (
        <TitlebarToolbarPortal>
          <span className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
            {index + 1} / {cards.length}
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
            <p className="text-sm text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
              Loading…
            </p>
          </div>
        </div>
      </>
    )
  }

  if (phase === 'empty' || phase === 'complete') {
    const isReviewAll = scope.ignoreSchedule && phase === 'complete'
    const pct = summary && summary.totalReviewed > 0
      ? Math.round((summary.correctCount / summary.totalReviewed) * 100)
      : null
    return (
      <>
        {toolbarPortal}
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-semibold text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)]">
                {isReviewAll ? 'Review complete' : 'All caught up'}
              </p>
              {phase === 'complete' && summary ? (
                <>
                  <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] mt-1">
                    {isReviewAll
                      ? `${summary.totalReviewed} move${summary.totalReviewed === 1 ? '' : 's'} covered`
                      : `${summary.totalReviewed} move${summary.totalReviewed === 1 ? '' : 's'} reviewed`}
                    {pct !== null ? `  ·  ${pct}% correct` : ''}
                  </p>
                  {!isReviewAll && summary.newToLearning > 0 && (
                    <p className="text-xs text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)] mt-0.5">
                      {summary.newToLearning} new move{summary.newToLearning === 1 ? '' : 's'} added to your schedule
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] mt-1">
                  {isReviewAll ? 'Review complete.' : 'No moves are due for review.'}
                </p>
              )}
              <div className="flex justify-center mt-4">
                <button className={btnSecondary} onClick={() => navigate(returnTo)}>
                  Back to Openings
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }


  return (
    <>
    {toolbarPortal}
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-0 overflow-hidden">
        {/* Board + feedback strip share a relative container so the strip never affects board layout */}
        <div className="relative w-full max-w-[560px]">
          <div className="aspect-square">
            <Chessboard config={boardConfig} />
          </div>

          {/* Feedback strip — absolutely positioned below the board, does not shift it */}
          <div className="absolute left-0 right-0 top-full pt-2">
            {phase === 'correct' && feedbackSans.length > 0 && (
              <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                <span className="text-green-700 dark:text-green-300 text-xs font-medium">
                  Correct — {feedbackSans[0]}
                </span>
                {card && (card.correctMove.comment || card.correctMove.nag) && (
                  <p className="text-xs italic mt-1 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                    {card.correctMove.nag && (
                      <span className="font-medium not-italic mr-1">{nagSymbol(card.correctMove.nag)}</span>
                    )}
                    {card.correctMove.comment}
                  </p>
                )}
              </div>
            )}
            {phase === 'incorrect' && (
              <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
                <span className="text-red-700 dark:text-red-300 text-xs font-medium">
                  Correct: {feedbackSans.join(', ')} — play the correct move to continue.
                </span>
                {card && (card.correctMove.comment || card.correctMove.nag) && (
                  <p className="text-xs italic mt-1 text-[var(--color-content-tertiary)] dark:text-[var(--color-dark-content-tertiary)]">
                    {card.correctMove.nag && (
                      <span className="font-medium not-italic mr-1">{nagSymbol(card.correctMove.nag)}</span>
                    )}
                    {card.correctMove.comment}
                  </p>
                )}
              </div>
            )}
            {alreadyDrilledSan !== null && phase === 'waiting' && (
              <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] dark:bg-[var(--color-dark-surface-2)] border border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
                <span className="text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] text-xs font-medium">
                  {alreadyDrilledSan} already drilled — choose another line.
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
