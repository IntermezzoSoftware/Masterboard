import { useMemo, useRef, useState, useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import Chessboard from '@/components/Chessboard'
import BoardControls from '@/components/BoardControls'
import EvalBar from '@/components/EvalBar'
import { EVAL_BAR_GAP, inputFilter, computeSize, computeCgSize } from './boardPanelUtils'
import { useNavBlur } from '@/hooks/useNavBlur'
import { useBoardEngineArrows } from './useBoardEngineArrows'
import { useRepertoireBuilderContext } from '@/context/RepertoireBuilderContext'
import { useEngineContext } from '@/context/EngineContext'
import { evalWhitePercent, formatScore } from '@/lib/engineUtils'
import type { Api } from '@lichess-org/chessground/api'
import type { Config } from '@lichess-org/chessground/config'


export default function RepertoireBoardPanel() {
  const {
    boardConfig, moves, currentMoveId, orientation,
    makeMove, goBack, goForward, goToStart, goToEnd, flipOrientation,
  } = useRepertoireBuilderContext()

  const { lines, isAnalysing: engineRunning } = useEngineContext()

  // Eval bar from live engine
  const topLine = lines[0]
  const { evalBarVisible, evalBarWhitePct, evalBarScore } = useMemo(() => {
    if (engineRunning && topLine) {
      return {
        evalBarVisible: true,
        evalBarWhitePct: evalWhitePercent(topLine),
        evalBarScore: formatScore(topLine),
      }
    }
    return { evalBarVisible: false, evalBarWhitePct: 50, evalBarScore: '' }
  }, [engineRunning, topLine])

  // Ref to the live chessground API for imperative engine arrow updates.
  const cgApiRef = useRef<Api | null>(null)

  const prevBoardConfigRef = useRef<Config | undefined>(undefined)
  const prevMakeMoveRef = useRef<typeof makeMove | undefined>(undefined)
  const cgWasPositiveRef = useRef(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const [boardSize, setBoardSize] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setBoardSize(computeSize(width, height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useNavBlur()
  useHotkeys('left',  goBack,          { preventDefault: true, ...inputFilter }, [goBack])
  useHotkeys('right', goForward,       { preventDefault: true, ...inputFilter }, [goForward])
  useHotkeys('home',  goToStart,       { preventDefault: true, ...inputFilter }, [goToStart])
  useHotkeys('up',    goToStart,       { preventDefault: true, ...inputFilter }, [goToStart])
  useHotkeys('end',   goToEnd,         { preventDefault: true, ...inputFilter }, [goToEnd])
  useHotkeys('down',  goToEnd,         { preventDefault: true, ...inputFilter }, [goToEnd])
  useHotkeys('f',     flipOrientation, { ...inputFilter },                       [flipOrientation])

  const canGoBack    = currentMoveId !== null
  const canGoForward = moves.some(m => m.parentId === currentMoveId)

  const cgSize = boardSize > 0 ? computeCgSize(boardSize) : 0

  // Mark that cgSize has been positive at least once this mount.
  // Must happen before positionConfig useMemo so the ref is up-to-date.
  if (cgSize > 0) cgWasPositiveRef.current = true

  const { engineBrushes } = useBoardEngineArrows(cgApiRef, boardConfig, cgSize)

  // Position config for chessground — includes fen, movable, and engine brushes.
  // Engine autoShapes are NOT included here — they are updated imperatively
  // via cgApiRef.setAutoShapes() (inside useBoardEngineArrows) to avoid triggering
  // chessground's full set() → render() DOM walk during piece animations.
  const positionConfig = useMemo(() => {
    const base = {
      ...boardConfig,
      movable: {
        ...boardConfig.movable,
        events: {
          after: (orig: string, dest: string) => { void makeMove(orig, dest) },
        },
      },
    }
    const boardChanged = prevBoardConfigRef.current !== boardConfig || prevMakeMoveRef.current !== makeMove
    // Only advance refs once the board is visible. This keeps boardChanged=true
    // through all pre-mount renders so the first config Chessboard receives is
    // always the full config (with fen and orientation).
    if (cgWasPositiveRef.current) {
      prevBoardConfigRef.current = boardConfig
      prevMakeMoveRef.current = makeMove
    }
    if (boardChanged) {
      return { ...base, drawable: { ...base.drawable, brushes: engineBrushes } }
    }
    // Nothing changed — return undefined to skip chessground set() entirely.
    return undefined
  }, [boardConfig, engineBrushes, makeMove])

  return (
    <div
      ref={containerRef}
      data-testid="repertoire-board"
      className="flex flex-col gap-2 h-full w-full p-2 overflow-hidden"
    >
      {cgSize > 0 && (
        <div className="flex flex-row items-start" style={{ gap: EVAL_BAR_GAP }}>
          <div style={{ width: cgSize, height: cgSize }}>
            <Chessboard config={positionConfig} cgApiRef={cgApiRef} />
          </div>
          <EvalBar
            height={cgSize}
            whitePct={evalBarWhitePct}
            score={evalBarScore}
            orientation={orientation}
            visible={evalBarVisible}
          />
        </div>
      )}
      <div style={{ width: cgSize > 0 ? cgSize : '100%' }}>
        <BoardControls
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoToStart={goToStart}
          onGoBack={goBack}
          onGoForward={goForward}
          onGoToEnd={goToEnd}
          onFlip={flipOrientation}
        />
      </div>
    </div>
  )
}
