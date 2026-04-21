// Package masterdb implements the master game database: a sidecar SQLite file
// (masterboard-positions.db) that indexes large PGN collections for move
// popularity overlays and position-based game lookup.
package masterdb

import (
	"bufio"
	"io"
	"os"
	"strconv"
	"strings"
)

// ParsedGame holds the headers and raw move text extracted from a single PGN game.
// Move text is unparsed — it is passed to EncodeGame for chess-library processing.
type ParsedGame struct {
	White    string
	Black    string
	Result   string // "1-0", "0-1", "1/2-1/2" — games with "*" are skipped
	Date     string
	ECO      string
	EloWhite int
	EloBlack int
	MoveText string // everything after the last header line
}

// ParseFile streams a PGN file and calls fn for each successfully parsed game.
// Errors in individual games are skipped; the file-level error (I/O, etc.) is
// returned. Games with Result="*" are silently dropped.
func ParseFile(path string, fn func(ParsedGame)) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return parseReader(f, fn)
}

// parseReader streams PGN from r and calls fn for each parsed game.
func parseReader(r io.Reader, fn func(ParsedGame)) error {
	scanner := bufio.NewScanner(r)
	// 1 MB buffer — some PGN files have very long lines with embedded clock
	// annotations like { [%clk 1:23:45] } on the move-text line.
	buf := make([]byte, 1024*1024)
	scanner.Buffer(buf, len(buf))

	var (
		headers  []string // accumulated [Key "Value"] lines for current game
		moves    []string // accumulated non-header lines for current game
		inMoves  bool     // true once we've seen the first non-header line
	)

	flush := func() {
		if len(headers) == 0 {
			return
		}
		pg := buildParsedGame(headers, moves)
		headers = headers[:0]
		moves = moves[:0]
		inMoves = false
		if pg.Result == "*" || pg.Result == "" {
			return
		}
		fn(pg)
	}

	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "[") {
			if inMoves {
				// A new header block starts — flush the previous game first.
				flush()
			}
			headers = append(headers, trimmed)
		} else if trimmed == "" {
			if inMoves {
				// Blank line after move text — end of game.
				flush()
			}
			// Blank line between header block and move text is normal — ignore.
		} else {
			// Non-empty, non-header line: move text.
			inMoves = true
			moves = append(moves, trimmed)
		}
	}

	// Flush any trailing game that wasn't followed by a blank line.
	flush()

	return scanner.Err()
}

// buildParsedGame assembles a ParsedGame from accumulated header and move lines.
// Parses [Key "Value"] headers with hand-written byte scanning instead of regex,
// eliminating ~23s CPU of regexp overhead in the import pipeline.
func buildParsedGame(headers, moves []string) ParsedGame {
	pg := ParsedGame{
		MoveText: strings.Join(moves, " "),
	}
	for _, line := range headers {
		key, val := parseHeaderLine(line)
		if key == "" {
			continue
		}
		switch key {
		case "White":
			pg.White = val
		case "Black":
			pg.Black = val
		case "Result":
			pg.Result = val
		case "Date":
			pg.Date = val
		case "ECO":
			pg.ECO = val
		case "WhiteElo":
			pg.EloWhite, _ = strconv.Atoi(val)
		case "BlackElo":
			pg.EloBlack, _ = strconv.Atoi(val)
		}
	}
	return pg
}

// parseHeaderLine extracts the key and value from a PGN header line like
// `[Key "Value"]`. Returns ("", "") if the line is not a valid header.
// Hand-written to avoid regexp overhead (~23s CPU at 1.94M games).
func parseHeaderLine(line string) (key, val string) {
	// Minimum valid: [K "V"]  = 6 chars
	n := len(line)
	if n < 6 || line[0] != '[' || line[n-1] != ']' {
		return "", ""
	}
	// Find space separating key from quoted value.
	sp := strings.IndexByte(line, ' ')
	if sp < 2 {
		return "", ""
	}
	key = line[1:sp]
	// Find opening and closing quotes.
	q1 := sp + 1
	if q1 >= n-1 || line[q1] != '"' {
		return "", ""
	}
	q2 := n - 2 // position of closing quote (before ']')
	if line[q2] != '"' {
		return "", ""
	}
	val = line[q1+1 : q2]
	return key, val
}
