package masterdb

import (
	"fmt"
	"hash/fnv"
	"strings"
	"unsafe"

	chess "github.com/corentings/chess/v2"
)

// normEPD returns the 4-field EPD position key used throughout the masterdb
// package. It strips the halfmove clock (field 5) and fullmove number (field 6)
// from a full FEN string, and normalizes the en-passant field (field 4) to "-".
//
// En-passant normalization is required for transposition awareness: some FEN
// generators include the EP target square after any double pawn push regardless
// of whether an enemy pawn can actually capture, while others only include it
// when capture is possible. Normalizing to "-" ensures both reach the same key.
// This matches the normalization used by Lichess.
func normEPD(fen string) string {
	parts := strings.Fields(fen)
	if len(parts) >= 4 {
		parts[3] = "-"
		return strings.Join(parts[:4], " ")
	}
	// Already a 4-field (or shorter) EPD — return as-is.
	return fen
}

// hashEPD returns a 64-bit FNV-1a hash of the normalized EPD derived from fen.
// The hash is used as the primary key for position rows in SQLite, stored as
// INTEGER (8 bytes) instead of the previous BLOB(16). Collision probability
// across 200M unique positions is ~0.1% (birthday paradox: n²/2^64), acceptable
// for a stats overlay where a collision merges two positions' move counts.
func hashEPD(fen string) int64 {
	h := fnv.New64a()
	h.Write([]byte(normEPD(fen)))
	return int64(h.Sum64())
}

// positionHasher hashes chess positions efficiently by reading the board's
// 12 bitboards directly via unsafe pointer access, completely bypassing
// Board.String() and Board.Piece(). This eliminates string allocation and
// the per-square bitboard iteration that dominated the CPU profile (34%).
//
// The hash includes: 12 piece bitboards + turn + castling rights + normalized
// en-passant ("-"). This produces different hashes than the old Board.String()
// approach — a fresh import (--replace) is required after this change.
//
// Board struct layout (corentings/chess/v2@v2.3.8):
//
//	bbWhiteKing   bitboard (uint64)  // offset 0
//	bbWhiteQueen  bitboard           // offset 8
//	bbWhiteRook   bitboard           // offset 16
//	bbWhiteBishop bitboard           // offset 24
//	bbWhiteKnight bitboard           // offset 32
//	bbWhitePawn   bitboard           // offset 40
//	bbBlackKing   bitboard           // offset 48
//	bbBlackQueen  bitboard           // offset 56
//	bbBlackRook   bitboard           // offset 64
//	bbBlackBishop bitboard           // offset 72
//	bbBlackKnight bitboard           // offset 80
//	bbBlackPawn   bitboard           // offset 88
//
// Validated by TestBoardBitboardOffsets.
type positionHasher struct {
	h *fnv64aHasher
}

// newPositionHasher creates a reusable position hasher.
func newPositionHasher() *positionHasher {
	return &positionHasher{h: newFnv64a()}
}

// Hash returns the FNV-1a 64-bit hash for the given chess position.
// Reads 12 piece bitboards directly via unsafe, hashing each as a uint64
// word (XOR + multiply) instead of 96 individual bytes. This reduces
// the hot loop from 96 to 12 iterations. Turn and castling rights are
// hashed byte-wise as before.
//
// NOTE: This produces different hashes than the previous byte-wise approach.
// Existing databases require --replace after this change.
func (ph *positionHasher) Hash(pos *chess.Position) int64 {
	board := pos.Board()
	base := unsafe.Pointer(board)
	// Word-wise FNV-1a of 12 bitboards (12 × uint64 = 96 bytes).
	h := uint64(fnv64aOffset)
	for i := 0; i < 12; i++ {
		v := *(*uint64)(unsafe.Add(base, i*8))
		h ^= v
		h *= fnv64aPrime
	}
	// Turn.
	if pos.Turn() == chess.Black {
		h ^= uint64('b')
	} else {
		h ^= uint64('w')
	}
	h *= fnv64aPrime
	// Castling rights — hash each byte of the string.
	cr := string(pos.CastleRights())
	for i := 0; i < len(cr); i++ {
		h ^= uint64(cr[i])
		h *= fnv64aPrime
	}
	// Normalized en-passant — always "-".
	h ^= uint64('-')
	h *= fnv64aPrime
	return int64(h)
}

// HashFEN returns the bitboard-based position hash for a FEN string.
// This is the query-time equivalent of positionHasher.Hash() — it parses the
// FEN into a chess.Position and hashes the bitboards, turn, and castling rights.
// The EP square is normalized to "-" (ignored) for transposition consistency.
// Returns an error if the FEN is invalid.
func HashFEN(fen string) (int64, error) {
	opt, err := chess.FEN(fen)
	if err != nil {
		return 0, fmt.Errorf("invalid FEN: %w", err)
	}
	g := chess.NewGame(opt)
	pos := g.Position()
	ph := newPositionHasher()
	return ph.Hash(pos), nil
}

// gameFingerprint returns a 64-bit FNV-1a hash that uniquely identifies a game
// by its metadata and move sequence. Used to deduplicate games during append imports.
// Fields are separated by null bytes to prevent ambiguity (e.g. "AB"+"C" vs "A"+"BC").
func gameFingerprint(white, black, date, result string, movesBlob []byte) int64 {
	h := newFnv64a()
	h.Write([]byte(white))
	h.Write([]byte{0})
	h.Write([]byte(black))
	h.Write([]byte{0})
	h.Write([]byte(date))
	h.Write([]byte{0})
	h.Write([]byte(result))
	h.Write([]byte{0})
	h.Write(movesBlob)
	return int64(h.Sum64())
}

// fnv64aHasher is a minimal inline FNV-1a 64-bit hasher that avoids the
// interface overhead and heap allocation of hash/fnv.New64a().
type fnv64aHasher struct {
	val uint64
}

const (
	fnv64aOffset = 14695981039346656037
	fnv64aPrime  = 1099511628211
)

func newFnv64a() *fnv64aHasher {
	return &fnv64aHasher{val: fnv64aOffset}
}

func (h *fnv64aHasher) Write(data []byte) {
	for _, b := range data {
		h.val ^= uint64(b)
		h.val *= fnv64aPrime
	}
}

func (h *fnv64aHasher) Sum64() uint64 {
	return h.val
}

