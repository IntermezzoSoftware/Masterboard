package masterdb

import (
	"cmp"
	"fmt"
	"slices"
	"strings"

	chess "github.com/corentings/chess/v2"
)

// positionRecord describes a single half-move played from a position.
// Returned by EncodeGame and EncodeGame2B for testing and comparison.
// The pipeline uses positionEntry (pre-resolved moveID) instead.
type positionRecord struct {
	// Hash is the FNV-1a 64-bit hash of the position BEFORE the move was played.
	Hash int64
	// MoveSAN is the move played from this position in SAN notation.
	MoveSAN string
}

// positionEntry is the pipeline-internal form of a position record. It stores
// the position hash and the pre-resolved move_id (from the move lookup table)
// instead of the SAN string. This eliminates per-position string allocation
// and the moveLookup.GetOrAdd call in the writer loop.
type positionEntry struct {
	hash   int64
	moveID int16
}

// encodedGame is the output of the encoding pipeline.
type encodedGame struct {
	ParsedGame
	MovesBlob []byte
	Positions []positionEntry
}

// tokenizeMoveText strips PGN annotations and returns bare SAN move tokens.
// Uses hand-written loops instead of regexp for ~7% CPU savings (profiled).
func tokenizeMoveText(moveText string) []string {
	stripped := stripComments(moveText)
	stripped = stripVariations(stripped)
	parts := strings.Fields(stripped)
	tokens := make([]string, 0, len(parts))
	for _, tok := range parts {
		// Result tokens.
		if tok == "1-0" || tok == "0-1" || tok == "1/2-1/2" || tok == "*" {
			continue
		}
		// Move numbers: digits followed by dots, e.g. "1.", "12...", "1..."
		if isMoveNumber(tok) {
			continue
		}
		// NAG annotations: $1, $2, etc.
		if tok[0] == '$' {
			continue
		}
		// Strip trailing annotation glyphs: !, ?, !!, ??, !?, ?!
		tok = trimAnnotationSuffix(tok)
		if tok != "" {
			tokens = append(tokens, tok)
		}
	}
	return tokens
}

// stripComments removes PGN block comments { ... } without regexp.
func stripComments(s string) string {
	if !strings.ContainsRune(s, '{') {
		return s // fast path: no comments
	}
	var b strings.Builder
	b.Grow(len(s))
	depth := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
		case '}':
			if depth > 0 {
				depth--
				b.WriteByte(' ') // replace comment with space separator
			}
		default:
			if depth == 0 {
				b.WriteByte(s[i])
			}
		}
	}
	return b.String()
}

// isMoveNumber returns true if tok matches ^\d+\.+$ (digits followed by dots).
func isMoveNumber(tok string) bool {
	if len(tok) < 2 {
		return false
	}
	// Must end with '.'
	if tok[len(tok)-1] != '.' {
		return false
	}
	// Find transition from digits to dots.
	i := 0
	for i < len(tok) && tok[i] >= '0' && tok[i] <= '9' {
		i++
	}
	if i == 0 {
		return false // no digits
	}
	for i < len(tok) {
		if tok[i] != '.' {
			return false
		}
		i++
	}
	return true
}

// trimAnnotationSuffix removes trailing ! and ? characters from a SAN token.
func trimAnnotationSuffix(tok string) string {
	i := len(tok)
	for i > 0 && (tok[i-1] == '!' || tok[i-1] == '?') {
		i--
	}
	return tok[:i]
}

// stripVariations removes parenthesised PGN variations, handling nesting.
// Uses byte iteration instead of rune iteration since PGN is 7-bit ASCII.
func stripVariations(s string) string {
	if !strings.ContainsRune(s, '(') {
		return s // fast path: no variations
	}
	var b strings.Builder
	b.Grow(len(s))
	depth := 0
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch ch {
		case '(':
			depth++
		case ')':
			if depth > 0 {
				depth--
			}
		default:
			if depth == 0 {
				b.WriteByte(ch)
			}
		}
	}
	return b.String()
}

// moveUCIKey computes a uint32 sort key for a chess.Move that produces
// the same ordering as alphabetical comparison of Move.String() (UCI).
//
// UCI format: fromFile + fromRank + toFile + toRank + [promoChar]
// Alphabetical order: file a–h (0–7), rank 1–8 (0–7), promo b<n<q<r.
// Key layout: fromFile(3) | fromRank(3) | toFile(3) | toRank(3) | promo(3)
func moveUCIKey(m *chess.Move) uint32 {
	return uint32(m.S1().File())<<15 |
		uint32(m.S1().Rank())<<12 |
		uint32(m.S2().File())<<9 |
		uint32(m.S2().Rank())<<6 |
		promoSortKey(m.Promo())
}

// promoSortKey maps a PieceType to a sort value matching UCI promo char order.
// NoPieceType → 0 (sorts before any promo), then b(1) < n(2) < q(3) < r(4).
func promoSortKey(pt chess.PieceType) uint32 {
	switch pt {
	case chess.Bishop:
		return 1
	case chess.Knight:
		return 2
	case chess.Queen:
		return 3
	case chess.Rook:
		return 4
	default:
		return 0
	}
}

// sanComp holds the parsed components of a SAN move token.
// This lets us match legal moves structurally without calling
// AlgebraicNotation.Encode (which internally calls ValidMoves again).
type sanComp struct {
	piece    chess.PieceType
	fromFile byte // 'a'-'h', 0 if unspecified
	fromRank byte // '1'-'8', 0 if unspecified
	toFile   byte // 'a'-'h', always set
	toRank   byte // '1'-'8', always set
	promo    chess.PieceType
	castle   int // 0=none, 1=kingside, 2=queenside
	invalid  bool
}

// parseSAN extracts the structural components of a SAN token without needing
// the current board position. No ValidMoves calls.
func parseSAN(san string) sanComp {
	s := strings.TrimRight(san, "+#") // strip check/mate chars

	// Castling.
	if s == "O-O" || s == "0-0" {
		return sanComp{castle: 1}
	}
	if s == "O-O-O" || s == "0-0-0" {
		return sanComp{castle: 2}
	}

	var c sanComp
	c.piece = chess.Pawn // default: pawn

	// Promotion: "e8=Q" or "exd8=N"
	if idx := strings.IndexByte(s, '='); idx >= 0 {
		if idx+1 < len(s) {
			c.promo = charToPieceType(s[idx+1])
		}
		s = s[:idx]
	}

	// Non-pawn piece: uppercase letter at start.
	if len(s) > 0 && s[0] >= 'A' && s[0] <= 'Z' {
		c.piece = charToPieceType(s[0])
		s = s[1:]
	}

	// Strip 'x' (capture indicator). At most one 'x' per SAN.
	if xi := strings.IndexByte(s, 'x'); xi >= 0 {
		s = s[:xi] + s[xi+1:]
	}

	// s is now: [disambig?][toFile][toRank]
	// Examples: "e4", "f3", "bf3", "1f3", "b1f3"
	if len(s) < 2 {
		c.invalid = true
		return c
	}

	// Last two bytes are always the destination square.
	c.toFile = s[len(s)-2]
	c.toRank = s[len(s)-1]
	rest := s[:len(s)-2]

	switch len(rest) {
	case 1:
		if rest[0] >= 'a' && rest[0] <= 'h' {
			c.fromFile = rest[0]
		} else if rest[0] >= '1' && rest[0] <= '8' {
			c.fromRank = rest[0]
		}
	case 2:
		c.fromFile = rest[0]
		c.fromRank = rest[1]
	}

	// For pawn straight pushes (e.g. "e4"), the source file equals the
	// destination file. Setting this avoids false matches with pawn captures
	// onto the same square from an adjacent file.
	if c.piece == chess.Pawn && c.fromFile == 0 {
		c.fromFile = c.toFile
	}

	return c
}

// charToPieceType maps a PGN piece letter byte to a PieceType.
func charToPieceType(b byte) chess.PieceType {
	switch b {
	case 'K':
		return chess.King
	case 'Q':
		return chess.Queen
	case 'R':
		return chess.Rook
	case 'B':
		return chess.Bishop
	case 'N':
		return chess.Knight
	default:
		return chess.Pawn
	}
}

// matchLegalMove finds the legal move that matches comp, without calling
// AlgebraicNotation.Encode. Returns nil if no match found.
func matchLegalMove(legal []chess.Move, pos *chess.Position, comp sanComp) *chess.Move {
	for i := range legal {
		m := &legal[i]

		if comp.castle != 0 {
			if comp.castle == 1 && m.HasTag(chess.KingSideCastle) {
				return m
			}
			if comp.castle == 2 && m.HasTag(chess.QueenSideCastle) {
				return m
			}
			continue
		}

		// Piece type on the source square.
		if pos.Board().Piece(m.S1()).Type() != comp.piece {
			continue
		}

		// Destination square.
		toFile := chess.File(comp.toFile - 'a')
		toRank := chess.Rank(comp.toRank - '1')
		if m.S2() != chess.NewSquare(toFile, toRank) {
			continue
		}

		// Promotion.
		if comp.promo != chess.NoPieceType {
			if m.Promo() != comp.promo {
				continue
			}
		} else if m.Promo() != chess.NoPieceType {
			// Promotion move when none expected (e.g. only queen auto-promo).
			continue
		}

		// Source file disambiguation.
		if comp.fromFile != 0 && m.S1().File() != chess.File(comp.fromFile-'a') {
			continue
		}

		// Source rank disambiguation.
		if comp.fromRank != 0 && m.S1().Rank() != chess.Rank(comp.fromRank-'1') {
			continue
		}

		return m
	}
	return nil
}

// EncodeGame parses moveText and encodes it as a compact blob.
//
// Encoding: at each position the legal moves are sorted alphabetically by
// UCI string. The played move's index is stored as one byte (max 218 legal
// moves → always fits in uint8).
//
// This implementation calls ValidMoves() exactly once per half-move by
// matching SAN tokens structurally rather than via AlgebraicNotation.Encode
// (which internally calls ValidMoves again for disambiguation).
func EncodeGame(moveText string) (blob []byte, positions []positionRecord, err error) {
	sans := tokenizeMoveText(moveText)
	if len(sans) == 0 {
		return nil, nil, nil
	}

	pos := cachedStartPos
	blob = make([]byte, 0, len(sans))
	positions = make([]positionRecord, 0, len(sans))

	// Preallocate entry buffer — reused across all half-moves (zero allocations per move).
	type entry struct {
		key      uint32
		legalIdx int
	}
	entries := make([]entry, 0, 256) // max legal moves in any position is 218

	// Reusable position hasher — avoids per-position fnv.New128a() and h.Sum(nil) allocs.
	ph := newPositionHasher()

	for _, san := range sans {
		hash := ph.Hash(pos)
		legal := pos.ValidMoves() // called exactly once per position

		comp := parseSAN(san)
		if comp.invalid {
			return nil, nil, fmt.Errorf("unparseable SAN %q", san)
		}

		// Sort legal moves by integer key equivalent to UCI alphabetical order.
		entries = entries[:len(legal)]
		for i := range legal {
			entries[i] = entry{key: moveUCIKey(&legal[i]), legalIdx: i}
		}
		slices.SortFunc(entries, func(a, b entry) int { return cmp.Compare(a.key, b.key) })

		// Find the played move structurally (no Encode calls).
		playedMove := matchLegalMove(legal, pos, comp)
		if playedMove == nil {
			return nil, nil, fmt.Errorf("move %q not found in legal moves at %s", san, pos.String())
		}

		// Find its sorted index via the integer key — no string allocation.
		playedKey := moveUCIKey(playedMove)
		sortedIdx, _ := slices.BinarySearchFunc(entries, playedKey, func(e entry, key uint32) int {
			return cmp.Compare(e.key, key)
		})
		if sortedIdx >= len(entries) || entries[sortedIdx].key != playedKey {
			return nil, nil, fmt.Errorf("move %q (key %d) not in sorted list (bug)", san, playedKey)
		}
		if sortedIdx > 255 {
			return nil, nil, fmt.Errorf("move index %d exceeds uint8 range (position has >255 legal moves)", sortedIdx)
		}

		blob = append(blob, byte(sortedIdx))
		positions = append(positions, positionRecord{Hash: hash, MoveSAN: san})
		pos = pos.Update(playedMove)
	}

	return blob, positions, nil
}

// DecodeGame reconstructs the SAN move list from a moves_blob.
func DecodeGame(blob []byte) ([]string, error) {
	pos := chess.StartingPosition()
	an := chess.AlgebraicNotation{}
	sans := make([]string, 0, len(blob))

	// Preallocate entry buffer — reused across all half-moves.
	type entry struct {
		key      uint32
		legalIdx int
	}
	entries := make([]entry, 0, 256)

	for i, b := range blob {
		legal := pos.ValidMoves()
		if len(legal) == 0 {
			return nil, fmt.Errorf("no legal moves at half-move %d", i)
		}

		entries = entries[:len(legal)]
		for j := range legal {
			entries[j] = entry{key: moveUCIKey(&legal[j]), legalIdx: j}
		}
		slices.SortFunc(entries, func(a, b entry) int { return cmp.Compare(a.key, b.key) })

		idx := int(b)
		if idx >= len(entries) {
			return nil, fmt.Errorf("byte %d at half-move %d out of range (have %d legal moves)", b, i, len(legal))
		}

		played := &legal[entries[idx].legalIdx]
		sans = append(sans, an.Encode(pos, played))
		pos = pos.Update(played)
	}

	return sans, nil
}
