// Chessops stores castling as king-to-rook (e1h1), engines use king-to-destination (e1g1).
// Normalize chessops encoding to engine encoding for comparison.
const CASTLING_NORMALIZE: Record<string, string> = {
  'e1h1': 'e1g1',  // White O-O
  'e1a1': 'e1c1',  // White O-O-O
  'e8h8': 'e8g8',  // Black O-O
  'e8a8': 'e8c8',  // Black O-O-O
}

export function normalizeUci(uci: string): string {
  return CASTLING_NORMALIZE[uci] ?? uci
}
