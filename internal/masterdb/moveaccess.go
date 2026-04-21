package masterdb

import (
	"unsafe"

	chess "github.com/corentings/chess/v2"
)

// setMoveFieldsUnsafe sets the unexported s1, s2, promo, and tags fields of
// a chess.Move using unsafe pointer arithmetic.
//
// This depends on the exact struct layout of chess.Move in corentings/chess/v2.
// The offset is validated by TestMoveFieldOffsets.
//
// chess.Move layout (v2.3.8):
//
//	parent   *Move               // 0
//	position *Position            // 8
//	nag      string               // 16 (16 bytes)
//	comments string               // 32 (16 bytes)
//	command  map[string]string    // 48 (8 bytes)
//	children []*Move              // 56 (24 bytes: ptr+len+cap)
//	number   uint                 // 80 (8 bytes)
//	tags     MoveTag (uint16)     // 88
//	s1       Square (int8)        // 90
//	s2       Square (int8)        // 91
//	promo    PieceType (int8)     // 92
func setMoveFieldsUnsafe(m *chess.Move, from, to chess.Square, promo chess.PieceType, tags chess.MoveTag) {
	base := unsafe.Pointer(m)
	*(*chess.MoveTag)(unsafe.Add(base, 88)) = tags
	*(*chess.Square)(unsafe.Add(base, 90)) = from
	*(*chess.Square)(unsafe.Add(base, 91)) = to
	*(*chess.PieceType)(unsafe.Add(base, 92)) = promo
}
