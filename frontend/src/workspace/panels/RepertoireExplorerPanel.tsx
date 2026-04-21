import { useRepertoireBuilderContext } from '@/context/RepertoireBuilderContext'
import { sanToUci } from '@/lib/fenUtils'
import ExplorerPanelContent from './ExplorerPanelContent'

/**
 * Explorer panel for the Repertoire Builder page — reads position from
 * RepertoireBuilderContext and wires move clicks to makeMove so that clicking
 * a move row in the Explorer automatically adds it to the current repertoire.
 */
export default function RepertoireExplorerPanel() {
  const { currentFen, makeMove, orientation, repertoire } = useRepertoireBuilderContext()

  function handlePlayMove(san: string) {
    const uci = sanToUci(currentFen, san)
    if (uci) makeMove(uci.slice(0, 2), uci.slice(2, 4), uci.length > 4 ? uci.slice(4) : undefined)
  }

  return <ExplorerPanelContent fen={currentFen} orientation={orientation} excludeRepertoireId={repertoire?.id} onPlayMove={handlePlayMove} />
}
