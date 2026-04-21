import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, pointerWithin } from '@dnd-kit/core'
import { useChessGameContext } from '@/context/ChessGameContext'
import { useAnalysisContext } from '@/context/AnalysisContext'
import { useToast } from '@/context/ToastContext'
import { api, type Collection, type Folder, type MoveEval, type ExplorerInitialState } from '@/lib/api'
import { normalizeUci } from '@/lib/uciUtils'
import MosaicNode from '@/workspace/MosaicNode'
import { WorkspaceActions, PanelToggles } from '@/workspace/WorkspaceToolbar'
import SaveGameDialog from '@/components/SaveGameDialog'
import PastePGNDialog from '@/components/PastePGNDialog'
import LoadFENDialog from '@/components/LoadFENDialog'
import PositionEditor from '@/components/PositionEditor'
import EditMetadataDialog from '@/components/EditMetadataDialog'

import { DEFAULT_LAYOUT, activatePanelById } from '@/workspace/layoutOps'
import { ALL_PANEL_IDS } from '@/workspace/panelRegistry'
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout'
import { useWorkspaceDnd } from '@/hooks/useWorkspaceDnd'
import { useWorkspacePanels } from '@/hooks/useWorkspacePanels'
import { metadataToHeaders } from '@/hooks/useChessGame'
import { useTitlebarBreadcrumb, TitlebarToolbarPortal, TitlebarToolbarLeftPortal } from '@/context/TitlebarContext'

export default function BoardPage() {
  return <BoardPageContent />
}

function BoardPageContent() {
  const {
    resetGame, toPGN, loadGame, loadFromFEN, currentNode, rootNode, hasContent,
    gameMetadata, setGameMetadata, savedGameId, markSaved,
    navigateToPV, setNodeNag, setNodeComment, goToStart, flipOrientation,
  } = useChessGameContext()
  const { isAnalysing, result: analysisResult, markAnnotated, setDeviationResult } = useAnalysisContext()
  const showToast = useToast()
  const location = useLocation()
  const [layout, setLayout] = useWorkspaceLayout(
    'masterboard.boardLayout',
    ALL_PANEL_IDS,
    DEFAULT_LAYOUT,
  )

  // Load a game from the database when navigated to with a gameId in state,
  // or load a master game PGN directly when navigated with masterPgn.
  // targetFen navigates to the explored position instead of the start.
  useEffect(() => {
    const state = location.state as { gameId?: string; masterPgn?: string; targetFen?: string; fen?: string; masterGame?: { white?: string; black?: string; eloWhite?: number | null; eloBlack?: number | null; result?: string; date?: string }; explorerInitialState?: ExplorerInitialState } | null
    if (state?.explorerInitialState) {
      // Activate the Explorer tab in whatever leaf it lives in.
      // layout is intentionally read from the closure at navigation time (board page is freshly mounted).
      setLayout(activatePanelById(layout, 'explorer'))
    }
    if (state?.fen) {
      setDeviationResult(null)
      loadFromFEN(state.fen)
      return
    }
    if (state?.masterPgn) {
      setDeviationResult(null)
      const g = state.masterGame
      loadGame(state.masterPgn, g ? {
        white: g.white,
        black: g.black,
        whiteElo: g.eloWhite || null,
        blackElo: g.eloBlack || null,
        result: g.result,
        date: g.date,
      } : null, state.targetFen)
      return
    }
    const gameId = state?.gameId
    if (!gameId) return
    Promise.all([api.getGame(gameId), api.getIdentityNames()]).then(([record, identityNames]) => {
      if (!record?.pgn) return
      loadGame(record.pgn, record, state?.targetFen)
      const names = identityNames ?? []
      if (record.black && names.some(n => n.toLowerCase() === record.black.toLowerCase())) {
        flipOrientation()
      }
    }).catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- layout read at navigation time only; board mounts fresh on each navigation
  }, [location.state, loadGame, loadFromFEN, flipOrientation, setLayout])

  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  useEffect(() => {
    if (!showSaveDialog) return
    Promise.all([api.listFolders(), api.listCollections()]).then(([f, c]) => {
      setFolders(f ?? [])
      setCollections(c ?? [])
    }).catch(() => {})
  }, [showSaveDialog])
  const [showPastePgn, setShowPastePgn] = useState(false)
  const [showLoadFen, setShowLoadFen] = useState(false)
  const [showPositionEditor, setShowPositionEditor] = useState(false)
  const [showEditMetadata, setShowEditMetadata] = useState(false)

  // Track whether analysis was initiated in this session so we show the
  // toast only for fresh completions, not when loading a previously-analyzed game.
  const wasAnalysingRef = useRef(false)
  useEffect(() => {
    if (isAnalysing) wasAnalysingRef.current = true
  }, [isAnalysing])

  // Apply analysis annotations to the game tree and persist the annotated PGN.
  // Fires both when analysis completes live AND when opening a game whose
  // analysis finished externally (e.g. triggered from the Games page).
  // The pgnAnnotated flag in the DB prevents double-annotation.
  useEffect(() => {
    if (!analysisResult || !savedGameId) return
    if (analysisResult.gameId !== savedGameId) return

    if (analysisResult.status === 'error' && wasAnalysingRef.current) {
      wasAnalysingRef.current = false
      showToast(analysisResult.errorMsg || 'Analysis failed', 'error')
      return
    }

    if (analysisResult.status !== 'complete' || analysisResult.pgnAnnotated) return

    const isLive = wasAnalysingRef.current
    wasAnalysingRef.current = false

    if (analysisResult.evals.length > 0) {
      const prevEvals = analysisResult.appliedEvals ?? []
      applyAnalysisAnnotations(rootNode, analysisResult.evals, prevEvals, setNodeNag, setNodeComment, navigateToPV)
      goToStart()
      const headers = gameMetadata ? metadataToHeaders(gameMetadata) : {}
      const appliedEvalsJSON = JSON.stringify(analysisResult.evals)
      api.updateGame(savedGameId, toPGN(headers), true, appliedEvalsJSON)
        .then(() => {
          markAnnotated(analysisResult.evals)
          markSaved(savedGameId)
        })
        .catch(() => {})
    }

    if (isLive) showToast('Analysis complete')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisResult, savedGameId, rootNode])

  function handleCopyFen() {
    navigator.clipboard.writeText(currentNode.fen)
      .then(() => showToast('FEN copied to clipboard'))
      .catch(() => showToast('Failed to copy FEN', 'error'))
  }

  function handleCopyPgn() {
    const headers = gameMetadata ? metadataToHeaders(gameMetadata) : {}
    navigator.clipboard.writeText(toPGN(headers))
      .then(() => showToast('PGN copied to clipboard'))
      .catch(() => showToast('Failed to copy PGN', 'error'))
  }

  function handleRequestNewGame()       { resetGame() }
  function handleRequestImportPgn()     { setShowPastePgn(true) }
  function handleRequestLoadFen()       { setShowLoadFen(true) }
  function handleRequestEditPosition()  { setShowPositionEditor(true) }
  function handleEditMetadata()          { if (gameMetadata) setShowEditMetadata(true) }

  async function handleSaveGame() {
    if (savedGameId) {
      const headers = gameMetadata ? metadataToHeaders(gameMetadata) : {}
      await api.updateGame(savedGameId, toPGN(headers))
        .then(() => { markSaved(savedGameId); showToast('Game saved') })
        .catch(() => showToast('Failed to save game', 'error'))
    } else {
      setShowSaveDialog(true)
    }
  }

  function handleSaveAsGame() {
    setShowSaveDialog(true)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const { activeIds, totalPanelCount, handleAdd, handleRemove, handleSetActiveTab } = useWorkspacePanels(layout, setLayout)
  const { activePanelLabel, handleDragStart, handleDragEnd } = useWorkspaceDnd(layout, setLayout)

  useTitlebarBreadcrumb([])

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <TitlebarToolbarLeftPortal>
        <WorkspaceActions
          onNewGame={handleRequestNewGame}
          onSaveGame={handleSaveGame}
          onSaveAsGame={handleSaveAsGame}
          hasSavedGame={savedGameId !== null}
          hasGame={hasContent}
          onCopyFen={handleCopyFen}
          onImportFen={handleRequestLoadFen}
          onEditPosition={handleRequestEditPosition}
          onCopyPgn={handleCopyPgn}
          onImportPgn={handleRequestImportPgn}
          onEditMetadata={handleEditMetadata}
        />
      </TitlebarToolbarLeftPortal>
      <TitlebarToolbarPortal>
        <PanelToggles
          panelIds={ALL_PANEL_IDS}
          activeIds={activeIds}
          totalPanelCount={totalPanelCount}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
      </TitlebarToolbarPortal>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 min-h-0 p-2">
          <MosaicNode
            node={layout}
            onRemove={handleRemove}
            onSetActiveTab={handleSetActiveTab}
            isOnlyPanel={totalPanelCount === 1}
          />
        </div>
      </div>

      <DragOverlay>
        {activePanelLabel && (
          <div className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] shadow-lg bg-[var(--color-accent)] text-white opacity-90">
            {activePanelLabel}
          </div>
        )}
      </DragOverlay>

      {showSaveDialog && (
        <SaveGameDialog
          pgn={toPGN()}
          initialWhite={gameMetadata?.white ?? ''}
          initialBlack={gameMetadata?.black ?? ''}
          initialEvent={gameMetadata?.event ?? ''}
          initialResult={gameMetadata?.result ?? '*'}
          folders={folders}
          collections={collections}
          onSaved={(id) => { markSaved(id) }}
          onClose={() => setShowSaveDialog(false)}
        />
      )}
      {showPastePgn && (
        <PastePGNDialog onClose={() => setShowPastePgn(false)} />
      )}
      {showLoadFen && (
        <LoadFENDialog onClose={() => setShowLoadFen(false)} />
      )}
      {showPositionEditor && (
        <PositionEditor initialFen={currentNode.fen} onClose={() => setShowPositionEditor(false)} />
      )}
      {showEditMetadata && savedGameId && gameMetadata && (
        <EditMetadataDialog
          gameId={savedGameId}
          initial={{
            white: gameMetadata.white ?? '',
            black: gameMetadata.black ?? '',
            whiteElo: gameMetadata.whiteElo ?? null,
            blackElo: gameMetadata.blackElo ?? null,
            result: gameMetadata.result ?? '*',
            date: gameMetadata.date ?? '',
            event: gameMetadata.event ?? '',
            site: gameMetadata.site ?? '',
            round: gameMetadata.round ?? '',
            eco: gameMetadata.eco ?? '',
            opening: gameMetadata.opening ?? '',
          }}
          onSaved={(updated) => {
            setGameMetadata(prev => prev ? { ...prev, ...updated } : prev)
            // do NOT call setShowEditMetadata(false) here — close() in the dialog handles it
          }}
          onClose={() => setShowEditMetadata(false)}
        />
      )}
    </DndContext>
  )
}

const NAG_LABEL: Record<number, string> = { 6: 'Inaccuracy', 2: 'Mistake', 4: 'Blunder' }

function formatEval(cp: number | null | undefined, mate: number | null | undefined): string {
  if (mate != null) return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`
  if (cp != null) {
    const sign = cp >= 0 ? '+' : ''
    return `${sign}${(cp / 100).toFixed(1)}`
  }
  return '0.0'
}

/** Returns the analysis-generated comment string for a MoveEval, or '' if none. */
function formatAnalysisComment(ev: MoveEval | undefined): string {
  if (!ev?.nag || !NAG_LABEL[ev.nag]) return ''
  return `${NAG_LABEL[ev.nag]}. ${formatEval(ev.bestCp, ev.bestMate)} → ${formatEval(ev.playedCp, ev.playedMate)}`
}

function applyAnalysisAnnotations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rootNode: any,
  evals: MoveEval[],
  prevEvals: MoveEval[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setNodeNag: (node: any, nag: number | undefined) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setNodeComment: (node: any, comment: string) => void,
  navigateToPV: (fen: string, uciMoves: string[]) => void,
) {
  let node = rootNode
  let ply = 0
  while (node.children?.[0]) {
    node = node.children[0]
    ply++
    const ev = evals.find((e: MoveEval) => e.ply === ply)
    if (!ev) continue

    const prevApplied = prevEvals.find((e: MoveEval) => e.ply === ply)
    const newNag: number | undefined = ev.nag ?? undefined
    const prevNag: number | undefined = prevApplied?.nag ?? undefined
    const currentNag: number | undefined = node.nag

    // NAG merge: only replace if the user hasn't changed it since last analysis.
    if (currentNag === prevNag) {
      setNodeNag(node, newNag)
    }
    // else: user edited the NAG — preserve it.

    // Comment merge: replace only the analysis-written prefix, preserve user text.
    const oldAnalysisComment = formatAnalysisComment(prevApplied)
    const newAnalysisComment = formatAnalysisComment(ev)
    const existing: string = node.comment ?? ''

    if (oldAnalysisComment !== '' && existing.startsWith(oldAnalysisComment)) {
      // Strip the old analysis prefix; keep whatever the user appended after it.
      let userPart = existing.slice(oldAnalysisComment.length)
      if (userPart.startsWith('. ')) userPart = userPart.slice(2)
      const merged = newAnalysisComment
        ? (userPart ? `${newAnalysisComment}. ${userPart}` : newAnalysisComment)
        : userPart
      setNodeComment(node, merged)
    } else {
      // Old analysis comment not found at front — user edited it, or first annotation.
      if (newAnalysisComment !== '') {
        const merged = existing ? `${newAnalysisComment}. ${existing}` : newAnalysisComment
        setNodeComment(node, merged)
      }
      // else: no new analysis comment and nothing to remove — leave node untouched.
    }

    // Remove the engine-inserted variation from the previous analysis run.
    // We always remove the entire old subtree (not just when the first move
    // changes) so that stale continuations deeper in the line are also cleared.
    // Children[0] is the mainline and is never touched.
    if (prevApplied?.nag && node.parent) {
      const prevPvMoves = prevApplied.bestPv.split(' ').filter(Boolean)
      const prevPlayedUci = normalizeUci(
        node.move ? node.move.from + node.move.to + (node.move.promotion ?? '') : '',
      )
      const prevPvFirst = prevPvMoves.length > 0 ? normalizeUci(prevPvMoves[0]) : ''
      if (prevPvFirst && prevPvFirst !== prevPlayedUci) {
        const idx = node.parent.children.findIndex((c: any, i: number) => {
          if (i === 0) return false
          const childUci = normalizeUci(
            (c.move?.from ?? '') + (c.move?.to ?? '') + (c.move?.promotion ?? ''),
          )
          return childUci === prevPvFirst
        })
        if (idx > 0) node.parent.children.splice(idx, 1)
      }
    }

    // Insert best-move variation (up to 10 ply) for classified moves.
    if (ev.nag && node.parent) {
      const pvMoves = ev.bestPv.split(' ').filter(Boolean).slice(0, 10)
      const playedUci = normalizeUci(
        node.move ? node.move.from + node.move.to + (node.move.promotion ?? '') : '',
      )
      if (pvMoves.length > 0 && pvMoves[0] !== playedUci) {
        navigateToPV(node.parent.fen, pvMoves)
      }
    }
  }
}
