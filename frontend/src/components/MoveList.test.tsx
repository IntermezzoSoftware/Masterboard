import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GameNode } from '@/hooks/useChessGame'
import MoveList, { type MoveListProps } from './MoveList'

// Real FEN strings so moveSide/moveNumber helpers work correctly
const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 =    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
const AFTER_E5 =    'rnbqkbnr/pppppppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
const AFTER_NF3 =   'rnbqkbnr/pppppppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'
const AFTER_D4 =    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1'

let idCounter = 0
function makeNode(
  fen: string,
  san: string | null,
  parent: GameNode | null,
  move: GameNode['move'] = null,
): GameNode {
  const node: GameNode = {
    id: String(idCounter++),
    fen,
    san,
    move,
    parent,
    children: [],
  }
  if (parent) parent.children.push(node)
  return node
}

function makeRoot(): GameNode {
  return { id: String(idCounter++), fen: INITIAL_FEN, san: null, move: null, parent: null, children: [] }
}

// jsdom doesn't implement scrollTo/scrollIntoView — stub them globally
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollTo = vi.fn() as any
})

beforeEach(() => { idCounter = 0 })

const noop = () => {}

// Provide all required MoveList props; callers may override any subset
function props(overrides: Partial<MoveListProps> = {}): MoveListProps {
  return {
    rootNode: makeRoot(),
    currentNodeId: '0',
    onGoToNode: noop,
    onDeleteFrom: noop,
    onPromoteVariation: noop,
    onSetNodeNag: noop,
    onSetNodeComment: noop,
    ...overrides,
  }
}

describe('MoveList', () => {
  it('shows "No moves yet" when root has no children', () => {
    const root = makeRoot()
    render(<MoveList rootNode={root} currentNodeId={root.id} onGoToNode={noop} />)
    expect(screen.getByText(/no moves yet/i)).toBeInTheDocument()
  })

  it('renders move number and SAN for a single white move', () => {
    const root = makeRoot()
    makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    render(<MoveList rootNode={root} currentNodeId={root.id} onGoToNode={noop} />)
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'e4' })).toBeInTheDocument()
  })

  it('renders white and black move without extra move number', () => {
    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    makeNode(AFTER_E5, 'e5', e4, { from: 'e7', to: 'e5' })
    render(<MoveList rootNode={root} currentNodeId={root.id} onGoToNode={noop} />)
    expect(screen.getByRole('button', { name: 'e4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'e5' })).toBeInTheDocument()
    // Only one move number "1." for white's move; no "1..." since no variation precedes e5
    expect(screen.getAllByText(/^1\.$/)).toHaveLength(1)
    expect(screen.queryByText('1...')).toBeNull()
  })

  it('renders multiple moves with correct move numbers', () => {
    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    const e5 = makeNode(AFTER_E5, 'e5', e4, { from: 'e7', to: 'e5' })
    makeNode(AFTER_NF3, 'Nf3', e5, { from: 'g1', to: 'f3' })
    render(<MoveList rootNode={root} currentNodeId={root.id} onGoToNode={noop} />)
    expect(screen.getByRole('button', { name: 'Nf3' })).toBeInTheDocument()
    expect(screen.getByText('2.')).toBeInTheDocument()
  })

  it('highlights the current node with accent styling', () => {
    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    render(<MoveList rootNode={root} currentNodeId={e4.id} onGoToNode={noop} />)
    const btn = screen.getByRole('button', { name: 'e4' })
    expect(btn.className).toContain('bg-[var(--color-accent-subtle)]')
  })

  it('does not highlight non-current nodes', () => {
    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    render(<MoveList rootNode={root} currentNodeId={root.id} onGoToNode={noop} />)
    const btn = screen.getByRole('button', { name: 'e4' })
    expect(btn.className).not.toContain('bg-[var(--color-accent-subtle)]')
  })

  it('calls onGoToNode with the correct node when a move is clicked', async () => {
    const onGoToNode = vi.fn()
    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    render(<MoveList rootNode={root} currentNodeId={root.id} onGoToNode={onGoToNode} />)
    await userEvent.click(screen.getByRole('button', { name: 'e4' }))
    expect(onGoToNode).toHaveBeenCalledWith(e4)
  })

  it('renders a variation in parentheses (alternative first move)', () => {
    // Variation: d4 as an alternative to e4 (both are root's children)
    // Expected: "1. e4 (1. d4) 1... e5"
    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    makeNode(AFTER_E5, 'e5', e4, { from: 'e7', to: 'e5' })
    makeNode(AFTER_D4, 'd4', root, { from: 'd2', to: 'd4' })  // second child of root
    render(<MoveList rootNode={root} currentNodeId={root.id} onGoToNode={noop} />)
    // Both parens and the variation move button should be present
    expect(screen.getByText('(')).toBeInTheDocument()
    expect(screen.getByText(')')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'd4' })).toBeInTheDocument()
  })

  it('shows "N..." move number after a variation that followed a white move', () => {
    // "1. e4 (1. d4) 1... e5" — after the (1. d4) variation, black's response needs 1...
    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    makeNode(AFTER_E5, 'e5', e4, { from: 'e7', to: 'e5' })
    makeNode(AFTER_D4, 'd4', root, { from: 'd2', to: 'd4' })
    render(<MoveList rootNode={root} currentNodeId={root.id} onGoToNode={noop} />)
    // "1..." should appear before the mainline e5 continuation after the variation block
    expect(screen.getByText('1...')).toBeInTheDocument()
  })

  it('renders variation in parentheses after a black move', () => {
    // "1. e4 e5 (1... c5) 2. Nf3" — c5 is an alternative to e5 (both children of e4)
    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    const e5 = makeNode(AFTER_E5, 'e5', e4, { from: 'e7', to: 'e5' })
    makeNode(AFTER_NF3, 'Nf3', e5, { from: 'g1', to: 'f3' })
    // c5 as alternative to e5
    makeNode(AFTER_D4, 'c5', e4, { from: 'c7', to: 'c5' })
    render(<MoveList rootNode={root} currentNodeId={root.id} onGoToNode={noop} />)
    expect(screen.getByRole('button', { name: 'c5' })).toBeInTheDocument()
    expect(screen.getByText('(')).toBeInTheDocument()
    // After a variation following a BLACK move, no "N..." is needed before white's next move
    // because white moves always show their number
    expect(screen.queryByText('2...')).toBeNull()
  })
})


describe('MoveList context menu', () => {
  function setup() {
    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    return { root, e4 }
  }

  it('opens the comment editor when "Add comment" is selected', async () => {
    const { root, e4: _ } = setup()
    render(<MoveList {...props({ rootNode: root, currentNodeId: root.id })} />)

    act(() => { fireEvent.contextMenu(screen.getByRole('button', { name: 'e4' })) })
    const menuItem = screen.getByText('Add comment')
    act(() => { fireEvent.pointerDown(menuItem); fireEvent.pointerUp(menuItem); fireEvent.click(menuItem) })

    expect(await screen.findByRole('textbox')).toBeInTheDocument()
  })

  it('auto-focuses the textarea when the comment editor opens', async () => {
    const { root } = setup()
    render(<MoveList {...props({ rootNode: root, currentNodeId: root.id })} />)

    act(() => { fireEvent.contextMenu(screen.getByRole('button', { name: 'e4' })) })
    const menuItem = screen.getByText('Add comment')
    act(() => { fireEvent.pointerDown(menuItem); fireEvent.pointerUp(menuItem); fireEvent.click(menuItem) })

    // useEffect focus runs after passive effects settle — flush with waitFor
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('textbox'))
    })
  })

  it('calls onSetNodeComment with the typed text when Enter is pressed', async () => {
    const onSetNodeComment = vi.fn()
    const { root, e4 } = setup()
    render(<MoveList {...props({ rootNode: root, currentNodeId: root.id, onSetNodeComment })} />)

    act(() => { fireEvent.contextMenu(screen.getByRole('button', { name: 'e4' })) })
    const menuItem = screen.getByText('Add comment')
    act(() => { fireEvent.pointerDown(menuItem); fireEvent.pointerUp(menuItem); fireEvent.click(menuItem) })

    const textarea = await screen.findByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'A great move' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSetNodeComment).toHaveBeenCalledWith(e4, 'A great move')
  })

  it('closes without saving when Escape is pressed', async () => {
    const onSetNodeComment = vi.fn()
    const { root } = setup()
    render(<MoveList {...props({ rootNode: root, currentNodeId: root.id, onSetNodeComment })} />)

    act(() => { fireEvent.contextMenu(screen.getByRole('button', { name: 'e4' })) })
    const menuItem = screen.getByText('Add comment')
    act(() => { fireEvent.pointerDown(menuItem); fireEvent.pointerUp(menuItem); fireEvent.click(menuItem) })

    const textarea = await screen.findByRole('textbox')
    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onSetNodeComment).not.toHaveBeenCalled()
  })

  it('shows "Edit comment" and the existing text when a comment is already set', async () => {
    const { root, e4 } = setup()
    e4.comment = 'Existing note'
    render(<MoveList {...props({ rootNode: root, currentNodeId: root.id })} />)

    // Comment text is visible inline
    expect(screen.getByText('Existing note')).toBeInTheDocument()

    // Context menu shows "Edit comment" instead of "Add comment"
    act(() => { fireEvent.contextMenu(screen.getByRole('button', { name: 'e4' })) })
    expect(screen.getByText('Edit comment')).toBeInTheDocument()

    // Editor opens pre-filled
    const menuItem = screen.getByText('Edit comment')
    act(() => { fireEvent.pointerDown(menuItem); fireEvent.pointerUp(menuItem); fireEvent.click(menuItem) })
    expect(await screen.findByRole('textbox')).toHaveValue('Existing note')
  })

  it('calls onSetNodeNag with the correct NAG when a symbol is selected', () => {
    const onSetNodeNag = vi.fn()
    const { root, e4 } = setup()
    render(<MoveList {...props({ rootNode: root, currentNodeId: root.id, onSetNodeNag })} />)

    act(() => { fireEvent.contextMenu(screen.getByRole('button', { name: 'e4' })) })
    const menuItem = screen.getByText('Good move')
    act(() => { fireEvent.pointerDown(menuItem); fireEvent.pointerUp(menuItem); fireEvent.click(menuItem) })

    expect(onSetNodeNag).toHaveBeenCalledWith(e4, 1)
  })

  it('toggles a NAG off (calls onSetNodeNag with undefined) when the active NAG is re-selected', () => {
    const onSetNodeNag = vi.fn()
    const { root, e4 } = setup()
    e4.nag = 1  // already has "Good move" NAG
    render(<MoveList {...props({ rootNode: root, currentNodeId: root.id, onSetNodeNag })} />)

    act(() => { fireEvent.contextMenu(screen.getByRole('button', { name: /e4/ })) })
    const menuItem = screen.getByText('Good move')
    act(() => { fireEvent.pointerDown(menuItem); fireEvent.pointerUp(menuItem); fireEvent.click(menuItem) })

    expect(onSetNodeNag).toHaveBeenCalledWith(e4, undefined)
  })

  it('scrolls the active move into view when currentNodeId changes', () => {
    const scrollIntoView = vi.fn()
    HTMLButtonElement.prototype.scrollIntoView = scrollIntoView

    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })
    const e5 = makeNode(AFTER_E5, 'e5', e4, { from: 'e7', to: 'e5' })

    const { rerender } = render(<MoveList {...props({ rootNode: root, currentNodeId: e4.id })} />)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })

    scrollIntoView.mockClear()
    rerender(<MoveList {...props({ rootNode: root, currentNodeId: e5.id })} />)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('scrolls container to top when navigating to root node', () => {
    const scrollTo = vi.fn()
    HTMLDivElement.prototype.scrollTo = scrollTo
    const scrollIntoView = vi.fn()
    HTMLButtonElement.prototype.scrollIntoView = scrollIntoView

    const root = makeRoot()
    const e4 = makeNode(AFTER_E4, 'e4', root, { from: 'e2', to: 'e4' })

    const { rerender } = render(<MoveList {...props({ rootNode: root, currentNodeId: e4.id })} />)
    scrollTo.mockClear()
    scrollIntoView.mockClear()

    rerender(<MoveList {...props({ rootNode: root, currentNodeId: root.id })} />)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
