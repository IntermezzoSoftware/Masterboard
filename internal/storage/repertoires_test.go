package storage

import (
	"errors"
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)


func TestCreateAndListRepertoires(t *testing.T) {
	db := openTestDB(t)

	id1, err := db.CreateRepertoire("Ruy Lopez", "white")
	if err != nil {
		t.Fatalf("CreateRepertoire white: %v", err)
	}
	id2, err := db.CreateRepertoire("Sicilian Defence", "black")
	if err != nil {
		t.Fatalf("CreateRepertoire black: %v", err)
	}

	list, err := db.ListRepertoires()
	if err != nil {
		t.Fatalf("ListRepertoires: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 repertoires, got %d", len(list))
	}
	// Ordered by colour then name: "black" < "white"
	if list[0].ID != id2 || list[1].ID != id1 {
		t.Errorf("unexpected order: %v", list)
	}
	if list[0].Colour != "black" || list[1].Colour != "white" {
		t.Errorf("unexpected colours: %v", list)
	}
}

func TestGetRepertoire(t *testing.T) {
	db := openTestDB(t)
	id, _ := db.CreateRepertoire("King's Indian", "black")

	r, err := db.GetRepertoire(id)
	if err != nil {
		t.Fatalf("GetRepertoire: %v", err)
	}
	if r.Name != "King's Indian" || r.Colour != "black" {
		t.Errorf("unexpected repertoire: %+v", r)
	}

	_, err = db.GetRepertoire("nonexistent")
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound for missing id, got %v", err)
	}
}

func TestRenameRepertoire(t *testing.T) {
	db := openTestDB(t)
	id, _ := db.CreateRepertoire("Old Name", "white")

	if err := db.RenameRepertoire(id, "New Name"); err != nil {
		t.Fatalf("RenameRepertoire: %v", err)
	}
	r, _ := db.GetRepertoire(id)
	if r.Name != "New Name" {
		t.Errorf("expected renamed repertoire, got %q", r.Name)
	}

	if err := db.RenameRepertoire("nonexistent", "x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound for missing id, got %v", err)
	}
}

func TestDeleteRepertoire(t *testing.T) {
	db := openTestDB(t)
	id, _ := db.CreateRepertoire("To Delete", "white")

	if err := db.DeleteRepertoire(id); err != nil {
		t.Fatalf("DeleteRepertoire: %v", err)
	}
	list, _ := db.ListRepertoires()
	if len(list) != 0 {
		t.Errorf("expected empty list after delete, got %d", len(list))
	}

	if err := db.DeleteRepertoire("nonexistent"); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}


func sampleMove(repertoireID string) repertoire.RepertoireMove {
	return repertoire.RepertoireMove{
		RepertoireID: repertoireID,
		ParentID:     nil,
		FromFEN:      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
		ToFEN:        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
		MoveSAN:      "e4",
		MoveUCI:      "e2e4",
		MoveOrder:    0,
	}
}

func TestSaveRepertoireMoveAndLoad(t *testing.T) {
	db := openTestDB(t)
	rid, _ := db.CreateRepertoire("1.e4 Systems", "white")

	m := sampleMove(rid)
	id1, err := db.SaveRepertoireMove(m)
	if err != nil {
		t.Fatalf("SaveRepertoireMove: %v", err)
	}

	// Add a child move
	child := repertoire.RepertoireMove{
		RepertoireID: rid,
		ParentID:     &id1,
		FromFEN:      m.ToFEN,
		ToFEN:        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
		MoveSAN:      "e5",
		MoveUCI:      "e7e5",
		MoveOrder:    0,
	}
	id2, err := db.SaveRepertoireMove(child)
	if err != nil {
		t.Fatalf("SaveRepertoireMove child: %v", err)
	}

	moves, err := db.LoadRepertoireMoves(rid)
	if err != nil {
		t.Fatalf("LoadRepertoireMoves: %v", err)
	}
	if len(moves) != 2 {
		t.Fatalf("expected 2 moves, got %d", len(moves))
	}

	// Verify IDs assigned
	ids := map[string]bool{id1: true, id2: true}
	for _, mv := range moves {
		if !ids[mv.ID] {
			t.Errorf("unexpected move ID %q", mv.ID)
		}
	}
}

func TestGetMovesForPosition(t *testing.T) {
	db := openTestDB(t)
	rid, _ := db.CreateRepertoire("Sicilian", "black")

	initialFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	afterE4FEN := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"

	// e4 from initial
	m1 := repertoire.RepertoireMove{
		RepertoireID: rid, FromFEN: initialFEN, ToFEN: afterE4FEN,
		MoveSAN: "e4", MoveUCI: "e2e4",
	}
	db.SaveRepertoireMove(m1)

	// d4 from initial (different move, same position)
	afterD4FEN := "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"
	m2 := repertoire.RepertoireMove{
		RepertoireID: rid, FromFEN: initialFEN, ToFEN: afterD4FEN,
		MoveSAN: "d4", MoveUCI: "d2d4", MoveOrder: 1,
	}
	db.SaveRepertoireMove(m2)

	// c5 from after-e4 position
	m3 := repertoire.RepertoireMove{
		RepertoireID: rid, FromFEN: afterE4FEN, ToFEN: "...",
		MoveSAN: "c5", MoveUCI: "c7c5",
	}
	db.SaveRepertoireMove(m3)

	// Lookup from initial position should return e4 and d4 only
	moves, err := db.GetMovesForPosition(rid, initialFEN)
	if err != nil {
		t.Fatalf("GetMovesForPosition: %v", err)
	}
	if len(moves) != 2 {
		t.Errorf("expected 2 moves from initial FEN, got %d", len(moves))
	}
	for _, mv := range moves {
		if mv.FromFEN != initialFEN {
			t.Errorf("unexpected from_fen %q", mv.FromFEN)
		}
	}

	// Lookup from after-e4 position should return c5 only
	moves2, _ := db.GetMovesForPosition(rid, afterE4FEN)
	if len(moves2) != 1 || moves2[0].MoveSAN != "c5" {
		t.Errorf("expected c5 from after-e4 FEN, got %v", moves2)
	}
}

func TestDeleteRepertoireBranch(t *testing.T) {
	db := openTestDB(t)
	rid, _ := db.CreateRepertoire("Branch Test", "white")

	parentID, _ := db.SaveRepertoireMove(sampleMove(rid))

	// Child of parent
	child := repertoire.RepertoireMove{
		RepertoireID: rid, ParentID: &parentID,
		FromFEN: "...", ToFEN: "...", MoveSAN: "e5", MoveUCI: "e7e5",
	}
	childID, _ := db.SaveRepertoireMove(child)

	// Grandchild of parent (child of child)
	grandchild := repertoire.RepertoireMove{
		RepertoireID: rid, ParentID: &childID,
		FromFEN: "...", ToFEN: "...", MoveSAN: "Nf3", MoveUCI: "g1f3",
	}
	db.SaveRepertoireMove(grandchild)

	// Delete the parent — child and grandchild should cascade
	if err := db.DeleteRepertoireBranch(parentID); err != nil {
		t.Fatalf("DeleteRepertoireBranch: %v", err)
	}

	moves, _ := db.LoadRepertoireMoves(rid)
	if len(moves) != 0 {
		t.Errorf("expected 0 moves after branch delete, got %d", len(moves))
	}

	// Delete non-existent
	if err := db.DeleteRepertoireBranch("nonexistent"); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestDeleteRepertoireCascadesToMoves(t *testing.T) {
	db := openTestDB(t)
	rid, _ := db.CreateRepertoire("Cascade Test", "white")
	db.SaveRepertoireMove(sampleMove(rid))
	db.SaveRepertoireMove(sampleMove(rid))

	db.DeleteRepertoire(rid)

	// LoadRepertoireMoves should return empty, not error
	moves, err := db.LoadRepertoireMoves(rid)
	if err != nil {
		t.Fatalf("LoadRepertoireMoves after delete: %v", err)
	}
	if len(moves) != 0 {
		t.Errorf("expected 0 moves after repertoire delete, got %d", len(moves))
	}
}


func TestSaveRepertoireMoveTranspositionDetection(t *testing.T) {
	db := openTestDB(t)
	rid, _ := db.CreateRepertoire("Transposition Test", "white")

	initialFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	fenP := "rnbqkbnr/pp1ppppp/8/2p5/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 2" // shared position

	// Path A: 1.d4 c5 2.c4 — saves a move FROM fenP (canonical branch)
	idA1, _ := db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: rid, FromFEN: initialFEN, ToFEN: "fen-after-d4",
		MoveSAN: "d4", MoveUCI: "d2d4",
	})
	idA2, _ := db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: rid, ParentID: &idA1, FromFEN: "fen-after-d4", ToFEN: "fen-after-d4-c5",
		MoveSAN: "c5", MoveUCI: "c7c5",
	})
	idA3, _ := db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: rid, ParentID: &idA2, FromFEN: "fen-after-d4-c5", ToFEN: fenP,
		MoveSAN: "c4", MoveUCI: "c2c4",
	})
	// Move from fenP (canonical child — establishes that fenP has successors)
	_, _ = db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: rid, ParentID: &idA3, FromFEN: fenP, ToFEN: "fen-after-fenP-Nf6",
		MoveSAN: "Nf6", MoveUCI: "g8f6",
	})

	// Path B: 1.c4 c5 2.d4 — reaches fenP via different move order
	idB1, _ := db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: rid, FromFEN: initialFEN, ToFEN: "fen-after-c4",
		MoveSAN: "c4", MoveUCI: "c2c4",
	})
	idB2, _ := db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: rid, ParentID: &idB1, FromFEN: "fen-after-c4", ToFEN: "fen-after-c4-c5",
		MoveSAN: "c5", MoveUCI: "c7c5",
	})
	idB3, err := db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: rid, ParentID: &idB2, FromFEN: "fen-after-c4-c5", ToFEN: fenP,
		MoveSAN: "d4", MoveUCI: "d2d4",
	})
	if err != nil {
		t.Fatalf("SaveRepertoireMove path-B terminal: %v", err)
	}

	moves, _ := db.LoadRepertoireMoves(rid)
	byID := make(map[string]repertoire.RepertoireMove)
	for _, m := range moves {
		byID[m.ID] = m
	}

	// idA3 (first move to reach fenP) should NOT be a transposition
	if byID[idA3].IsTransposition {
		t.Errorf("canonical move %s should not be a transposition", idA3)
	}

	// idB3 (second move to reach fenP, after Nf6 already exists) should be a transposition
	if !byID[idB3].IsTransposition {
		t.Errorf("path-B terminal move %s should be marked as transposition", idB3)
	}
}

func TestBatchReorderMoves(t *testing.T) {
	db := openTestDB(t)
	rid, _ := db.CreateRepertoire("Test", "white")

	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	afterE4 := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
	afterD4 := "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1"

	id1, err := db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: rid, FromFEN: startFEN, ToFEN: afterE4,
		MoveSAN: "e4", MoveUCI: "e2e4", MoveOrder: 0,
	})
	if err != nil {
		t.Fatalf("SaveRepertoireMove e4: %v", err)
	}
	id2, err := db.SaveRepertoireMove(repertoire.RepertoireMove{
		RepertoireID: rid, FromFEN: startFEN, ToFEN: afterD4,
		MoveSAN: "d4", MoveUCI: "d2d4", MoveOrder: 1,
	})
	if err != nil {
		t.Fatalf("SaveRepertoireMove d4: %v", err)
	}

	if err := db.BatchReorderMoves([]ReorderUpdate{
		{ID: id1, NewOrder: 1},
		{ID: id2, NewOrder: 0},
	}); err != nil {
		t.Fatalf("BatchReorderMoves: %v", err)
	}

	moves, err := db.LoadRepertoireMoves(rid)
	if err != nil {
		t.Fatalf("LoadRepertoireMoves: %v", err)
	}
	if len(moves) != 2 {
		t.Fatalf("expected 2 moves, got %d", len(moves))
	}

	byID := make(map[string]repertoire.RepertoireMove)
	for _, m := range moves {
		byID[m.ID] = m
	}
	if byID[id1].MoveOrder != 1 {
		t.Errorf("e4 move: expected order 1, got %d", byID[id1].MoveOrder)
	}
	if byID[id2].MoveOrder != 0 {
		t.Errorf("d4 move: expected order 0, got %d", byID[id2].MoveOrder)
	}
}


func TestGetAllMovesForPosition_MultipleRepertoires(t *testing.T) {
	db := openTestDB(t)

	const (
		startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
		afterE4  = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
		afterD4  = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"
	)

	rid1, _ := db.CreateRepertoire("Ruy Lopez", "white")
	rid2, _ := db.CreateRepertoire("London", "white")
	// Black repertoire — its move is from afterE4, not startFEN, so it won't match
	rid3, _ := db.CreateRepertoire("Sicilian", "black")

	db.SaveRepertoireMove(repertoire.RepertoireMove{RepertoireID: rid1, FromFEN: startFEN, ToFEN: afterE4, MoveSAN: "e4", MoveUCI: "e2e4"})
	db.SaveRepertoireMove(repertoire.RepertoireMove{RepertoireID: rid2, FromFEN: startFEN, ToFEN: afterD4, MoveSAN: "d4", MoveUCI: "d2d4"})
	// Black repertoire move from afterE4 (different from_fen — won't match startFEN query)
	db.SaveRepertoireMove(repertoire.RepertoireMove{RepertoireID: rid3, FromFEN: afterE4, ToFEN: "...", MoveSAN: "c5", MoveUCI: "c7c5"})

	summaries, err := db.GetAllMovesForPosition(startFEN)
	if err != nil {
		t.Fatalf("GetAllMovesForPosition: %v", err)
	}
	// Two white repertoires have moves from startFEN; the black repertoire's move is from afterE4
	if len(summaries) != 2 {
		t.Fatalf("expected 2 summaries, got %d", len(summaries))
	}
	for _, s := range summaries {
		if len(s.Moves) != 1 {
			t.Errorf("expected 1 move in summary for %q, got %d", s.Repertoire.Name, len(s.Moves))
		}
	}
	names := map[string]bool{}
	for _, s := range summaries {
		names[s.Repertoire.Name] = true
	}
	if !names["Ruy Lopez"] || !names["London"] {
		t.Errorf("unexpected repertoire names: %v", names)
	}
}

func TestGetAllMovesForPosition_Empty(t *testing.T) {
	db := openTestDB(t)
	summaries, err := db.GetAllMovesForPosition("8/8/8/8/8/8/8/4K3 w - - 0 1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(summaries) != 0 {
		t.Fatalf("expected 0 summaries, got %d", len(summaries))
	}
}

func TestGetAllMovesForPosition_BothColours(t *testing.T) {
	db := openTestDB(t)

	const (
		afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
		afterC5 = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
	)

	ridB, _ := db.CreateRepertoire("Sicilian", "black")
	ridW, _ := db.CreateRepertoire("Ruy Lopez", "white")

	db.SaveRepertoireMove(repertoire.RepertoireMove{RepertoireID: ridB, FromFEN: afterE4, ToFEN: afterC5, MoveSAN: "c5", MoveUCI: "c7c5"})
	db.SaveRepertoireMove(repertoire.RepertoireMove{RepertoireID: ridW, FromFEN: afterE4, ToFEN: "...", MoveSAN: "e5", MoveUCI: "e7e5"})

	summaries, err := db.GetAllMovesForPosition(afterE4)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Both repertoires have moves from afterE4, regardless of colour
	if len(summaries) != 2 {
		t.Fatalf("expected 2 summaries, got %d", len(summaries))
	}
	names := map[string]bool{}
	for _, s := range summaries {
		names[s.Repertoire.Name] = true
	}
	if !names["Sicilian"] || !names["Ruy Lopez"] {
		t.Errorf("unexpected repertoire names: %v", names)
	}
}

func TestUpdateRepertoireMove(t *testing.T) {
	db := openTestDB(t)
	rid, _ := db.CreateRepertoire("Annotations", "white")
	nag := 1
	moveID, _ := db.SaveRepertoireMove(sampleMove(rid))

	updated := repertoire.RepertoireMove{
		ID: moveID, NAG: &nag, Comment: "Best move", Shapes: `[]`, MoveOrder: 5,
	}
	if err := db.UpdateRepertoireMove(updated); err != nil {
		t.Fatalf("UpdateRepertoireMove: %v", err)
	}

	moves, _ := db.LoadRepertoireMoves(rid)
	if len(moves) != 1 {
		t.Fatalf("expected 1 move, got %d", len(moves))
	}
	m := moves[0]
	if m.Comment != "Best move" || m.Shapes != "[]" || m.MoveOrder != 5 {
		t.Errorf("update not persisted: %+v", m)
	}
	if m.NAG == nil || *m.NAG != 1 {
		t.Errorf("NAG not persisted: %v", m.NAG)
	}
}

func TestBatchSaveRepertoireMoves(t *testing.T) {
	db := openTestDB(t)
	repID, err := db.CreateRepertoire("Test", "white")
	if err != nil {
		t.Fatal(err)
	}

	startFEN := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	afterE4FEN := "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
	afterD4FEN := "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"

	moves := []repertoire.RepertoireMove{
		{ID: "move-id-1", RepertoireID: repID, ParentID: nil,
			FromFEN: startFEN, ToFEN: afterE4FEN, MoveSAN: "e4", MoveUCI: "e2e4", MoveOrder: 0},
		{ID: "move-id-2", RepertoireID: repID, ParentID: nil,
			FromFEN: startFEN, ToFEN: afterD4FEN, MoveSAN: "d4", MoveUCI: "d2d4", MoveOrder: 1},
	}

	n, err := db.BatchSaveRepertoireMoves(moves)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("want 2 inserted, got %d", n)
	}

	loaded, err := db.LoadRepertoireMoves(repID)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 2 {
		t.Fatalf("want 2 moves loaded, got %d", len(loaded))
	}
}
