import { useCallback, useMemo, useRef, useState } from 'react'
import { makeFen, INITIAL_FEN } from 'chessops/fen'
import { chessFromFen } from '@/lib/fenUtils'
import { playMoveSound, playCaptureSound } from '@/lib/soundManager'
import { chessgroundDests } from 'chessops/compat'
import { makeSan, parseSan } from 'chessops/san'
import { parseUci, parseSquare, makeUci, makeSquare } from 'chessops/util'
import { normalizeUci } from '@/lib/uciUtils'
import { parsePgn, makePgn, defaultGame, ChildNode, parseComment, makeComment, startingPosition } from 'chessops/pgn'
import type { Node as PgnNode, PgnNodeData, CommentShape } from 'chessops/pgn'
import type { Config } from '@lichess-org/chessground/config'
import type { Key } from '@lichess-org/chessground/types'
import type { DrawShape } from '@lichess-org/chessground/draw'

/** Metadata for a loaded game (mirrors GameRecord fields, all optional). */
export interface GameMetadata {
  id?: string        // DB record ID — set when loaded from the database
  white?: string
  black?: string
  whiteElo?: number | null
  blackElo?: number | null
  result?: string
  date?: string
  event?: string
  site?: string
  round?: string
  eco?: string
  opening?: string
  timeControl?: string
  /** PGN tags not mapped to structured fields, preserved for lossless round-tripping. */
  extraHeaders?: Record<string, string>
}

// PGN headers that are already captured in structured GameMetadata fields.
// Anything not in this set is stored in extraHeaders for lossless round-tripping.
const KNOWN_HEADERS = new Set([
  'White', 'Black', 'WhiteElo', 'BlackElo', 'Result', 'Date',
  'Event', 'Site', 'Round', 'ECO', 'Opening', 'TimeControl',
  'UTCDate', 'UTCTime', 'Time', 'Variation',
])

export interface GameNode {
  id: string
  fen: string       // FEN *after* this move (starting FEN for root)
  move: { from: string; to: string; promotion?: string } | null  // null for root
  san: string | null  // null for root
  parent: GameNode | null
  children: GameNode[]  // children[0] is mainline continuation
  nag?: number          // Move assessment NAG (1=!, 2=?, 3=!!, 4=??, 5=!?, 6=?!)
  comment?: string      // Free-text comment displayed after this move
  shapes?: DrawShape[]  // Board arrows/circles drawn at this position
}

let nodeCounter = 0

function makeRoot(): GameNode {
  return {
    id: `root-${++nodeCounter}`,
    fen: INITIAL_FEN,
    move: null,
    san: null,
    parent: null,
    children: [],
  }
}


function walkMainlineEnd(root: GameNode): GameNode {
  let n = root
  while (n.children[0]) n = n.children[0]
  return n
}

function brushToCommentColor(brush: string): CommentShape['color'] {
  if (brush === 'red')    return 'red'
  if (brush === 'blue')   return 'blue'
  if (brush === 'yellow') return 'yellow'
  return 'green'
}

/** Convert a chessops CommentShape (Square integers) to a chessground DrawShape (Key strings). */
function commentShapeToDrawShape(shape: CommentShape): DrawShape {
  const orig = makeSquare(shape.from) as Key
  if (shape.from === shape.to) {
    return { orig, brush: shape.color }
  }
  return { orig, dest: makeSquare(shape.to) as Key, brush: shape.color }
}

/** Convert a chessground DrawShape to a chessops CommentShape for PGN serialization. */
function drawShapeToCommentShape(shape: DrawShape): CommentShape | null {
  const from = parseSquare(shape.orig as Key)
  if (from === undefined) return null
  const to = shape.dest ? (parseSquare(shape.dest as Key) ?? from) : from
  return { color: brushToCommentColor(shape.brush ?? 'green'), from, to }
}

/**
 * Build a GameNode tree from a PGN string, preserving variations, NAGs, and
 * comments (including [%cal]/[%csl] board shapes). Uses chessops/pgn's
 * parsePgn() so all RAV branches are included as children[1..n].
 */
function buildTreeFromPgn(pgn: string): { newRoot: GameNode; end: GameNode; pgnHeaders: Map<string, string> } {
  const games = parsePgn(pgn)
  const game = games[0]

  if (!game) {
    const newRoot = makeRoot()
    return { newRoot, end: newRoot, pgnHeaders: new Map() }
  }

  // Determine starting FEN from headers (supports SetUp/FEN custom positions)
  const startPosResult = startingPosition(game.headers)
  const startFen = startPosResult.isOk ? makeFen(startPosResult.value.toSetup()) : INITIAL_FEN

  const newRoot: GameNode = {
    id: `root-${++nodeCounter}`,
    fen: startFen,
    move: null,
    san: null,
    parent: null,
    children: [],
  }

  function buildNodes(pgnParent: PgnNode<PgnNodeData>, parentGameNode: GameNode, parentFen: string): void {
    for (const child of pgnParent.children) {
      const { san, nags, comments } = child.data
      const chess = chessFromFen(parentFen)
      const move = parseSan(chess, san)
      if (!move) continue

      const sanFormatted = makeSan(chess, move)
      const uci = makeUci(move)
      const from = uci.slice(0, 2)
      const to   = uci.slice(2, 4)
      const promo = uci.length > 4 ? uci.slice(4) : undefined
      chess.play(move)
      const nextFen = makeFen(chess.toSetup())

      let nodeShapes: DrawShape[] | undefined
      let nodeComment: string | undefined
      for (const comment of (comments ?? [])) {
        const parsed = parseComment(comment)
        if (parsed.shapes.length) {
          nodeShapes = (nodeShapes ?? []).concat(parsed.shapes.map(commentShapeToDrawShape))
        }
        if (parsed.text) {
          nodeComment = nodeComment ? `${nodeComment} ${parsed.text}` : parsed.text
        }
      }

      const gameNode: GameNode = {
        id: String(++nodeCounter),
        fen: nextFen,
        move: { from, to, promotion: promo },
        san: sanFormatted,
        parent: parentGameNode,
        children: [],
        nag: nags?.[0],
        comment: nodeComment,
        shapes: nodeShapes,
      }
      parentGameNode.children.push(gameNode)

      buildNodes(child, gameNode, nextFen)
    }
  }

  buildNodes(game.moves, newRoot, startFen)

  return { newRoot, end: walkMainlineEnd(newRoot), pgnHeaders: game.headers }
}

function isDescendantOrSelf(node: GameNode, ancestor: GameNode): boolean {
  let n: GameNode | null = node
  while (n) {
    if (n === ancestor) return true
    n = n.parent
  }
  return false
}

/**
 * Serialize a game tree to a PGN string, including all variations, NAGs,
 * comments, and board shapes (via [%cal]/[%csl] extensions). Uses
 * chessops/pgn's makePgn() for standards-compliant RAV output.
 */
export function toPGN(
  rootNode: GameNode,
  headers: Record<string, string> = {},
): string {
  const game = defaultGame<PgnNodeData>()

  const mergedHeaders: Record<string, string> = {
    Event: '?',
    Site: '?',
    Date: '????.??.??',
    Round: '?',
    White: '?',
    Black: '?',
    Result: '*',
    ...headers,
  }
  game.headers.clear()
  for (const [k, v] of Object.entries(mergedHeaders)) {
    game.headers.set(k, v)
  }

  function buildPgnTree(gameParent: GameNode, pgnParent: PgnNode<PgnNodeData>): void {
    for (const gameChild of gameParent.children) {
      const commentShapes = (gameChild.shapes ?? [])
        .map(drawShapeToCommentShape)
        .filter((s): s is CommentShape => s !== null)

      const commentStr = makeComment({
        text: gameChild.comment || undefined,
        shapes: commentShapes,
      })

      const nodeData: PgnNodeData = {
        san: gameChild.san!,
        nags: gameChild.nag !== undefined ? [gameChild.nag] : undefined,
        comments: commentStr ? [commentStr] : undefined,
      }

      const pgnChild = new ChildNode<PgnNodeData>(nodeData)
      pgnParent.children.push(pgnChild)
      buildPgnTree(gameChild, pgnChild)
    }
  }

  buildPgnTree(rootNode, game.moves)

  return makePgn(game)
}

export function metadataToHeaders(m: GameMetadata): Record<string, string> {
  const h: Record<string, string> = {}
  // Spread extra headers first; standard fields below override any conflicts.
  if (m.extraHeaders) Object.assign(h, m.extraHeaders)
  if (m.white)            h['White']       = m.white
  if (m.black)            h['Black']       = m.black
  if (m.whiteElo != null) h['WhiteElo']    = String(m.whiteElo)
  if (m.blackElo != null) h['BlackElo']    = String(m.blackElo)
  if (m.result)           h['Result']      = m.result
  if (m.date)             h['Date']        = m.date
  if (m.event)            h['Event']       = m.event
  if (m.site)             h['Site']        = m.site
  if (m.round)            h['Round']       = m.round
  if (m.eco)              h['ECO']         = m.eco
  if (m.opening)          h['Opening']     = m.opening
  if (m.timeControl)      h['TimeControl'] = m.timeControl
  return h
}

export function useChessGame() {
  const [rootNode, setRootNode] = useState<GameNode>(makeRoot)
  const [currentNode, setCurrentNode] = useState<GameNode>(() => rootNode)
  // mainlineEnd tracks the leaf of the first-child chain from root — O(1) navigation
  const [mainlineEnd, setMainlineEnd] = useState<GameNode>(() => rootNode)
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')
  // Incrementing counter to force re-renders after tree mutations
  const [treeRevision, setTreeRevision] = useState(0)
  const [gameMetadata, setGameMetadata] = useState<GameMetadata | null>(null)
  const [savedGameId, setSavedGameId] = useState<string | null>(null)
  // One-way latch: true after any mutation since last load/reset; never auto-reverts
  const [isDirty, setIsDirty] = useState(false)

  // Pending destructive action: set when a state-replacing call is made while
  // the board is dirty. Exposed so BoardStateGuardModal can show a confirmation.
  const [pendingDestructiveAction, _setPendingDestructiveAction] = useState<(() => void) | null>(null)

  // Refs let stable useCallback closures ([] deps) read current state values
  // without going stale. Assigned inline so they're always up-to-date.
  const pendingDestructiveActionRef = useRef<(() => void) | null>(null)
  const rootNodeRef = useRef<GameNode>(rootNode)
  rootNodeRef.current = rootNode
  const savedGameIdRef = useRef<string | null>(savedGameId)
  savedGameIdRef.current = savedGameId
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  /** Sync both the ref and the state for pendingDestructiveAction. */
  function setPendingDestructiveAction(action: (() => void) | null) {
    pendingDestructiveActionRef.current = action
    // useState setter: wrap function in () => to avoid it being called as updater
    _setPendingDestructiveAction(action === null ? null : () => action)
  }

  /**
   * Single entry point that all state-replacing methods funnel through.
   * Private — callers use resetGame / loadGame / loadFromPGN / loadFromFEN.
   */
  function _applyNewGameState(
    newRoot: GameNode,
    startNode: GameNode,
    end: GameNode,
    metadata: GameMetadata | null,
    savedId: string | null,
  ) {
    setRootNode(newRoot)
    setCurrentNode(startNode)
    setMainlineEnd(end)
    setGameMetadata(metadata)
    setSavedGameId(savedId)
    setOrientation('white')
    setTreeRevision(r => r + 1)
    setIsDirty(false)
  }

  /**
   * Guarded wrapper around _applyNewGameState. If the board is dirty, defers
   * the state change as a pendingDestructiveAction for the user to confirm.
   * Stable ([] deps) because it reads state through refs.
   */
  const applyNewGameState = useCallback((
    newRoot: GameNode,
    startNode: GameNode,
    end: GameNode,
    metadata: GameMetadata | null,
    savedId: string | null,
  ) => {
    if (pendingDestructiveActionRef.current !== null) return
    const hasContent = rootNodeRef.current.children.length > 0 || rootNodeRef.current.fen !== INITIAL_FEN
    if (hasContent && (savedGameIdRef.current === null || isDirtyRef.current)) {
      const action = () => _applyNewGameState(newRoot, startNode, end, metadata, savedId)
      pendingDestructiveActionRef.current = action
      _setPendingDestructiveAction(() => action)
      return
    }
    _applyNewGameState(newRoot, startNode, end, metadata, savedId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Reset the game tree to a fresh empty board, clearing all moves, variations,
   * annotations, and loaded game metadata. Does not affect layout or engine state.
   * Pass force: true to bypass the destructive action guard.
   */
  const resetGame = useCallback(({ force = false }: { force?: boolean } = {}) => {
    const newRoot = makeRoot()
    if (force) {
      _applyNewGameState(newRoot, newRoot, newRoot, null, null)
    } else {
      applyNewGameState(newRoot, newRoot, newRoot, null, null)
    }
  }, [applyNewGameState, _applyNewGameState])

  /**
   * Load a full game: builds the game tree from PGN (including RAV variations)
   * and stores the metadata.
   * Use this instead of loadFromPGN when you have a GameRecord from the database.
   */
  const loadGame = useCallback((pgn: string, metadata: GameMetadata | null, targetFen?: string) => {
    const { newRoot, end, pgnHeaders } = buildTreeFromPgn(pgn)

    let finalMetadata = metadata
    if (metadata && pgnHeaders.size > 0) {
      const extraHeaders: Record<string, string> = {}
      for (const [k, v] of pgnHeaders) {
        if (!KNOWN_HEADERS.has(k) && v) {
          extraHeaders[k] = v
        }
      }
      if (Object.keys(extraHeaders).length > 0) {
        finalMetadata = { ...metadata, extraHeaders }
      }
    }

    // Walk the mainline to find the target position when provided.
    let startNode = newRoot
    if (targetFen) {
      const targetEpd = targetFen.split(' ').slice(0, 3).join(' ')
      let node: GameNode | null = newRoot
      while (node) {
        if (node.fen.split(' ').slice(0, 3).join(' ') === targetEpd) {
          startNode = node
          break
        }
        node = node.children[0] ?? null
      }
    }

    applyNewGameState(newRoot, startNode, end, finalMetadata, metadata?.id ?? null)
  }, [applyNewGameState])

  /**
   * Build a new game tree from a PGN string (including RAV variations).
   * Replaces the current game state entirely.
   */
  const loadFromPGN = useCallback((pgn: string) => {
    setSavedGameId(null)
    const { newRoot, end, pgnHeaders } = buildTreeFromPgn(pgn)

    // Mirror Go's parseGame() header extraction so saving after a Home page
    // PGN import produces the same metadata as importing via the Games page.
    const rawDate = pgnHeaders.get('UTCDate') || pgnHeaders.get('Date') || ''
    const timeVal = pgnHeaders.get('UTCTime') || pgnHeaders.get('Time') || ''
    const date = rawDate && timeVal ? `${rawDate} ${timeVal}` : rawDate

    const variation = pgnHeaders.get('Variation')
    const opening = variation
      ? [pgnHeaders.get('Opening'), variation].filter(Boolean).join(', ')
      : (pgnHeaders.get('Opening') ?? '')

    const whiteEloRaw = parseInt(pgnHeaders.get('WhiteElo') ?? '', 10)
    const blackEloRaw = parseInt(pgnHeaders.get('BlackElo') ?? '', 10)

    const extraHeaders: Record<string, string> = {}
    for (const [k, v] of pgnHeaders) {
      if (!KNOWN_HEADERS.has(k) && v) extraHeaders[k] = v
    }

    const metadata: GameMetadata = {
      white:       pgnHeaders.get('White')       || undefined,
      black:       pgnHeaders.get('Black')       || undefined,
      whiteElo:    isNaN(whiteEloRaw) ? undefined : whiteEloRaw,
      blackElo:    isNaN(blackEloRaw) ? undefined : blackEloRaw,
      result:      pgnHeaders.get('Result')      || undefined,
      date:        date                          || undefined,
      event:       pgnHeaders.get('Event')       || undefined,
      site:        pgnHeaders.get('Site')        || undefined,
      round:       pgnHeaders.get('Round')       || undefined,
      eco:         pgnHeaders.get('ECO')         || undefined,
      opening:     opening                       || undefined,
      timeControl: pgnHeaders.get('TimeControl') || undefined,
      ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
    }

    const hasAny = Object.values(metadata).some(v => v !== undefined)
    applyNewGameState(newRoot, newRoot, end, hasAny ? metadata : null, null)
  }, [applyNewGameState])

  /**
   * Load a position from a FEN string, discarding all moves and metadata.
   * Used for "load position" imports.
   */
  const loadFromFEN = useCallback((fen: string) => {
    const newRoot: GameNode = {
      id: `root-${++nodeCounter}`,
      fen,
      move: null,
      san: null,
      parent: null,
      children: [],
    }
    applyNewGameState(newRoot, newRoot, newRoot, null, null)
  }, [applyNewGameState])

  const makeMove = useCallback((orig: string, dest: string, promotion?: string) => {
    const chess = chessFromFen(currentNode.fen)

    // Auto-detect pawn promotion when not supplied by caller
    const sq = parseSquare(orig)
    const piece = sq !== undefined ? chess.board.get(sq) : undefined
    const isPromo = piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1')
    const promo = promotion ?? (isPromo ? 'q' : undefined)

    const uci = orig + dest + (promo ?? '')
    const move = parseUci(uci)
    if (!move) return

    let san: string
    try {
      san = makeSan(chess, move)
      chess.play(move)
    } catch {
      return // illegal move
    }

    const nextFen = makeFen(chess.toSetup())

    // Deduplicate: navigate to existing child if this move already exists
    const existing = currentNode.children.find(
      c => c.move?.from === orig && c.move?.to === dest && c.move?.promotion === promo,
    )
    if (existing) {
      setCurrentNode(existing)
      return
    }

    const newNode: GameNode = {
      id: String(++nodeCounter),
      fen: nextFen,
      move: { from: orig, to: dest, promotion: promo },
      san,
      parent: currentNode,
      children: [],
    }
    currentNode.children.push(newNode)
    setCurrentNode(newNode)
    setIsDirty(true)
    if (san.includes('x')) playCaptureSound()
    else playMoveSound()

    // Advance mainlineEnd only when extending the mainline (first child of current end)
    setMainlineEnd(prev => {
      if (currentNode === prev && currentNode.children.length === 1) return newNode
      return prev
    })
  }, [currentNode])

  const boardConfig = useMemo((): Config => {
    const chess = chessFromFen(currentNode.fen)
    const dests = chessgroundDests(chess)
    const over = chess.isEnd()
    const turn = chess.turn === 'white' ? 'white' : 'black'
    return {
      fen: currentNode.fen,
      orientation,
      turnColor: turn,
      check: chess.isCheck() ? turn : undefined,
      lastMove: currentNode.move
        ? [currentNode.move.from as Key, currentNode.move.to as Key]
        : undefined,
      movable: {
        free: false,
        color: over ? undefined : 'both',
        dests: over ? new Map() : dests,
        showDests: true,
        events: { after: (orig: Key, dest: Key) => makeMove(orig, dest) },
      },
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 150 },
      drawable: {
        enabled: true,
        visible: true,
        shapes: currentNode.shapes ?? [],
        onChange: (shapes: DrawShape[]) => {
          currentNode.shapes = shapes.length > 0 ? shapes : undefined
          setTreeRevision(r => r + 1)
          setIsDirty(true)
        },
      },
    }
  }, [currentNode, orientation, makeMove])

  const goBack    = useCallback(() => { if (currentNode.parent) setCurrentNode(currentNode.parent) }, [currentNode])
  const goForward = useCallback(() => {
    const next = currentNode.children[0]
    if (next) {
      if (next.san) {
        if (next.san.includes('x')) playCaptureSound()
        else playMoveSound()
      }
      setCurrentNode(next)
    }
  }, [currentNode])
  const goToStart = useCallback(() => setCurrentNode(rootNode), [rootNode])
  const goToEnd   = useCallback(() => setCurrentNode(mainlineEnd), [mainlineEnd])
  const goToNode  = useCallback((node: GameNode) => {
    if (node.san) {
      if (node.san.includes('x')) playCaptureSound()
      else playMoveSound()
    }
    setCurrentNode(node)
  }, [])

  /**
   * Navigate to the position reached by replaying uciMoves from analysisFen.
   * Finds the game node whose FEN matches analysisFen, then follows or creates
   * child nodes for each UCI move. Calls setCurrentNode once at the end.
   * No-ops if analysisFen is not found in the current game tree.
   */
  const navigateToPV = useCallback((analysisFen: string, uciMoves: string[]) => {
    function findByFen(node: GameNode): GameNode | null {
      if (node.fen === analysisFen) return node
      for (const child of node.children) {
        const r = findByFen(child)
        if (r) return r
      }
      return null
    }
    const startNode = findByFen(rootNode)
    if (!startNode) return

    let node = startNode
    let createdAny = false
    for (const uci of uciMoves) {
      if (uci.length < 4) break
      const orig = uci.slice(0, 2)
      const dest = uci.slice(2, 4)
      const promo = uci.length === 5 ? uci[4] : undefined
      const normalizedPv = normalizeUci(orig + dest + (promo ?? ''))
      const existing = node.children.find(c => {
        const childUci = normalizeUci(
          (c.move?.from ?? '') + (c.move?.to ?? '') + (c.move?.promotion ?? ''),
        )
        return childUci === normalizedPv
      })
      if (existing) {
        node = existing
        continue
      }
      try {
        const chess = chessFromFen(node.fen)
        const move = parseUci(uci)
        if (!move) break
        const san = makeSan(chess, move)
        if (san === '--') break
        chess.play(move)
        const newNode: GameNode = {
          id: String(++nodeCounter),
          fen: makeFen(chess.toSetup()),
          move: { from: orig, to: dest, promotion: promo },
          san,
          parent: node,
          children: [],
        }
        node.children.push(newNode)
        createdAny = true
        node = newNode
      } catch {
        break
      }
    }
    setCurrentNode(node)
    if (createdAny) {
      setTreeRevision(r => r + 1)
      setIsDirty(true)
    }
  }, [rootNode])
  const flipOrientation = useCallback(() => setOrientation(o => o === 'white' ? 'black' : 'white'), [])

  /**
   * Delete `node` and all its descendants. If `currentNode` is inside the
   * deleted subtree, navigate to `node.parent`.
   */
  const deleteFrom = useCallback((node: GameNode) => {
    if (!node.parent) return  // cannot delete root
    node.parent.children = node.parent.children.filter(c => c !== node)
    const newCurrent = isDescendantOrSelf(currentNode, node) ? node.parent! : currentNode
    setMainlineEnd(walkMainlineEnd(rootNode))
    setCurrentNode(newCurrent)
    setTreeRevision(r => r + 1)
    setIsDirty(true)
  }, [currentNode, rootNode])

  /**
   * Swap `varNode` (a variation start, i.e. parent.children[1..n]) with
   * children[0], making the variation the new mainline.
   */
  const promoteVariation = useCallback((varNode: GameNode) => {
    const parent = varNode.parent
    if (!parent) return
    const idx = parent.children.indexOf(varNode)
    if (idx <= 0) return  // already mainline or not found
    ;[parent.children[0], parent.children[idx]] = [parent.children[idx], parent.children[0]]
    setMainlineEnd(walkMainlineEnd(rootNode))
    setTreeRevision(r => r + 1)
    setIsDirty(true)
  }, [rootNode])

  /** Set or clear the NAG on a node. Pass undefined to remove the NAG. */
  const setNodeNag = useCallback((node: GameNode, nag: number | undefined) => {
    node.nag = nag
    setTreeRevision(r => r + 1)
    setIsDirty(true)
  }, [])

  /** Set or clear the comment on a node. Pass empty string to remove. */
  const setNodeComment = useCallback((node: GameNode, comment: string) => {
    node.comment = comment || undefined
    setTreeRevision(r => r + 1)
    setIsDirty(true)
  }, [])

  /** Set or clear the board shapes (arrows/circles) on a node. */
  const setNodeShapes = useCallback((node: GameNode, shapes: DrawShape[]) => {
    node.shapes = shapes.length > 0 ? shapes : undefined
    setTreeRevision(r => r + 1)
    setIsDirty(true)
  }, [])

  /** Mark the current game as saved with the given DB ID (e.g. after a new save). */
  const markSaved = useCallback((id: string) => {
    setSavedGameId(id)
    setIsDirty(false)
  }, [])

  /** Execute the deferred destructive action (user chose Discard or Save+confirmed). */
  const confirmPendingDestructiveAction = useCallback(() => {
    const action = pendingDestructiveActionRef.current
    if (action) {
      pendingDestructiveActionRef.current = null
      _setPendingDestructiveAction(null)
      action()
    }
  }, [])

  /** Cancel the deferred destructive action (user chose Cancel). */
  const cancelPendingDestructiveAction = useCallback(() => {
    pendingDestructiveActionRef.current = null
    _setPendingDestructiveAction(null)
  }, [])

  return {
    rootNode,
    hasContent: rootNode.children.length > 0 || rootNode.fen !== INITIAL_FEN,
    currentNode,
    mainlineEnd,
    orientation,
    treeRevision,
    boardConfig,
    gameMetadata,
    setGameMetadata,
    savedGameId,
    isDirty,
    pendingDestructiveAction,
    confirmPendingDestructiveAction,
    cancelPendingDestructiveAction,
    makeMove,
    loadFromPGN,
    loadFromFEN,
    loadGame,
    resetGame,
    markSaved,
    goBack,
    goForward,
    goToStart,
    goToEnd,
    goToNode,
    navigateToPV,
    flipOrientation,
    deleteFrom,
    promoteVariation,
    setNodeNag,
    setNodeComment,
    setNodeShapes,
    toPGN: (headers?: Record<string, string>) => toPGN(rootNode, headers),
  }
}
