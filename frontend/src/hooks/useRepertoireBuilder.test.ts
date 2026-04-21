import { renderHook, act, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

const {
  mockPlay,
  mockMakeFen,
  mockMakeSan,
  mockMakeUci,
  mockParseUci,
  mockParseFen,
  mockParseSan,
  mockChessgroundDests,
  MockChess,
  mockParseAllMovesFromPGN,
} = vi.hoisted(() => {
  const mockPlay              = vi.fn()
  const mockMakeFen           = vi.fn((setup: unknown) => {
    // Return a deterministic FEN based on how many times play was called
    return 'fen-' + (mockPlay.mock.calls.length)
  })
  const mockMakeSan           = vi.fn(() => 'e4')
  const mockMakeUci           = vi.fn(() => 'e2e4')
  const mockParseUci          = vi.fn((uci: string) => ({ from: uci.slice(0,2), to: uci.slice(2,4) }))
  const mockParseFen          = vi.fn(() => ({ unwrap: () => ({}) }))
  const mockParseSan          = vi.fn(() => ({ from: 'e2', to: 'e4' }))
  const mockChessgroundDests  = vi.fn(() => new Map())
  const MockChess = {
    fromSetup: vi.fn(() => ({
      unwrap: vi.fn(() => ({
        play: mockPlay,
        turn: 'white',
        toSetup: vi.fn(() => ({})),
        isEnd: vi.fn(() => false),
      })),
    })),
  }
  const mockParseAllMovesFromPGN = vi.fn(() => [])

  return {
    mockPlay, mockMakeFen, mockMakeSan, mockMakeUci,
    mockParseUci, mockParseFen, mockParseSan, mockChessgroundDests,
    MockChess, mockParseAllMovesFromPGN,
  }
})

vi.mock('chessops/chess',  () => ({ Chess: MockChess }))
vi.mock('chessops/fen',    () => ({
  parseFen: mockParseFen,
  makeFen: mockMakeFen,
  INITIAL_FEN: 'startpos',
}))
vi.mock('chessops/compat', () => ({ chessgroundDests: mockChessgroundDests }))
vi.mock('chessops/san',    () => ({ makeSan: mockMakeSan, parseSan: mockParseSan }))
vi.mock('chessops/util',   () => ({ parseUci: mockParseUci, makeUci: mockMakeUci }))
vi.mock('@/lib/pgnUtils',  () => ({ parseAllMovesFromPGN: mockParseAllMovesFromPGN }))

// Mock api — defined after hoisting so factories can reference vi.fn()
const mockLoadRepertoire       = vi.fn()
const mockSaveRepertoireMove   = vi.fn()
const mockUpdateRepertoireMove = vi.fn()
const mockDeleteRepertoireBranch = vi.fn()
const mockGetRepertoireHeatmap = vi.fn().mockResolvedValue([])

vi.mock('@/lib/api', () => ({
  api: {
    loadRepertoire:        (...args: unknown[]) => mockLoadRepertoire(...args),
    saveRepertoireMove:    (...args: unknown[]) => mockSaveRepertoireMove(...args),
    updateRepertoireMove:  (...args: unknown[]) => mockUpdateRepertoireMove(...args),
    deleteRepertoireBranch:(...args: unknown[]) => mockDeleteRepertoireBranch(...args),
    getRepertoireHeatmap:  (...args: unknown[]) => mockGetRepertoireHeatmap(...args),
  },
}))

import { INITIAL_FEN } from 'chessops/fen'
import { useRepertoireBuilder } from './useRepertoireBuilder'


const MOCK_REPERTOIRE = { id: 'rep-1', name: 'Ruy Lopez', colour: 'white', description: '' }
const MOCK_MOVES = [
  {
    id: 'move-1', repertoireId: 'rep-1', parentId: null,
    fromFen: INITIAL_FEN, toFen: 'fen-after-e4',
    moveSan: 'e4', moveUci: 'e2e4', moveOrder: 0, nag: null, comment: '', shapes: '',
  },
  {
    id: 'move-2', repertoireId: 'rep-1', parentId: 'move-1',
    fromFen: 'fen-after-e4', toFen: 'fen-after-e4-e5',
    moveSan: 'e5', moveUci: 'e7e5', moveOrder: 0, nag: null, comment: '', shapes: '',
  },
]

function setupLoadMock(moves = MOCK_MOVES) {
  mockLoadRepertoire.mockResolvedValue({ repertoire: MOCK_REPERTOIRE, moves })
}


beforeEach(() => {
  vi.clearAllMocks()
  // Reset makeFen to simple deterministic value
  mockMakeFen.mockReturnValue('fen-next')
  mockMakeSan.mockReturnValue('e4')
  mockMakeUci.mockReturnValue('e2e4')
  mockParseUci.mockImplementation((uci: string) => ({ from: uci.slice(0,2), to: uci.slice(2,4) }))
})

describe('useRepertoireBuilder', () => {
  it('loads repertoire data on mount', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(mockLoadRepertoire).toHaveBeenCalledWith('rep-1')
    expect(result.current.repertoire?.name).toBe('Ruy Lopez')
    expect(result.current.moves).toHaveLength(2)
  })

  it('initialises orientation from repertoire colour', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.orientation).toBe('white')
  })

  it('starts at INITIAL_FEN with null currentMoveId', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.currentFen).toBe(INITIAL_FEN)
    expect(result.current.currentMoveId).toBeNull()
  })

  it('navigateTo sets currentFen and currentMoveId', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => { result.current.navigateTo(MOCK_MOVES[0]) })
    expect(result.current.currentFen).toBe('fen-after-e4')
    expect(result.current.currentMoveId).toBe('move-1')
  })

  it('makeMove navigates to existing move without saving', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Set up mocks so the move looks like an existing one
    mockMakeUci.mockReturnValue('e2e4')
    mockMakeFen.mockReturnValue('fen-after-e4')

    await act(async () => { await result.current.makeMove('e2', 'e4') })

    expect(mockSaveRepertoireMove).not.toHaveBeenCalled()
    expect(result.current.currentMoveId).toBe('move-1')
    expect(result.current.currentFen).toBe('fen-after-e4')
  })

  it('makeMove saves new move and navigates', async () => {
    setupLoadMock()
    mockSaveRepertoireMove.mockResolvedValue('move-new')
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // d4 is not in existing moves (only e2e4 and e7e5 are)
    mockMakeUci.mockReturnValue('d2d4')
    mockMakeFen.mockReturnValue('fen-after-d4')
    mockMakeSan.mockReturnValue('d4')

    await act(async () => { await result.current.makeMove('d2', 'd4') })

    expect(mockSaveRepertoireMove).toHaveBeenCalledOnce()
    const savedMove = mockSaveRepertoireMove.mock.calls[0][0]
    expect(savedMove.moveUci).toBe('d2d4')
    expect(savedMove.moveSan).toBe('d4')
    expect(savedMove.fromFen).toBe(INITIAL_FEN)
    expect(result.current.currentMoveId).toBe('move-new')
    expect(result.current.currentFen).toBe('fen-after-d4')
  })

  it('goBack returns to parent position', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Navigate to move-2
    act(() => { result.current.navigateTo(MOCK_MOVES[1]) })
    expect(result.current.currentMoveId).toBe('move-2')

    act(() => { result.current.goBack() })
    expect(result.current.currentFen).toBe('fen-after-e4')
    expect(result.current.currentMoveId).toBe('move-1')
  })

  it('goBack at root does nothing', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => { result.current.goBack() })
    expect(result.current.currentFen).toBe(INITIAL_FEN)
    expect(result.current.currentMoveId).toBeNull()
  })

  it('goToStart resets to INITIAL_FEN and null moveId', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => { result.current.navigateTo(MOCK_MOVES[1]) })
    act(() => { result.current.goToStart() })
    expect(result.current.currentFen).toBe(INITIAL_FEN)
    expect(result.current.currentMoveId).toBeNull()
  })

  it('goForward navigates to the first child of current position', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // At root, main child is move-1 (parentId null, moveOrder 0)
    act(() => { result.current.goForward() })
    expect(result.current.currentMoveId).toBe('move-1')
    expect(result.current.currentFen).toBe('fen-after-e4')
  })

  it('goForward does nothing when no children exist', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Navigate to the deepest move (move-2 has no children)
    act(() => { result.current.navigateTo(MOCK_MOVES[1]) })
    act(() => { result.current.goForward() })
    expect(result.current.currentMoveId).toBe('move-2')
  })

  it('goToEnd follows the main line to the deepest position', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => { result.current.goToEnd() })
    // Root → move-1 → move-2 (deepest)
    expect(result.current.currentMoveId).toBe('move-2')
    expect(result.current.currentFen).toBe('fen-after-e4-e5')
  })

  it('flipOrientation toggles white/black', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.orientation).toBe('white')

    act(() => { result.current.flipOrientation() })
    expect(result.current.orientation).toBe('black')

    act(() => { result.current.flipOrientation() })
    expect(result.current.orientation).toBe('white')
  })

  it('deleteMove calls api.deleteRepertoireBranch and reloads', async () => {
    setupLoadMock([MOCK_MOVES[0]])  // reload returns only root move
    mockDeleteRepertoireBranch.mockResolvedValue(undefined)
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => { await result.current.deleteMove('move-1') })

    expect(mockDeleteRepertoireBranch).toHaveBeenCalledWith('move-1')
    expect(mockLoadRepertoire).toHaveBeenCalledTimes(2) // initial + reload
  })

  it('deleteMove navigates back when current move is deleted', async () => {
    // Load with both moves so the hook knows move-2's parent
    setupLoadMock(MOCK_MOVES)
    mockDeleteRepertoireBranch.mockResolvedValue(undefined)
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Navigate to move-2 (child of move-1)
    act(() => { result.current.navigateTo(MOCK_MOVES[1]) })
    expect(result.current.currentMoveId).toBe('move-2')

    // Delete the current move — reload will return only root move
    mockLoadRepertoire.mockResolvedValue({ repertoire: MOCK_REPERTOIRE, moves: [MOCK_MOVES[0]] })
    await act(async () => { await result.current.deleteMove('move-2') })

    // Should have backed up to move-1's toFen = 'fen-after-e4' and parentId = 'move-1'
    expect(result.current.currentFen).toBe('fen-after-e4')
    expect(result.current.currentMoveId).toBe('move-1')
  })

  it('updateAnnotation calls api.updateRepertoireMove and updates local state', async () => {
    setupLoadMock()
    mockUpdateRepertoireMove.mockResolvedValue(undefined)
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.updateAnnotation('move-1', 1, 'Good move')
    })

    expect(mockUpdateRepertoireMove).toHaveBeenCalledOnce()
    const updated = mockUpdateRepertoireMove.mock.calls[0][0]
    expect(updated.id).toBe('move-1')
    expect(updated.nag).toBe(1)
    expect(updated.comment).toBe('Good move')

    // Local state should be updated optimistically
    expect(result.current.moves.find(m => m.id === 'move-1')?.comment).toBe('Good move')
  })

  it('importPGN calls parseAllMovesFromPGN, saves new moves, returns count', async () => {
    setupLoadMock()
    mockParseAllMovesFromPGN.mockReturnValue([
      { fromFen: INITIAL_FEN, toFen: 'fen-d4', san: 'd4', uci: 'd2d4' },
    ])
    mockSaveRepertoireMove.mockResolvedValue('move-new-d4')

    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let count = 0
    await act(async () => {
      count = await result.current.importPGN('1. d4 *')
    })

    expect(mockParseAllMovesFromPGN).toHaveBeenCalledWith('1. d4 *')
    expect(mockSaveRepertoireMove).toHaveBeenCalledOnce()
    expect(count).toBe(1)
  })

  it('importPGN skips moves already in the repertoire', async () => {
    setupLoadMock()
    // e2e4 already exists in MOCK_MOVES
    mockParseAllMovesFromPGN.mockReturnValue([
      { fromFen: INITIAL_FEN, toFen: 'fen-after-e4', san: 'e4', uci: 'e2e4' },
    ])
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let count = 0
    await act(async () => { count = await result.current.importPGN('1. e4 *') })

    expect(mockSaveRepertoireMove).not.toHaveBeenCalled()
    expect(count).toBe(0)
  })

  it('existingMoveSans returns SANs of direct children of the current move', async () => {
    setupLoadMock()
    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // At root (currentMoveId = null), direct children have parentId = null → only move-1 (e4)
    expect(result.current.existingMoveSans).toEqual(new Set(['e4']))

    // Navigate to move-1; direct children have parentId = 'move-1' → only move-2 (e5)
    act(() => { result.current.navigateTo(MOCK_MOVES[0]) })
    expect(result.current.existingMoveSans).toEqual(new Set(['e5']))
  })

  // The same position can be reached via different move orders.  FENs for the
  // same position may differ in halfmove clock (field 5) and fullmove number
  // (field 6) depending on how the route was played.  Transposition detection
  // must use only the first four FEN fields (piece placement + active color +
  // castling + en passant) so these differences don't cause false negatives.

  it('makeMove flags isTransposition when toFen shares position key with existing move despite different halfmove clock', async () => {
    // Existing line ends at the position with halfmove clock 0 (after a pawn move).
    const movesWithCanonical = [
      ...MOCK_MOVES,
      {
        id: 'move-3', repertoireId: 'rep-1', parentId: 'move-2',
        fromFen: 'fen-after-e4-e5', toFen: 'pos w KQkq - 0 11',
        moveSan: 'b5', moveUci: 'b2b5', moveOrder: 0,
        nag: null, comment: '', shapes: '', isTransposition: false,
      },
    ]
    mockLoadRepertoire.mockResolvedValue({ repertoire: MOCK_REPERTOIRE, moves: movesWithCanonical })
    mockSaveRepertoireMove.mockResolvedValue('move-transposition')

    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // A different move from a different starting point also reaches the same position
    // but with halfmove clock 3 (after a piece move) — same first-four FEN fields.
    mockMakeUci.mockReturnValue('g1f3')
    mockMakeFen.mockReturnValue('pos w KQkq - 3 11')
    mockMakeSan.mockReturnValue('Nf3')

    await act(async () => { await result.current.makeMove('g1', 'f3') })

    expect(mockSaveRepertoireMove).toHaveBeenCalledOnce()
    const saved = mockSaveRepertoireMove.mock.calls[0][0]
    expect(saved.isTransposition).toBe(true)
  })

  it('importPGN marks isTransposition when imported move reaches position already in repertoire via different halfmove clock', async () => {
    // Existing line ends at position with halfmove clock 0.
    const movesWithCanonical = [
      ...MOCK_MOVES,
      {
        id: 'move-3', repertoireId: 'rep-1', parentId: 'move-2',
        fromFen: 'fen-after-e4-e5', toFen: 'pos w KQkq - 0 11',
        moveSan: 'b5', moveUci: 'b2b5', moveOrder: 0,
        nag: null, comment: '', shapes: '', isTransposition: false,
      },
    ]
    mockLoadRepertoire.mockResolvedValue({ repertoire: MOCK_REPERTOIRE, moves: movesWithCanonical })
    mockSaveRepertoireMove.mockResolvedValue('move-import-transposition')

    // The imported PGN reaches the same position from a different parent, but
    // with halfmove clock 5 (piece move sequence) — same first-four FEN fields.
    mockParseAllMovesFromPGN.mockReturnValue([
      { fromFen: 'fen-after-e4-e5', toFen: 'pos w KQkq - 5 11', san: 'Nbd2', uci: 'b1d2' },
    ])

    const { result } = renderHook(() => useRepertoireBuilder('rep-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => { await result.current.importPGN('1. e4 e5 2. Nbd2 *') })

    expect(mockSaveRepertoireMove).toHaveBeenCalledOnce()
    const saved = mockSaveRepertoireMove.mock.calls[0][0]
    expect(saved.isTransposition).toBe(true)
  })

})
