import { render } from '@testing-library/react'
import { vi, beforeEach } from 'vitest'

const { mockChessground, mockDestroy, mockSet } = vi.hoisted(() => {
  const mockDestroy = vi.fn()
  const mockSet = vi.fn()
  const mockChessground = vi.fn(() => ({ destroy: mockDestroy, set: mockSet }))
  return { mockChessground, mockDestroy, mockSet }
})

vi.mock('@lichess-org/chessground', () => ({ Chessground: mockChessground }))
vi.mock('@lichess-org/chessground/assets/chessground.base.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.brown.css', () => ({}))
vi.mock('@lichess-org/chessground/assets/chessground.cburnett.css', () => ({}))

import Chessboard from './Chessboard'

beforeEach(() => {
  mockChessground.mockClear()
  mockDestroy.mockClear()
  mockSet.mockClear()
})

describe('Chessboard', () => {
  it('renders a container div', () => {
    const { container } = render(<Chessboard />)
    expect(container.querySelector('div')).toBeInTheDocument()
  })

  it('calls Chessground on mount', () => {
    render(<Chessboard />)
    expect(mockChessground).toHaveBeenCalledTimes(1)
  })

  it('passes config to Chessground on mount', () => {
    const config = { viewOnly: true }
    render(<Chessboard config={config} />)
    expect(mockChessground).toHaveBeenCalledWith(expect.any(HTMLElement), config)
  })

  it('calls api.destroy on unmount', () => {
    const { unmount } = render(<Chessboard />)
    unmount()
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })
})
