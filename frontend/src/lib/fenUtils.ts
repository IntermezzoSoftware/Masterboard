import { Chess } from 'chessops/chess'
import { parseFen } from 'chessops/fen'
import { parseSan } from 'chessops/san'
import { makeUci } from 'chessops/util'

/**
 * Returns the position key of a FEN — the first four space-separated fields
 * (piece placement, active color, castling, en passant) — stripping the
 * halfmove clock and fullmove number.  Use this whenever two FENs should be
 * considered equal if they describe the same position, regardless of how many
 * moves have been played (e.g. transposition detection).
 */
export function positionFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

/** Parse a FEN string into a Chess position. Throws if the FEN is invalid. */
export function chessFromFen(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
}

/**
 * Convert a SAN move string to UCI notation given the current board FEN.
 * Returns null if the FEN is invalid or the move is not legal.
 */
export function sanToUci(fen: string, san: string): string | null {
  try {
    const chess = chessFromFen(fen)
    const move = parseSan(chess, san)
    return move != null ? makeUci(move) : null
  } catch {
    return null
  }
}
