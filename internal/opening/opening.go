// Package opening provides ECO (Encyclopaedia of Chess Openings) classification
// for chess positions and games.
//
// The ECO dataset is the Lichess chess-openings data (CC0) embedded at compile
// time. Each entry maps a board position (EPD) to its ECO code and opening name.
// Lookups are O(1) and transposition-aware: any move order that reaches the same
// position returns the same classification.
package opening

import (
	"bytes"
	"embed"
	"encoding/csv"
	"fmt"
	"io"
	"strings"

	chess "github.com/corentings/chess/v2"
)

//go:embed data/eco_lichess.tsv
var ecoData embed.FS

type Entry struct {
	ECO   string `json:"eco"`
	Name  string `json:"name"`
	Moves string `json:"moves"` // canonical PGN, e.g. "1. Nh3 d5 2. g3 e5 3. f4"
	EPD   string `json:"epd"`  // 4-field position string
}

type Classifier struct {
	byEPD           map[string]*Entry
	byECOAndName    map[string]*Entry
	allByECOAndName map[string][]*Entry
	byECOBase       map[string]*Entry
	allEntries      []*Entry

	// prefix tree maps
	parentByKey   map[string]*Entry
	childrenByKey map[string][]*Entry
}

func NewClassifier() (*Classifier, error) {
	data, err := ecoData.ReadFile("data/eco_lichess.tsv")
	if err != nil {
		return nil, fmt.Errorf("opening: failed to read embedded ECO data: %w", err)
	}

	r := csv.NewReader(bytes.NewReader(data))
	r.Comma = '\t'
	r.LazyQuotes = true

	// skip header row
	if _, err := r.Read(); err != nil {
		return nil, fmt.Errorf("opening: failed to read ECO TSV header: %w", err)
	}

	c := &Classifier{
		byEPD:           make(map[string]*Entry, 3400),
		byECOAndName:    make(map[string]*Entry, 3400),
		allByECOAndName: make(map[string][]*Entry, 3400),
		byECOBase:       make(map[string]*Entry, 500),
	}

	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil || len(row) < 5 {
			continue
		}
		// TSV columns: eco, name, pgn, uci, epd
		epd := strings.TrimSpace(row[4])
		if epd == "" {
			continue
		}
		e := &Entry{ECO: row[0], Name: row[1], Moves: row[2], EPD: epd}
		c.byEPD[epd] = e
		nameKey := row[0] + "|" + row[1]
		c.byECOAndName[nameKey] = e
		c.allByECOAndName[nameKey] = append(c.allByECOAndName[nameKey], e)
		c.allEntries = append(c.allEntries, e)
		// Keep the shallowest (fewest-move) entry per ECO code so that
		// ECO-grouped stats can navigate to a position all games passed through.
		if cur := c.byECOBase[row[0]]; cur == nil || len(tokenizeMoves(row[2])) < len(tokenizeMoves(cur.Moves)) {
			c.byECOBase[row[0]] = e
		}
	}
	c.buildPrefixTree()
	return c, nil
}

// normalizeEPD strips the halfmove and fullmove counters from a full FEN string
// and normalizes the en-passant field to "-", producing the 4-field EPD used as
// the map key. En-passant is normalized because some FEN generators include the
// ep square after any double pawn push (e.g. "e3"), while the Lichess TSV only
// includes it when an enemy pawn can actually capture — causing false mismatches.
func normalizeEPD(fen string) string {
	parts := strings.Fields(fen)
	if len(parts) >= 4 {
		parts[3] = "-"
		return strings.Join(parts[:4], " ")
	}
	return fen
}

func (c *Classifier) Classify(fen string) *Entry {
	return c.byEPD[normalizeEPD(fen)]
}

// LookupByECO returns the shallowest Entry for the given ECO code — the entry
// with the fewest moves, which corresponds to the canonical base position that
// all games classified under this ECO code passed through.
// Returns nil if the ECO code is not found.
func (c *Classifier) LookupByECO(eco string) *Entry {
	return c.byECOBase[eco]
}

// LookupByECOAndName returns the Entry for the given ECO code and opening name,
// or nil if not found. This is useful for retrieving the canonical move sequence
// and position for a named opening (e.g. from statistics or reports data).
func (c *Classifier) LookupByECOAndName(eco, name string) *Entry {
	return c.byECOAndName[eco+"|"+name]
}

// LookupAllByECOAndName returns every entry for the given ECO code and opening
// name, ordered shallowest first (fewest moves). Multiple entries arise when the
// same named opening can be reached via different move orders, or when
// successive positions along one line share the same name.
func (c *Classifier) LookupAllByECOAndName(eco, name string) []*Entry {
	return c.allByECOAndName[eco+"|"+name]
}

// ClassifyGame replays the mainline of a PGN string and returns the deepest
// ECO entry matched along the way — i.e. the most specific opening name
// reached before the game leaves book.
// Returns nil if no position in the game is in the opening book, or if the
// PGN cannot be parsed.
func (c *Classifier) ClassifyGame(pgn string) *Entry {
	updateFn, err := chess.PGN(strings.NewReader(pgn))
	if err != nil {
		return nil
	}
	g := chess.NewGame()
	updateFn(g)

	var deepest *Entry
	for _, pos := range g.Positions() {
		if e := c.Classify(pos.String()); e != nil {
			deepest = e
		}
	}
	return deepest
}

func (c *Classifier) Parent(eco, name string) *Entry {
	return c.parentByKey[eco+"|"+name]
}

// Children returns the direct children of the entry in the opening prefix tree —
// openings whose canonical sequence extends this entry's by at least one move,
// with no other book entry in between.
func (c *Classifier) Children(eco, name string) []*Entry {
	return c.childrenByKey[eco+"|"+name]
}

func (c *Classifier) Descendants(eco, name string) []*Entry {
	var result []*Entry
	var collect func(key string)
	collect = func(key string) {
		for _, child := range c.childrenByKey[key] {
			result = append(result, child)
			collect(child.ECO + "|" + child.Name)
		}
	}
	collect(eco + "|" + name)
	return result
}

func (c *Classifier) Ancestors(eco, name string) []*Entry {
	var result []*Entry
	key := eco + "|" + name
	for {
		p := c.parentByKey[key]
		if p == nil {
			break
		}
		result = append(result, p)
		key = p.ECO + "|" + p.Name
	}
	return result
}

