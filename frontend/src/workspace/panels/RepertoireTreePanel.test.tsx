import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { RepertoireMove, Repertoire, RepertoireData } from '@/lib/api'
import { RepertoireBuilderProvider } from '@/context/RepertoireBuilderContext'
import type { RepertoireBuilderHook } from '@/hooks/useRepertoireBuilder'


vi.mock('@radix-ui/react-context-menu', () => ({
  Root:        ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Trigger:     ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  Portal:      ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Content:     ({ children }: { children: React.ReactNode; className?: string; onCloseAutoFocus?: unknown }) => <div>{children}</div>,
  Item:        ({ children, onSelect, className }: { children: React.ReactNode; onSelect?: () => void; className?: string }) => (
    <button onClick={onSelect} className={className}>{children}</button>
  ),
  Separator:   () => <hr />,
  Sub:         ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SubTrigger:  ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  SubContent:  ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
}))


const mockListRepertoires   = vi.fn<() => Promise<Repertoire[]>>()
const mockLoadRepertoire    = vi.fn<(id: string) => Promise<RepertoireData>>()
const mockSaveRepertoireMove = vi.fn<(m: RepertoireMove) => Promise<string>>()

vi.mock('@/lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      getSetting:         vi.fn().mockResolvedValue(''),
      listRepertoires:    (...args: Parameters<typeof mockListRepertoires>)    => mockListRepertoires(...args),
      loadRepertoire:     (...args: Parameters<typeof mockLoadRepertoire>)     => mockLoadRepertoire(...args),
      saveRepertoireMove: (...args: Parameters<typeof mockSaveRepertoireMove>) => mockSaveRepertoireMove(...args),
    },
  }
})


const mockNavigate = vi.fn()
vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/openings/test-rep-id' }),
}))


const mockShowToast = vi.fn()
vi.mock('@/context/ToastContext', () => ({
  useToast: () => mockShowToast,
}))

import RepertoireTreePanel from './RepertoireTreePanel'
import { api } from '@/lib/api'


const INITIAL_FEN    = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const FEN_AFTER_E4   = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const FEN_AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
const FEN_AFTER_E4_C5 = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
const FEN_AFTER_D4    = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'
const FEN_AFTER_E4_E5_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'

function makeMove(overrides: Partial<RepertoireMove> & Pick<RepertoireMove, 'id' | 'moveSan'>): RepertoireMove {
  return {
    repertoireId: 'rep-1',
    parentId: null,
    fromFen: INITIAL_FEN,
    toFen: FEN_AFTER_E4,
    moveUci: 'e2e4',
    moveOrder: 0,
    nag: null,
    comment: '',
    shapes: '',
    isTransposition: false,
    ...overrides,
  }
}

// A tree: 1. e4 (1... e5 2. Nf3, 1... c5) and 1. d4
const MOVES: RepertoireMove[] = [
  makeMove({ id: 'e4',  moveSan: 'e4',  fromFen: INITIAL_FEN,    toFen: FEN_AFTER_E4,      moveUci: 'e2e4', moveOrder: 0 }),
  makeMove({ id: 'd4',  moveSan: 'd4',  fromFen: INITIAL_FEN,    toFen: FEN_AFTER_D4,      moveUci: 'd2d4', moveOrder: 1 }),
  makeMove({ id: 'e5',  moveSan: 'e5',  fromFen: FEN_AFTER_E4,   toFen: FEN_AFTER_E4_E5,   moveUci: 'e7e5', parentId: 'e4',  moveOrder: 0 }),
  makeMove({ id: 'c5',  moveSan: 'c5',  fromFen: FEN_AFTER_E4,   toFen: FEN_AFTER_E4_C5,   moveUci: 'c7c5', parentId: 'e4',  moveOrder: 1 }),
  makeMove({ id: 'nf3', moveSan: 'Nf3', fromFen: FEN_AFTER_E4_E5, toFen: FEN_AFTER_E4_E5_NF3, moveUci: 'g1f3', parentId: 'e5', moveOrder: 0 }),
]

const TARGET_REP: Repertoire = { id: 'rep-2', name: 'King Pawn', colour: 'white', description: '' }

function makeContext(overrides: Partial<RepertoireBuilderHook> = {}): RepertoireBuilderHook {
  return {
    repertoire: null,
    moves: MOVES,
    currentFen: INITIAL_FEN,
    currentMoveId: null,
    boardConfig: {},
    orientation: 'white',
    isLoading: false,
    error: '',
    existingMoveSans: new Set<string>(),
    heatmap: null,
    loadHeatmap: vi.fn(),
    makeMove: vi.fn(),
    navigateTo: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    goToStart: vi.fn(),
    goToEnd: vi.fn(),
    flipOrientation: vi.fn(),
    deleteMove: vi.fn(),
    updateAnnotation: vi.fn(),
    importPGN: vi.fn().mockResolvedValue(0),
    importPolyglotBook: vi.fn().mockResolvedValue(0),
    reorderSiblings: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as RepertoireBuilderHook
}

function renderPanel(ctx = makeContext()) {
  return render(
    <RepertoireBuilderProvider value={ctx}>
      <RepertoireTreePanel />
    </RepertoireBuilderProvider>
  )
}


describe('RepertoireTreePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getSetting).mockResolvedValue('')
    mockListRepertoires.mockResolvedValue([TARGET_REP])
    mockLoadRepertoire.mockResolvedValue({ repertoire: TARGET_REP, moves: [] })
    mockSaveRepertoireMove.mockResolvedValue('new-id')
  })

  it('renders data-testid="repertoire-tree"', () => {
    renderPanel()
    expect(screen.getByTestId('repertoire-tree')).toBeInTheDocument()
  })

  it('shows empty-state hint when no moves', () => {
    renderPanel(makeContext({ moves: [] }))
    expect(screen.getByText(/play a move on the board/i)).toBeInTheDocument()
  })

  it('renders root moves as buttons', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /^e4/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^d4/ })).toBeInTheDocument()
  })

  it('renders child moves', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /^e5/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^c5/ })).toBeInTheDocument()
  })

  it('all branches are visible — no branch hidden', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /^e5/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^c5/ })).toBeVisible()
  })

  it('child move has greater paddingLeft than its parent', () => {
    renderPanel()
    const e4Btn = screen.getByRole('button', { name: /^e4/ })
    const e5Btn = screen.getByRole('button', { name: /^e5/ })
    const e4Row = e4Btn.closest('div[style]') as HTMLElement
    const e5Row = e5Btn.closest('div[style]') as HTMLElement
    const e4Pad = parseInt(e4Row?.style.paddingLeft ?? '0')
    const e5Pad = parseInt(e5Row?.style.paddingLeft ?? '0')
    expect(e5Pad).toBeGreaterThan(e4Pad)
  })

  it('active move has accent styling', () => {
    renderPanel(makeContext({ currentMoveId: 'e4' }))
    const btn = screen.getByRole('button', { name: /^e4/ })
    expect(btn.className).toContain('font-semibold')
  })

  it('inactive moves do not have active styling', () => {
    renderPanel(makeContext({ currentMoveId: 'e4' }))
    const btn = screen.getByRole('button', { name: /^d4/ })
    expect(btn.className).not.toContain('font-semibold')
    expect(btn.className).toContain('cursor-pointer')
  })

  it('clicking a move calls navigateTo with the correct move', () => {
    const navigateTo = vi.fn()
    renderPanel(makeContext({ navigateTo }))
    fireEvent.click(screen.getByRole('button', { name: /^e5/ }))
    expect(navigateTo).toHaveBeenCalledOnce()
    expect(navigateTo.mock.calls[0][0].id).toBe('e5')
  })

  it('displays comment text below the move row', () => {
    const movesWithComment = MOVES.map(m =>
      m.id === 'e4' ? { ...m, comment: 'The king pawn opening' } : m
    )
    renderPanel(makeContext({ moves: movesWithComment }))
    expect(screen.getByText('The king pawn opening')).toBeInTheDocument()
  })


  it('clicking the collapse toggle hides the branch children', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /^e5/ })).toBeInTheDocument()

    const collapseBtn = screen.getAllByRole('button', { name: /collapse branch/i })[0]
    fireEvent.click(collapseBtn)

    expect(screen.getAllByRole('button', { name: /expand branch/i }).length).toBeGreaterThan(0)
  })

  it('clicking expand restores collapsed branch', () => {
    renderPanel()
    const collapseBtn = screen.getAllByRole('button', { name: /collapse branch/i })[0]
    fireEvent.click(collapseBtn)

    const expandBtn = screen.getByRole('button', { name: /expand branch/i })
    fireEvent.click(expandBtn)

    expect(screen.getAllByRole('button', { name: /collapse branch/i }).length).toBeGreaterThan(0)
  })


  it('renders transposition indicator for a move with isTransposition=true', () => {
    const movesWithTransposition = MOVES.map(m =>
      m.id === 'c5' ? { ...m, isTransposition: true } : m
    )
    renderPanel(makeContext({ moves: movesWithTransposition }))
    expect(screen.getByText(/transposes/i)).toBeInTheDocument()
  })

  it('does not render children of a transposition move', () => {
    const FEN_AFTER_C5_NF3 = 'some-fen-nf3'
    const grandchild = makeMove({ id: 'nf3b', moveSan: 'Nf3b', parentId: 'c5', fromFen: FEN_AFTER_E4_C5, toFen: FEN_AFTER_C5_NF3 })
    const movesWithTransposition = [
      ...MOVES.map(m => m.id === 'c5' ? { ...m, isTransposition: true } : m),
      grandchild,
    ]
    renderPanel(makeContext({ moves: movesWithTransposition }))
    expect(screen.queryByRole('button', { name: /^Nf3b/ })).not.toBeInTheDocument()
  })


  it('shows copy submenus when other repertoires exist', async () => {
    renderPanel()
    await waitFor(() => {
      expect(screen.getAllByText('Add to repertoire').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Add branch to repertoire').length).toBeGreaterThan(0)
    })
  })

  it('does not show copy submenus when no other repertoires exist', async () => {
    mockListRepertoires.mockResolvedValue([])
    renderPanel()
    await waitFor(() => {
      expect(mockListRepertoires).toHaveBeenCalled()
    })
    expect(screen.queryByText('Add to repertoire')).not.toBeInTheDocument()
    expect(screen.queryByText('Add branch to repertoire')).not.toBeInTheDocument()
  })

  it('excludes the current repertoire from copy targets', async () => {
    // The current repertoire has the same id as moves[0].repertoireId = 'rep-1'
    const currentRep: Repertoire = { id: 'rep-1', name: 'Current', colour: 'white', description: '' }
    mockListRepertoires.mockResolvedValue([currentRep, TARGET_REP])
    renderPanel()
    await waitFor(() => {
      expect(screen.getAllByText('Add to repertoire').length).toBeGreaterThan(0)
    })
    // 'Current' (rep-1) should not appear as a target; 'King Pawn' (rep-2) should
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
    expect(screen.getAllByText('King Pawn').length).toBeGreaterThan(0)
  })


  it('Add to repertoire saves the path from root to the clicked move', async () => {
    renderPanel()
    await waitFor(() => {
      expect(screen.getAllByText('King Pawn').length).toBeGreaterThan(0)
    })

    // Click the "King Pawn" target under the first "Add to repertoire" submenu for the Nf3 move
    const targets = screen.getAllByText('King Pawn')
    // First occurrence belongs to the first move's "Add to repertoire" submenu
    fireEvent.click(targets[0])

    await waitFor(() => {
      expect(mockSaveRepertoireMove).toHaveBeenCalled()
    })

    // All saved moves should be destined for rep-2
    const calls = mockSaveRepertoireMove.mock.calls
    expect(calls.every(([m]) => m.repertoireId === 'rep-2')).toBe(true)
  })

  it('Add to repertoire: saves nothing when all moves already exist in target', async () => {
    // Pre-populate target with all MOVES
    mockLoadRepertoire.mockResolvedValue({
      repertoire: TARGET_REP,
      moves: MOVES.map(m => ({ ...m, repertoireId: 'rep-2' })),
    })
    renderPanel()
    await waitFor(() => {
      expect(screen.getAllByText('King Pawn').length).toBeGreaterThan(0)
    })

    const targets = screen.getAllByText('King Pawn')
    fireEvent.click(targets[0])

    await waitFor(() => {
      expect(mockLoadRepertoire).toHaveBeenCalled()
    })
    expect(mockSaveRepertoireMove).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.stringMatching(/already in/i))
    })
  })


  it('Add branch to repertoire saves ancestors + clicked move + all descendants', async () => {
    renderPanel()
    await waitFor(() => {
      expect(screen.getAllByText('King Pawn').length).toBeGreaterThan(0)
    })

    // Each move gets two "King Pawn" targets (one per submenu).
    // Clicking the second occurrence triggers "Add branch to repertoire" for the e4 move.
    // e5 is a child of e4, and Nf3 is a child of e5. Right-clicking e5 should include
    // e4 (ancestor) + e5 (clicked) + Nf3 (descendant).
    // We click the "Add branch to repertoire" target for the e5 move.
    // In the rendered order: each move has [Add to rep target, Add branch target].
    // e4 targets are indices 0, 1 (add path, add branch).
    // d4 targets are indices 2, 3.
    // e5 targets are indices 4, 5 — index 5 is "Add branch" for e5.
    const targets = screen.getAllByText('King Pawn')
    fireEvent.click(targets[5])

    await waitFor(() => {
      expect(mockSaveRepertoireMove).toHaveBeenCalled()
    })

    const savedUcis = mockSaveRepertoireMove.mock.calls.map(([m]) => m.moveUci)
    // e4 is the ancestor of e5
    expect(savedUcis).toContain('e2e4')
    // e5 is the clicked move
    expect(savedUcis).toContain('e7e5')
    // Nf3 is a descendant of e5
    expect(savedUcis).toContain('g1f3')
    // c5 is a sibling of e5 — should NOT be included
    expect(savedUcis).not.toContain('c7c5')
  })

  it('Add branch to repertoire: toast shows move count on success', async () => {
    renderPanel()
    await waitFor(() => {
      expect(screen.getAllByText('King Pawn').length).toBeGreaterThan(0)
    })

    const targets = screen.getAllByText('King Pawn')
    fireEvent.click(targets[1])

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.stringMatching(/added \d+ move/i))
    })
  })


  it('hides heatmap dots when repertoire.showHeatmap is false', async () => {
    vi.mocked(api.getSetting).mockResolvedValue('false')
    const heatmapData = new Map([
      ['e4', { moveId: 'e4', retrievability: 0.95, state: 2 }],
    ])
    renderPanel(makeContext({ heatmap: heatmapData }))
    await waitFor(() => {
      expect(vi.mocked(api.getSetting)).toHaveBeenCalledWith('repertoire.showHeatmap')
    })
    expect(document.querySelector('.bg-green-500')).toBeNull()
  })
})
