package polyglot

import (
	"encoding/binary"
	"fmt"
	"io"
	"sort"
	"strings"

	chess "github.com/corentings/chess/v2"
	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)

// WriteBook writes entries to w in Polyglot binary format.
// Entries are sorted ascending by Key before writing.
// Each entry is 16 bytes: Key(8 BE) | Move(2 BE) | Weight(2 BE) | Learn(4 BE).
func WriteBook(w io.Writer, entries []chess.PolyglotEntry) error {
	sorted := make([]chess.PolyglotEntry, len(entries))
	copy(sorted, entries)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Key < sorted[j].Key
	})

	buf := make([]byte, 16)
	for _, e := range sorted {
		binary.BigEndian.PutUint64(buf[0:8], e.Key)
		binary.BigEndian.PutUint16(buf[8:10], e.Move)
		binary.BigEndian.PutUint16(buf[10:12], e.Weight)
		binary.BigEndian.PutUint32(buf[12:16], e.Learn)
		if _, err := w.Write(buf); err != nil {
			return fmt.Errorf("polyglot: write entry: %w", err)
		}
	}
	return nil
}

// zobristHash returns the Polyglot Zobrist hash for the given FEN string.
func zobristHash(fen string) (uint64, error) {
	hasher := chess.NewZobristHasher()
	hex, err := hasher.HashPosition(fen)
	if err != nil {
		return 0, fmt.Errorf("polyglot: zobrist hash %q: %w", fen, err)
	}
	return chess.ZobristHashToUint64(hex), nil
}

// encodeMoveForPolyglot encodes a chess.Move into the Polyglot uint16 format,
// applying the castling fix: kingside castle uses toFile=7 (h), queenside uses toFile=0 (a).
func encodeMoveForPolyglot(m chess.Move) uint16 {
	fromFile := int(m.S1().File())
	fromRank := int(m.S1().Rank())
	toFile := int(m.S2().File())
	toRank := int(m.S2().Rank())
	promo := m.Promo().ToPolyglotPromotionValue()

	if m.HasTag(chess.KingSideCastle) {
		toFile = 7
	} else if m.HasTag(chess.QueenSideCastle) {
		toFile = 0
	}

	encoded := uint16(toFile&0x7) |
		uint16((toRank&0x7)<<3) |
		uint16((fromFile&0x7)<<6) |
		uint16((fromRank&0x7)<<9) |
		uint16((promo&0x7)<<12)
	return encoded
}

// WeightOverride allows callers to override the default weight for a specific move.
type WeightOverride struct {
	FromFEN string `json:"fromFen"`
	MoveUCI string `json:"moveUci"`
	Weight  uint16 `json:"weight"`
}

// CompileRepertoire converts a flat list of RepertoireMoves into Polyglot entries.
// Moves are grouped by FromFEN. Within each group they are ordered by MoveOrder ascending,
// and weights are assigned so earlier moves (lower index) get higher weights:
//
//	weight[i] = uint16(((n-i) * 65535) / n)
//
// Weights may be overridden per-move via the overrides slice (keyed by "fromFEN|moveUCI").
func CompileRepertoire(moves []repertoire.RepertoireMove, overrides []WeightOverride) ([]chess.PolyglotEntry, error) {
	// Build override map.
	overrideMap := make(map[string]uint16, len(overrides))
	for _, ov := range overrides {
		overrideMap[ov.FromFEN+"|"+ov.MoveUCI] = ov.Weight
	}

	// Group moves by FromFEN, preserving insertion order for stable output.
	type group struct {
		fen   string
		moves []repertoire.RepertoireMove
	}
	groupMap := make(map[string]*group)
	var order []string
	for _, m := range moves {
		if _, ok := groupMap[m.FromFEN]; !ok {
			groupMap[m.FromFEN] = &group{fen: m.FromFEN}
			order = append(order, m.FromFEN)
		}
		groupMap[m.FromFEN].moves = append(groupMap[m.FromFEN].moves, m)
	}

	// Sort each group by MoveOrder ascending.
	for _, g := range groupMap {
		sort.Slice(g.moves, func(i, j int) bool {
			return g.moves[i].MoveOrder < g.moves[j].MoveOrder
		})
	}

	var entries []chess.PolyglotEntry

	for _, fen := range order {
		g := groupMap[fen]
		n := len(g.moves)

		key, err := zobristHash(fen)
		if err != nil {
			return nil, err
		}

		pos := new(chess.Position)
		if err := pos.UnmarshalText([]byte(fen)); err != nil {
			return nil, fmt.Errorf("polyglot: parse FEN %q: %w", fen, err)
		}

		for i, sib := range g.moves {
			mv, err := chess.UCINotation{}.Decode(pos, sib.MoveUCI)
			if err != nil {
				return nil, fmt.Errorf("polyglot: decode UCI %q at %q: %w", sib.MoveUCI, fen, err)
			}

			encoded := encodeMoveForPolyglot(*mv)

			weight := uint16(((n - i) * 65535) / n)
			if ov, ok := overrideMap[fen+"|"+sib.MoveUCI]; ok {
				weight = ov
			}

			entries = append(entries, chess.PolyglotEntry{
				Key:    key,
				Move:   encoded,
				Weight: weight,
				Learn:  0,
			})
		}
	}

	return entries, nil
}

// ExtractedMove is a move recovered from a Polyglot book during traversal.
type ExtractedMove struct {
	FromFEN string
	ToFEN   string
	MoveSAN string
	MoveUCI string
}

// bfsItem is an internal queue item for TraverseBook.
type bfsItem struct {
	pos   *chess.Position
	depth int
}

// TraverseBook performs a BFS traversal of book, starting from the initial position.
// All book moves are followed for both sides — this is a repertoire import, not game-playing.
// maxDepth limits how deep (in half-moves) the traversal goes.
func TraverseBook(book *chess.PolyglotBook, colour string, maxDepth int) ([]ExtractedMove, error) {
	visited := make(map[string]bool)
	var result []ExtractedMove

	queue := []bfsItem{{pos: chess.StartingPosition(), depth: 0}}

	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]

		if item.depth >= maxDepth {
			continue
		}

		// EPD key: first 4 space-separated tokens of FEN (position + side + castling + ep).
		posStr := item.pos.String()
		epd := epd4(posStr)
		if visited[epd] {
			continue
		}
		visited[epd] = true

		hash, err := zobristHash(posStr)
		if err != nil {
			return nil, err
		}

		bookEntries := book.FindMoves(hash)
		if len(bookEntries) == 0 {
			continue
		}

		for _, be := range bookEntries {
			pm := chess.DecodeMove(be.Move)
			mv := pm.ToMove()

			san := chess.AlgebraicNotation{}.Encode(item.pos, &mv)
			uci := chess.UCINotation{}.Encode(item.pos, &mv)
			nextPos := item.pos.Update(&mv)
			toFEN := nextPos.String()

			result = append(result, ExtractedMove{
				FromFEN: posStr,
				ToFEN:   toFEN,
				MoveSAN: san,
				MoveUCI: uci,
			})

			nextEPD := epd4(toFEN)
			if !visited[nextEPD] {
				queue = append(queue, bfsItem{pos: nextPos, depth: item.depth + 1})
			}
		}
	}

	return result, nil
}

// epd4 returns the first 4 space-separated fields of a FEN string,
// forming a position key that ignores move clocks.
func epd4(fen string) string {
	fields := strings.SplitN(fen, " ", 6)
	if len(fields) >= 4 {
		return strings.Join(fields[:4], " ")
	}
	return fen
}
