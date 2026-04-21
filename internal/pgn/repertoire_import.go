package pgn

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode"

	chess "github.com/corentings/chess/v2"
	"github.com/google/uuid"
	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
)

// ImportChapterAsRepertoireMoves parses a PGN chapter (including variations) and
// returns a depth-first-ordered flat slice of RepertoireMove ready for
// BatchSaveRepertoireMoves. Parents always appear before their children.
func ImportChapterAsRepertoireMoves(chapterPGN, repertoireID string) ([]repertoire.RepertoireMove, error) {
	startFEN := extractPGNHeader(chapterPGN, "FEN")
	if startFEN == "" {
		startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	}

	startPos := new(chess.Position)
	if err := startPos.UnmarshalText([]byte(startFEN)); err != nil {
		return nil, fmt.Errorf("parse starting FEN %q: %w", startFEN, err)
	}

	moveText := extractMoveText(chapterPGN)
	tokens := tokenizePGN(moveText)

	var moves []repertoire.RepertoireMove
	if err := walkTokens(tokens, startPos, nil, repertoireID, &moves); err != nil {
		return nil, err
	}
	return moves, nil
}

// ------- tokenizer -------

type tokenKind int

const (
	tokSAN     tokenKind = iota
	tokNAG
	tokComment
	tokOpenVar
	tokCloseVar
	tokResult
)

type token struct {
	kind    tokenKind
	san     string
	nag     int
	comment string
	shapes  string
}

var reNAG = regexp.MustCompile(`^\$(\d+)$`)
var reCal = regexp.MustCompile(`\[%cal\s+([^\]]+)\]`)
var reCsl = regexp.MustCompile(`\[%csl\s+([^\]]+)\]`)
var reStrip = regexp.MustCompile(`\[%(?:eval|clk)[^\]]*\]`)
var reMoveNum = regexp.MustCompile(`^\d+\.+$`)
var reResult = regexp.MustCompile(`^(?:1-0|0-1|1/2-1/2|\*)$`)

func tokenizePGN(moveText string) []token {
	// Ensure ( and ) are surrounded by spaces so they tokenize independently
	// from adjacent move numbers and SANs (e.g. "(1. d4" → "( 1. d4").
	var sb strings.Builder
	for _, ch := range moveText {
		if ch == '(' || ch == ')' {
			sb.WriteByte(' ')
			sb.WriteRune(ch)
			sb.WriteByte(' ')
		} else {
			sb.WriteRune(ch)
		}
	}
	moveText = sb.String()

	var rawTokens []string
	rest := moveText
	for {
		idx := strings.Index(rest, "{")
		if idx < 0 {
			rawTokens = append(rawTokens, strings.Fields(rest)...)
			break
		}
		rawTokens = append(rawTokens, strings.Fields(rest[:idx])...)
		end := strings.Index(rest[idx:], "}")
		if end < 0 {
			rawTokens = append(rawTokens, strings.Fields(rest[idx:])...)
			break
		}
		rawTokens = append(rawTokens, rest[idx:idx+end+1])
		rest = rest[idx+end+1:]
	}

	var tokens []token
	for _, raw := range rawTokens {
		switch {
		case strings.HasPrefix(raw, "{") && strings.HasSuffix(raw, "}"):
			inner := raw[1 : len(raw)-1]
			tok := token{kind: tokComment}
			tok.shapes = extractShapesJSON(inner)
			tok.comment = cleanComment(inner)
			tokens = append(tokens, tok)
		case raw == "(":
			tokens = append(tokens, token{kind: tokOpenVar})
		case raw == ")":
			tokens = append(tokens, token{kind: tokCloseVar})
		case reResult.MatchString(raw):
			tokens = append(tokens, token{kind: tokResult})
		case reMoveNum.MatchString(raw):
			// skip move numbers
		case reNAG.MatchString(raw):
			var n int
			fmt.Sscanf(raw[1:], "%d", &n)
			tokens = append(tokens, token{kind: tokNAG, nag: n})
		default:
			san, nag := parseSANAnnotation(raw)
			tokens = append(tokens, token{kind: tokSAN, san: san, nag: nag})
		}
	}
	return tokens
}

func parseSANAnnotation(raw string) (san string, nag int) {
	type suffixEntry struct {
		suffix string
		nag    int
	}
	suffixes := []suffixEntry{
		{"!!", 3}, {"??", 4}, {"!?", 5}, {"?!", 6}, {"!", 1}, {"?", 2},
	}
	for _, e := range suffixes {
		if strings.HasSuffix(raw, e.suffix) {
			return strings.TrimSuffix(raw, e.suffix), e.nag
		}
	}
	return raw, 0
}

// ------- comment parsing -------

type drawShape struct {
	Orig  string `json:"orig"`
	Dest  string `json:"dest,omitempty"`
	Brush string `json:"brush"`
}

var brushMap = map[byte]string{'G': "green", 'R': "red", 'B': "blue", 'Y': "yellow"}

func extractShapesJSON(comment string) string {
	var shapes []drawShape

	for _, m := range reCal.FindAllStringSubmatch(comment, -1) {
		for _, entry := range strings.Split(m[1], ",") {
			entry = strings.TrimSpace(entry)
			if len(entry) < 5 {
				continue
			}
			brush := brushMap[entry[0]]
			if brush == "" {
				brush = "green"
			}
			orig := strings.ToLower(entry[1:3])
			dest := strings.ToLower(entry[3:5])
			shapes = append(shapes, drawShape{Orig: orig, Dest: dest, Brush: brush})
		}
	}
	for _, m := range reCsl.FindAllStringSubmatch(comment, -1) {
		for _, entry := range strings.Split(m[1], ",") {
			entry = strings.TrimSpace(entry)
			if len(entry) < 3 {
				continue
			}
			brush := brushMap[entry[0]]
			if brush == "" {
				brush = "green"
			}
			orig := strings.ToLower(entry[1:3])
			shapes = append(shapes, drawShape{Orig: orig, Brush: brush})
		}
	}
	if len(shapes) == 0 {
		return ""
	}
	b, _ := json.Marshal(shapes)
	return string(b)
}

func cleanComment(comment string) string {
	s := reCal.ReplaceAllString(comment, "")
	s = reCsl.ReplaceAllString(s, "")
	s = reStrip.ReplaceAllString(s, "")
	fields := strings.FieldsFunc(s, unicode.IsSpace)
	return strings.Join(fields, " ")
}

// ------- tree walker -------

type walkerFrame struct {
	pos      *chess.Position
	parentID *string
}

type stackEntry struct {
	cur          walkerFrame
	before       walkerFrame
	lastMoveIdx  int
}

func walkTokens(tokens []token, startPos *chess.Position, rootParent *string, repertoireID string, out *[]repertoire.RepertoireMove) error {
	sibOrder := map[string]int{}

	cur := walkerFrame{pos: startPos, parentID: rootParent}
	before := cur

	var stack []stackEntry
	var pendingNAG int
	var pendingComment string
	var pendingShapes string

	parentKey := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}

	// lastMoveIdx tracks the index in *out of the most recently emitted move at
	// the current depth so that post-move NAG/Comment tokens can be retroactively
	// applied to the correct move.
	lastMoveIdx := -1

	for _, tok := range tokens {
		switch tok.kind {
		case tokNAG:
			// NAG follows the move it annotates; patch last emitted move.
			if lastMoveIdx >= 0 {
				n := tok.nag
				(*out)[lastMoveIdx].NAG = &n
			} else {
				pendingNAG = tok.nag
			}
		case tokComment:
			// Comment follows the move it annotates; patch last emitted move.
			if lastMoveIdx >= 0 {
				(*out)[lastMoveIdx].Comment = tok.comment
				(*out)[lastMoveIdx].Shapes = tok.shapes
			} else {
				pendingComment = tok.comment
				pendingShapes = tok.shapes
			}

		case tokSAN:
			before = cur
			pKey := parentKey(cur.parentID)
			order := sibOrder[pKey]
			sibOrder[pKey]++

			mv, err := chess.AlgebraicNotation{}.Decode(cur.pos, tok.san)
			if err != nil {
				return fmt.Errorf("decode SAN %q: %w", tok.san, err)
			}
			nextPos := cur.pos.Update(mv)

			fromFEN := repertoire.PositionFen(cur.pos.String())
			toFEN := repertoire.PositionFen(nextPos.String())
			uci := chess.UCINotation{}.Encode(cur.pos, mv)

			nag := tok.nag
			if pendingNAG != 0 {
				nag = pendingNAG
				pendingNAG = 0
			}

			var nagPtr *int
			if nag != 0 {
				n := nag
				nagPtr = &n
			}

			moveID := uuid.New().String()
			*out = append(*out, repertoire.RepertoireMove{
				ID:           moveID,
				RepertoireID: repertoireID,
				ParentID:     cur.parentID,
				FromFEN:      fromFEN,
				ToFEN:        toFEN,
				MoveSAN:      tok.san,
				MoveUCI:      uci,
				MoveOrder:    order,
				NAG:          nagPtr,
				Comment:      pendingComment,
				Shapes:       pendingShapes,
			})
			pendingComment = ""
			pendingShapes = ""
			lastMoveIdx = len(*out) - 1

			cur = walkerFrame{pos: nextPos, parentID: &moveID}

		case tokOpenVar:
			stack = append(stack, stackEntry{cur: cur, before: before, lastMoveIdx: lastMoveIdx})
			cur = before
			lastMoveIdx = -1

		case tokCloseVar:
			if len(stack) == 0 {
				continue
			}
			entry := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			cur = entry.cur
			before = entry.before
			lastMoveIdx = entry.lastMoveIdx

		case tokResult:
			// end of game/variation
		}
	}
	return nil
}

// extractPGNHeader is a package-local copy to avoid circular import (pgn → importer → pgn).
func extractPGNHeader(pgn, tag string) string {
	prefix := "[" + tag + " \""
	for _, line := range strings.Split(pgn, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, prefix) && strings.HasSuffix(line, "\"]") {
			return line[len(prefix) : len(line)-2]
		}
	}
	return ""
}

func extractMoveText(pgn string) string {
	lines := strings.Split(pgn, "\n")
	var sb strings.Builder
	inMoves := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if inMoves {
			sb.WriteString(line)
			sb.WriteByte(' ')
		} else if line == "" {
			inMoves = true
		}
	}
	return sb.String()
}
