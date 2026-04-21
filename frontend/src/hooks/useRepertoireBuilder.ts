/**
 * useRepertoireBuilder — state management for the repertoire builder page.
 *
 * Manages the interactive board, the flat move-tree loaded from the DB, and all
 * mutations (add move, delete branch, annotate, import PGN).  Deliberately
 * independent of ChessGameContext so there is no dual-source-of-truth.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Chess } from 'chessops/chess'
import { makeFen, INITIAL_FEN } from 'chessops/fen'
import { chessFromFen, positionFen } from '@/lib/fenUtils'
import { chessgroundDests } from 'chessops/compat'
import { makeSan } from 'chessops/san'
import { parseUci, makeUci } from 'chessops/util'
import type { Config } from '@lichess-org/chessground/config'
import type { Key } from '@lichess-org/chessground/types'
import { api, type HeatmapEntry, type Repertoire, type RepertoireMove, type ReorderUpdate } from '@/lib/api'
import { parseAllMovesFromPGN } from '@/lib/pgnUtils'


export interface RepertoireBuilderHook {
  repertoire: Repertoire | null
  moves: RepertoireMove[]        // full flat array from DB — refreshed after every mutation
  currentFen: string             // board position
  currentMoveId: string | null   // ID of the move that produced currentFen; null = at root
  boardConfig: Config            // Chessground config built from currentFen
  orientation: 'white' | 'black'
  isLoading: boolean
  error: string
  existingMoveSans: Set<string>  // SANs of direct children of currentMoveId
  heatmap: Map<string, HeatmapEntry> | null  // null until loaded; keyed by moveId
  loadHeatmap: (repertoireId: string) => void

  makeMove: (orig: string, dest: string, promotion?: string) => Promise<void>
  navigateTo: (move: RepertoireMove) => void
  goBack: () => void
  goForward: () => void
  goToStart: () => void
  goToEnd: () => void
  flipOrientation: () => void
  deleteMove: (moveId: string) => Promise<void>
  updateAnnotation: (moveId: string, nag: number | null, comment: string) => Promise<void>
  importPGN: (pgn: string) => Promise<number>
  importPolyglotBook: () => Promise<number>
  reorderSiblings: (moveId: string, direction: 'up' | 'down') => Promise<void>
}


export function useRepertoireBuilder(repertoireId: string): RepertoireBuilderHook {
  const [repertoire, setRepertoire]         = useState<Repertoire | null>(null)
  const [moves, setMoves]                   = useState<RepertoireMove[]>([])
  const [currentFen, setCurrentFen]         = useState<string>(INITIAL_FEN)
  const [currentMoveId, setCurrentMoveId]   = useState<string | null>(null)
  const [orientation, setOrientation]       = useState<'white' | 'black'>('white')
  const [isLoading, setIsLoading]           = useState(true)
  const [error, setError]                   = useState('')
  const [heatmap, setHeatmap]               = useState<Map<string, HeatmapEntry> | null>(null)


  const loadHeatmap = useCallback((repertoireId: string) => {
    api.getRepertoireHeatmap(repertoireId)
      .then(entries => {
        const map = new Map<string, HeatmapEntry>()
        for (const e of (entries ?? [])) {
          map.set(e.moveId, e)
        }
        setHeatmap(map)
      })
      .catch(() => {})
  }, [])


  const load = useCallback(async () => {
    try {
      const data = await api.loadRepertoire(repertoireId)
      if (!data) { setError('Repertoire not found.'); return }
      setRepertoire(data.repertoire)
      setMoves(data.moves ?? [])
      // Orient the board to match the repertoire colour on first load only
      setOrientation(data.repertoire.colour as 'white' | 'black')
    } catch {
      setError('Failed to load repertoire.')
    } finally {
      setIsLoading(false)
    }
  }, [repertoireId])

  useEffect(() => { load() }, [load])


  const boardConfig = useMemo((): Config => {
    try {
      const chess = chessFromFen(currentFen)
      const dests = chessgroundDests(chess)
      const turn  = chess.turn === 'white' ? 'white' : 'black'
      const currentMove = currentMoveId !== null ? moves.find(m => m.id === currentMoveId) : undefined
      const lastMove: Key[] | undefined = currentMove
        ? [currentMove.moveUci.slice(0, 2) as Key, currentMove.moveUci.slice(2, 4) as Key]
        : undefined
      return {
        fen: currentFen,
        orientation,
        turnColor: turn,
        lastMove,
        movable: {
          color: 'both',
          dests,
          free: false,
        },
        highlight: { lastMove: true, check: true },
        draggable: { enabled: true },
        selectable: { enabled: true },
      }
    } catch {
      return { fen: currentFen, orientation }
    }
  }, [currentFen, orientation, currentMoveId, moves])


  const existingMoveSans = useMemo((): Set<string> => {
    return new Set(
      moves
        .filter(m => m.parentId === currentMoveId)
        .map(m => m.moveSan)
    )
  }, [moves, currentMoveId])


  const navigateTo = useCallback((move: RepertoireMove) => {
    setCurrentFen(move.toFen)
    setCurrentMoveId(move.id)
  }, [])

  const goBack = useCallback(() => {
    if (currentMoveId === null) return
    const current = moves.find(m => m.id === currentMoveId)
    if (!current) return
    setCurrentFen(current.fromFen)
    setCurrentMoveId(current.parentId)
  }, [currentMoveId, moves])

  const goToStart = useCallback(() => {
    setCurrentFen(INITIAL_FEN)
    setCurrentMoveId(null)
  }, [])

  // Resolve the canonical move ID for a given FEN — i.e. the non-transposition move
  // whose toFen matches.  Returns null if there is no such move (root position).
  // Uses positionFen() so halfmove-clock / fullmove-number differences between
  // routes to the same position don't prevent the lookup from succeeding.
  const canonicalIdForFen = useCallback((fen: string): string | null => {
    const key = positionFen(fen)
    return moves.find(m => positionFen(m.toFen) === key && !m.isTransposition)?.id ?? null
  }, [moves])

  // Children for a given parent ID, following through transpositions when needed.
  const childrenOf = useCallback((parentId: string | null, parentFen: string) => {
    const direct = moves.filter(m => m.parentId === parentId)
    if (direct.length > 0) return direct
    // If no direct children the current endpoint may be a transposition — look up
    // the canonical node for this FEN and return its children instead.
    const canonicalId = canonicalIdForFen(parentFen)
    if (canonicalId && canonicalId !== parentId) {
      return moves.filter(m => m.parentId === canonicalId)
    }
    return []
  }, [moves, canonicalIdForFen])

  // Follow the main child (moveOrder === 0) one step forward
  const goForward = useCallback(() => {
    const mainChild = childrenOf(currentMoveId, currentFen)
      .sort((a, b) => a.moveOrder - b.moveOrder)[0]
    if (mainChild) navigateTo(mainChild)
  }, [currentMoveId, currentFen, childrenOf, navigateTo])

  // Follow the main line to the deepest position
  const goToEnd = useCallback(() => {
    let id = currentMoveId
    let fen = currentFen
    const visited = new Set<string | null>()
    while (true) {
      if (visited.has(id)) break // cycle guard
      visited.add(id)
      const mainChild = childrenOf(id, fen)
        .sort((a, b) => a.moveOrder - b.moveOrder)[0]
      if (!mainChild) break
      id = mainChild.id
      fen = mainChild.toFen
    }
    if (id !== currentMoveId) {
      setCurrentFen(fen)
      setCurrentMoveId(id)
    }
  }, [currentMoveId, currentFen, childrenOf])

  const flipOrientation = useCallback(() => {
    setOrientation(o => o === 'white' ? 'black' : 'white')
  }, [])


  const makeMove = useCallback(async (orig: string, dest: string, promotion?: string) => {
    let chess: Chess
    try {
      chess = chessFromFen(currentFen)
    } catch {
      return
    }

    const uciStr = orig + dest + (promotion ?? '')
    const move = parseUci(uciStr)
    if (!move) return

    let san: string
    try {
      san = makeSan(chess, move)
      chess.play(move)
    } catch {
      return // illegal move
    }

    const toFen = makeFen(chess.toSetup())
    const uci   = makeUci(move)

    // If this move already exists in the repertoire, just navigate to it
    const existing = moves.find(m => m.fromFen === currentFen && m.moveUci === uci)
    if (existing) {
      navigateTo(existing)
      return
    }

    // If we're currently sitting on a transposition endpoint, resolve to the canonical
    // branch's endpoint for parenting — so any new moves extend the canonical line.
    const currentMove = moves.find(m => m.id === currentMoveId)
    const resolvedParentId = (currentMove?.isTransposition && currentMove.toFen === currentFen)
      ? (moves.find(m => positionFen(m.toFen) === positionFen(currentFen) && !m.isTransposition)?.id ?? currentMoveId)
      : currentMoveId

    // New move — persist to DB
    const moveOrder = moves.filter(m => m.fromFen === currentFen).length
    // Detect transposition: if another move already reaches this same destination position.
    // Compare by positionFen() so routes with different halfmove-clock or fullmove-number
    // values are still recognised as reaching the same position.
    const toFenKey = positionFen(toFen)
    const isTransposition = moves.some(m => positionFen(m.toFen) === toFenKey)
    const newMove: RepertoireMove = {
      id: '',
      repertoireId,
      parentId: resolvedParentId,
      fromFen: currentFen,
      toFen,
      moveSan: san,
      moveUci: uci,
      moveOrder,
      nag: null,
      comment: '',
      shapes: '',
      isTransposition,
    }

    try {
      const savedId = await api.saveRepertoireMove(newMove)
      const savedMove: RepertoireMove = { ...newMove, id: savedId }
      setMoves(prev => [...prev, savedMove])
      setCurrentFen(toFen)
      // Always navigate to the newly saved move so it's visible and highlighted in the
      // tree. For transpositions the ⇄ indicator appears on this move. The user can
      // navigate to the canonical endpoint separately to extend that line.
      setCurrentMoveId(savedId)
    } catch {
      setError('Failed to save move.')
    }
  }, [currentFen, currentMoveId, moves, navigateTo, repertoireId])


  const deleteMove = useCallback(async (moveId: string) => {
    try {
      await api.deleteRepertoireBranch(moveId)
      // If we were on the deleted branch, back up to start
      if (currentMoveId === moveId) {
        const m = moves.find(x => x.id === moveId)
        setCurrentFen(m?.fromFen ?? INITIAL_FEN)
        setCurrentMoveId(m?.parentId ?? null)
      }
      // Reload to get correct cascade state
      const data = await api.loadRepertoire(repertoireId)
      if (data) setMoves(data.moves ?? [])
    } catch {
      setError('Failed to delete move.')
    }
  }, [currentMoveId, moves, repertoireId])


  const updateAnnotation = useCallback(async (
    moveId: string,
    nag: number | null,
    comment: string,
  ) => {
    const target = moves.find(m => m.id === moveId)
    if (!target) return
    const updated: RepertoireMove = { ...target, nag, comment }
    try {
      await api.updateRepertoireMove(updated)
      setMoves(prev => prev.map(m => m.id === moveId ? updated : m))
    } catch {
      setError('Failed to update annotation.')
    }
  }, [moves])


  const reorderSiblings = useCallback(async (moveId: string, direction: 'up' | 'down') => {
    const target = moves.find(m => m.id === moveId)
    if (!target) return

    const siblings = moves
      .filter(m => m.parentId === target.parentId && m.fromFen === target.fromFen)
      .sort((a, b) => a.moveOrder - b.moveOrder)

    const idx = siblings.findIndex(m => m.id === moveId)
    if (idx === -1) return
    if (direction === 'up'   && idx === 0)                   return
    if (direction === 'down' && idx === siblings.length - 1) return

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const reordered = [...siblings]
    ;[reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]]

    const updates: ReorderUpdate[] = reordered.map((m, i) => ({ id: m.id, newOrder: i }))

    // Optimistic update
    setMoves(prev => prev.map(m => {
      const u = updates.find(u => u.id === m.id)
      return u ? { ...m, moveOrder: u.newOrder } : m
    }))

    try {
      await api.reorderRepertoireMoves(updates)
    } catch {
      // Revert on failure
      const data = await api.loadRepertoire(repertoireId)
      setMoves(data?.moves ?? [])
    }
  }, [moves, repertoireId])


  const importPGN = useCallback(async (pgn: string): Promise<number> => {
    const extracted = parseAllMovesFromPGN(pgn)
    if (extracted.length === 0) return 0

    // Deduplicate: skip moves already in the repertoire
    const existing = new Set(moves.map(m => `${m.fromFen}|${m.moveUci}`))

    let saved = 0
    // Track newly saved moves keyed by positionFen(toFen) → id, so we can chain
    // parentIds within the same import batch (moves earlier in the list may be
    // parents of later ones).  Using positionFen() keys means routes that reach
    // the same position via different halfmove-clock paths are treated as equal.
    const savedByToFen = new Map<string, string>(
      moves.map(m => [positionFen(m.toFen), m.id] as [string, string])
    )
    // existingToFens: position keys already reached by existing moves — used for
    // transposition detection and to preserve canonical toFen→id mappings.
    const existingToFens = new Set(moves.map(m => positionFen(m.toFen)))

    for (const ex of extracted) {
      const key = `${ex.fromFen}|${ex.uci}`
      if (existing.has(key)) continue

      const posToFen = positionFen(ex.toFen)
      const parentId = savedByToFen.get(positionFen(ex.fromFen)) ?? null
      const moveOrder = [...existing].filter(k => k.startsWith(ex.fromFen + '|')).length
      const isTransposition = existingToFens.has(posToFen) || savedByToFen.has(posToFen)
      const newMove: RepertoireMove = {
        id: '',
        repertoireId,
        parentId,
        fromFen: ex.fromFen,
        toFen: ex.toFen,
        moveSan: ex.san,
        moveUci: ex.uci,
        moveOrder,
        nag: ex.nag,
        comment: ex.comment,
        shapes: '',
        isTransposition,
      }

      try {
        const savedId = await api.saveRepertoireMove(newMove)
        existing.add(key)
        // Only update the canonical mapping if this position wasn't already reached
        // by an existing move. If it was, this move is a transposition and the
        // canonical mapping (positionFen → existing branch's ID) must be preserved so
        // subsequent moves in the chain are parented correctly to the canonical branch.
        if (!existingToFens.has(posToFen)) {
          savedByToFen.set(posToFen, savedId)
        }
        saved++
      } catch {
        // Non-fatal — continue with remaining moves
      }
    }

    if (saved > 0) {
      const data = await api.loadRepertoire(repertoireId)
      if (data) setMoves(data.moves ?? [])
    }

    return saved
  }, [moves, repertoireId])

  const importPolyglotBook = useCallback(async (): Promise<number> => {
    const path = await api.openPolyglotFileDialog()
    if (!path) return -1
    const colour = repertoire?.colour ?? 'white'
    const count = await api.importPolyglotBook(repertoireId, path, colour)
    if (count > 0) {
      const refreshed = await api.loadRepertoire(repertoireId)
      if (refreshed) setMoves(refreshed.moves ?? [])
    }
    return count
  }, [repertoire, repertoireId])


  return {
    repertoire,
    moves,
    currentFen,
    currentMoveId,
    boardConfig,
    orientation,
    isLoading,
    error,
    existingMoveSans,
    heatmap,
    loadHeatmap,
    makeMove,
    navigateTo,
    goBack,
    goForward,
    goToStart,
    goToEnd,
    flipOrientation,
    deleteMove,
    updateAnnotation,
    importPGN,
    importPolyglotBook,
    reorderSiblings,
  }
}
