import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

const mockApi = vi.hoisted(() => ({
  destroy: vi.fn(),
  set: vi.fn(),
  getFen: vi.fn(() => 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'),
  newPiece: vi.fn(),
  redrawAll: vi.fn(),
}))

const mockChessUnwrap = vi.hoisted(() => vi.fn(() => ({})))
const mockParseFenUnwrap = vi.hoisted(() => vi.fn(() => ({})))

vi.mock('@lichess-org/chessground', () => ({
  Chessground: vi.fn(() => mockApi),
}))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

vi.mock('chessops/chess', () => ({
  Chess: { fromSetup: vi.fn(() => ({ unwrap: mockChessUnwrap })) },
}))
vi.mock('chessops/fen', () => ({
  parseFen: vi.fn(() => ({ unwrap: mockParseFenUnwrap })),
}))

const mockLoadFromFEN = vi.fn()
vi.mock('@/context/ChessGameContext', () => ({
  useChessGameContext: () => ({ loadFromFEN: mockLoadFromFEN }),
}))

import PositionEditor from './PositionEditor'

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function renderEditor(onClose = vi.fn()) {
  return render(<PositionEditor initialFen={INITIAL_FEN} onClose={onClose} />)
}

describe('PositionEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChessUnwrap.mockImplementation(() => ({}))
    mockParseFenUnwrap.mockImplementation(() => ({}))
    mockApi.getFen.mockImplementation(() => 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')
  })

  it('renders the dialog with board and controls', () => {
    renderEditor()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('position-editor-board')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load Position' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('renders the piece picker with all 12 pieces', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: 'Place white king' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Place black pawn' })).toBeInTheDocument()
    // 6 white + 6 black = 12 picker buttons
    const pickerButtons = [
      'Place white king', 'Place white queen', 'Place white rook',
      'Place white bishop', 'Place white knight', 'Place white pawn',
      'Place black king', 'Place black queen', 'Place black rook',
      'Place black bishop', 'Place black knight', 'Place black pawn',
    ]
    pickerButtons.forEach(name => {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    })
  })

  it('renders side-to-move toggle initialised from FEN', () => {
    renderEditor()
    const whiteBtn = screen.getByRole('button', { name: 'White' })
    const blackBtn = screen.getByRole('button', { name: 'Black' })
    expect(whiteBtn).toBeInTheDocument()
    expect(blackBtn).toBeInTheDocument()
    // Initial FEN has 'w' so White should be selected
    expect(whiteBtn).toHaveAttribute('aria-pressed', 'true')
    expect(blackBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders castling toggles initialised from FEN', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: 'White kingside' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'White queenside' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Black kingside' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Black queenside' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows Clear board and Starting position buttons', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: 'Clear board' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Starting position' })).toBeInTheDocument()
  })

  it('shows live FEN preview input', () => {
    renderEditor()
    const fenInput = screen.getByRole('textbox', { name: 'Current FEN' })
    expect(fenInput).toBeInTheDocument()
    expect((fenInput as HTMLInputElement).value).toContain('rnbqkbnr/pppppppp')
  })

  it('Cancel calls onClose without loading FEN', async () => {
    const onClose = vi.fn()
    renderEditor(onClose)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(mockLoadFromFEN).not.toHaveBeenCalled()
  })

  it('Load Position calls loadFromFEN and onClose for valid position', async () => {
    const onClose = vi.fn()
    renderEditor(onClose)
    fireEvent.click(screen.getByRole('button', { name: 'Load Position' }))
    expect(mockLoadFromFEN).toHaveBeenCalledOnce()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('shows error and does not load for invalid position', () => {
    mockChessUnwrap.mockImplementationOnce(() => { throw new Error('Missing kings') })
    const onClose = vi.fn()
    renderEditor(onClose)
    fireEvent.click(screen.getByRole('button', { name: 'Load Position' }))
    expect(screen.getByText(/invalid position/i)).toBeInTheDocument()
    expect(mockLoadFromFEN).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('selecting a piece shows the overlay', () => {
    renderEditor()
    expect(screen.queryByTestId('piece-overlay')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Place white queen' }))
    expect(screen.getByTestId('piece-overlay')).toBeInTheDocument()
  })

  it('clicking piece again deselects it and hides overlay', () => {
    renderEditor()
    const queenBtn = screen.getByRole('button', { name: 'Place white queen' })
    fireEvent.click(queenBtn)
    expect(screen.getByTestId('piece-overlay')).toBeInTheDocument()
    fireEvent.click(queenBtn)
    expect(screen.queryByTestId('piece-overlay')).not.toBeInTheDocument()
  })

  it('Starting position resets side and castling', () => {
    // Start with black to move by rendering a black-to-move FEN
    const blackFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    const onClose = vi.fn()
    render(<PositionEditor initialFen={blackFen} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Black' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Starting position' }))
    expect(screen.getByRole('button', { name: 'White' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'White kingside' })).toHaveAttribute('aria-pressed', 'true')
  })
})
