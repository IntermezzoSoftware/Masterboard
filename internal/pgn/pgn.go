// Package pgn provides PGN serialization for repertoire move trees.
package pgn

import (
	"fmt"
	"sort"
	"strings"

	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)

// CompileRepertoire builds a PGN string from a repertoire's move tree.
// Produces a single game with RAV (recursive annotation variations).
// MoveOrder determines main line vs. alternatives; comments and NAGs are preserved.
func CompileRepertoire(rep repertoire.Repertoire, moves []repertoire.RepertoireMove) string {
	byParent := groupByParent(moves)

	var sb strings.Builder
	fmt.Fprintf(&sb, "[Event \"%s\"]\n", escapeTagValue(rep.Name))
	fmt.Fprintf(&sb, "[Site \"Masterboard\"]\n")
	fmt.Fprintf(&sb, "[Date \"????.??.??\"]\n")
	fmt.Fprintf(&sb, "[Round \"-\"]\n")
	if rep.Colour == "white" {
		fmt.Fprintf(&sb, "[White \"%s\"]\n[Black \"?\"]\n", escapeTagValue(rep.Name))
	} else {
		fmt.Fprintf(&sb, "[White \"?\"]\n[Black \"%s\"]\n", escapeTagValue(rep.Name))
	}
	fmt.Fprintf(&sb, "[Result \"*\"]\n\n")

	writeMoves(&sb, byParent, "", 0, false)
	sb.WriteString("*\n")
	return sb.String()
}

// groupByParent indexes moves by their parent ID (empty string for root moves)
// and sorts each group by MoveOrder ascending.
func groupByParent(moves []repertoire.RepertoireMove) map[string][]repertoire.RepertoireMove {
	byParent := make(map[string][]repertoire.RepertoireMove)
	for _, m := range moves {
		key := ""
		if m.ParentID != nil {
			key = *m.ParentID
		}
		byParent[key] = append(byParent[key], m)
	}
	for k := range byParent {
		sort.Slice(byParent[k], func(i, j int) bool {
			return byParent[k][i].MoveOrder < byParent[k][j].MoveOrder
		})
	}
	return byParent
}

// writeMoves recursively writes moves and sub-variations into sb.
// halfMove counts half-moves from the start (0 = White's first move).
// needsNum indicates whether the next Black move must be prefixed with "N...".
func writeMoves(sb *strings.Builder, byParent map[string][]repertoire.RepertoireMove, parentID string, halfMove int, needsNum bool) {
	children := byParent[parentID]
	if len(children) == 0 {
		return
	}

	main := children[0]
	alts := children[1:]
	isWhite := halfMove%2 == 0
	num := halfMove/2 + 1

	// Move number prefix
	if isWhite {
		fmt.Fprintf(sb, "%d. ", num)
	} else if needsNum {
		fmt.Fprintf(sb, "%d... ", num)
	}

	sb.WriteString(main.MoveSAN)

	if main.NAG != nil {
		fmt.Fprintf(sb, " $%d", *main.NAG)
	}
	if main.Comment != "" {
		fmt.Fprintf(sb, " { %s }", strings.TrimSpace(main.Comment))
	}
	sb.WriteString(" ")

	// Sub-variations for alternatives
	for _, alt := range alts {
		sb.WriteString("( ")
		if isWhite {
			fmt.Fprintf(sb, "%d. ", num)
		} else {
			fmt.Fprintf(sb, "%d... ", num)
		}
		sb.WriteString(alt.MoveSAN)
		if alt.NAG != nil {
			fmt.Fprintf(sb, " $%d", *alt.NAG)
		}
		if alt.Comment != "" {
			fmt.Fprintf(sb, " { %s }", strings.TrimSpace(alt.Comment))
		}
		sb.WriteString(" ")
		writeMoves(sb, byParent, alt.ID, halfMove+1, false)
		sb.WriteString(") ")
	}

	// Continue main line; force move number after any alternatives
	writeMoves(sb, byParent, main.ID, halfMove+1, len(alts) > 0)
}

// escapeTagValue escapes backslashes and double-quotes in a PGN tag value.
func escapeTagValue(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return s
}
