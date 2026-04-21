import { useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import Chessboard from '@/components/Chessboard'
import BoardControls from '@/components/BoardControls'
import EvalBar from '@/components/EvalBar'
import { EVAL_BAR_GAP, inputFilter, computeSize, computeCgSize, findPlyOfNode } from './boardPanelUtils'
import { useNavBlur } from '@/hooks/useNavBlur'
import { useBoardEngineArrows } from './useBoardEngineArrows'
import { useChessGameContext } from '@/context/ChessGameContext'
import { useEngineContext } from '@/context/EngineContext'
import { useAnalysisContext } from '@/context/AnalysisContext'
import { evalWhitePercent, formatScore } from '@/lib/engineUtils'
import type { EngineInfo } from '@/lib/api'
import type { Api } from '@lichess-org/chessground/api'
import type { Config } from '@lichess-org/chessground/config'


export default function BoardPanel() {
  const {
    boardConfig, currentNode, rootNode, orientation,
    goBack, goForward, goToStart, goToEnd, flipOrientation,
  } = useChessGameContext()

  const { lines, isAnalysing: engineRunning } = useEngineContext()
  const { result: analysisResult } = useAnalysisContext()

  // Derive eval bar values: live engine takes priority, then game analysis
  const topLine = lines[0]
  const analysisEvals = analysisResult?.status === 'complete' ? analysisResult.evals : null

  const { evalBarVisible, evalBarWhitePct, evalBarScore } = useMemo(() => {
    // Live engine always wins
    if (engineRunning && topLine) {
      return {
        evalBarVisible: true,
        evalBarWhitePct: evalWhitePercent(topLine),
        evalBarScore: formatScore(topLine),
      }
    }
    // Fall back to game analysis evals
    if (analysisEvals && analysisEvals.length > 0) {
      const ply = findPlyOfNode(rootNode, currentNode)
      let cp: number | null = null
      let mate: number | null = null
      if (ply === 0) {
        // At root position: use bestCp/bestMate from ply 1 (the eval of this position)
        const first = analysisEvals.find(e => e.ply === 1)
        if (first) { cp = first.bestCp; mate = first.bestMate }
      } else {
        // After ply N: use playedCp/playedMate from that ply (the resulting position eval)
        const ev = analysisEvals.find(e => e.ply === ply)
        if (ev) { cp = ev.playedCp; mate = ev.playedMate }
      }
      if (cp != null || mate != null) {
        const isMate = mate != null
        const scoreCp = cp ?? 0
        const scoreMate = mate ?? 0
        return {
          evalBarVisible: true,
          evalBarWhitePct: evalWhitePercent({ scoreCp, isMate, scoreMate } as EngineInfo),
          evalBarScore: formatScore({ scoreCp, isMate, scoreMate } as EngineInfo),
        }
      }
    }
    return { evalBarVisible: false, evalBarWhitePct: 50, evalBarScore: '' }
  }, [engineRunning, topLine, analysisEvals, rootNode, currentNode])

  // Ref to the live chessground API for imperative engine arrow updates.
  const cgApiRef = useRef<Api | null>(null)

  // prevBoardConfigRef is only updated once cgSize > 0 (i.e. once Chessboard
  // can actually mount).  This prevents a race where a render fires between
  // BoardPanel's first render and the ResizeObserver callback: without this
  // guard the useMemo would cache a partial config (no fen) before Chessboard
  // ever mounts, causing chessground to initialise at the starting position
  // instead of the current game position.
  const prevBoardConfigRef = useRef<Config | undefined>(undefined)
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

  // cgSize is the exact pixel size chessground will render cg-container at.
  // Using it for the board div ensures the wrap element fed to chessground is already
  // cgSize wide/tall, so cg-container fills it exactly — no remainder, constant gap.
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
    const boardChanged = prevBoardConfigRef.current !== boardConfig
    if (cgWasPositiveRef.current) {
      prevBoardConfigRef.current = boardConfig
    }
    if (boardChanged) {
      return {
        ...boardConfig,
        drawable: { ...boardConfig.drawable, brushes: engineBrushes },
      }
    }
    // Nothing changed — return undefined to skip chessground set() entirely.
    return undefined
  }, [boardConfig, engineBrushes])

  return (
    <div ref={containerRef} className="flex flex-col gap-2 h-full w-full p-2 overflow-hidden">
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
          canGoBack={currentNode.parent !== null}
          canGoForward={currentNode.children.length > 0}
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

