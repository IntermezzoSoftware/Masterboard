package storage

import (
	"testing"
	"time"

	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)

// White to move — the standard starting position FEN.
const startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

// FEN after 1.e4 (black to move).
const after1e4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"

// FEN after 1.e4 e5 (white to move).
const after1e4e5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"

func srsMove(repID string, parentID *string, fromFen, toFen, san, uci string, order int) repertoire.RepertoireMove {
	return repertoire.RepertoireMove{
		RepertoireID: repID,
		ParentID:     parentID,
		FromFEN:      fromFen,
		ToFEN:        toFen,
		MoveSAN:      san,
		MoveUCI:      uci,
		MoveOrder:    order,
	}
}

// setupSRSDB creates an in-memory DB with a white repertoire containing a
// player move (e4) and one opponent response (e5).
func setupSRSDB(t *testing.T) (db *DB, repID, whiteMoveID string) {
	t.Helper()
	db = openTestDB(t)

	repID, err := db.CreateRepertoire("Test White", "white")
	if err != nil {
		t.Fatalf("create repertoire: %v", err)
	}

	// Player move: 1.e4 (white to move at startFEN).
	whiteMoveID, err = db.SaveRepertoireMove(srsMove(repID, nil, startFEN, after1e4, "e4", "e2e4", 0))
	if err != nil {
		t.Fatalf("save white move: %v", err)
	}

	// Opponent response: 1...e5 (black to move at after1e4).
	wid := whiteMoveID
	_, err = db.SaveRepertoireMove(srsMove(repID, &wid, after1e4, after1e4e5, "e5", "e7e5", 0))
	if err != nil {
		t.Fatalf("save black move: %v", err)
	}

	return db, repID, whiteMoveID
}

// TestGetDrillSession_NewRepertoire verifies that a fresh session creates SRS
// entries and returns exactly the player's moves (not opponent moves).
func TestGetDrillSession_NewRepertoire(t *testing.T) {
	db, repID, _ := setupSRSDB(t)

	cards, err := db.GetDrillSession(DrillScope{RepertoireID: repID})
	if err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}
	if len(cards) != 1 {
		t.Fatalf("want 1 card (player move only), got %d", len(cards))
	}
	c := cards[0]
	if c.Colour != "white" {
		t.Errorf("card colour = %q, want %q", c.Colour, "white")
	}
	if c.CorrectMove.SAN != "e4" {
		t.Errorf("correct move SAN = %q, want %q", c.CorrectMove.SAN, "e4")
	}
}

// TestRecordDrillResult_Correct verifies that a correct (Good) answer transitions the
// FSRS card state from New(0) to Learning(1), increments Reps, and schedules due in future.
func TestRecordDrillResult_Correct(t *testing.T) {
	db, repID, whiteMoveID := setupSRSDB(t)

	// Initialise SRS entries.
	if _, err := db.GetDrillSession(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}

	// First correct answer.
	if err := db.RecordDrillResult([]string{whiteMoveID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult: %v", err)
	}

	card, err := loadCard(db.db, whiteMoveID)
	if err != nil {
		t.Fatalf("loadCard: %v", err)
	}

	// After first Good on a New card: state moves to Learning(1), reps == 1.
	if card.Reps != 1 {
		t.Errorf("reps after first correct = %d, want 1", card.Reps)
	}
	if card.Due.IsZero() {
		t.Error("Due is zero after first correct answer")
	}
	if !card.Due.After(time.Now()) {
		t.Errorf("due %v is not in the future after correct answer", card.Due)
	}

	// Second correct answer — reps should increment again.
	if err := db.RecordDrillResult([]string{whiteMoveID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult second: %v", err)
	}
	card2, err := loadCard(db.db, whiteMoveID)
	if err != nil {
		t.Fatalf("loadCard second: %v", err)
	}
	if card2.Reps != 2 {
		t.Errorf("reps after second correct = %d, want 2", card2.Reps)
	}
}

// TestRecordDrillResult_Incorrect verifies that an incorrect (Again) answer on a New
// card schedules it only a short time in the future (FSRS: now+1min for Again on New).
// Lapses are only incremented when a Review-state card fails; on a New card they stay 0.
func TestRecordDrillResult_Incorrect(t *testing.T) {
	db, repID, whiteMoveID := setupSRSDB(t)

	if _, err := db.GetDrillSession(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}

	before := time.Now().UTC()
	if err := db.RecordDrillResult([]string{whiteMoveID}, false, "e2e4"); err != nil {
		t.Fatalf("RecordDrillResult incorrect: %v", err)
	}

	card, err := loadCard(db.db, whiteMoveID)
	if err != nil {
		t.Fatalf("loadCard: %v", err)
	}
	// FSRS Again on a New card: due = now + 1 minute, state = Learning, lapses = 0.
	maxDue := before.Add(15 * time.Minute)
	if card.Due.After(maxDue) {
		t.Errorf("due %v is unexpectedly far in the future after Again on New card (max expected %v)", card.Due, maxDue)
	}
}

// TestGetDrillSession_AllCaughtUp verifies that no cards are returned when
// all moves have been reviewed and their next due date is in the future.
func TestGetDrillSession_AllCaughtUp(t *testing.T) {
	db, repID, whiteMoveID := setupSRSDB(t)

	if _, err := db.GetDrillSession(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("GetDrillSession first: %v", err)
	}
	// Mark correct → due in the future.
	if err := db.RecordDrillResult([]string{whiteMoveID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult: %v", err)
	}

	cards, err := db.GetDrillSession(DrillScope{RepertoireID: repID})
	if err != nil {
		t.Fatalf("GetDrillSession second: %v", err)
	}
	if len(cards) != 0 {
		t.Errorf("expected 0 cards after correct answer, got %d", len(cards))
	}
}

// TestRecordDrillResult_IncorrectRequeues verifies that a move marked incorrect
// is scheduled only a short time in the future (Again = 5 minutes for a Learning card),
// not days away. After a Review-state card is marked incorrect, it re-appears soon.
func TestRecordDrillResult_IncorrectRequeues(t *testing.T) {
	db, repID, whiteMoveID := setupSRSDB(t)

	if _, err := db.GetDrillSession(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}
	// Correct to advance to Learning, then incorrect.
	if err := db.RecordDrillResult([]string{whiteMoveID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult correct: %v", err)
	}
	if err := db.RecordDrillResult([]string{whiteMoveID}, false, "d2d4"); err != nil {
		t.Fatalf("RecordDrillResult incorrect: %v", err)
	}

	card, err := loadCard(db.db, whiteMoveID)
	if err != nil {
		t.Fatalf("loadCard: %v", err)
	}
	// FSRS Again on a Learning card: due = now + 5 minutes, not days.
	maxDue := time.Now().UTC().Add(15 * time.Minute)
	if card.Due.After(maxDue) {
		t.Errorf("after incorrect, due %v is unexpectedly far in future (max expected %v)", card.Due, maxDue)
	}
}

// TestResetDrillScope verifies that resetting deletes srs_entries rows so moves
// are re-queued as fresh FSRS cards on the next session.
func TestResetDrillScope(t *testing.T) {
	db, repID, whiteMoveID := setupSRSDB(t)

	if _, err := db.GetDrillSession(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}
	// Record a correct answer to advance the card beyond New state.
	if err := db.RecordDrillResult([]string{whiteMoveID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult: %v", err)
	}

	// Confirm the row exists.
	var count int
	db.db.QueryRow(`SELECT COUNT(*) FROM srs_entries WHERE move_id = ?`, whiteMoveID).Scan(&count) //nolint:errcheck
	if count != 1 {
		t.Fatalf("want 1 srs_entries row before reset, got %d", count)
	}

	// Reset — should delete the row.
	if err := db.ResetDrillScope(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("ResetDrillScope: %v", err)
	}

	db.db.QueryRow(`SELECT COUNT(*) FROM srs_entries WHERE move_id = ?`, whiteMoveID).Scan(&count) //nolint:errcheck
	if count != 0 {
		t.Errorf("want 0 srs_entries rows after reset, got %d", count)
	}

	// Next session should re-create the entry and return the card as due.
	cards, err := db.GetDrillSession(DrillScope{RepertoireID: repID})
	if err != nil {
		t.Fatalf("GetDrillSession after reset: %v", err)
	}
	if len(cards) != 1 {
		t.Errorf("expected 1 card after reset, got %d", len(cards))
	}
}

// TestReviewLog_Correct verifies that a correct answer inserts a review log row
// with rating=3 (Good) and played_uci NULL.
func TestReviewLog_Correct(t *testing.T) {
	db, repID, whiteMoveID := setupSRSDB(t)

	if _, err := db.GetDrillSession(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}
	if err := db.RecordDrillResult([]string{whiteMoveID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult: %v", err)
	}

	var rating int
	var state int
	var playedUCI *string
	err := db.db.QueryRow(
		`SELECT rating, state, played_uci FROM srs_review_logs WHERE move_id = ? ORDER BY id DESC LIMIT 1`,
		whiteMoveID,
	).Scan(&rating, &state, &playedUCI)
	if err != nil {
		t.Fatalf("query review log: %v", err)
	}
	if rating != 3 { // fsrs.Good = 3
		t.Errorf("review log rating = %d, want 3 (Good)", rating)
	}
	if state != 1 { // fsrs.Learning = 1 (post-review state after first Good on New card)
		t.Errorf("review log state = %d, want 1 (Learning)", state)
	}
	if playedUCI != nil {
		t.Errorf("played_uci = %q, want NULL for correct answer", *playedUCI)
	}
}

// TestReviewLog_Incorrect verifies that an incorrect answer inserts a review log row
// with rating=1 (Again) and played_uci set to the passed UCI string.
func TestReviewLog_Incorrect(t *testing.T) {
	db, repID, whiteMoveID := setupSRSDB(t)

	if _, err := db.GetDrillSession(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}
	const wrongMove = "d2d4"
	if err := db.RecordDrillResult([]string{whiteMoveID}, false, wrongMove); err != nil {
		t.Fatalf("RecordDrillResult: %v", err)
	}

	var rating int
	var playedUCI *string
	err := db.db.QueryRow(
		`SELECT rating, played_uci FROM srs_review_logs WHERE move_id = ? ORDER BY id DESC LIMIT 1`,
		whiteMoveID,
	).Scan(&rating, &playedUCI)
	if err != nil {
		t.Fatalf("query review log: %v", err)
	}
	if rating != 1 { // fsrs.Again = 1
		t.Errorf("review log rating = %d, want 1 (Again)", rating)
	}
	if playedUCI == nil {
		t.Fatal("played_uci is NULL, want non-NULL for incorrect answer")
	}
	if *playedUCI != wrongMove {
		t.Errorf("played_uci = %q, want %q", *playedUCI, wrongMove)
	}
}

// TestGetDrillSession_PrecedingMove verifies that a card for a black repertoire
// includes the opponent's preceding move (white's first move).
func TestGetDrillSession_PrecedingMove(t *testing.T) {
	db := openTestDB(t)

	repID, _ := db.CreateRepertoire("Black e5", "black")
	// Opponent move: 1.e4 (white to move at startFEN → black to move at after1e4).
	oppID, err := db.SaveRepertoireMove(srsMove(repID, nil, startFEN, after1e4, "e4", "e2e4", 0))
	if err != nil {
		t.Fatalf("save opponent move: %v", err)
	}
	// Player move: 1...e5 (black to move at after1e4).
	if _, err := db.SaveRepertoireMove(srsMove(repID, &oppID, after1e4, after1e4e5, "e5", "e7e5", 0)); err != nil {
		t.Fatalf("save player move: %v", err)
	}

	cards, err := db.GetDrillSession(DrillScope{RepertoireID: repID})
	if err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}
	if len(cards) != 1 {
		t.Fatalf("want 1 card, got %d", len(cards))
	}
	pm := cards[0].PrecedingMove
	if pm == nil {
		t.Fatal("PrecedingMove is nil, want opponent's move (e4)")
	}
	if pm.SAN != "e4" {
		t.Errorf("PrecedingMove.SAN = %q, want %q", pm.SAN, "e4")
	}
	if pm.UCI != "e2e4" {
		t.Errorf("PrecedingMove.UCI = %q, want %q", pm.UCI, "e2e4")
	}
	if pm.FromFEN != startFEN {
		t.Errorf("PrecedingMove.FromFEN = %q, want startFEN", pm.FromFEN)
	}
}

// TestFenPly verifies ply calculation from FEN strings.
func TestFenPly(t *testing.T) {
	cases := []struct {
		fen  string
		want int
	}{
		{startFEN, 0},   // move 1, white to move = ply 0
		{after1e4, 1},   // move 1, black to move = ply 1
		{after1e4e5, 2}, // move 2, white to move = ply 2
		// move 3, white to move = ply 4
		{"rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2", 3},
	}
	for _, tc := range cases {
		got := fenPly(tc.fen)
		if got != tc.want {
			t.Errorf("fenPly(%q) = %d, want %d", tc.fen, got, tc.want)
		}
	}
}

// TestGetDrillSession_DepthFirst verifies depth-first ordering.
//
// Tree shape (white repertoire):
//
//	startFEN  ──player e4──►  root card e4
//	           ──player d4──►  root card d4
//	             │
//	     ┌───────┴──────────┐
//	  (opp e5)           (opp d5)
//	     ▼                  ▼
//	after1e4e5           afterD4D5
//	  (player Nf3)      (player Nf3b)  ← child of d4
//	     ▼
//	afterNf3Nc6
//	  (player Bb5)                     ← grandchild via e4
//
// e4 and d4 each produce their own DrillCard (one card per move). Both are roots.
// The Nf3 card is a child of e4; Bb5 is a grandchild of e4 via Nf3.
// The Nf3b card is a child of d4.
//
// DFS guarantees:
//  1. e4 root card appears before its descendant Nf3 card.
//  2. Bb5 card always follows the Nf3 card (ancestor before descendant).
//  3. The Nf3 sub-branch [nf3Idx, bb5Idx] and the Nf3b card do not interleave.
func TestGetDrillSession_DepthFirst(t *testing.T) {
	const (
		afterNf3    = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"
		afterNf3Nc6 = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
		afterBb5    = "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3"
		afterD4     = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"
		afterD4D5   = "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2"
		afterNf3b   = "rnbqkbnr/ppp1pppp/8/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R b KQkq - 1 2"
	)

	db := openTestDB(t)
	repID, _ := db.CreateRepertoire("Two sub-branches", "white")

	// Player: e4 and d4 from startFEN — become one root card with two correct moves.
	e4ID, _ := db.SaveRepertoireMove(srsMove(repID, nil, startFEN, after1e4, "e4", "e2e4", 0))
	d4ID, _ := db.SaveRepertoireMove(srsMove(repID, nil, startFEN, afterD4, "d4", "d2d4", 1))

	// e4 sub-branch: opp e5 → player Nf3 → opp Nc6 → player Bb5
	e5ID, _ := db.SaveRepertoireMove(srsMove(repID, &e4ID, after1e4, after1e4e5, "e5", "e7e5", 0))
	nf3ID, _ := db.SaveRepertoireMove(srsMove(repID, &e5ID, after1e4e5, afterNf3, "Nf3", "g1f3", 0))
	nc6ID, _ := db.SaveRepertoireMove(srsMove(repID, &nf3ID, afterNf3, afterNf3Nc6, "Nc6", "b8c6", 0))
	_, _ = db.SaveRepertoireMove(srsMove(repID, &nc6ID, afterNf3Nc6, afterBb5, "Bb5", "f1b5", 0))

	// d4 sub-branch: opp d5 → player Nf3b
	d5ID, _ := db.SaveRepertoireMove(srsMove(repID, &d4ID, afterD4, afterD4D5, "d5", "d7d5", 0))
	_, _ = db.SaveRepertoireMove(srsMove(repID, &d5ID, afterD4D5, afterNf3b, "Nf3", "g1f3", 0))

	cards, err := db.GetDrillSession(DrillScope{RepertoireID: repID})
	if err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}
	// 5 player cards: startFEN(e4), startFEN(d4), after1e4e5(Nf3), afterNf3Nc6(Bb5), afterD4D5(Nf3b)
	if len(cards) != 5 {
		t.Fatalf("want 5 player cards, got %d", len(cards))
	}

	// cardIdx finds the index of the card with the given fromFen AND correctMove SAN.
	cardIdx := func(fen, san string) int {
		for i, c := range cards {
			if c.FromFEN == fen && c.CorrectMove.SAN == san {
				return i
			}
		}
		t.Fatalf("no card found for FEN %q san %q", fen, san)
		return -1
	}

	e4Idx   := cardIdx(startFEN, "e4")
	d4Idx   := cardIdx(startFEN, "d4")
	nf3Idx  := cardIdx(after1e4e5, "Nf3")
	bb5Idx  := cardIdx(afterNf3Nc6, "Bb5")
	nf3bIdx := cardIdx(afterD4D5, "Nf3")

	// 1. e4 root card appears before its descendant Nf3 card.
	if e4Idx > nf3Idx {
		t.Errorf("e4 card (idx %d) must precede Nf3 card (idx %d)", e4Idx, nf3Idx)
	}

	// 2. d4 root card appears before its descendant Nf3b card.
	if d4Idx > nf3bIdx {
		t.Errorf("d4 card (idx %d) must precede Nf3b card (idx %d)", d4Idx, nf3bIdx)
	}

	// 3. Bb5 must come after Nf3 (ancestor before descendant).
	if bb5Idx < nf3Idx {
		t.Errorf("Bb5 card (idx %d) precedes its ancestor Nf3 card (idx %d)", bb5Idx, nf3Idx)
	}

	// 4. The Nf3 sub-branch [nf3Idx, bb5Idx] and the Nf3b card must not interleave.
	lo, hi := nf3Idx, bb5Idx
	if lo > hi {
		lo, hi = hi, lo
	}
	if nf3bIdx > lo && nf3bIdx < hi {
		t.Errorf("nf3b card (idx %d) interleaves with e4 sub-branch [%d,%d]", nf3bIdx, lo, hi)
	}
}

// TestGetDrillSession_SiblingMoves verifies that when two player moves exist at the
// same position, each produces its own DrillCard and each card's SiblingMoves contains
// the other move with the correct Due value.
func TestGetDrillSession_SiblingMoves(t *testing.T) {
	const afterD4 = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"

	db := openTestDB(t)
	repID, _ := db.CreateRepertoire("Two roots", "white")

	e4ID, _ := db.SaveRepertoireMove(srsMove(repID, nil, startFEN, after1e4, "e4", "e2e4", 0))
	d4ID, _ := db.SaveRepertoireMove(srsMove(repID, nil, startFEN, afterD4, "d4", "d2d4", 1))

	cards, err := db.GetDrillSession(DrillScope{RepertoireID: repID})
	if err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}
	if len(cards) != 2 {
		t.Fatalf("want 2 cards, got %d", len(cards))
	}

	// Find each card.
	findCard := func(san string) *DrillCard {
		for i := range cards {
			if cards[i].CorrectMove.SAN == san {
				return &cards[i]
			}
		}
		t.Fatalf("no card for san %q", san)
		return nil
	}
	e4Card := findCard("e4")
	d4Card := findCard("d4")

	// e4 card: CorrectMove is e4, sibling is d4 (due = true since not yet reviewed).
	if e4Card.CorrectMove.MoveID != e4ID {
		t.Errorf("e4 card CorrectMove.MoveID = %q, want %q", e4Card.CorrectMove.MoveID, e4ID)
	}
	if len(e4Card.SiblingMoves) != 1 {
		t.Fatalf("e4 card: want 1 sibling, got %d", len(e4Card.SiblingMoves))
	}
	if e4Card.SiblingMoves[0].MoveID != d4ID {
		t.Errorf("e4 card sibling MoveID = %q, want d4 (%q)", e4Card.SiblingMoves[0].MoveID, d4ID)
	}
	if !e4Card.SiblingMoves[0].Due {
		t.Error("e4 card sibling (d4) should be Due=true before any review")
	}

	// d4 card: CorrectMove is d4, sibling is e4 (due = true).
	if d4Card.CorrectMove.MoveID != d4ID {
		t.Errorf("d4 card CorrectMove.MoveID = %q, want %q", d4Card.CorrectMove.MoveID, d4ID)
	}
	if len(d4Card.SiblingMoves) != 1 {
		t.Fatalf("d4 card: want 1 sibling, got %d", len(d4Card.SiblingMoves))
	}
	if d4Card.SiblingMoves[0].MoveID != e4ID {
		t.Errorf("d4 card sibling MoveID = %q, want e4 (%q)", d4Card.SiblingMoves[0].MoveID, e4ID)
	}
	if !d4Card.SiblingMoves[0].Due {
		t.Error("d4 card sibling (e4) should be Due=true before any review")
	}

	// Mark e4 correct (due in future, not due any more).
	if err := db.RecordDrillResult([]string{e4ID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult: %v", err)
	}

	// Re-fetch: only d4 should be due; its sibling e4 should be Due=false.
	cards2, err := db.GetDrillSession(DrillScope{RepertoireID: repID})
	if err != nil {
		t.Fatalf("GetDrillSession after review: %v", err)
	}
	if len(cards2) != 1 {
		t.Fatalf("after reviewing e4, want 1 card (d4 only), got %d", len(cards2))
	}
	c := cards2[0]
	if c.CorrectMove.SAN != "d4" {
		t.Errorf("remaining card SAN = %q, want d4", c.CorrectMove.SAN)
	}
	if len(c.SiblingMoves) != 1 {
		t.Fatalf("d4 card: want 1 sibling, got %d", len(c.SiblingMoves))
	}
	if c.SiblingMoves[0].Due {
		t.Error("d4 card sibling (e4) should be Due=false after e4 was reviewed")
	}
}

// TestGetDrillSession_IgnoreSchedule verifies that all moves are returned even when
// they are not due (scheduled in the future), when IgnoreSchedule is set.
func TestGetDrillSession_IgnoreSchedule(t *testing.T) {
	db, repID, whiteMoveID := setupSRSDB(t)

	// Initialise SRS entries.
	if _, err := db.GetDrillSession(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}

	// Mark correct — card is now scheduled in the future.
	if err := db.RecordDrillResult([]string{whiteMoveID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult: %v", err)
	}

	// Normal session — no cards should be due.
	cards, err := db.GetDrillSession(DrillScope{RepertoireID: repID})
	if err != nil {
		t.Fatalf("GetDrillSession normal: %v", err)
	}
	if len(cards) != 0 {
		t.Fatalf("expected 0 due cards after correct answer, got %d", len(cards))
	}

	// IgnoreSchedule — all player moves should be returned regardless.
	cards, err = db.GetDrillSession(DrillScope{RepertoireID: repID, IgnoreSchedule: true})
	if err != nil {
		t.Fatalf("GetDrillSession IgnoreSchedule: %v", err)
	}
	if len(cards) != 1 {
		t.Fatalf("expected 1 card with IgnoreSchedule=true, got %d", len(cards))
	}
	if cards[0].CorrectMove.SAN != "e4" {
		t.Errorf("card SAN = %q, want %q", cards[0].CorrectMove.SAN, "e4")
	}
}

// TestGetDrillSummary verifies that GetDrillSummary aggregates review-log rows correctly.
func TestGetDrillSummary(t *testing.T) {
	db, repID, whiteMoveID := setupSRSDB(t)

	// Initialise SRS entries.
	if _, err := db.GetDrillSession(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}

	before := time.Now().UTC().Add(-time.Second)

	// One correct answer.
	if err := db.RecordDrillResult([]string{whiteMoveID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult correct: %v", err)
	}
	// One incorrect answer (re-queues the card; it's a new card so also goes to Learning).
	if err := db.RecordDrillResult([]string{whiteMoveID}, false, "d2d4"); err != nil {
		t.Fatalf("RecordDrillResult incorrect: %v", err)
	}

	summary, err := db.GetDrillSummary(before)
	if err != nil {
		t.Fatalf("GetDrillSummary: %v", err)
	}

	if summary.TotalReviewed != 2 {
		t.Errorf("TotalReviewed = %d, want 2", summary.TotalReviewed)
	}
	if summary.CorrectCount != 1 {
		t.Errorf("CorrectCount = %d, want 1", summary.CorrectCount)
	}
	if summary.IncorrectCount != 1 {
		t.Errorf("IncorrectCount = %d, want 1", summary.IncorrectCount)
	}
	// The correct answer was on a New card that got promoted to Learning — NewToLearning >= 1.
	if summary.NewToLearning < 1 {
		t.Errorf("NewToLearning = %d, want >= 1", summary.NewToLearning)
	}

	// Verify that reviews before `before` are excluded.
	afterAll := time.Now().UTC().Add(time.Minute)
	summaryEmpty, err := db.GetDrillSummary(afterAll)
	if err != nil {
		t.Fatalf("GetDrillSummary after all: %v", err)
	}
	if summaryEmpty.TotalReviewed != 0 {
		t.Errorf("TotalReviewed with future since = %d, want 0", summaryEmpty.TotalReviewed)
	}
}

// TestGetRepertoireHeatmap verifies heatmap entries before and after drilling.
func TestGetRepertoireHeatmap(t *testing.T) {
	db, repID, whiteMoveID := setupSRSDB(t)

	// Before any drilling: all entries should have Retrievability=0 and State=0.
	entries, err := db.GetRepertoireHeatmap(repID)
	if err != nil {
		t.Fatalf("GetRepertoireHeatmap before drill: %v", err)
	}
	// setupSRSDB creates 1 player move (e4) and 1 opponent move (e5).
	// Heatmap should only include player moves.
	if len(entries) != 1 {
		t.Fatalf("want 1 heatmap entry (player move only), got %d", len(entries))
	}
	if entries[0].MoveID != whiteMoveID {
		t.Errorf("entry MoveID = %q, want %q", entries[0].MoveID, whiteMoveID)
	}
	if entries[0].Retrievability != 0 {
		t.Errorf("retrievability before drill = %v, want 0", entries[0].Retrievability)
	}
	if entries[0].State != 0 {
		t.Errorf("state before drill = %d, want 0 (New)", entries[0].State)
	}

	// Drill the move with a correct answer to advance its FSRS state.
	if _, err := db.GetDrillSession(DrillScope{RepertoireID: repID}); err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}
	if err := db.RecordDrillResult([]string{whiteMoveID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult: %v", err)
	}

	// After drilling: the move should have State > 0 and Retrievability > 0.
	entries2, err := db.GetRepertoireHeatmap(repID)
	if err != nil {
		t.Fatalf("GetRepertoireHeatmap after drill: %v", err)
	}
	if len(entries2) != 1 {
		t.Fatalf("want 1 heatmap entry after drill, got %d", len(entries2))
	}
	if entries2[0].State == 0 {
		t.Errorf("state after correct drill = 0, want > 0")
	}
	if entries2[0].Retrievability <= 0 {
		t.Errorf("retrievability after correct drill = %v, want > 0", entries2[0].Retrievability)
	}
	if entries2[0].Retrievability > 1 {
		t.Errorf("retrievability = %v, want <= 1.0", entries2[0].Retrievability)
	}

	// Insert a transposition player move (white to move, is_transposition = 1) and verify
	// that GetRepertoireHeatmap still returns the same count — transpositions are excluded.
	_, err = db.db.Exec(`
		INSERT INTO repertoire_moves
		  (id, repertoire_id, parent_id, from_fen, to_fen,
		   move_san, move_uci, move_order, is_transposition)
		VALUES ('transposition-id', ?, NULL, ?, ?, 'Nf3', 'g1f3', 1, 1)`,
		repID, startFEN, after1e4)
	if err != nil {
		t.Fatalf("insert transposition move: %v", err)
	}

	entries3, err := db.GetRepertoireHeatmap(repID)
	if err != nil {
		t.Fatalf("GetRepertoireHeatmap after transposition insert: %v", err)
	}
	if len(entries3) != len(entries2) {
		t.Fatalf("want %d heatmap entries after transposition insert (transpositions excluded), got %d", len(entries2), len(entries3))
	}
}

// TestGetDrillSession_RootMoveID verifies that when RootMoveID is set, only moves
// in the subtree rooted at that move are returned.
//
// Tree (white repertoire):
//
//	startFEN ──e4──► after1e4 ──e5──► after1e4e5 ──Nf3──► (player)
//	startFEN ──c4──► afterC4                              (player, independent branch)
//
// Calling with RootMoveID = e4ID should return only Nf3 (the player move in e4's subtree),
// not c4 (which is in a separate branch).
func TestGetDrillSession_RootMoveID(t *testing.T) {
	const (
		afterC4  = "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1"
		afterNf3 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"
	)

	db := openTestDB(t)
	repID, _ := db.CreateRepertoire("Branch test", "white")

	// e4 branch: e4 (player) → e5 (opp) → Nf3 (player)
	e4ID, _ := db.SaveRepertoireMove(srsMove(repID, nil, startFEN, after1e4, "e4", "e2e4", 0))
	e5ID, _ := db.SaveRepertoireMove(srsMove(repID, &e4ID, after1e4, after1e4e5, "e5", "e7e5", 0))
	_, _ = db.SaveRepertoireMove(srsMove(repID, &e5ID, after1e4e5, afterNf3, "Nf3", "g1f3", 0))

	// c4 branch: c4 (player) — independent
	_, _ = db.SaveRepertoireMove(srsMove(repID, nil, startFEN, afterC4, "c4", "c2c4", 1))

	// Full session should include both player moves: e4, Nf3, and c4 = 3 cards total?
	// e4 and c4 are player moves from startFEN; Nf3 is a player move from after1e4e5.
	allCards, err := db.GetDrillSession(DrillScope{RepertoireID: repID})
	if err != nil {
		t.Fatalf("GetDrillSession (all): %v", err)
	}
	if len(allCards) != 3 {
		t.Fatalf("full session: want 3 player cards (e4, Nf3, c4), got %d", len(allCards))
	}

	// Session restricted to e4's subtree: should return only e4 and Nf3.
	subtreeCards, err := db.GetDrillSession(DrillScope{RepertoireID: repID, RootMoveID: e4ID})
	if err != nil {
		t.Fatalf("GetDrillSession (subtree): %v", err)
	}
	if len(subtreeCards) != 2 {
		t.Fatalf("subtree session: want 2 cards (e4, Nf3), got %d", len(subtreeCards))
	}
	for _, c := range subtreeCards {
		if c.CorrectMove.SAN == "c4" {
			t.Error("subtree session returned c4 card, which is outside e4's subtree")
		}
	}
	sans := make([]string, 0, len(subtreeCards))
	for _, c := range subtreeCards {
		sans = append(sans, c.CorrectMove.SAN)
	}
	foundE4, foundNf3 := false, false
	for _, s := range sans {
		if s == "e4" { foundE4 = true }
		if s == "Nf3" { foundNf3 = true }
	}
	if !foundE4 {
		t.Error("subtree session missing e4 card")
	}
	if !foundNf3 {
		t.Error("subtree session missing Nf3 card")
	}
}

// TestGetDrillCount_RootMoveID verifies that GetDrillCount respects RootMoveID.
func TestGetDrillCount_RootMoveID(t *testing.T) {
	const (
		afterC4  = "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1"
		afterNf3 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"
	)

	db := openTestDB(t)
	repID, _ := db.CreateRepertoire("Count test", "white")

	e4ID, _ := db.SaveRepertoireMove(srsMove(repID, nil, startFEN, after1e4, "e4", "e2e4", 0))
	e5ID, _ := db.SaveRepertoireMove(srsMove(repID, &e4ID, after1e4, after1e4e5, "e5", "e7e5", 0))
	_, _ = db.SaveRepertoireMove(srsMove(repID, &e5ID, after1e4e5, afterNf3, "Nf3", "g1f3", 0))
	_, _ = db.SaveRepertoireMove(srsMove(repID, nil, startFEN, afterC4, "c4", "c2c4", 1))

	// Full count should be 3 (e4, Nf3, c4).
	total, err := db.GetDrillCount(DrillScope{RepertoireID: repID})
	if err != nil {
		t.Fatalf("GetDrillCount (all): %v", err)
	}
	if total != 3 {
		t.Fatalf("full count: want 3, got %d", total)
	}

	// Subtree count should be 2 (e4, Nf3 only).
	subtreeCount, err := db.GetDrillCount(DrillScope{RepertoireID: repID, RootMoveID: e4ID})
	if err != nil {
		t.Fatalf("GetDrillCount (subtree): %v", err)
	}
	if subtreeCount != 2 {
		t.Fatalf("subtree count: want 2, got %d", subtreeCount)
	}
}

// TestGetDrillSession_ColourScope verifies colour-based scope filtering.
func TestGetDrillSession_ColourScope(t *testing.T) {
	db := openTestDB(t)

	// White repertoire with one player move.
	whiteRepID, _ := db.CreateRepertoire("White Rep", "white")
	db.SaveRepertoireMove(srsMove(whiteRepID, nil, startFEN, after1e4, "e4", "e2e4", 0)) //nolint:errcheck

	// Black repertoire with one player move.
	blackRepID, _ := db.CreateRepertoire("Black Rep", "black")
	db.SaveRepertoireMove(srsMove(blackRepID, nil, after1e4, after1e4e5, "e5", "e7e5", 0)) //nolint:errcheck

	cases := []struct {
		scope      DrillScope
		wantN      int
		wantColour string
	}{
		{DrillScope{Colour: "white"}, 1, "white"},
		{DrillScope{Colour: "black"}, 1, "black"},
		{DrillScope{}, 2, ""},
	}
	for _, tc := range cases {
		cards, err := db.GetDrillSession(tc.scope)
		if err != nil {
			t.Fatalf("scope %+v: GetDrillSession: %v", tc.scope, err)
		}
		if len(cards) != tc.wantN {
			t.Errorf("scope %+v: got %d cards, want %d", tc.scope, len(cards), tc.wantN)
			continue
		}
		if tc.wantColour != "" && cards[0].Colour != tc.wantColour {
			t.Errorf("scope %+v: card colour = %q, want %q", tc.scope, cards[0].Colour, tc.wantColour)
		}
	}
}

// TestResetDrillScope_RootMoveID verifies that ResetDrillScope with a RootMoveID
// deletes srs_entries only for moves in that subtree and leaves other branches intact.
//
// Tree (white repertoire):
//
//	startFEN ──e4──► after1e4 ──e5──► after1e4e5 ──Nf3──► (player)
//	startFEN ──c4──► afterC4                               (player, independent branch)
//
// Resetting with RootMoveID=e4ID should delete e4 and Nf3 entries but not c4.
func TestResetDrillScope_RootMoveID(t *testing.T) {
	const (
		afterC4  = "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1"
		afterNf3 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"
	)

	db := openTestDB(t)
	reperID, _ := db.CreateRepertoire("Reset subtree test", "white")

	// e4 branch: e4 (player) → e5 (opp) → Nf3 (player)
	e4ID, _ := db.SaveRepertoireMove(srsMove(reperID, nil, startFEN, after1e4, "e4", "e2e4", 0))
	e5ID, _ := db.SaveRepertoireMove(srsMove(reperID, &e4ID, after1e4, after1e4e5, "e5", "e7e5", 0))
	nf3ID, _ := db.SaveRepertoireMove(srsMove(reperID, &e5ID, after1e4e5, afterNf3, "Nf3", "g1f3", 0))

	// c4 branch: c4 (player) — independent
	c4ID, _ := db.SaveRepertoireMove(srsMove(reperID, nil, startFEN, afterC4, "c4", "c2c4", 1))

	// Seed SRS entries for all player moves via a full drill session.
	if _, err := db.GetDrillSession(DrillScope{RepertoireID: reperID}); err != nil {
		t.Fatalf("GetDrillSession: %v", err)
	}
	// Record a result for each player move so entries definitely exist.
	if err := db.RecordDrillResult([]string{e4ID, nf3ID, c4ID}, true, ""); err != nil {
		t.Fatalf("RecordDrillResult: %v", err)
	}

	// Confirm all three player moves have srs_entries rows.
	for _, id := range []string{e4ID, nf3ID, c4ID} {
		var count int
		db.db.QueryRow(`SELECT COUNT(*) FROM srs_entries WHERE move_id = ?`, id).Scan(&count) //nolint:errcheck
		if count != 1 {
			t.Fatalf("want 1 srs_entries row for %s before reset, got %d", id, count)
		}
	}

	// Reset only the e4 subtree.
	if err := db.ResetDrillScope(DrillScope{RepertoireID: reperID, RootMoveID: e4ID}); err != nil {
		t.Fatalf("ResetDrillScope: %v", err)
	}

	// e4 and Nf3 entries should be deleted.
	for _, id := range []string{e4ID, nf3ID} {
		var count int
		db.db.QueryRow(`SELECT COUNT(*) FROM srs_entries WHERE move_id = ?`, id).Scan(&count) //nolint:errcheck
		if count != 0 {
			t.Errorf("want 0 srs_entries rows for %s after subtree reset, got %d", id, count)
		}
	}

	// c4 entry must still exist (outside the reset subtree).
	var c4Count int
	db.db.QueryRow(`SELECT COUNT(*) FROM srs_entries WHERE move_id = ?`, c4ID).Scan(&c4Count) //nolint:errcheck
	if c4Count != 1 {
		t.Errorf("want 1 srs_entries row for c4 after subtree reset, got %d", c4Count)
	}
}
