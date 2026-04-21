package storage

import (
	"cmp"
	"fmt"
	"slices"
	"sort"
	"strings"

	chess "github.com/corentings/chess/v2"
	"github.com/IntermezzoSoftware/Masterboard/internal/masterdb"
)

// GetUnanalyzedGameIDsForPlayer returns IDs of games where any of the given
// player names appear (case-insensitive, white or black) and whose analysis
// is not complete or currently running.
// If limit > 0, at most limit IDs are returned.
func (d *DB) GetUnanalyzedGameIDsForPlayer(playerNames []string, limit int) ([]string, error) {
	if len(playerNames) == 0 {
		return nil, nil
	}

	// Build lowercase versions of the names for case-insensitive matching.
	lower := make([]string, len(playerNames))
	for i, n := range playerNames {
		lower[i] = strings.ToLower(n)
	}

	// Build parameterized IN clause placeholders.
	placeholders := make([]string, len(lower))
	args := make([]any, 0, len(lower)*2+1)
	for i, n := range lower {
		placeholders[i] = "?"
		args = append(args, n)
	}
	// Args order: lower names for white IN, then lower names for black IN.
	args = append(args, args[:len(lower)]...)

	inClause := strings.Join(placeholders, ", ")

	q := fmt.Sprintf(`
		SELECT g.id FROM games g
		LEFT JOIN game_analyses ga ON ga.game_id = g.id
		WHERE (LOWER(g.white) IN (%s) OR LOWER(g.black) IN (%s))
		  AND (ga.status IS NULL OR ga.status NOT IN ('complete', 'running'))`,
		inClause, inClause)

	if limit > 0 {
		q += " LIMIT ?"
		args = append(args, limit)
	}

	rows, err := d.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("GetUnanalyzedGameIDsForPlayer: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("GetUnanalyzedGameIDsForPlayer scan: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// GetPlayerNames returns distinct player names from the games table whose
// names start with prefix (case-insensitive). Results are ordered
// alphabetically. At most limit names are returned (0 = default 20).
func (d *DB) GetPlayerNames(prefix string, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 20
	}
	like := prefix + "%"
	q := `
		SELECT DISTINCT name FROM (
			SELECT white AS name FROM games WHERE LOWER(white) LIKE LOWER(?)
			UNION
			SELECT black AS name FROM games WHERE LOWER(black) LIKE LOWER(?)
		) ORDER BY name LIMIT ?`

	rows, err := d.db.Query(q, like, like, limit)
	if err != nil {
		return nil, fmt.Errorf("GetPlayerNames: %w", err)
	}
	defer rows.Close()

	names := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("GetPlayerNames scan: %w", err)
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

// MasterDB is the subset of masterdb.DB used by GetDeviationPositions.
type MasterDB interface {
	GetPositionStats(fen string) ([]masterdb.MoveStat, error)
}

// DeviationRow represents a position where a player deviated from master
// database theory.
type DeviationRow struct {
	FEN         string   `json:"fen"`
	PlayerMove  string   `json:"playerMove"`  // SAN move the player actually played
	TheoryMoves []string `json:"theoryMoves"` // top-3 SAN moves in the master DB at this position
	Count       int      `json:"count"`       // how many times this deviation occurred
}

// RepertoireDeviationRow represents a position where the player deviated from
// their own prepared repertoire. Parallel to DeviationRow but compares against
// the user's repertoire instead of master DB theory.
type RepertoireDeviationRow struct {
	FEN             string   `json:"fen"`
	PlayerMove      string   `json:"playerMove"`      // SAN the player actually played
	RepertoireMoves []string `json:"repertoireMoves"` // SANs in their repertoire at this position
	Count           int      `json:"count"`
}

const (
	deviationMaxGames  = 500
	deviationMaxPly    = 30
	deviationMinTheory = 100
	deviationRareThreshold = 0.05
	deviationDefaultLimit  = 10
)

// GetDeviationPositions finds positions (up to ply 30) where the given players
// deviated from master database theory. Returns at most limit rows (default 10)
// sorted by count descending.
//
// Returns nil, nil when mdb is nil (master DB not imported).
func GetDeviationPositions(db *DB, mdb MasterDB, playerNames []string, limit int) ([]DeviationRow, error) {
	if mdb == nil {
		return nil, nil
	}
	if len(playerNames) == 0 {
		return []DeviationRow{}, nil
	}
	if limit <= 0 {
		limit = deviationDefaultLimit
	}

	// Build lower-cased name set for side determination.
	nameSet := make(map[string]bool, len(playerNames))
	for _, n := range playerNames {
		nameSet[strings.ToLower(n)] = true
	}

	// Build IN clause for the query.
	ph := strings.Repeat("?,", len(playerNames))
	ph = ph[:len(ph)-1]
	lowers := make([]any, len(playerNames))
	for i, n := range playerNames {
		lowers[i] = strings.ToLower(n)
	}

	// Load at most deviationMaxGames most recent games for these players.
	q := `SELECT g.white, g.black, g.pgn FROM games g
	      WHERE (LOWER(g.white) IN (` + ph + `) OR LOWER(g.black) IN (` + ph + `))
	      ORDER BY g.date DESC, g.created_at DESC
	      LIMIT ?`
	args := append(lowers, lowers...)
	args = append(args, deviationMaxGames)

	rows, err := db.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("GetDeviationPositions games query: %w", err)
	}
	defer rows.Close()

	// deviationKey groups moves by FEN.
	type deviationKey = string // the position FEN
	type moveCount struct {
		san   string
		count int
	}
	// Track: FEN → map[playerMoveSAN]count
	deviationMoves := make(map[deviationKey]map[string]int)

	an := chess.AlgebraicNotation{}

	for rows.Next() {
		var white, black, pgn string
		if err := rows.Scan(&white, &black, &pgn); err != nil {
			return nil, fmt.Errorf("GetDeviationPositions scan: %w", err)
		}

		playerIsWhite := nameSet[strings.ToLower(white)]

		updateFn, parseErr := chess.PGN(strings.NewReader(pgn))
		if parseErr != nil {
			continue
		}
		g := chess.NewGame()
		updateFn(g)
		moves := g.Moves()
		positions := g.Positions()

		for ply := 1; ply <= deviationMaxPly && ply <= len(moves); ply++ {
			// ply 1 = white's first move (positions[0] = starting pos before ply 1 move)
			moveIsWhite := ply%2 == 1
			if moveIsWhite != playerIsWhite {
				continue // not the player's turn
			}

			posIdx := ply - 1 // position before this move
			if posIdx >= len(positions) || posIdx >= len(moves) {
				break
			}

			fen := positions[posIdx].String()
			stats, err := mdb.GetPositionStats(fen)
			if err != nil || len(stats) == 0 {
				continue // position not in master DB
			}

			// Sum total theory games.
			var total int
			for _, s := range stats {
				total += s.Total
			}
			if total < deviationMinTheory {
				continue
			}

			// Encode the player's actual move in SAN.
			playerSAN := an.Encode(positions[posIdx], moves[posIdx])

			// Check if the move appears in theory with >= 5% frequency.
			var inTheory bool
			for _, s := range stats {
				if s.MoveSAN == playerSAN {
					if float64(s.Total)/float64(total) >= deviationRareThreshold {
						inTheory = true
					}
					break
				}
			}
			if inTheory {
				continue
			}

			// Record deviation.
			if deviationMoves[fen] == nil {
				deviationMoves[fen] = make(map[string]int)
			}
			deviationMoves[fen][playerSAN]++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(deviationMoves) == 0 {
		return []DeviationRow{}, nil
	}

	// Build result rows.
	type rowCandidate struct {
		fen        string
		playerMove string
		count      int
	}
	var candidates []rowCandidate
	for fen, moveCounts := range deviationMoves {
		// Pick the most common player move at this position.
		best := moveCount{}
		for san, cnt := range moveCounts {
			if cnt > best.count {
				best.san = san
				best.count = cnt
			}
		}
		// Sum all counts for this position.
		total := 0
		for _, cnt := range moveCounts {
			total += cnt
		}
		candidates = append(candidates, rowCandidate{fen: fen, playerMove: best.san, count: best.count})
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].count > candidates[j].count
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}

	result := make([]DeviationRow, 0, len(candidates))
	for _, c := range candidates {
		stats, err := mdb.GetPositionStats(c.fen)
		if err != nil {
			stats = nil
		}
		var posTotal int
		for _, s := range stats {
			posTotal += s.Total
		}
		theoryMoves := make([]string, 0, 3)
		for _, s := range stats {
			if len(theoryMoves) >= 3 {
				break
			}
			if posTotal > 0 && float64(s.Total)/float64(posTotal) >= deviationRareThreshold {
				theoryMoves = append(theoryMoves, s.MoveSAN)
			}
		}
		result = append(result, DeviationRow{
			FEN:         c.fen,
			PlayerMove:  c.playerMove,
			TheoryMoves: theoryMoves,
			Count:       c.count,
		})
	}
	return result, nil
}

// GetRepertoireDeviations finds positions where the given players deviated from
// their own prepared repertoire. Returns at most limit rows sorted by count desc.
// Returns an empty slice when playerNames is empty or no repertoire moves exist.
func (d *DB) GetRepertoireDeviations(playerNames []string, limit int) ([]RepertoireDeviationRow, error) {
	if len(playerNames) == 0 {
		return []RepertoireDeviationRow{}, nil
	}
	if limit <= 0 {
		limit = deviationDefaultLimit
	}

	repRows, err := d.db.Query(`SELECT from_fen, move_san FROM repertoire_moves`)
	if err != nil {
		return nil, fmt.Errorf("GetRepertoireDeviations repertoire query: %w", err)
	}
	defer repRows.Close()

	type repEntry struct {
		fromFen string
		sans    []string
		sanSet  map[string]struct{}
	}
	repByHash := make(map[int64]*repEntry)
	for repRows.Next() {
		var fromFen, moveSan string
		if err := repRows.Scan(&fromFen, &moveSan); err != nil {
			return nil, fmt.Errorf("GetRepertoireDeviations scan repertoire: %w", err)
		}
		h, herr := masterdb.HashFEN(fromFen)
		if herr != nil {
			continue
		}
		if _, ok := repByHash[h]; !ok {
			repByHash[h] = &repEntry{fromFen: fromFen, sanSet: make(map[string]struct{})}
		}
		e := repByHash[h]
		if _, seen := e.sanSet[moveSan]; !seen {
			e.sanSet[moveSan] = struct{}{}
			e.sans = append(e.sans, moveSan)
		}
	}
	if err := repRows.Err(); err != nil {
		return nil, fmt.Errorf("GetRepertoireDeviations iterate repertoire: %w", err)
	}
	if len(repByHash) == 0 {
		return []RepertoireDeviationRow{}, nil
	}

	hashList := make([]any, 0, len(repByHash))
	for h := range repByHash {
		hashList = append(hashList, h)
	}
	hashPH := strings.Repeat("?,", len(hashList))
	hashPH = hashPH[:len(hashPH)-1]

	lowers := make([]any, len(playerNames))
	for i, n := range playerNames {
		lowers[i] = strings.ToLower(n)
	}
	namePH := strings.Repeat("?,", len(lowers))
	namePH = namePH[:len(namePH)-1]

	args := append(hashList, lowers...)
	args = append(args, lowers...)
	q := `SELECT pgi.position_hash, pgi.move_san, COUNT(*) AS cnt
	      FROM position_game_index pgi
	      JOIN games g ON g.id = pgi.game_id
	      WHERE pgi.position_hash IN (` + hashPH + `)
	        AND (LOWER(g.white) IN (` + namePH + `) OR LOWER(g.black) IN (` + namePH + `))
	      GROUP BY pgi.position_hash, pgi.move_san`

	gameRows, err := d.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("GetRepertoireDeviations game index query: %w", err)
	}
	defer gameRows.Close()

	var result []RepertoireDeviationRow
	for gameRows.Next() {
		var hash int64
		var moveSan string
		var cnt int
		if err := gameRows.Scan(&hash, &moveSan, &cnt); err != nil {
			return nil, fmt.Errorf("GetRepertoireDeviations scan: %w", err)
		}
		rep, ok := repByHash[hash]
		if !ok {
			continue
		}
		inRep := false
		for _, s := range rep.sans {
			if s == moveSan {
				inRep = true
				break
			}
		}
		if !inRep {
			result = append(result, RepertoireDeviationRow{
				FEN:             rep.fromFen,
				PlayerMove:      moveSan,
				RepertoireMoves: rep.sans,
				Count:           cnt,
			})
		}
	}
	if err := gameRows.Err(); err != nil {
		return nil, fmt.Errorf("GetRepertoireDeviations iterate: %w", err)
	}

	// Sort by count descending, then truncate.
	slices.SortFunc(result, func(a, b RepertoireDeviationRow) int {
		return cmp.Compare(b.Count, a.Count)
	})
	if len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}
