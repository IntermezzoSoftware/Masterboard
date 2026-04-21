package masterdb

import (
	"encoding/binary"
	"fmt"

	chess "github.com/corentings/chess/v2"
)

// 2-byte move encoding format:
//   uint16 = from_square(6 bits) << 10 | to_square(6 bits) << 4 | promo(4 bits)
//
// promo values: 0=none, 1=knight, 2=bishop, 3=rook, 4=queen

// cachedStartPos holds a pre-computed starting position to avoid calling
// chess.StartingPosition() → decodeFEN() per game (42s CPU at 1.94M games).
// Safe to share: Position.Update() returns a new *Position without mutating.
var cachedStartPos = chess.StartingPosition()

func encodeMove2B(from, to chess.Square, promo chess.PieceType) uint16 {
	return uint16(from)<<10 | uint16(to)<<4 | promoTo4Bit(promo)
}

func decodeMove2B(v uint16) (from, to chess.Square, promo chess.PieceType) {
	from = chess.Square((v >> 10) & 0x3F)
	to = chess.Square((v >> 4) & 0x3F)
	promo = promoFrom4Bit(v & 0x0F)
	return
}

func promoTo4Bit(pt chess.PieceType) uint16 {
	switch pt {
	case chess.Knight:
		return 1
	case chess.Bishop:
		return 2
	case chess.Rook:
		return 3
	case chess.Queen:
		return 4
	default:
		return 0
	}
}

func promoFrom4Bit(v uint16) chess.PieceType {
	switch v {
	case 1:
		return chess.Knight
	case 2:
		return chess.Bishop
	case 3:
		return chess.Rook
	case 4:
		return chess.Queen
	default:
		return chess.NoPieceType
	}
}

// EncodeGame2BWithLookup encodes a game and resolves each SAN to a moveID via
// ml, producing []positionEntry (hash + moveID) instead of []positionRecord.
// This is the pipeline path: it eliminates the MoveSAN string allocation per
// position and moves the moveLookup.GetOrAdd call into the encoder goroutine
// (where it runs concurrently) rather than the single-threaded writer loop.
func EncodeGame2BWithLookup(moveText string, ml *moveLookup) (blob []byte, positions []positionEntry, err error) {
	sans := tokenizeMoveText(moveText)
	if len(sans) == 0 {
		return nil, nil, nil
	}

	pos := cachedStartPos
	blob = make([]byte, 0, len(sans)*2)
	positions = make([]positionEntry, 0, len(sans))

	ph := newPositionHasher()

	for _, san := range sans {
		hash := ph.Hash(pos)

		comp := parseSAN(san)
		if comp.invalid {
			return nil, nil, fmt.Errorf("unparseable SAN %q", san)
		}

		from, to, tags, err := resolveMove(pos, comp)
		if err != nil {
			return blob, positions, fmt.Errorf("resolve %q at ply %d (fen=%s): %w", san, len(positions), pos, err)
		}

		var buf [2]byte
		binary.BigEndian.PutUint16(buf[:], encodeMove2B(from, to, comp.promo))
		blob = append(blob, buf[:]...)
		positions = append(positions, positionEntry{hash: hash, moveID: ml.getOrAdd(san)})

		move := &chess.Move{}
		setMoveFieldsUnsafe(move, from, to, comp.promo, tags)
		pos = pos.Update(move)
	}

	return blob, positions, nil
}

// EncodeGame2B encodes a game's move text using 2-byte-per-move encoding.
// This eliminates the need for ValidMoves() during encoding by resolving
// source squares directly from the board state and SAN structure.
// Returns []positionRecord (hash + SAN string) — used in tests and benchmarks.
// The pipeline uses EncodeGame2BWithLookup instead.
func EncodeGame2B(moveText string) (blob []byte, positions []positionRecord, err error) {
	sans := tokenizeMoveText(moveText)
	if len(sans) == 0 {
		return nil, nil, nil
	}

	pos := cachedStartPos
	blob = make([]byte, 0, len(sans)*2)
	positions = make([]positionRecord, 0, len(sans))

	ph := newPositionHasher()

	for _, san := range sans {
		hash := ph.Hash(pos)

		comp := parseSAN(san)
		if comp.invalid {
			return nil, nil, fmt.Errorf("unparseable SAN %q", san)
		}

		from, to, tags, err := resolveMove(pos, comp)
		if err != nil {
			return blob, positions, fmt.Errorf("resolve %q at ply %d (fen=%s): %w", san, len(positions), pos, err)
		}

		var buf [2]byte
		binary.BigEndian.PutUint16(buf[:], encodeMove2B(from, to, comp.promo))
		blob = append(blob, buf[:]...)
		positions = append(positions, positionRecord{Hash: hash, MoveSAN: san})

		move := &chess.Move{}
		setMoveFieldsUnsafe(move, from, to, comp.promo, tags)
		pos = pos.Update(move)
	}

	return blob, positions, nil
}

// DecodeGame2B reconstructs the SAN move list from a 2-byte-per-move blob.
// This still requires ValidMoves for SAN disambiguation (read path only).
func DecodeGame2B(blob []byte) ([]string, error) {
	if len(blob)%2 != 0 {
		return nil, fmt.Errorf("blob length %d is not even", len(blob))
	}

	pos := cachedStartPos
	an := chess.AlgebraicNotation{}
	sans := make([]string, 0, len(blob)/2)

	for i := 0; i < len(blob); i += 2 {
		v := binary.BigEndian.Uint16(blob[i : i+2])
		from, to, promo := decodeMove2B(v)

		// Find the matching legal move to get proper SAN notation.
		legal := pos.ValidMoves()
		var played *chess.Move
		for j := range legal {
			m := &legal[j]
			if m.S1() == from && m.S2() == to && m.Promo() == promo {
				played = m
				break
			}
		}
		if played == nil {
			return nil, fmt.Errorf("no legal move %s%s at half-move %d", from, to, i/2)
		}

		sans = append(sans, an.Encode(pos, played))
		pos = pos.Update(played)
	}

	return sans, nil
}

// resolveMove determines the from-square, to-square, and tags for a SAN move
// without calling ValidMoves. It scans the board directly.
//
// When multiple candidate source squares are found (ambiguous position where
// SAN omits disambiguation because one candidate is illegal, e.g. pinned),
// it falls back to ValidMoves to pick the legal one.
func resolveMove(pos *chess.Position, comp sanComp) (from, to chess.Square, tags chess.MoveTag, err error) {
	board := pos.Board()
	color := pos.Turn()

	// Castling.
	if comp.castle != 0 {
		if color == chess.White {
			from = chess.E1
			if comp.castle == 1 {
				to = chess.G1
				tags = chess.KingSideCastle
			} else {
				to = chess.C1
				tags = chess.QueenSideCastle
			}
		} else {
			from = chess.E8
			if comp.castle == 1 {
				to = chess.G8
				tags = chess.KingSideCastle
			} else {
				to = chess.C8
				tags = chess.QueenSideCastle
			}
		}
		return from, to, tags, nil
	}

	// Destination square.
	toFile := chess.File(comp.toFile - 'a')
	toRank := chess.Rank(comp.toRank - '1')
	to = chess.NewSquare(toFile, toRank)

	// Check if destination is occupied (capture).
	if board.Piece(to) != chess.NoPiece {
		tags |= chess.Capture
	}

	// Find source square(s) by scanning the board.
	piece := chess.NewPiece(comp.piece, color)
	var candidates []chess.Square

	switch comp.piece {
	case chess.Pawn:
		candidates = findPawnCandidates(board, pos, color, to, comp)
		// En passant detection.
		if pos.EnPassantSquare() == to {
			tags |= chess.EnPassant | chess.Capture
		}
	case chess.Knight:
		candidates = findKnightCandidates(board, piece, to, comp)
	case chess.Bishop:
		candidates = findSlidingCandidates(board, piece, to, comp, bishopDirs)
	case chess.Rook:
		candidates = findSlidingCandidates(board, piece, to, comp, rookDirs)
	case chess.Queen:
		candidates = findSlidingCandidates(board, piece, to, comp, queenDirs)
	case chess.King:
		from = findKingFrom(board, piece, to)
		if from == chess.NoSquare {
			return 0, 0, 0, fmt.Errorf("cannot find %s on %s for target %s", comp.piece, piece, to)
		}
		return from, to, tags, nil
	}

	switch len(candidates) {
	case 0:
		return 0, 0, 0, fmt.Errorf("cannot find %s on %s for target %s", comp.piece, piece, to)
	case 1:
		from = candidates[0]
	default:
		// Multiple candidates: SAN is ambiguous because one or more candidates
		// are illegal (e.g. pinned). Fall back to ValidMoves to disambiguate.
		from, err = disambiguateWithValidMoves(pos, comp, to, candidates)
		if err != nil {
			return 0, 0, 0, err
		}
	}

	return from, to, tags, nil
}

// disambiguateWithValidMoves uses the full legal move list to pick the correct
// source square from multiple geometric candidates. This is rare — it only
// triggers when SAN omits disambiguation because one candidate is illegal.
func disambiguateWithValidMoves(pos *chess.Position, comp sanComp, to chess.Square, candidates []chess.Square) (chess.Square, error) {
	legal := pos.ValidMoves()
	candidateSet := make(map[chess.Square]bool, len(candidates))
	for _, sq := range candidates {
		candidateSet[sq] = true
	}
	for i := range legal {
		m := &legal[i]
		if m.S2() != to {
			continue
		}
		if pos.Board().Piece(m.S1()).Type() != comp.piece {
			continue
		}
		if comp.promo != chess.NoPieceType && m.Promo() != comp.promo {
			continue
		}
		if candidateSet[m.S1()] {
			return m.S1(), nil
		}
	}
	return chess.NoSquare, fmt.Errorf("no legal move among %d candidates for %s to %s", len(candidates), comp.piece, to)
}

// Direction vectors for sliding pieces.
type direction struct{ df, dr int8 }

var (
	bishopDirs = []direction{{1, 1}, {1, -1}, {-1, 1}, {-1, -1}}
	rookDirs   = []direction{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	queenDirs  = []direction{{1, 1}, {1, -1}, {-1, 1}, {-1, -1}, {1, 0}, {-1, 0}, {0, 1}, {0, -1}}
)

// Knight jump offsets (file, rank).
var knightJumps = [8][2]int8{
	{-2, -1}, {-2, 1}, {-1, -2}, {-1, 2},
	{1, -2}, {1, 2}, {2, -1}, {2, 1},
}

func findPawnCandidates(board *chess.Board, pos *chess.Position, color chess.Color, to chess.Square, comp sanComp) []chess.Square {
	toF := to.File()
	toR := to.Rank()
	dir := int8(1) // White pawns move up
	if color == chess.Black {
		dir = -1
	}

	piece := chess.NewPiece(chess.Pawn, color)
	var candidates []chess.Square

	// Capture (file changes).
	if comp.fromFile != 0 && chess.File(comp.fromFile-'a') != toF {
		fromF := chess.File(comp.fromFile - 'a')
		fromR := chess.Rank(int8(toR) - dir)
		sq := chess.NewSquare(fromF, fromR)
		if board.Piece(sq) == piece {
			candidates = append(candidates, sq)
		}
		return candidates
	}

	// Single push.
	fromR := chess.Rank(int8(toR) - dir)
	if fromR >= 0 && fromR <= 7 {
		sq := chess.NewSquare(toF, fromR)
		if board.Piece(sq) == piece {
			candidates = append(candidates, sq)
		}
	}

	// Double push (only if single push square is empty).
	if len(candidates) == 0 {
		startRank := chess.Rank(1) // White starts on rank 2 (index 1)
		if color == chess.Black {
			startRank = chess.Rank(6)
		}
		fromR = chess.Rank(int8(toR) - 2*dir)
		if fromR == startRank {
			sq := chess.NewSquare(toF, fromR)
			midR := chess.Rank(int8(toR) - dir)
			mid := chess.NewSquare(toF, midR)
			if board.Piece(sq) == piece && board.Piece(mid) == chess.NoPiece {
				candidates = append(candidates, sq)
			}
		}
	}

	return candidates
}

func findKnightCandidates(board *chess.Board, piece chess.Piece, to chess.Square, comp sanComp) []chess.Square {
	toF := int8(to.File())
	toR := int8(to.Rank())
	var candidates []chess.Square

	for _, j := range knightJumps {
		f := toF + j[0]
		r := toR + j[1]
		if f < 0 || f > 7 || r < 0 || r > 7 {
			continue
		}
		sq := chess.NewSquare(chess.File(f), chess.Rank(r))
		if board.Piece(sq) != piece {
			continue
		}
		if comp.fromFile != 0 && chess.File(comp.fromFile-'a') != chess.File(f) {
			continue
		}
		if comp.fromRank != 0 && chess.Rank(comp.fromRank-'1') != chess.Rank(r) {
			continue
		}
		candidates = append(candidates, sq)
	}
	return candidates
}

func findSlidingCandidates(board *chess.Board, piece chess.Piece, to chess.Square, comp sanComp, dirs []direction) []chess.Square {
	toF := int8(to.File())
	toR := int8(to.Rank())
	var candidates []chess.Square

	for _, d := range dirs {
		for dist := int8(1); dist <= 7; dist++ {
			f := toF + d.df*dist
			r := toR + d.dr*dist
			if f < 0 || f > 7 || r < 0 || r > 7 {
				break
			}
			sq := chess.NewSquare(chess.File(f), chess.Rank(r))
			p := board.Piece(sq)
			if p == chess.NoPiece {
				continue // empty square, keep scanning
			}
			if p == piece {
				// Check disambiguation.
				if comp.fromFile != 0 && chess.File(comp.fromFile-'a') != chess.File(f) {
					break // wrong file, skip this ray
				}
				if comp.fromRank != 0 && chess.Rank(comp.fromRank-'1') != chess.Rank(r) {
					break // wrong rank, skip this ray
				}
				candidates = append(candidates, sq)
			}
			break // blocked by another piece
		}
	}
	return candidates
}

func findKingFrom(board *chess.Board, piece chess.Piece, to chess.Square) chess.Square {
	toF := int8(to.File())
	toR := int8(to.Rank())

	for df := int8(-1); df <= 1; df++ {
		for dr := int8(-1); dr <= 1; dr++ {
			if df == 0 && dr == 0 {
				continue
			}
			f := toF + df
			r := toR + dr
			if f < 0 || f > 7 || r < 0 || r > 7 {
				continue
			}
			sq := chess.NewSquare(chess.File(f), chess.Rank(r))
			if board.Piece(sq) == piece {
				return sq
			}
		}
	}
	return chess.NoSquare
}
