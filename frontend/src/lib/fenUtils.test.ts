import { describe, it, expect, vi } from 'vitest'

vi.mock('chessops/chess', () => ({
  Chess: { fromSetup: vi.fn() },
}))
vi.mock('chessops/fen', () => ({
  parseFen: vi.fn(),
}))

import { chessFromFen } from './fenUtils'

function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w'
}
import { Chess } from 'chessops/chess'
import { parseFen } from 'chessops/fen'

function makeOk(val: unknown) {
  return { isErr: false, unwrap: () => val }
}

describe('chessFromFen', () => {
  it('parses a FEN and returns a Chess position', () => {
    const mockPos = { board: {} }
    vi.mocked(parseFen).mockReturnValue(makeOk({}) as ReturnType<typeof parseFen>)
    vi.mocked(Chess.fromSetup).mockReturnValue(makeOk(mockPos) as ReturnType<typeof Chess.fromSetup>)

    const result = chessFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(result).toBe(mockPos)
  })
})

describe('sideToMove', () => {
  it('returns w for white to move', () => {
    expect(sideToMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe('w')
  })

  it('returns b for black to move', () => {
    expect(sideToMove('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe('b')
  })
})
