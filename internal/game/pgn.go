package game

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
)

var (
	// headerRe matches PGN header tag-pairs: [Key "Value"]
	headerRe = regexp.MustCompile(`\[(\w+)\s+"([^"]*)"\]`)

	// normHdrRe strips all [Header "value"] blocks from move text.
	normHdrRe = regexp.MustCompile(`\[[^\]]*\]`)
)

func ParsePGN(pgn string) ([]GameInput, error) {
	games := splitGames(pgn)
	result := make([]GameInput, 0, len(games))
	for _, g := range games {
		g = strings.TrimSpace(g)
		if g == "" {
			continue
		}
		result = append(result, parseGame(g))
	}
	return result, nil
}

// parseGame extracts headers from a single PGN game string and returns a GameInput.
func parseGame(pgn string) GameInput {
	headers := extractHeaders(pgn)

	// Prefer UTCDate (Lichess) over Date; fall back to Date.
	date := headers["UTCDate"]
	if date == "" {
		date = headers["Date"]
	}

	// Append UTCTime (Lichess) or Time (Chess.com) when available so games
	// played on the same day sort in the correct order. The combined value
	// "YYYY.MM.DD HH:MM:SS" sorts correctly as a string and the UI strips the
	// time portion for display.
	timeVal := headers["UTCTime"]
	if timeVal == "" {
		timeVal = headers["Time"]
	}
	if timeVal != "" && date != "" {
		date = date + " " + timeVal
	}

	opening := headers["Opening"]
	if variation := headers["Variation"]; variation != "" {
		if opening != "" {
			opening = opening + ", " + variation
		} else {
			opening = variation
		}
	}

	var whiteElo, blackElo *int
	if s := headers["WhiteElo"]; s != "" {
		if v, err := strconv.Atoi(s); err == nil {
			whiteElo = &v
		}
	}
	if s := headers["BlackElo"]; s != "" {
		if v, err := strconv.Atoi(s); err == nil {
			blackElo = &v
		}
	}

	input := GameInput{
		White:       headers["White"],
		Black:       headers["Black"],
		WhiteElo:    whiteElo,
		BlackElo:    blackElo,
		Result:      headers["Result"],
		Date:        date,
		Event:       headers["Event"],
		Site:        headers["Site"],
		Round:       headers["Round"],
		ECO:         headers["ECO"],
		Opening:     opening,
		TimeControl: headers["TimeControl"],
		Source:      "pgn_import",
		// SourceID is a content fingerprint so re-importing the same PGN is a no-op.
		SourceID: contentHash(pgn, headers["White"], headers["Black"], date),
		PGN:      pgn,
	}
	if input.Result == "" {
		input.Result = "*"
	}
	return input
}

// extractHeaders returns all PGN tag-pair values from a game string.
func extractHeaders(pgn string) map[string]string {
	headers := make(map[string]string)
	for _, match := range headerRe.FindAllStringSubmatch(pgn, -1) {
		headers[match[1]] = match[2]
	}
	return headers
}

// splitGames splits a multi-game PGN string into individual game strings.
// Games are separated by a blank line followed by a new [Event tag.
func splitGames(pgn string) []string {
	// Normalise line endings.
	pgn = strings.ReplaceAll(pgn, "\r\n", "\n")
	pgn = strings.ReplaceAll(pgn, "\r", "\n")

	var games []string
	var current strings.Builder

	lines := strings.Split(pgn, "\n")
	for i, line := range lines {
		if i > 0 && strings.HasPrefix(strings.TrimSpace(line), "[Event ") {
			// Check if the previous line was blank, indicating a game boundary.
			prev := strings.TrimSpace(lines[i-1])
			if prev == "" {
				if current.Len() > 0 {
					games = append(games, strings.TrimSpace(current.String()))
					current.Reset()
				}
			}
		}
		current.WriteString(line)
		current.WriteByte('\n')
	}
	if current.Len() > 0 {
		if g := strings.TrimSpace(current.String()); g != "" {
			games = append(games, g)
		}
	}
	if len(games) == 0 && strings.TrimSpace(pgn) != "" {
		games = append(games, strings.TrimSpace(pgn))
	}
	return games
}

// ExtractHeader returns a single header value from a PGN string, or "" if not found.
func ExtractHeader(pgn, tag string) string {
	return extractHeaders(pgn)[tag]
}

// editableTags lists the 10 PGN tags that UpdateHeaders manages, in insertion order.
var editableTags = []string{
	"White", "Black", "WhiteElo", "BlackElo",
	"Result", "Date", "Event", "Site", "Round", "ECO",
}

// UpdateHeaders rewrites the editable PGN tag-pairs in pgn using the values
// from m. Tags present in the PGN are replaced in-place; missing tags are
// appended after the last existing tag-pair line. WhiteElo/BlackElo are omitted
// entirely when the corresponding pointer is nil. All other tags and the move
// text are preserved unchanged.
func UpdateHeaders(pgn string, m GameMetadataInput) string {
	// Normalise line endings.
	pgn = strings.ReplaceAll(pgn, "\r\n", "\n")
	pgn = strings.ReplaceAll(pgn, "\r", "\n")

	// Split into header block and move text on the blank line separator.
	headerBlock, moveText, hasSep := strings.Cut(pgn, "\n\n")
	if !hasSep {
		// No blank-line separator — treat the whole string as the header block.
		headerBlock = pgn
		moveText = ""
	}

	// Build a map of tag name → formatted tag-pair line for each editable tag.
	// Nil Elo pointers produce an empty string, meaning "remove this tag".
	tagLine := func(tag string) string {
		switch tag {
		case "White":
			return `[White "` + m.White + `"]`
		case "Black":
			return `[Black "` + m.Black + `"]`
		case "WhiteElo":
			if m.WhiteElo == nil {
				return ""
			}
			return `[WhiteElo "` + strconv.Itoa(*m.WhiteElo) + `"]`
		case "BlackElo":
			if m.BlackElo == nil {
				return ""
			}
			return `[BlackElo "` + strconv.Itoa(*m.BlackElo) + `"]`
		case "Result":
			return `[Result "` + m.Result + `"]`
		case "Date":
			return `[Date "` + m.Date + `"]`
		case "Event":
			return `[Event "` + m.Event + `"]`
		case "Site":
			return `[Site "` + m.Site + `"]`
		case "Round":
			return `[Round "` + m.Round + `"]`
		case "ECO":
			return `[ECO "` + m.ECO + `"]`
		}
		return ""
	}

	// editableSet is a quick-lookup set of the 10 managed tag names.
	editableSet := make(map[string]bool, len(editableTags))
	for _, t := range editableTags {
		editableSet[t] = true
	}

	// Process existing header lines.
	lines := strings.Split(headerBlock, "\n")
	seen := make(map[string]bool, len(editableTags))
	var out []string
	for _, line := range lines {
		m2 := headerRe.FindStringSubmatch(line)
		if m2 != nil && editableSet[m2[1]] {
			tag := m2[1]
			seen[tag] = true
			replacement := tagLine(tag)
			if replacement != "" {
				out = append(out, replacement)
			}
			// If replacement is "" (nil Elo), the tag is dropped.
		} else {
			out = append(out, line)
		}
	}

	// Append any editable tags that were not found in the original header.
	for _, tag := range editableTags {
		if !seen[tag] {
			line := tagLine(tag)
			if line != "" {
				out = append(out, line)
			}
		}
	}

	newHeader := strings.Join(out, "\n")
	if hasSep {
		return newHeader + "\n\n" + moveText
	}
	return newHeader
}

// hashFields SHA-256s a pipe-joined list of strings and returns the first 8
// bytes as 16 hex characters. Negligible collision probability for game dedup.
func hashFields(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(h[:8])
}

// contentHash computes a short SHA-256 fingerprint for a game based on its
// players, date, and normalized mainline move sequence. Used as a source_id
// for pgn_import games so that re-importing the same PGN file is idempotent.
func contentHash(pgn, white, black, date string) string {
	if len(date) > 10 {
		date = date[:10]
	}
	return hashFields(strings.ToLower(white), strings.ToLower(black), date, normalizeMoves(pgn))
}

// GameHash computes a content fingerprint for all five fields that together
// uniquely identify a game: white, black, date (first 10 chars), result, and
// the normalized mainline move sequence. Used to detect true duplicates
// regardless of source, annotations, or variations.
//
// Intentionally separate from contentHash (which omits result and is used as
// SourceID for pgn_import re-import dedup) so the two hash spaces never collide.
func GameHash(pgn, white, black, date, result string) string {
	if len(date) > 10 {
		date = date[:10]
	}
	return hashFields(strings.ToLower(white), strings.ToLower(black), date, result, normalizeMoves(pgn))
}

// normalizeMoves extracts the mainline SAN move sequence from a PGN string,
// strips move numbers, results, NAGs, and annotation suffixes, and joins
// the tokens with a single space. The result is deterministic regardless of
// comments, board arrows, or other annotations.
func normalizeMoves(pgn string) string {
	// Strip all [Header "value"] pairs.
	moveText := normHdrRe.ReplaceAllString(pgn, "")

	var tokens []string
	inComment := false
	variationDepth := 0
	var token strings.Builder

	flush := func() {
		if token.Len() == 0 {
			return
		}
		t := token.String()
		token.Reset()
		// Skip move numbers (1. or 1...) — byte scan, no regex.
		if isMoveNumberToken(t) {
			return
		}
		// Skip result tokens
		if t == "*" || t == "1-0" || t == "0-1" || t == "1/2-1/2" {
			return
		}
		// Skip NAGs ($1, $2, …)
		if strings.HasPrefix(t, "$") {
			return
		}
		// Strip annotation suffixes (!, ?, +, #)
		t = strings.TrimRight(t, "!?+#")
		if t != "" {
			tokens = append(tokens, strings.ToLower(t))
		}
	}

	for _, ch := range moveText {
		if inComment {
			if ch == '}' {
				inComment = false
			}
			continue
		}
		switch ch {
		case '{':
			inComment = true
		case '(':
			variationDepth++
		case ')':
			if variationDepth > 0 {
				variationDepth--
			}
		case ' ', '\n', '\r', '\t':
			if variationDepth == 0 {
				flush()
			}
		default:
			if variationDepth == 0 {
				token.WriteRune(ch)
			}
		}
	}
	flush()

	return strings.Join(tokens, " ")
}

// isMoveNumberToken returns true if tok is a PGN move-number token like "1."
// or "12...". Uses a byte scan instead of a regexp for efficiency.
func isMoveNumberToken(tok string) bool {
	if len(tok) < 2 {
		return false
	}
	if tok[len(tok)-1] != '.' {
		return false
	}
	i := 0
	for i < len(tok) && tok[i] >= '0' && tok[i] <= '9' {
		i++
	}
	if i == 0 {
		return false
	}
	for i < len(tok) {
		if tok[i] != '.' {
			return false
		}
		i++
	}
	return true
}
