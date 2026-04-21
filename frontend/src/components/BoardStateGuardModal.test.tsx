import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'


const mockConfirm = vi.fn()
const mockCancel = vi.fn()
const mockMarkSaved = vi.fn()
const mockToPGN = vi.fn(() => '')
const mockContextValue = {
  pendingDestructiveAction: null as (() => void) | null,
  confirmPendingDestructiveAction: mockConfirm,
  cancelPendingDestructiveAction: mockCancel,
  markSaved: mockMarkSaved,
  toPGN: mockToPGN,
  gameMetadata: null,
}

vi.mock('@/context/ChessGameContext', () => ({
  useChessGameContext: () => mockContextValue,
}))

const mockNavigate = vi.fn()
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal() as object
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/lib/api', () => ({
  api: {
    listFolders: vi.fn().mockResolvedValue([]),
    listCollections: vi.fn().mockResolvedValue([]),
    saveGame: vi.fn(),
    findDuplicateGame: vi.fn().mockResolvedValue(null),
  },
}))

import BoardStateGuardModal from './BoardStateGuardModal'


function renderModal(path = '/board') {
  const router = createMemoryRouter(
    [{ path: '/:page?', element: <BoardStateGuardModal /> }],
    { initialEntries: [path] }
  )
  return render(<RouterProvider router={router} />)
}


beforeEach(() => {
  vi.clearAllMocks()
  mockContextValue.pendingDestructiveAction = null
  mockContextValue.gameMetadata = null
})

describe('BoardStateGuardModal', () => {
  it('renders nothing when pendingDestructiveAction is null', () => {
    const { container } = renderModal()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the dialog when pendingDestructiveAction is set', () => {
    mockContextValue.pendingDestructiveAction = vi.fn()
    renderModal()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByText('Your current game will be lost.')).toBeInTheDocument()
  })

  it('Cancel calls cancelPendingDestructiveAction', async () => {
    mockContextValue.pendingDestructiveAction = vi.fn()
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(mockCancel).toHaveBeenCalledOnce())
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('Discard calls confirmPendingDestructiveAction', async () => {
    mockContextValue.pendingDestructiveAction = vi.fn()
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledOnce())
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it('Save shows SaveGameDialog without navigating when already on /board', async () => {
    mockContextValue.pendingDestructiveAction = vi.fn()
    renderModal('/board')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Save Game' })).toBeInTheDocument())
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('Save navigates to /board when on a different page', async () => {
    mockContextValue.pendingDestructiveAction = vi.fn()
    renderModal('/games')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/board'))
  })

  it('Save → cancel calls cancelPendingDestructiveAction', async () => {
    mockContextValue.pendingDestructiveAction = vi.fn()
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => screen.getByRole('heading', { name: 'Save Game' }))
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)
    await waitFor(() => expect(mockCancel).toHaveBeenCalledOnce())
    expect(mockConfirm).not.toHaveBeenCalled()
  })
})
