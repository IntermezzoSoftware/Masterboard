import { useChessGameContext } from '@/context/ChessGameContext'
import { useAnalysisContext } from '@/context/AnalysisContext'
import type { MasterGameSummary } from '@/lib/api'
import { sanToUci } from '@/lib/fenUtils'
import { findNodeByPly } from './boardPanelUtils'
import ExplorerPanelContent from './ExplorerPanelContent'

/** Explorer panel for the Home page — reads position from ChessGameContext. */
export default function ExplorerPanel() {
  const { currentNode, loadGame, makeMove, orientation, rootNode, goToNode } = useChessGameContext()
  const { deviationResult } = useAnalysisContext()

  function handleLoadPgn(pgn: string, game: MasterGameSummary) {
    loadGame(pgn, {
      white: game.white,
      black: game.black,
      whiteElo: game.eloWhite || null,
      blackElo: game.eloBlack || null,
      result: game.result,
      date: game.date,
    }, currentNode.fen)
  }

  function handlePlayMove(san: string) {
    const uci = sanToUci(currentNode.fen, san)
    if (uci) makeMove(uci.slice(0, 2), uci.slice(2, 4), uci.length > 4 ? uci.slice(4) : undefined)
  }

  function handleJumpToDeviation() {
    if (!deviationResult || deviationResult.deviationPly < 0) return
    const node = findNodeByPly(rootNode, deviationResult.deviationPly)
    if (node) goToNode(node)
  }

  return (
    <ExplorerPanelContent
      fen={currentNode.fen}
      orientation={orientation}
      onLoadPgn={handleLoadPgn}
      onPlayMove={handlePlayMove}
      deviationResult={deviationResult}
      onJumpToDeviation={handleJumpToDeviation}
    />
  )
}
