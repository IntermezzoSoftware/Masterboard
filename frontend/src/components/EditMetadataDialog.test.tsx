import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import EditMetadataDialog from './EditMetadataDialog'

vi.mock('@lichess-org/chessground', () => ({ Chessground: vi.fn() }))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

vi.mock('chessops/chess', () => ({}))
vi.mock('chessops/fen', () => ({}))
vi.mock('chessops/compat', () => ({}))
vi.mock('chessops/san', () => ({}))
vi.mock('chessops/util', () => ({}))

vi.mock('@/context/ChessGameContext', () => ({
  useChessGameContext: () => ({}),
}))
vi.mock('@/context/AnalysisContext', () => ({
  useAnalysisContext: () => ({}),
}))

vi.mock('@/components/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDialogClose: () => vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: { updateGameMetadata: vi.fn() },
}))

const initial = {
  white: 'Kasparov',
  black: 'Karpov',
  whiteElo: 2800,
  blackElo: 2750,
  result: '1-0',
  date: '1990.01.01',
  event: 'World Championship',
  site: 'New York',
  round: '1',
  eco: 'D85',
}

const defaultProps = {
  gameId: 'game-abc',
  initial,
  onSaved: vi.fn(),
  onClose: vi.fn(),
}

describe('EditMetadataDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pre-populates fields from initial prop', () => {
    render(<EditMetadataDialog {...defaultProps} />)
    const whiteInput = screen.getByPlaceholderText('White player') as HTMLInputElement
    expect(whiteInput.value).toBe(initial.white)
  })

  it('calls updateGameMetadata and onSaved on submit', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.updateGameMetadata).mockResolvedValue(undefined)
    render(<EditMetadataDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateGameMetadata).toHaveBeenCalledWith(
      'game-abc',
      expect.objectContaining({ white: 'Kasparov', black: 'Karpov', result: '1-0' }),
    ))
    await waitFor(() => expect(defaultProps.onSaved).toHaveBeenCalled())
  })

  it('shows error message on failure', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.updateGameMetadata).mockRejectedValue(new Error('IPC failed'))
    render(<EditMetadataDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('IPC failed')).toBeInTheDocument())
  })
})
