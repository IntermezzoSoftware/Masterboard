package repertoire

import "strings"

// PositionFen returns the first four space-delimited FEN fields (piece placement,
// active colour, castling, en passant), stripping the halfmove clock and fullmove
// number.  Mirrors positionFen() in frontend/src/lib/fenUtils.ts — two FENs that
// describe the same board position share the same PositionFen regardless of the
// route by which the position was reached.
func PositionFen(fen string) string {
	fields := strings.Fields(fen)
	if len(fields) >= 5 {
		return strings.Join(fields[:4], " ")
	}
	return fen
}

// Repertoire represents a named opening system for one colour.
type Repertoire struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Colour      string `json:"colour"`      // "white" or "black"
	Description string `json:"description"`
}

// RepertoireMove is one node in a repertoire's move tree.
// parent_id NULL means the move hangs off the starting position of the repertoire.
type RepertoireMove struct {
	ID           string  `json:"id"`
	RepertoireID string  `json:"repertoireId"`
	ParentID     *string `json:"parentId"` // nil for top-level moves
	FromFEN      string  `json:"fromFen"`  // position before the move
	ToFEN        string  `json:"toFen"`    // position after the move
	MoveSAN      string  `json:"moveSan"`
	MoveUCI      string  `json:"moveUci"`  // UCI long-algebraic, e.g. "e2e4"
	MoveOrder    int     `json:"moveOrder"`
	NAG             *int    `json:"nag"`
	Comment         string  `json:"comment"`
	Shapes          string  `json:"shapes"` // JSON-encoded [%cal]/[%csl] data
	IsTransposition bool    `json:"isTransposition"`
}

// RepertoireData is the full payload returned by LoadRepertoire,
// and also the per-repertoire result of GetAllMovesForPosition.
type RepertoireData struct {
	Repertoire Repertoire       `json:"repertoire"`
	Moves      []RepertoireMove `json:"moves"`
}
