package pgn

import (
	"strings"
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)


func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

func rep(name, colour string) repertoire.Repertoire {
	return repertoire.Repertoire{ID: "r1", Name: name, Colour: colour}
}


func TestEscapeTagValue_NoSpecialChars(t *testing.T) {
	if got := escapeTagValue("Sicilian Defence"); got != "Sicilian Defence" {
		t.Errorf("got %q", got)
	}
}

func TestEscapeTagValue_Quotes(t *testing.T) {
	if got := escapeTagValue(`say "hello"`); got != `say \"hello\"` {
		t.Errorf("got %q", got)
	}
}

func TestEscapeTagValue_Backslash(t *testing.T) {
	if got := escapeTagValue(`path\to\thing`); got != `path\\to\\thing` {
		t.Errorf("got %q", got)
	}
}

func TestEscapeTagValue_Both(t *testing.T) {
	if got := escapeTagValue(`a\"b`); got != `a\\\"b` {
		t.Errorf("got %q", got)
	}
}


func TestGroupByParent_EmptyMoves(t *testing.T) {
	m := groupByParent(nil)
	if len(m) != 0 {
		t.Errorf("expected empty map, got %v", m)
	}
}

func TestGroupByParent_SortsAscending(t *testing.T) {
	p := strPtr("root")
	moves := []repertoire.RepertoireMove{
		{ID: "b", ParentID: p, MoveOrder: 2, MoveSAN: "Nf6"},
		{ID: "a", ParentID: p, MoveOrder: 1, MoveSAN: "e5"},
		{ID: "c", ParentID: p, MoveOrder: 0, MoveSAN: "c5"},
	}
	m := groupByParent(moves)
	children := m["root"]
	if children[0].MoveOrder != 0 || children[1].MoveOrder != 1 || children[2].MoveOrder != 2 {
		t.Errorf("not sorted: %v", children)
	}
}

func TestGroupByParent_NilParentGoesToRoot(t *testing.T) {
	moves := []repertoire.RepertoireMove{
		{ID: "m1", ParentID: nil, MoveOrder: 0, MoveSAN: "e4"},
	}
	m := groupByParent(moves)
	if _, ok := m[""]; !ok {
		t.Error("nil parent should be keyed by empty string")
	}
}


func TestCompileRepertoire_NoMoves(t *testing.T) {
	pgn := CompileRepertoire(rep("Test", "white"), nil)
	if !strings.Contains(pgn, `[Event "Test"]`) {
		t.Error("missing Event header")
	}
	if !strings.Contains(pgn, "[Result \"*\"]") {
		t.Error("missing Result header")
	}
	if !strings.HasSuffix(strings.TrimSpace(pgn), "*") {
		t.Errorf("PGN should end with *, got: %q", pgn)
	}
}

func TestCompileRepertoire_WhiteColour(t *testing.T) {
	pgn := CompileRepertoire(rep("My Whites", "white"), nil)
	if !strings.Contains(pgn, `[White "My Whites"]`) {
		t.Errorf("expected White tag with repertoire name: %q", pgn)
	}
	if !strings.Contains(pgn, `[Black "?"]`) {
		t.Errorf("expected Black unknown: %q", pgn)
	}
}

func TestCompileRepertoire_BlackColour(t *testing.T) {
	pgn := CompileRepertoire(rep("My Blacks", "black"), nil)
	if !strings.Contains(pgn, `[White "?"]`) {
		t.Errorf("expected White unknown: %q", pgn)
	}
	if !strings.Contains(pgn, `[Black "My Blacks"]`) {
		t.Errorf("expected Black tag with repertoire name: %q", pgn)
	}
}

func TestCompileRepertoire_MainlineMoves(t *testing.T) {
	// e4 e5 Nf3 as a single line
	moves := []repertoire.RepertoireMove{
		{ID: "m1", ParentID: nil, MoveOrder: 0, MoveSAN: "e4"},
		{ID: "m2", ParentID: strPtr("m1"), MoveOrder: 0, MoveSAN: "e5"},
		{ID: "m3", ParentID: strPtr("m2"), MoveOrder: 0, MoveSAN: "Nf3"},
	}
	pgn := CompileRepertoire(rep("Test", "white"), moves)
	if !strings.Contains(pgn, "1. e4") {
		t.Errorf("expected '1. e4': %q", pgn)
	}
	if !strings.Contains(pgn, "e5") {
		t.Errorf("expected 'e5': %q", pgn)
	}
	if !strings.Contains(pgn, "2. Nf3") {
		t.Errorf("expected '2. Nf3': %q", pgn)
	}
}

func TestCompileRepertoire_SingleVariation(t *testing.T) {
	// 1. e4 (1. d4) e5
	moves := []repertoire.RepertoireMove{
		{ID: "m1", ParentID: nil, MoveOrder: 0, MoveSAN: "e4"},
		{ID: "m2", ParentID: nil, MoveOrder: 1, MoveSAN: "d4"},
		{ID: "m3", ParentID: strPtr("m1"), MoveOrder: 0, MoveSAN: "e5"},
	}
	pgn := CompileRepertoire(rep("Test", "white"), moves)
	if !strings.Contains(pgn, "( 1. d4") {
		t.Errorf("expected d4 as RAV alternative, got: %q", pgn)
	}
	if !strings.Contains(pgn, "1. e4") {
		t.Errorf("expected e4 as mainline: %q", pgn)
	}
}

func TestCompileRepertoire_WithNAG(t *testing.T) {
	moves := []repertoire.RepertoireMove{
		{ID: "m1", ParentID: nil, MoveOrder: 0, MoveSAN: "e4", NAG: intPtr(1)}, // !
	}
	pgn := CompileRepertoire(rep("Test", "white"), moves)
	if !strings.Contains(pgn, "$1") {
		t.Errorf("expected NAG $1: %q", pgn)
	}
}

func TestCompileRepertoire_WithComment(t *testing.T) {
	moves := []repertoire.RepertoireMove{
		{ID: "m1", ParentID: nil, MoveOrder: 0, MoveSAN: "e4", Comment: "Main move"},
	}
	pgn := CompileRepertoire(rep("Test", "white"), moves)
	if !strings.Contains(pgn, "{ Main move }") {
		t.Errorf("expected comment { Main move }: %q", pgn)
	}
}

func TestCompileRepertoire_BlackMoveNumberPrefix(t *testing.T) {
	// After a variation, the next black move must show N...
	moves := []repertoire.RepertoireMove{
		{ID: "m1", ParentID: nil, MoveOrder: 0, MoveSAN: "e4"},
		{ID: "m1a", ParentID: nil, MoveOrder: 1, MoveSAN: "d4"},
		{ID: "m2", ParentID: strPtr("m1"), MoveOrder: 0, MoveSAN: "e5"},
	}
	pgn := CompileRepertoire(rep("Test", "white"), moves)
	// After the RAV, black's move needs "1..."
	if !strings.Contains(pgn, "1...") {
		t.Errorf("expected black move number prefix '1...' after variation: %q", pgn)
	}
}

func TestCompileRepertoire_EscapedRepertoireName(t *testing.T) {
	pgn := CompileRepertoire(rep(`My "Sicilian"`, "white"), nil)
	if !strings.Contains(pgn, `My \"Sicilian\"`) {
		t.Errorf("expected escaped quotes in tag: %q", pgn)
	}
}
