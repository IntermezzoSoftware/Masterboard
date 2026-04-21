import { useState, useEffect } from 'react'
import { useChessGameContext } from '@/context/ChessGameContext'
import { useAnalysisContext } from '@/context/AnalysisContext'
import { useToast } from '@/context/ToastContext'
import { ResultBadge } from '@/components/ResultBadge'
import { formatTimeControl } from '@/lib/gameFormatters'
import MoveList from '@/components/MoveList'
import { api, type ECOEntry, type Repertoire, type RepertoireMove } from '@/lib/api'
import type { GameNode } from '@/hooks/useChessGame'

function playerStr(name: string | undefined, elo: number | null | undefined): string {
  if (!name) return '?'
  return elo != null ? `${name} (${elo})` : name
}

export default function NotationPanel() {
  const {
    rootNode, currentNode, gameMetadata, savedGameId, loadGame,
    goToNode, deleteFrom, promoteVariation,
    setNodeNag, setNodeComment,
  } = useChessGameContext()
  const { deviationResult } = useAnalysisContext()
  const showToast = useToast()
  const [liveEco, setLiveEco] = useState<ECOEntry | null>(null)
  const [repertoires, setRepertoires] = useState<Repertoire[]>([])

  useEffect(() => {
    api.classifyPosition(currentNode.fen)
      .then(entry => setLiveEco(entry ?? null))
      .catch(() => {})
  }, [currentNode.fen])

  useEffect(() => {
    api.listRepertoires()
      .then(list => setRepertoires(list ?? []))
      .catch(() => {})
  }, [])

  async function addToRepertoire(node: GameNode, repertoireId: string) {
    const chain: GameNode[] = []
    let cur: GameNode | null = node
    while (cur !== null && cur.move !== null) {
      chain.push(cur)
      cur = cur.parent
    }
    chain.reverse()

    let existingMoves: RepertoireMove[]
    try {
      const data = await api.loadRepertoire(repertoireId)
      existingMoves = data?.moves ?? []
    } catch {
      showToast('Failed to load repertoire.', 'error')
      return
    }

    // Build dedup set, toFen→id map, and existing-destinations set (mirrors importPGN in useRepertoireBuilder.ts).
    const existingSet  = new Set(existingMoves.map(m => `${m.fromFen}|${m.moveUci}`))
    const toFenToId    = new Map(existingMoves.map(m => [m.toFen, m.id] as [string, string]))
    // existingToFens: positions already reached by existing moves — used for transposition detection.
    // When a new move leads to one of these positions, it's a transposition: preserve the existing
    // canonical toFen→id mapping so subsequent moves are parented to the canonical branch.
    const existingToFens = new Set(existingMoves.map(m => m.toFen))

    let saved = 0
    for (const n of chain) {
      const fromFen = n.parent!.fen
      const toFen   = n.fen
      const uci     = n.move!.from + n.move!.to + (n.move!.promotion ?? '')
      const key     = `${fromFen}|${uci}`

      if (existingSet.has(key)) continue

      const parentId  = toFenToId.get(fromFen) ?? null
      const moveOrder = [...existingSet].filter(k => k.startsWith(fromFen + '|')).length

      const newMove: RepertoireMove = {
        id: '', repertoireId, parentId, fromFen, toFen,
        moveSan: n.san ?? '', moveUci: uci, moveOrder,
        nag: null, comment: '', shapes: '', isTransposition: false,
      }

      try {
        const savedId = await api.saveRepertoireMove(newMove)
        existingSet.add(key)
        // Only update the canonical mapping if this position wasn't already reached
        // by an existing move. If it was, this move is a transposition and the
        // canonical mapping (toFen → existing branch's ID) must be preserved so
        // subsequent moves in the chain are parented correctly to the canonical branch.
        if (!existingToFens.has(toFen)) {
          toFenToId.set(toFen, savedId)
        }
        saved++
      } catch {
        // Non-fatal: continue with the rest of the chain.
      }
    }

    const repName = repertoires.find(r => r.id === repertoireId)?.name ?? 'repertoire'
    if (saved === 0) {
      showToast(`Already in ${repName}.`)
    } else {
      showToast(`Added ${saved} move${saved === 1 ? '' : 's'} to ${repName}.`)
    }
  }

  const header = gameMetadata ? (() => {
    const { white, black, whiteElo, blackElo, result, date, event, eco, opening, timeControl } = gameMetadata
    const dateDisplay = date ? date.slice(0, 10) : ''
    const displayEco     = liveEco?.eco  ?? eco     ?? ''
    const displayOpening = liveEco?.name ?? opening ?? ''
    const openingDisplay = displayOpening && displayEco
      ? `${displayOpening} (${displayEco})`
      : (displayOpening || displayEco)
    const details = [event, dateDisplay, openingDisplay, timeControl ? formatTimeControl(timeControl) : '']
      .filter(Boolean)
      .join(' · ')

    return (
      <div className="shrink-0 px-3 pt-2.5 pb-2 border-b border-[var(--color-surface-3)] dark:border-[var(--color-dark-surface-3)]">
        {/* Players + result */}
        <div className="flex items-center gap-1.5 text-xs min-w-0">
          <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] truncate min-w-0">
            {playerStr(white, whiteElo)}
          </span>
          {result && (
            <span className="shrink-0">
              <ResultBadge result={result} />
            </span>
          )}
          <span className="font-medium text-[var(--color-content-primary)] dark:text-[var(--color-dark-content-primary)] truncate min-w-0 text-right">
            {playerStr(black, blackElo)}
          </span>
        </div>
        {/* Details line */}
        {details && (
          <div className="mt-0.5 text-xs text-[var(--color-content-secondary)] dark:text-[var(--color-dark-content-secondary)] truncate">
            {details}
          </div>
        )}
      </div>
    )
  })() : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {header}
      <MoveList
        rootNode={rootNode}
        currentNodeId={currentNode.id}
        onGoToNode={goToNode}
        onDeleteFrom={deleteFrom}
        onPromoteVariation={promoteVariation}
        onSetNodeNag={setNodeNag}
        onSetNodeComment={setNodeComment}
        result={gameMetadata?.result}
        repertoires={repertoires}
        onAddToRepertoire={addToRepertoire}
        deviationFen={deviationResult?.deviationPly !== undefined && deviationResult.deviationPly >= 0 ? deviationResult.deviationFen : undefined}
        deviationMove={deviationResult?.deviationPly !== undefined && deviationResult.deviationPly >= 0 ? deviationResult.playedMove : undefined}
      />
    </div>
  )
}
