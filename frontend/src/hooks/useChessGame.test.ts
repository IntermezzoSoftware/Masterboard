import { renderHook, act } from '@testing-library/react'
import { vi } from 'vitest'

const {
  mockIsCheck,
  mockIsEnd,
  mockPlay,
  mockTurn,
  mockBoardGet,
  mockMakeFen,
  mockChessgroundDests,
  mockMakeSan,
  mockParseUci,
  mockParseFen,
  mockParseSan,
  mockParsePgn,
  mockStartingPosition,
  MockChess,
} = vi.hoisted(() => {
  const mockIsCheck   = vi.fn(() => false)
  const mockIsEnd     = vi.fn(() => false)
  const mockPlay      = vi.fn()
  const mockTurn      = { value: 'white' }  // object so we can mutate it
  const mockBoardGet  = vi.fn(() => ({ role: 'pawn', color: 'white' }))
  const mockMakeFen   = vi.fn(() => 'nextfen')
  const mockChessgroundDests = vi.fn(() => new Map([['e2', ['e4']]]))
  const mockMakeSan   = vi.fn(() => 'e4')
  const mockParseUci  = vi.fn((uci: string) => ({ uci }))
  const mockParseFen  = vi.fn(() => ({ unwrap: () => ({}) }))
  const mockParseSan  = vi.fn(() => undefined as unknown)
  const mockParsePgn  = vi.fn(() => [{
    headers: new Map(),
    comments: undefined,
    moves: { children: [] },
  }])
  const mockStartingPosition = vi.fn(() => ({ isOk: false }))

  const MockChess = {
    fromSetup: vi.fn(() => ({
      unwrap: () => ({
        isCheck: mockIsCheck,
        isEnd: mockIsEnd,
        play: mockPlay,
        get turn() { return mockTurn.value },
        board: { get: mockBoardGet },
        toSetup: () => ({}),
      }),
    })),
  }

  return {
    mockIsCheck, mockIsEnd, mockPlay, mockTurn, mockBoardGet,
    mockMakeFen, mockChessgroundDests, mockMakeSan, mockParseUci,
    mockParseFen, mockParseSan, mockParsePgn, mockStartingPosition, MockChess,
  }
})

vi.mock('chessops/chess', () => ({ Chess: MockChess }))
vi.mock('chessops/fen', () => ({
  parseFen: mockParseFen,
  makeFen: mockMakeFen,
  INITIAL_FEN: 'startpos',
}))
vi.mock('chessops/compat', () => ({ chessgroundDests: mockChessgroundDests }))
vi.mock('chessops/san', () => ({ makeSan: mockMakeSan, parseSan: mockParseSan }))
vi.mock('chessops/util', () => ({
  parseUci: mockParseUci,
  parseSquare: vi.fn((s: string) => s.charCodeAt(0) - 97 + (parseInt(s[1]) - 1) * 8),
  makeUci: vi.fn(() => 'e2e4'),
  makeSquare: vi.fn((sq: number) => String.fromCharCode(97 + sq % 8) + String(Math.floor(sq / 8) + 1)),
}))
vi.mock('@/lib/soundManager', () => ({
  playMoveSound:    vi.fn(),
  playCaptureSound: vi.fn(),
  setSoundEnabled:  vi.fn(),
  isSoundEnabled:   vi.fn(() => true),
}))

// Keep real makePgn/makeComment/ChildNode/defaultGame; only mock the parsing side
vi.mock('chessops/pgn', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    parsePgn: mockParsePgn,
    startingPosition: mockStartingPosition,
  }
})

import { useChessGame, toPGN } from './useChessGame'
import type { GameNode } from './useChessGame'
import { playMoveSound, playCaptureSound } from '@/lib/soundManager'


beforeEach(() => {
  mockIsCheck.mockReturnValue(false)
  mockIsEnd.mockReturnValue(false)
  mockPlay.mockReset()
  mockTurn.value = 'white'
  mockBoardGet.mockReturnValue({ role: 'pawn', color: 'white' })
  mockMakeFen.mockReturnValue('nextfen')
  mockChessgroundDests.mockReturnValue(new Map([['e2', ['e4']]]))
  mockMakeSan.mockReturnValue('e4')
  mockParseUci.mockImplementation((uci: string) => ({ uci }))
  mockParseSan.mockReturnValue(undefined)
  mockParsePgn.mockReturnValue([{ headers: new Map(), comments: undefined, moves: { children: [] } }])
  mockStartingPosition.mockReturnValue({ isOk: false })
  MockChess.fromSetup.mockReturnValue({
    unwrap: () => ({
      isCheck: mockIsCheck,
      isEnd: mockIsEnd,
      play: mockPlay,
      get turn() { return mockTurn.value },
      board: { get: mockBoardGet },
      toSetup: () => ({}),
    }),
  })
})

describe('useChessGame', () => {
  it('initialises with root node at starting position', () => {
    const { result } = renderHook(() => useChessGame())
    expect(result.current.rootNode.fen).toBe('startpos')
    expect(result.current.rootNode.parent).toBeNull()
    expect(result.current.rootNode.children).toHaveLength(0)
    expect(result.current.currentNode).toBe(result.current.rootNode)
  })

  it('makeMove creates a child node with correct san and fen', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    expect(result.current.rootNode.children).toHaveLength(1)
    expect(result.current.currentNode.san).toBe('e4')
    expect(result.current.currentNode.fen).toBe('nextfen')
    expect(result.current.currentNode.parent).toBe(result.current.rootNode)
  })

  it('makeMove deduplicates an existing child', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const firstChild = result.current.currentNode
    act(() => { result.current.goToStart() })
    act(() => { result.current.makeMove('e2', 'e4') })
    expect(result.current.rootNode.children).toHaveLength(1)
    expect(result.current.currentNode).toBe(firstChild)
  })

  it('makeMove creates a variation when the same position already has a child', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    act(() => { result.current.goToStart() })
    mockMakeSan.mockReturnValueOnce('d4')
    mockMakeFen.mockReturnValueOnce('nextfen2')
    act(() => { result.current.makeMove('d2', 'd4') })
    expect(result.current.rootNode.children).toHaveLength(2)
    expect(result.current.currentNode.san).toBe('d4')
  })

  it('makeMove ignores illegal moves (makeSan throws)', () => {
    mockMakeSan.mockImplementationOnce(() => { throw new Error('illegal move') })
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e8') })
    expect(result.current.rootNode.children).toHaveLength(0)
    expect(result.current.currentNode).toBe(result.current.rootNode)
  })

  it('makeMove ignores moves when parseUci returns null', () => {
    mockParseUci.mockReturnValueOnce(null)
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    expect(result.current.rootNode.children).toHaveLength(0)
  })

  it('goBack returns to parent', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    act(() => { result.current.goBack() })
    expect(result.current.currentNode).toBe(result.current.rootNode)
  })

  it('goBack does nothing at root', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.goBack() })
    expect(result.current.currentNode).toBe(result.current.rootNode)
  })

  it('goForward follows first child', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const child = result.current.currentNode
    act(() => { result.current.goBack() })
    act(() => { result.current.goForward() })
    expect(result.current.currentNode).toBe(child)
  })

  it('goForward does nothing at a leaf', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.goForward() })
    expect(result.current.currentNode).toBe(result.current.rootNode)
  })

  it('goToStart navigates directly to rootNode (O(1))', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    mockMakeFen.mockReturnValueOnce('nextfen2')
    act(() => { result.current.makeMove('e7', 'e5') })
    act(() => { result.current.goToStart() })
    expect(result.current.currentNode).toBe(result.current.rootNode)
  })

  it('goToEnd navigates directly to mainlineEnd (O(1))', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const end = result.current.currentNode
    act(() => { result.current.goToStart() })
    act(() => { result.current.goToEnd() })
    expect(result.current.currentNode).toBe(end)
  })

  it('mainlineEnd advances when extending the mainline', () => {
    const { result } = renderHook(() => useChessGame())
    expect(result.current.mainlineEnd).toBe(result.current.rootNode)
    act(() => { result.current.makeMove('e2', 'e4') })
    const firstMove = result.current.currentNode
    expect(result.current.mainlineEnd).toBe(firstMove)
    mockMakeFen.mockReturnValueOnce('nextfen2')
    act(() => { result.current.makeMove('e7', 'e5') })
    const secondMove = result.current.currentNode
    expect(result.current.mainlineEnd).toBe(secondMove)
  })

  it('mainlineEnd does not change when creating a variation', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const mainlineChild = result.current.currentNode
    act(() => { result.current.goToStart() })
    mockMakeSan.mockReturnValueOnce('d4')
    mockMakeFen.mockReturnValueOnce('varfen')
    act(() => { result.current.makeMove('d2', 'd4') })
    expect(result.current.mainlineEnd).toBe(mainlineChild)
  })

  it('goToNode navigates to an arbitrary node', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const target = result.current.currentNode
    mockMakeFen.mockReturnValueOnce('nextfen2')
    act(() => { result.current.makeMove('e7', 'e5') })
    act(() => { result.current.goToNode(target) })
    expect(result.current.currentNode).toBe(target)
  })

  it('flipOrientation toggles white/black', () => {
    const { result } = renderHook(() => useChessGame())
    expect(result.current.orientation).toBe('white')
    act(() => { result.current.flipOrientation() })
    expect(result.current.orientation).toBe('black')
    act(() => { result.current.flipOrientation() })
    expect(result.current.orientation).toBe('white')
  })

  it('boardConfig turnColor is white when chess.turn is white', () => {
    mockTurn.value = 'white'
    const { result } = renderHook(() => useChessGame())
    expect(result.current.boardConfig.turnColor).toBe('white')
  })

  it('boardConfig turnColor is black when chess.turn is black', () => {
    mockTurn.value = 'black'
    const { result } = renderHook(() => useChessGame())
    expect(result.current.boardConfig.turnColor).toBe('black')
  })

  it('boardConfig movable.color is undefined when game is over', () => {
    mockIsEnd.mockReturnValue(true)
    const { result } = renderHook(() => useChessGame())
    expect(result.current.boardConfig.movable?.color).toBeUndefined()
  })

  it('boardConfig check reflects king in check', () => {
    mockIsCheck.mockReturnValue(true)
    const { result } = renderHook(() => useChessGame())
    expect(result.current.boardConfig.check).toBe('white')
  })

  it('boardConfig lastMove reflects current node move', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    expect(result.current.boardConfig.lastMove).toEqual(['e2', 'e4'])
  })

  it('boardConfig includes drawable config with shapes from current node', () => {
    const { result } = renderHook(() => useChessGame())
    expect(result.current.boardConfig.drawable).toBeDefined()
    expect(result.current.boardConfig.drawable?.shapes).toEqual([])
  })

  it('boardConfig drawable.shapes restores shapes when navigating to an annotated node', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const node = result.current.currentNode
    // Navigate away, set shapes on the node, then navigate back
    act(() => { result.current.goToStart() })
    act(() => {
      result.current.setNodeShapes(node, [{ orig: 'e2', dest: 'e4', brush: 'green' }])
    })
    act(() => { result.current.goToNode(node) })
    expect(result.current.boardConfig.drawable?.shapes).toHaveLength(1)
  })

  it('gameMetadata is null on init', () => {
    const { result } = renderHook(() => useChessGame())
    expect(result.current.gameMetadata).toBeNull()
  })

  it('loadGame stores metadata', () => {
    const { result } = renderHook(() => useChessGame())
    const meta = { white: 'Kasparov', black: 'Karpov', result: '1-0' }
    act(() => { result.current.loadGame('', meta) })
    expect(result.current.gameMetadata).toEqual(meta)
  })

  it('resetGame clears gameMetadata', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.loadGame('', { white: 'A', black: 'B' }) })
    act(() => { result.current.resetGame() })
    expect(result.current.gameMetadata).toBeNull()
  })

  it('loadGame resets game tree when state is clean', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    expect(result.current.rootNode.children).toHaveLength(1)
    // markSaved clears isDirty so the guard will not block the load
    act(() => { result.current.markSaved('saved-id') })
    act(() => { result.current.loadGame('', null) })
    expect(result.current.rootNode.children).toHaveLength(0)
  })
})


describe('annotations', () => {
  it('setNodeNag sets NAG on a node and bumps treeRevision', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const node = result.current.currentNode
    const revBefore = result.current.treeRevision
    act(() => { result.current.setNodeNag(node, 1) })
    expect(node.nag).toBe(1)
    expect(result.current.treeRevision).toBeGreaterThan(revBefore)
  })

  it('setNodeNag with undefined clears an existing NAG', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const node = result.current.currentNode
    act(() => { result.current.setNodeNag(node, 2) })
    expect(node.nag).toBe(2)
    act(() => { result.current.setNodeNag(node, undefined) })
    expect(node.nag).toBeUndefined()
  })

  it('setNodeNag on one node does not affect siblings', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const firstChild = result.current.currentNode
    act(() => { result.current.goToStart() })
    mockMakeSan.mockReturnValueOnce('d4')
    mockMakeFen.mockReturnValueOnce('nextfen2')
    act(() => { result.current.makeMove('d2', 'd4') })
    const secondChild = result.current.currentNode
    act(() => { result.current.setNodeNag(firstChild, 1) })
    expect(firstChild.nag).toBe(1)
    expect(secondChild.nag).toBeUndefined()
  })

  it('setNodeComment sets comment on a node and bumps treeRevision', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const node = result.current.currentNode
    const revBefore = result.current.treeRevision
    act(() => { result.current.setNodeComment(node, 'Best opening move') })
    expect(node.comment).toBe('Best opening move')
    expect(result.current.treeRevision).toBeGreaterThan(revBefore)
  })

  it('setNodeComment with empty string clears the comment', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const node = result.current.currentNode
    act(() => { result.current.setNodeComment(node, 'Some comment') })
    expect(node.comment).toBe('Some comment')
    act(() => { result.current.setNodeComment(node, '') })
    expect(node.comment).toBeUndefined()
  })

  it('setNodeShapes stores shapes on a node', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const node = result.current.currentNode
    act(() => {
      result.current.setNodeShapes(node, [{ orig: 'e2', dest: 'e4', brush: 'green' }])
    })
    expect(node.shapes).toHaveLength(1)
    expect(node.shapes?.[0].orig).toBe('e2')
  })

  it('setNodeShapes with empty array clears shapes', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const node = result.current.currentNode
    act(() => {
      result.current.setNodeShapes(node, [{ orig: 'e2', dest: 'e4', brush: 'green' }])
    })
    act(() => { result.current.setNodeShapes(node, []) })
    expect(node.shapes).toBeUndefined()
  })

  it('shapes are available on the node after being set', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    const node = result.current.currentNode
    const shapes = [{ orig: 'e4', brush: 'red' }, { orig: 'e2', dest: 'e4', brush: 'green' }]
    act(() => { result.current.setNodeShapes(node, shapes) })
    expect(node.shapes).toHaveLength(2)
  })
})


describe('toPGN with annotations', () => {
  /** Build a minimal root node with one child for serialization tests. */
  function makeNodeWithChild(overrides: Partial<GameNode> = {}): { root: GameNode; child: GameNode } {
    const root: GameNode = {
      id: 'root',
      fen: 'startpos w - - 0 1',
      move: null, san: null, parent: null, children: [],
    }
    const child: GameNode = {
      id: 'c1',
      fen: 'nextfen b - - 0 1',
      move: { from: 'e2', to: 'e4' },
      san: 'e4',
      parent: root,
      children: [],
      ...overrides,
    }
    root.children.push(child)
    return { root, child }
  }

  it('serialises a plain move correctly', () => {
    const { root } = makeNodeWithChild()
    const pgn = toPGN(root, { Result: '*' })
    expect(pgn).toContain('1. e4')
  })

  it('serialises NAG as $n after SAN', () => {
    const { root } = makeNodeWithChild({ nag: 1 })
    const pgn = toPGN(root, { Result: '*' })
    expect(pgn).toContain('e4 $1')
  })

  it('serialises comment as { text } after SAN', () => {
    const { root } = makeNodeWithChild({ comment: 'great move' })
    const pgn = toPGN(root, { Result: '*' })
    expect(pgn).toContain('e4 { great move }')
  })

  it('serialises NAG before comment when both are present', () => {
    const { root } = makeNodeWithChild({ nag: 3, comment: 'brilliant!' })
    const pgn = toPGN(root, { Result: '*' })
    expect(pgn).toContain('e4 $3 { brilliant! }')
  })

  it('serialises arrow shapes as [%cal] inside comment block', () => {
    const { root } = makeNodeWithChild({ shapes: [{ orig: 'e2', dest: 'e4', brush: 'green' }] })
    const pgn = toPGN(root, { Result: '*' })
    expect(pgn).toContain('[%cal Ge2e4]')
  })

  it('serialises circle shapes as [%csl] inside comment block', () => {
    const { root } = makeNodeWithChild({ shapes: [{ orig: 'e4', brush: 'red' }] })
    const pgn = toPGN(root, { Result: '*' })
    expect(pgn).toContain('[%csl Re4]')
  })

  it('combines shapes and comment text in a single { } block', () => {
    const { root } = makeNodeWithChild({
      shapes: [{ orig: 'e2', dest: 'e4', brush: 'blue' }],
      comment: 'key square',
    })
    const pgn = toPGN(root, { Result: '*' })
    // chessops/pgn's makeComment puts text before shapes
    expect(pgn).toContain('{ key square [%cal Be2e4] }')
  })

  it('does not emit empty comment blocks', () => {
    const { root } = makeNodeWithChild()
    const pgn = toPGN(root, { Result: '*' })
    expect(pgn).not.toContain('{')
  })
})


describe('RAV variations', () => {
  it('loadGame builds a tree with mainline + variation from parsePgn output', () => {
    // parsePgn mock returns: root → [e4] → [e5 (mainline), d5 (variation)]
    const mockMove = { from: 12, to: 28 }
    const d5Node = { data: { san: 'd5', nags: undefined, comments: undefined }, children: [] }
    const e5Node = { data: { san: 'e5', nags: undefined, comments: undefined }, children: [] }
    const e4Node = { data: { san: 'e4', nags: undefined, comments: undefined }, children: [e5Node, d5Node] }

    mockParsePgn.mockReturnValueOnce([{
      headers: new Map(),
      comments: undefined,
      moves: { children: [e4Node] },
    }])

    // parseSan returns a move for e4, then e5, then d5
    mockParseSan
      .mockReturnValueOnce(mockMove)
      .mockReturnValueOnce(mockMove)
      .mockReturnValueOnce(mockMove)
    mockMakeSan
      .mockReturnValueOnce('e4')
      .mockReturnValueOnce('e5')
      .mockReturnValueOnce('d5')
    mockMakeFen
      .mockReturnValueOnce('aftere4')
      .mockReturnValueOnce('aftere5')
      .mockReturnValueOnce('afterd5')

    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.loadGame('1. e4 e5 (1... d5) *', null) })

    const e4GameNode = result.current.rootNode.children[0]
    expect(e4GameNode.san).toBe('e4')
    expect(e4GameNode.children).toHaveLength(2)
    expect(e4GameNode.children[0].san).toBe('e5')
    expect(e4GameNode.children[1].san).toBe('d5')
  })

  it('toPGN serialises a variation as ( N... san ) in the PGN string', () => {
    // Build a GameNode tree manually: root → e4 → [e5 (mainline), d5 (variation)]
    const root: GameNode = {
      id: 'root', fen: 'startpos w - - 0 1', move: null, san: null, parent: null, children: [],
    }
    const e4: GameNode = {
      id: 'e4', fen: 'fen1', move: { from: 'e2', to: 'e4' }, san: 'e4', parent: root, children: [],
    }
    const e5: GameNode = {
      id: 'e5', fen: 'fen2', move: { from: 'e7', to: 'e5' }, san: 'e5', parent: e4, children: [],
    }
    const d5: GameNode = {
      id: 'd5', fen: 'fen3', move: { from: 'd7', to: 'd5' }, san: 'd5', parent: e4, children: [],
    }
    root.children.push(e4)
    e4.children.push(e5, d5)  // e5 = mainline, d5 = variation

    const pgn = toPGN(root, { Result: '*' })
    expect(pgn).toContain('1. e4')
    expect(pgn).toContain('e5')
    expect(pgn).toContain('( 1... d5 )')
  })

  it('toPGN serialises a NAG on the mainline move', () => {
    const root: GameNode = {
      id: 'root', fen: 'startpos w - - 0 1', move: null, san: null, parent: null, children: [],
    }
    const e4: GameNode = {
      id: 'e4', fen: 'fen1', move: { from: 'e2', to: 'e4' }, san: 'e4',
      parent: root, children: [], nag: 4,
    }
    root.children.push(e4)

    const pgn = toPGN(root, { Result: '*' })
    expect(pgn).toContain('e4 $4')
  })
})


describe('navigateToPV', () => {
  it('follows an existing child without creating a new node', () => {
    const { result } = renderHook(() => useChessGame())
    // Create root → child via makeMove
    act(() => { result.current.makeMove('e2', 'e4') })
    const child = result.current.currentNode
    const rootFen = result.current.rootNode.fen

    act(() => { result.current.goToStart() })
    act(() => {
      result.current.navigateToPV(rootFen, ['e2e4'])
    })

    expect(result.current.currentNode).toBe(child)
    expect(result.current.rootNode.children).toHaveLength(1) // no duplicate
  })

  it('creates a new child node when the move is not in the tree', () => {
    const { result } = renderHook(() => useChessGame())
    const rootFen = result.current.rootNode.fen

    mockMakeSan.mockReturnValueOnce('d4')
    mockMakeFen.mockReturnValueOnce('pvfen')
    act(() => {
      result.current.navigateToPV(rootFen, ['d2d4'])
    })

    expect(result.current.rootNode.children).toHaveLength(1)
    expect(result.current.currentNode.san).toBe('d4')
    expect(result.current.currentNode.fen).toBe('pvfen')
    expect(result.current.isDirty).toBe(true)
  })

  it('does nothing when analysisFen is not found in the tree', () => {
    const { result } = renderHook(() => useChessGame())
    const initialNode = result.current.currentNode

    act(() => {
      result.current.navigateToPV('notintree', ['e2e4'])
    })

    expect(result.current.currentNode).toBe(initialNode)
    expect(result.current.rootNode.children).toHaveLength(0)
  })

  it('stops replaying at an illegal move (makeSan throws)', () => {
    const { result } = renderHook(() => useChessGame())
    const rootFen = result.current.rootNode.fen

    mockMakeSan.mockReturnValueOnce('e4') // first move succeeds
    mockMakeFen.mockReturnValueOnce('after_e4')
    mockMakeSan.mockImplementationOnce(() => { throw new Error('illegal') }) // second throws

    act(() => {
      result.current.navigateToPV(rootFen, ['e2e4', 'e7e5'])
    })

    // Navigated to after first move; did not crash
    expect(result.current.currentNode.san).toBe('e4')
    expect(result.current.rootNode.children).toHaveLength(1)
    expect(result.current.rootNode.children[0].children).toHaveLength(0)
  })

  it('finds existing castling child despite UCI encoding difference (e1h1 vs e1g1)', () => {
    const { result } = renderHook(() => useChessGame())
    const rootFen = result.current.rootNode.fen

    // Mock board.get to return a king (not pawn) so makeMove doesn't auto-promote
    mockBoardGet.mockReturnValueOnce({ role: 'king', color: 'white' })
    mockMakeSan.mockReturnValueOnce('O-O')
    mockMakeFen.mockReturnValueOnce('after-castle-fen')
    act(() => { result.current.makeMove('e1', 'h1') }) // chessops encoding
    expect(result.current.rootNode.children).toHaveLength(1)
    const castleChild = result.current.rootNode.children[0]
    expect(castleChild.move?.from).toBe('e1')
    expect(castleChild.move?.to).toBe('h1')
    expect(castleChild.move?.promotion).toBeUndefined()

    // Now navigateToPV with engine encoding (e1g1 = king-to-destination)
    act(() => { result.current.goToStart() })
    act(() => {
      result.current.navigateToPV(rootFen, ['e1g1'])
    })

    // Should follow the existing castling node, not create a duplicate
    expect(result.current.rootNode.children).toHaveLength(1)
    expect(result.current.currentNode).toBe(castleChild)
  })

  it('handles promotion moves (5-char UCI) correctly', () => {
    const { result } = renderHook(() => useChessGame())
    const rootFen = result.current.rootNode.fen

    mockMakeSan.mockReturnValueOnce('e8=Q')
    mockMakeFen.mockReturnValueOnce('promofen')
    act(() => {
      result.current.navigateToPV(rootFen, ['e7e8q'])
    })

    expect(result.current.currentNode.move?.promotion).toBe('q')
    expect(result.current.currentNode.san).toBe('e8=Q')
  })

  it('stops when makeSan returns null-move indicator "--"', () => {
    const { result } = renderHook(() => useChessGame())
    const rootFen = result.current.rootNode.fen

    mockMakeSan.mockReturnValueOnce('Nf3')
    mockMakeFen.mockReturnValueOnce('after_nf3')
    mockMakeSan.mockReturnValueOnce('--') // null move = no piece at source

    act(() => {
      result.current.navigateToPV(rootFen, ['g1f3', 'a7a6', 'd2d4'])
    })

    // Only the first move should have been created; loop should stop at "--"
    expect(result.current.rootNode.children).toHaveLength(1)
    expect(result.current.currentNode.san).toBe('Nf3')
    expect(result.current.rootNode.children[0].children).toHaveLength(0)
  })
})


describe('board state guard', () => {
  /** Make one move so the board is non-empty and dirty. */
  function makeDirty(result: ReturnType<typeof renderHook<ReturnType<typeof useChessGame>, unknown>>['result']) {
    act(() => { result.current.makeMove('e2', 'e4') })
  }

  it('resetGame on a clean board applies immediately', () => {
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.resetGame() })
    expect(result.current.pendingDestructiveAction).toBeNull()
    expect(result.current.rootNode.children).toHaveLength(0)
  })

  it('resetGame on a dirty board defers and sets pendingDestructiveAction', () => {
    const { result } = renderHook(() => useChessGame())
    makeDirty(result)
    const childrenBefore = result.current.rootNode.children.length
    act(() => { result.current.resetGame() })
    expect(result.current.pendingDestructiveAction).not.toBeNull()
    // State is NOT changed yet
    expect(result.current.rootNode.children).toHaveLength(childrenBefore)
  })

  it('confirmPendingDestructiveAction applies the deferred action', () => {
    const { result } = renderHook(() => useChessGame())
    makeDirty(result)
    act(() => { result.current.resetGame() })
    expect(result.current.pendingDestructiveAction).not.toBeNull()
    act(() => { result.current.confirmPendingDestructiveAction() })
    expect(result.current.pendingDestructiveAction).toBeNull()
    expect(result.current.rootNode.children).toHaveLength(0)
    expect(result.current.isDirty).toBe(false)
  })

  it('cancelPendingDestructiveAction clears pending without applying', () => {
    const { result } = renderHook(() => useChessGame())
    makeDirty(result)
    act(() => { result.current.resetGame() })
    const childrenBefore = result.current.rootNode.children.length
    act(() => { result.current.cancelPendingDestructiveAction() })
    expect(result.current.pendingDestructiveAction).toBeNull()
    // Tree unchanged
    expect(result.current.rootNode.children).toHaveLength(childrenBefore)
    expect(result.current.isDirty).toBe(true)
  })

  it('second destructive call while pending is ignored', () => {
    const { result } = renderHook(() => useChessGame())
    makeDirty(result)
    act(() => { result.current.resetGame() })
    const firstPending = result.current.pendingDestructiveAction
    act(() => { result.current.resetGame() })
    // pendingDestructiveAction unchanged (second call ignored)
    expect(result.current.pendingDestructiveAction).toBe(firstPending)
  })

  it('markSaved clears isDirty', () => {
    const { result } = renderHook(() => useChessGame())
    makeDirty(result)
    expect(result.current.isDirty).toBe(true)
    act(() => { result.current.markSaved('some-id') })
    expect(result.current.isDirty).toBe(false)
    expect(result.current.savedGameId).toBe('some-id')
  })

  it('loadFromFEN on a dirty board defers', () => {
    const { result } = renderHook(() => useChessGame())
    makeDirty(result)
    act(() => { result.current.loadFromFEN('custom-fen') })
    expect(result.current.pendingDestructiveAction).not.toBeNull()
    // FEN not applied yet
    expect(result.current.rootNode.fen).not.toBe('custom-fen')
  })

  it('loadFromFEN confirmed applies the new position', () => {
    const { result } = renderHook(() => useChessGame())
    makeDirty(result)
    act(() => { result.current.loadFromFEN('custom-fen') })
    act(() => { result.current.confirmPendingDestructiveAction() })
    expect(result.current.rootNode.fen).toBe('custom-fen')
    expect(result.current.isDirty).toBe(false)
  })
})


describe('sound effects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('plays move sound on a quiet move', () => {
    mockMakeSan.mockReturnValue('e4')
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    expect(playMoveSound).toHaveBeenCalledTimes(1)
    expect(playCaptureSound).not.toHaveBeenCalled()
  })

  it('plays capture sound when SAN contains x', () => {
    mockMakeSan.mockReturnValue('exd5')
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e4', 'd5') })
    expect(playCaptureSound).toHaveBeenCalledTimes(1)
    expect(playMoveSound).not.toHaveBeenCalled()
  })

  it('does not play sound when navigating to existing child on same line (existing child shortcut)', () => {
    mockMakeSan.mockReturnValue('e4')
    const { result } = renderHook(() => useChessGame())
    act(() => { result.current.makeMove('e2', 'e4') })
    vi.clearAllMocks()
    // Making same move again navigates to existing child — no new move, no sound from makeMove
    act(() => { result.current.goBack() })
    vi.clearAllMocks()
    act(() => { result.current.goForward() })
    expect(playMoveSound).toHaveBeenCalledTimes(1)
  })
})
