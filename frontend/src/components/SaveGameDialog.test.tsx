import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SaveGameDialog from './SaveGameDialog'

vi.mock('@/lib/api', () => ({
  api: {
    saveGame: vi.fn(),
    findDuplicateGame: vi.fn(),
    updateGame: vi.fn().mockResolvedValue(undefined),
    moveGameToFolder: vi.fn().mockResolvedValue(undefined),
    addGameToCollection: vi.fn().mockResolvedValue(undefined),
  },
}))

const defaultProps = {
  pgn: '[White "Alice"]\n\n1. e4',
  onSaved: vi.fn(),
  onClose: vi.fn(),
}

describe('SaveGameDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Default: no duplicate found
    const { api } = await import('@/lib/api')
    vi.mocked(api.findDuplicateGame).mockResolvedValue('')
  })

  it('renders with default field values', () => {
    render(<SaveGameDialog {...defaultProps} />)
    expect(screen.getByPlaceholderText('White player')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Black player')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Tournament or event name')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Save Game' })).toBeInTheDocument()
  })

  it('pre-fills provided initial values', () => {
    render(<SaveGameDialog {...defaultProps} initialWhite="Magnus" initialBlack="Hikaru" initialEvent="World Cup" />)
    expect(screen.getByDisplayValue('Magnus')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Hikaru')).toBeInTheDocument()
    expect(screen.getByDisplayValue('World Cup')).toBeInTheDocument()
  })

  it('calls api.saveGame and onSaved on successful save', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.saveGame).mockResolvedValue('game-123')
    render(<SaveGameDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(defaultProps.onSaved).toHaveBeenCalledWith('game-123'))
  })

  it('shows error message when save fails', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.saveGame).mockRejectedValue(new Error('Duplicate game'))
    render(<SaveGameDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('Duplicate game')).toBeInTheDocument())
  })

  it('disables the Save button while saving', async () => {
    const { api } = await import('@/lib/api')
    let resolve!: (id: string) => void
    vi.mocked(api.saveGame).mockReturnValue(new Promise(r => { resolve = r }))
    render(<SaveGameDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    resolve('id')
  })

  it('calls onClose when Cancel is clicked', async () => {
    render(<SaveGameDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalled())
  })


  it('shows conflict prompt when a duplicate is found', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.findDuplicateGame).mockResolvedValue('existing-game-id')
    render(<SaveGameDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByText(/already exists/i)).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeInTheDocument()
    expect(api.saveGame).not.toHaveBeenCalled()
  })

  it('calls updateGame and onSaved when Overwrite is clicked', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.findDuplicateGame).mockResolvedValue('existing-game-id')
    render(<SaveGameDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => screen.getByRole('button', { name: 'Overwrite' }))
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(defaultProps.onSaved).toHaveBeenCalledWith('existing-game-id'))
    expect(api.updateGame).toHaveBeenCalledWith('existing-game-id', defaultProps.pgn)
  })

  it('calls onClose when Cancel is clicked on conflict prompt', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.findDuplicateGame).mockResolvedValue('existing-game-id')
    render(<SaveGameDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => screen.getByRole('button', { name: 'Overwrite' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalled())
  })

  it('shows error and stays on conflict prompt when overwrite fails', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.findDuplicateGame).mockResolvedValue('existing-game-id')
    vi.mocked(api.updateGame).mockRejectedValue(new Error('Update failed'))
    render(<SaveGameDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => screen.getByRole('button', { name: 'Overwrite' }))
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(screen.getByText('Update failed')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeInTheDocument()
  })
})
