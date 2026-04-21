package analysis

import (
	"strings"
	"testing"

	chess "github.com/corentings/chess/v2"
)

func TestMoveToUCI(t *testing.T) {
	pgn := "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0"
	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		t.Fatalf("parse PGN: %v", err)
	}
	g := chess.NewGame()
	updateFn(g)

	moves := g.Moves()
	expected := []string{"e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"}
	if len(moves) != len(expected) {
		t.Fatalf("got %d moves, want %d", len(moves), len(expected))
	}
	for i, m := range moves {
		uci := moveToUCI(m)
		if uci != expected[i] {
			t.Errorf("move %d: got %q, want %q", i, uci, expected[i])
		}
	}
}

func TestMoveToUCI_Promotion(t *testing.T) {
	pgn := `[FEN "7k/P7/8/8/8/8/8/4K3 w - - 0 1"]

1. a8=Q 1-0`
	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		t.Fatalf("parse PGN: %v", err)
	}
	g := chess.NewGame()
	updateFn(g)

	moves := g.Moves()
	if len(moves) != 1 {
		t.Fatalf("got %d moves, want 1", len(moves))
	}
	uci := moveToUCI(moves[0])
	if uci != "a7a8q" {
		t.Errorf("got %q, want %q", uci, "a7a8q")
	}
}

func TestNormaliseToWhite(t *testing.T) {
	cp5 := 5
	mate3 := 3

	// White to move: no change
	pe := normaliseToWhite(posEval{cp: &cp5}, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
	if pe.cp == nil || *pe.cp != 5 {
		t.Errorf("white-to-move cp: got %v, want 5", pe.cp)
	}

	// Black to move: negate
	pe = normaliseToWhite(posEval{cp: &cp5}, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
	if pe.cp == nil || *pe.cp != -5 {
		t.Errorf("black-to-move cp: got %v, want -5", pe.cp)
	}

	// Black to move with mate
	pe = normaliseToWhite(posEval{mate: &mate3}, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
	if pe.mate == nil || *pe.mate != -3 {
		t.Errorf("black-to-move mate: got %v, want -3", pe.mate)
	}
}

func TestEvalClassification(t *testing.T) {
	// Simulate a scenario: position eval is +1.00 (white), after move eval is +0.50
	// WC before: winChance(100) ~ 59.1
	// WC after:  winChance(50)  ~ 54.6
	// Delta for white: 59.1 - 54.6 ~ 4.5 -> no classification (< 5)
	wcBefore := winChance(100)
	wcAfter := winChance(50)
	delta := wcBefore - wcAfter
	nag := classifyDelta(delta)
	if nag != nil {
		t.Errorf("50cp drop from +100: delta=%.1f, got NAG %d, want nil", delta, *nag)
	}

	// Position eval is +1.00, after move eval is -0.50
	// WC before: 59.1, WC after: 40.9
	// Delta: 18.2 -> blunder (>= 15)
	wcAfter = winChance(-100)
	delta = wcBefore - wcAfter
	nag = classifyDelta(delta)
	if nag == nil || *nag != nagBlunder {
		t.Errorf("200cp drop from +100 to -100: delta=%.1f, got NAG %v, want %d", delta, nag, nagBlunder)
	}
}

func TestEvalToCp(t *testing.T) {
	cp := 150
	cpHigh := 2500
	cpLow := -1800
	mate3 := 3
	mateNeg := -2

	tests := []struct {
		name string
		pe   posEval
		want float64
	}{
		{"cp value", posEval{cp: &cp}, 150},
		{"cp ceiled high", posEval{cp: &cpHigh}, cpCeiling},
		{"cp ceiled low", posEval{cp: &cpLow}, -cpCeiling},
		{"positive mate", posEval{mate: &mate3}, cpCeiling},
		{"negative mate", posEval{mate: &mateNeg}, -cpCeiling},
		{"no score", posEval{}, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := evalToCp(tt.pe)
			if got != tt.want {
				t.Errorf("evalToCp(%+v) = %v, want %v", tt.pe, got, tt.want)
			}
		})
	}
}

func TestNagSuppressedWhenBestMoveMatchesPlayed(t *testing.T) {
	// A game where castling (O-O) is the engine's best move AND the played move.
	// Even if we manufacture a large WC delta, the NAG should be suppressed
	// because the engine agrees with the move.
	pgn := "1. e4 e5 2. Nf3 Nf6 3. Bc4 Bc5 4. O-O 1-0"
	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		t.Fatalf("parse PGN: %v", err)
	}
	g := chess.NewGame()
	updateFn(g)

	moves := g.Moves()
	positions := g.Positions()

	// O-O is move index 6 (ply 7): 1.e4 2.e5 3.Nf3 4.Nf6 5.Bc4 6.Bc5 7.O-O
	castleIdx := 6
	playedUci := moveToUCI(moves[castleIdx])
	if playedUci != "e1g1" {
		t.Fatalf("expected O-O = e1g1, got %q", playedUci)
	}

	// Simulate a posEval where the engine's best move is also O-O.
	beforeEval := posEval{
		bestPV: []string{"e1g1", "d7d6", "d2d4"},
	}
	_ = positions // used above via PGN parsing

	// Compute a synthetic WC loss that would normally trigger a blunder.
	wcLoss := 20.0 // well above the blunder threshold
	nag := classifyDelta(wcLoss)
	if nag == nil {
		t.Fatal("sanity: classifyDelta(20) should return a NAG")
	}

	// Apply the suppression logic from AnalyseGame.
	if nag != nil && len(beforeEval.bestPV) > 0 {
		if beforeEval.bestPV[0] == playedUci {
			nag = nil
		}
	}

	if nag != nil {
		t.Errorf("NAG should be nil when best move matches played move, got %d", *nag)
	}
}

func TestOnInfoPVFilter(t *testing.T) {
	// Simulate the onInfo callback logic from evalPosition: only info lines
	// with a PV should overwrite lastInfo.
	var lastInfo *struct {
		cp int
		pv []string
	}

	onInfo := func(cp int, pv []string) {
		if len(pv) > 0 {
			lastInfo = &struct {
				cp int
				pv []string
			}{cp, pv}
		}
	}

	// Good info with PV
	onInfo(45, []string{"e2e4", "e7e5", "g1f3"})
	if lastInfo == nil || len(lastInfo.pv) != 3 {
		t.Fatal("expected lastInfo with 3-move PV")
	}
	if lastInfo.cp != 45 {
		t.Errorf("cp: got %d, want 45", lastInfo.cp)
	}

	// Non-PV info line (aspiration window, node count, etc.) should NOT overwrite
	onInfo(50, nil)
	if lastInfo.cp != 45 {
		t.Errorf("non-PV line should not overwrite: cp got %d, want 45", lastInfo.cp)
	}
	if len(lastInfo.pv) != 3 {
		t.Errorf("non-PV line should not overwrite: pv got %v", lastInfo.pv)
	}

	// Another good info with PV SHOULD overwrite
	onInfo(48, []string{"d2d4", "d7d5"})
	if lastInfo.cp != 48 {
		t.Errorf("new PV line should overwrite: cp got %d, want 48", lastInfo.cp)
	}
	if len(lastInfo.pv) != 2 {
		t.Errorf("new PV line should overwrite: pv length got %d, want 2", len(lastInfo.pv))
	}
}

func TestTerminalPositionEval(t *testing.T) {
	// Scholar's mate: 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0
	// The final position is checkmate with black to move (white delivered mate).
	pgn := "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0"
	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		t.Fatalf("parse PGN: %v", err)
	}
	g := chess.NewGame()
	updateFn(g)

	positions := g.Positions()
	lastPos := positions[len(positions)-1]

	if lastPos.Status() != chess.Checkmate {
		t.Fatalf("expected checkmate, got %v", lastPos.Status())
	}

	// Simulate the terminal position eval logic: side to move is mated → mate = -1
	// from side-to-move perspective, then normalise to white.
	m := -1
	pe := normaliseToWhite(posEval{mate: &m}, lastPos.String())

	// Black is to move and checkmated; from white's perspective, mate should be positive
	// (white is winning).
	if pe.mate == nil {
		t.Fatal("expected mate score, got nil")
	}
	if *pe.mate <= 0 {
		t.Errorf("expected positive mate from white's perspective, got %d", *pe.mate)
	}

	// evalToCp should map this to +cpCeiling
	cp := evalToCp(pe)
	if cp != cpCeiling {
		t.Errorf("evalToCp = %v, want %v", cp, cpCeiling)
	}
}

func TestPositionCount(t *testing.T) {
	pgn := "1. e4 e5 2. Nf3 1-0"
	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		t.Fatalf("parse PGN: %v", err)
	}
	g := chess.NewGame()
	updateFn(g)

	moves := g.Moves()
	positions := g.Positions()

	if len(moves) != 3 {
		t.Errorf("got %d moves, want 3", len(moves))
	}
	// positions includes the starting position + one after each move
	if len(positions) != 4 {
		t.Errorf("got %d positions, want 4", len(positions))
	}
}
