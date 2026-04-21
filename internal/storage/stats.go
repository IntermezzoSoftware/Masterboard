package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	chess "github.com/corentings/chess/v2"
	"github.com/IntermezzoSoftware/Masterboard/internal/analysis"
	"github.com/IntermezzoSoftware/Masterboard/internal/game"
)

// StatsFilters holds the optional filtering parameters for personal statistics.
type StatsFilters struct {
	PlayerNames          []string // case-insensitive OR match on white/black
	FolderID             string
	CollectionID         string
	ExcludeFolderIDs     []string // games in these folders are omitted
	ExcludeCollectionIDs []string // games tagged with any of these collections are omitted
}

// ColourResults holds W/D/L counts from the player's perspective as one colour.
type ColourResults struct {
	Wins   int `json:"wins"`
	Draws  int `json:"draws"`
	Losses int `json:"losses"`
	Total  int `json:"total"`
}

// TimeControlResults holds W/D/L for one time-control category.
type TimeControlResults struct {
	Category string        `json:"category"` // bullet/blitz/rapid/classical/other
	Results  ColourResults `json:"results"`
}

// OpeningRow holds per-ECO aggregate performance from the player's perspective.
type OpeningRow struct {
	ECO         string  `json:"eco"`
	Opening     string  `json:"opening"`
	Games       int     `json:"games"`
	WinPct      float64 `json:"winPct"`
	DrawPct     float64 `json:"drawPct"`
	LossPct     float64 `json:"lossPct"`
	AsWhite     int     `json:"asWhite"`
	AsBlack     int     `json:"asBlack"`
	WhiteWins   int     `json:"whiteWins"`
	WhiteDraws  int     `json:"whiteDraws"`
	BlackWins   int     `json:"blackWins"`
	BlackDraws  int     `json:"blackDraws"`
}

// PlayerStats is the metadata-tier payload (no engine analysis required).
type PlayerStats struct {
	TotalGames    int                  `json:"totalGames"`
	AnalyzedGames int                  `json:"analyzedGames"`
	AsWhite       ColourResults        `json:"asWhite"`
	AsBlack       ColourResults        `json:"asBlack"`
	ByTimeControl []TimeControlResults `json:"byTimeControl"`
	ByOpening     []OpeningRow         `json:"byOpening"`
}

// statsBaseWhere builds a WHERE fragment + args that restrict to the given
// folder/collection. Player name filtering is handled separately because the
// syntax differs by query (side-specific vs. either side).
func statsBaseWhere(f StatsFilters) (joins string, where []string, args []any) {
	where = []string{"1=1"}
	if f.FolderID != "" {
		where = append(where, "g.folder_id = ?")
		args = append(args, f.FolderID)
	}
	if f.CollectionID != "" {
		joins += " JOIN game_collections gc ON gc.game_id = g.id"
		where = append(where, "gc.collection_id = ?")
		args = append(args, f.CollectionID)
	}
	if len(f.ExcludeFolderIDs) > 0 {
		ph := strings.Repeat("?,", len(f.ExcludeFolderIDs))
		ph = ph[:len(ph)-1]
		// IS NULL guard: unfiled games (folder_id NULL) are never excluded.
		where = append(where, "(g.folder_id IS NULL OR g.folder_id NOT IN ("+ph+"))")
		for _, id := range f.ExcludeFolderIDs {
			args = append(args, id)
		}
	}
	if len(f.ExcludeCollectionIDs) > 0 {
		ph := strings.Repeat("?,", len(f.ExcludeCollectionIDs))
		ph = ph[:len(ph)-1]
		where = append(where, "NOT EXISTS (SELECT 1 FROM game_collections exc WHERE exc.game_id = g.id AND exc.collection_id IN ("+ph+"))")
		for _, id := range f.ExcludeCollectionIDs {
			args = append(args, id)
		}
	}
	return joins, where, args
}

// playerINClause builds an IN clause string and lowercased args slice for
// matching LOWER(col) against the given player names.
func playerINClause(names []string) (placeholder string, lowers []any) {
	lowers = make([]any, len(names))
	for i, n := range names {
		lowers[i] = strings.ToLower(n)
	}
	ph := strings.Repeat("?,", len(lowers))
	return ph[:len(ph)-1], lowers
}

// GetPlayerStats returns the metadata-tier player statistics.
func (d *DB) GetPlayerStats(f StatsFilters) (*PlayerStats, error) {
	joins, where, baseArgs := statsBaseWhere(f)

	// Add player filter (either side) for total count.
	whereAll := append(where[:len(where):len(where)], "1=1")
	allArgs := append(baseArgs[:len(baseArgs):len(baseArgs)], nil)
	allArgs = allArgs[:len(allArgs)-1]
	if len(f.PlayerNames) > 0 {
		ph, lowers := playerINClause(f.PlayerNames)
		whereAll = append(whereAll[:len(whereAll)-1], "(LOWER(g.white) IN ("+ph+") OR LOWER(g.black) IN ("+ph+"))")
		allArgs = append(baseArgs[:len(baseArgs):len(baseArgs)], lowers...)
		allArgs = append(allArgs, lowers...)
	} else {
		allArgs = baseArgs
		whereAll = where
	}
	whereAllStr := strings.Join(whereAll, " AND ")

	var stats PlayerStats

	// 1. Total games.
	if err := d.db.QueryRow(
		`SELECT COUNT(*) FROM games g`+joins+` WHERE `+whereAllStr, allArgs...,
	).Scan(&stats.TotalGames); err != nil {
		return nil, fmt.Errorf("total games: %w", err)
	}

	// 2. Analyzed games.
	if err := d.db.QueryRow(
		`SELECT COUNT(*) FROM games g`+joins+` JOIN game_analyses ga ON ga.game_id = g.id WHERE `+whereAllStr+` AND ga.status = 'complete'`,
		allArgs...,
	).Scan(&stats.AnalyzedGames); err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("analyzed games: %w", err)
	}

	// 3. Results as White and as Black.
	white, err := d.colourResults(f, joins, where, baseArgs, "white")
	if err != nil {
		return nil, err
	}
	stats.AsWhite = white

	black, err := d.colourResults(f, joins, where, baseArgs, "black")
	if err != nil {
		return nil, err
	}
	stats.AsBlack = black

	// 4. Results by time control.
	tc, err := d.timeControlResults(f, joins, where, baseArgs)
	if err != nil {
		return nil, err
	}
	stats.ByTimeControl = tc

	// 5. Opening performance by ECO.
	openings, err := d.openingPerformance(f, joins, where, baseArgs)
	if err != nil {
		return nil, err
	}
	stats.ByOpening = openings

	return &stats, nil
}

// colourResults returns W/D/L for games where the player appeared on the given
// side ("white" or "black").
func (d *DB) colourResults(f StatsFilters, joins string, baseWhere []string, baseArgs []any, side string) (ColourResults, error) {
	where := append(baseWhere[:len(baseWhere):len(baseWhere)], "1=1")
	args := append(baseArgs[:len(baseArgs):len(baseArgs)], nil)
	args = args[:len(args)-1]

	if len(f.PlayerNames) > 0 {
		ph, lowers := playerINClause(f.PlayerNames)
		where[len(where)-1] = "LOWER(g." + side + ") IN (" + ph + ")"
		args = append(baseArgs[:len(baseArgs):len(baseArgs)], lowers...)
	} else {
		where = baseWhere
		args = baseArgs
	}

	rows, err := d.db.Query(
		`SELECT g.result, COUNT(*) FROM games g`+joins+` WHERE `+strings.Join(where, " AND ")+` GROUP BY g.result`,
		args...,
	)
	if err != nil {
		return ColourResults{}, fmt.Errorf("colour results (%s): %w", side, err)
	}
	defer rows.Close()

	var cr ColourResults
	for rows.Next() {
		var result string
		var count int
		if err := rows.Scan(&result, &count); err != nil {
			return ColourResults{}, fmt.Errorf("scan colour result: %w", err)
		}
		cr.Total += count
		switch {
		case result == "1-0" && side == "white":
			cr.Wins += count
		case result == "0-1" && side == "black":
			cr.Wins += count
		case result == "1/2-1/2":
			cr.Draws += count
		default:
			cr.Losses += count
		}
	}
	return cr, rows.Err()
}

// timeControlResults returns W/D/L grouped by time-control category.
func (d *DB) timeControlResults(f StatsFilters, joins string, baseWhere []string, baseArgs []any) ([]TimeControlResults, error) {
	where := baseWhere
	args := baseArgs

	if len(f.PlayerNames) > 0 {
		ph, lowers := playerINClause(f.PlayerNames)
		where = append(baseWhere[:len(baseWhere):len(baseWhere)],
			"(LOWER(g.white) IN ("+ph+") OR LOWER(g.black) IN ("+ph+"))")
		args = append(baseArgs[:len(baseArgs):len(baseArgs)], lowers...)
		args = append(args, lowers...)
	}

	rows, err := d.db.Query(
		`SELECT g.time_control, g.result, g.white, g.black FROM games g`+joins+` WHERE `+strings.Join(where, " AND "),
		args...,
	)
	if err != nil {
		return nil, fmt.Errorf("time control query: %w", err)
	}
	defer rows.Close()

	nameSet := make(map[string]bool, len(f.PlayerNames))
	for _, n := range f.PlayerNames {
		nameSet[strings.ToLower(n)] = true
	}

	type bucket struct{ wins, draws, losses, total int }
	buckets := make(map[string]*bucket)

	for rows.Next() {
		var tc, result, white, black string
		if err := rows.Scan(&tc, &result, &white, &black); err != nil {
			return nil, fmt.Errorf("scan tc row: %w", err)
		}
		cat := game.CategorizeTimeControl(tc)
		if _, ok := buckets[cat]; !ok {
			buckets[cat] = &bucket{}
		}
		b := buckets[cat]
		b.total++

		isWhite := len(nameSet) == 0 || nameSet[strings.ToLower(white)]
		isBlack := len(nameSet) > 0 && nameSet[strings.ToLower(black)]

		switch result {
		case "1-0":
			if isWhite {
				b.wins++
			} else if isBlack {
				b.losses++
			}
		case "0-1":
			if isBlack {
				b.wins++
			} else if isWhite {
				b.losses++
			}
		case "1/2-1/2":
			b.draws++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	order := []string{"bullet", "blitz", "rapid", "classical", "other"}
	var result []TimeControlResults
	for _, cat := range order {
		if b, ok := buckets[cat]; ok && b.total > 0 {
			result = append(result, TimeControlResults{
				Category: cat,
				Results:  ColourResults{Wins: b.wins, Draws: b.draws, Losses: b.losses, Total: b.total},
			})
		}
	}
	return result, nil
}

// openingPerformance returns per-ECO stats from the player's perspective,
// sorted by number of games descending.
func (d *DB) openingPerformance(f StatsFilters, joins string, baseWhere []string, baseArgs []any) ([]OpeningRow, error) {
	where := append(baseWhere[:len(baseWhere):len(baseWhere)], "g.eco != ''", "g.eco != '?'")
	args := baseArgs[:len(baseArgs):len(baseArgs)]

	var winExpr, asWhiteExpr, asBlackExpr string
	var extraArgs []any

	var whiteWinsExpr, whiteDrawsExpr, blackWinsExpr, blackDrawsExpr string

	if len(f.PlayerNames) > 0 {
		ph, lowers := playerINClause(f.PlayerNames)
		// Player filter for WHERE.
		where = append(where, "(LOWER(g.white) IN ("+ph+") OR LOWER(g.black) IN ("+ph+"))")
		// player_wins expression: white in names AND 1-0, OR black in names AND 0-1.
		winExpr = `SUM(CASE WHEN (LOWER(g.white) IN (` + ph + `) AND g.result = '1-0')
			OR (LOWER(g.black) IN (` + ph + `) AND g.result = '0-1') THEN 1 ELSE 0 END)`
		asWhiteExpr = `SUM(CASE WHEN LOWER(g.white) IN (` + ph + `) THEN 1 ELSE 0 END)`
		asBlackExpr = `SUM(CASE WHEN LOWER(g.black) IN (` + ph + `) THEN 1 ELSE 0 END)`
		whiteWinsExpr = `SUM(CASE WHEN LOWER(g.white) IN (` + ph + `) AND g.result = '1-0' THEN 1 ELSE 0 END)`
		whiteDrawsExpr = `SUM(CASE WHEN LOWER(g.white) IN (` + ph + `) AND g.result = '1/2-1/2' THEN 1 ELSE 0 END)`
		blackWinsExpr = `SUM(CASE WHEN LOWER(g.black) IN (` + ph + `) AND g.result = '0-1' THEN 1 ELSE 0 END)`
		blackDrawsExpr = `SUM(CASE WHEN LOWER(g.black) IN (` + ph + `) AND g.result = '1/2-1/2' THEN 1 ELSE 0 END)`

		// extraArgs: WHERE filter (2×), winExpr (2×), asWhiteExpr (1×), asBlackExpr (1×),
		// whiteWinsExpr (1×), whiteDrawsExpr (1×), blackWinsExpr (1×), blackDrawsExpr (1×).
		extraArgs = append(extraArgs, lowers...) // WHERE white IN
		extraArgs = append(extraArgs, lowers...) // WHERE black IN
		extraArgs = append(extraArgs, lowers...) // win white IN
		extraArgs = append(extraArgs, lowers...) // win black IN
		extraArgs = append(extraArgs, lowers...) // asWhite IN
		extraArgs = append(extraArgs, lowers...) // asBlack IN
		extraArgs = append(extraArgs, lowers...) // whiteWins IN
		extraArgs = append(extraArgs, lowers...) // whiteDraws IN
		extraArgs = append(extraArgs, lowers...) // blackWins IN
		extraArgs = append(extraArgs, lowers...) // blackDraws IN
	} else {
		winExpr = `SUM(CASE WHEN g.result = '1-0' THEN 1 ELSE 0 END)`
		asWhiteExpr = `COUNT(*)`
		asBlackExpr = `0`
		whiteWinsExpr = `SUM(CASE WHEN g.result = '1-0' THEN 1 ELSE 0 END)`
		whiteDrawsExpr = `SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END)`
		blackWinsExpr = `0`
		blackDrawsExpr = `0`
	}

	q := `SELECT g.eco, MAX(g.opening),
		` + winExpr + ` AS player_wins,
		SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws,
		` + asWhiteExpr + ` AS as_white,
		` + asBlackExpr + ` AS as_black,
		` + whiteWinsExpr + ` AS white_wins,
		` + whiteDrawsExpr + ` AS white_draws,
		` + blackWinsExpr + ` AS black_wins,
		` + blackDrawsExpr + ` AS black_draws,
		COUNT(*) AS total
	FROM games g` + joins + `
	WHERE ` + strings.Join(where, " AND ") + `
	GROUP BY g.eco
	ORDER BY total DESC`

	// Combine: baseArgs first, then extraArgs for the SELECT expressions.
	allArgs := append(args, extraArgs...)

	rows, err := d.db.Query(q, allArgs...)
	if err != nil {
		return nil, fmt.Errorf("opening performance: %w", err)
	}
	defer rows.Close()

	var result []OpeningRow
	for rows.Next() {
		var row OpeningRow
		var playerWins, draws, asWhite, asBlack, whiteWins, whiteDraws, blackWins, blackDraws, total int
		if err := rows.Scan(&row.ECO, &row.Opening, &playerWins, &draws, &asWhite, &asBlack,
			&whiteWins, &whiteDraws, &blackWins, &blackDraws, &total); err != nil {
			return nil, fmt.Errorf("scan opening row: %w", err)
		}
		if total == 0 {
			continue
		}
		losses := total - playerWins - draws
		if losses < 0 {
			losses = 0
		}
		row.Games = total
		row.AsWhite = asWhite
		row.AsBlack = asBlack
		row.WhiteWins = whiteWins
		row.WhiteDraws = whiteDraws
		row.BlackWins = blackWins
		row.BlackDraws = blackDraws
		row.WinPct = float64(playerWins) / float64(total) * 100
		row.DrawPct = float64(draws) / float64(total) * 100
		row.LossPct = float64(losses) / float64(total) * 100
		result = append(result, row)
	}
	return result, rows.Err()
}

// GetPlayerVariationStats returns per-variation (ECO + opening name) stats,
// one row per distinct named variation played by the player.
func (d *DB) GetPlayerVariationStats(f StatsFilters) ([]OpeningRow, error) {
	joins, where, baseArgs := statsBaseWhere(f)
	return d.openingVariationPerformance(f, joins, where, baseArgs)
}

// openingVariationPerformance is like openingPerformance but groups by
// g.eco AND g.opening, giving one row per distinct named variation.
func (d *DB) openingVariationPerformance(f StatsFilters, joins string, baseWhere []string, baseArgs []any) ([]OpeningRow, error) {
	where := append(baseWhere[:len(baseWhere):len(baseWhere)], "g.eco != ''", "g.eco != '?'", "g.opening != ''", "g.opening != '?'")
	args := baseArgs[:len(baseArgs):len(baseArgs)]

	var winExpr, asWhiteExpr, asBlackExpr string
	var extraArgs []any

	var whiteWinsExpr, whiteDrawsExpr, blackWinsExpr, blackDrawsExpr string

	if len(f.PlayerNames) > 0 {
		ph, lowers := playerINClause(f.PlayerNames)
		where = append(where, "(LOWER(g.white) IN ("+ph+") OR LOWER(g.black) IN ("+ph+"))")
		winExpr = `SUM(CASE WHEN (LOWER(g.white) IN (` + ph + `) AND g.result = '1-0')
			OR (LOWER(g.black) IN (` + ph + `) AND g.result = '0-1') THEN 1 ELSE 0 END)`
		asWhiteExpr = `SUM(CASE WHEN LOWER(g.white) IN (` + ph + `) THEN 1 ELSE 0 END)`
		asBlackExpr = `SUM(CASE WHEN LOWER(g.black) IN (` + ph + `) THEN 1 ELSE 0 END)`
		whiteWinsExpr = `SUM(CASE WHEN LOWER(g.white) IN (` + ph + `) AND g.result = '1-0' THEN 1 ELSE 0 END)`
		whiteDrawsExpr = `SUM(CASE WHEN LOWER(g.white) IN (` + ph + `) AND g.result = '1/2-1/2' THEN 1 ELSE 0 END)`
		blackWinsExpr = `SUM(CASE WHEN LOWER(g.black) IN (` + ph + `) AND g.result = '0-1' THEN 1 ELSE 0 END)`
		blackDrawsExpr = `SUM(CASE WHEN LOWER(g.black) IN (` + ph + `) AND g.result = '1/2-1/2' THEN 1 ELSE 0 END)`

		extraArgs = append(extraArgs, lowers...) // WHERE white IN
		extraArgs = append(extraArgs, lowers...) // WHERE black IN
		extraArgs = append(extraArgs, lowers...) // win white IN
		extraArgs = append(extraArgs, lowers...) // win black IN
		extraArgs = append(extraArgs, lowers...) // asWhite IN
		extraArgs = append(extraArgs, lowers...) // asBlack IN
		extraArgs = append(extraArgs, lowers...) // whiteWins IN
		extraArgs = append(extraArgs, lowers...) // whiteDraws IN
		extraArgs = append(extraArgs, lowers...) // blackWins IN
		extraArgs = append(extraArgs, lowers...) // blackDraws IN
	} else {
		winExpr = `SUM(CASE WHEN g.result = '1-0' THEN 1 ELSE 0 END)`
		asWhiteExpr = `COUNT(*)`
		asBlackExpr = `0`
		whiteWinsExpr = `SUM(CASE WHEN g.result = '1-0' THEN 1 ELSE 0 END)`
		whiteDrawsExpr = `SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END)`
		blackWinsExpr = `0`
		blackDrawsExpr = `0`
	}

	q := `SELECT g.eco, g.opening,
		` + winExpr + ` AS player_wins,
		SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws,
		` + asWhiteExpr + ` AS as_white,
		` + asBlackExpr + ` AS as_black,
		` + whiteWinsExpr + ` AS white_wins,
		` + whiteDrawsExpr + ` AS white_draws,
		` + blackWinsExpr + ` AS black_wins,
		` + blackDrawsExpr + ` AS black_draws,
		COUNT(*) AS total
	FROM games g` + joins + `
	WHERE ` + strings.Join(where, " AND ") + `
	GROUP BY g.eco, g.opening
	ORDER BY total DESC`

	allArgs := append(args, extraArgs...)

	rows, err := d.db.Query(q, allArgs...)
	if err != nil {
		return nil, fmt.Errorf("opening variation performance: %w", err)
	}
	defer rows.Close()

	var result []OpeningRow
	for rows.Next() {
		var row OpeningRow
		var playerWins, draws, asWhite, asBlack, whiteWins, whiteDraws, blackWins, blackDraws, total int
		if err := rows.Scan(&row.ECO, &row.Opening, &playerWins, &draws, &asWhite, &asBlack,
			&whiteWins, &whiteDraws, &blackWins, &blackDraws, &total); err != nil {
			return nil, fmt.Errorf("scan opening variation row: %w", err)
		}
		if total == 0 {
			continue
		}
		losses := total - playerWins - draws
		if losses < 0 {
			losses = 0
		}
		row.Games = total
		row.AsWhite = asWhite
		row.AsBlack = asBlack
		row.WhiteWins = whiteWins
		row.WhiteDraws = whiteDraws
		row.BlackWins = blackWins
		row.BlackDraws = blackDraws
		row.WinPct = float64(playerWins) / float64(total) * 100
		row.DrawPct = float64(draws) / float64(total) * 100
		row.LossPct = float64(losses) / float64(total) * 100
		result = append(result, row)
	}
	return result, rows.Err()
}


// AccuracyPoint is one data point in the accuracy time-series (one per analysed game).
type AccuracyPoint struct {
	Date        string  `json:"date"`
	GameID      string  `json:"gameId"`
	PlayerSide  string  `json:"playerSide"`  // "white" or "black"
	PlayerAcc   float64 `json:"playerAcc"`
	TimeControl string  `json:"timeControl"` // bullet/blitz/rapid/classical/other
}

// BlunderSquare holds the blunder-destination frequency for one board square.
type BlunderSquare struct {
	Square string `json:"square"`
	Count  int    `json:"count"`
}

// BlunderPosition holds a recurrent blunder position.
type BlunderPosition struct {
	FEN   string `json:"fen"`
	Count int    `json:"count"`
}

// LuckStats bundles luck and opportunism rate data.
type LuckStats struct {
	BlunderCount       int     `json:"blunderCount"`
	UnpunishedBlunders int     `json:"unpunishedBlunders"`
	LuckRate           float64 `json:"luckRate"`
	OppBlunderCount    int     `json:"oppBlunderCount"`
	ExploitedBlunders  int     `json:"exploitedBlunders"`
	OpportunismRate    float64 `json:"opportunismRate"`
}

// PlayerAnalysisStats is the analysis-augmented tier payload.
type PlayerAnalysisStats struct {
	AccuracyTimeSeries []AccuracyPoint   `json:"accuracyTimeSeries"`
	BlunderHeatmap     []BlunderSquare   `json:"blunderHeatmap"`
	BlunderPositions   []BlunderPosition `json:"blunderPositions"`
	LuckStats          LuckStats         `json:"luckStats"`
}

const (
	nagMistakeVal = 2
	nagBlunderVal = 4
	blunderTopN   = 10
)

// GetPlayerAnalysisStats returns the analysis-augmented tier statistics.
// It walks every completed analysis for the player's games.
func (d *DB) GetPlayerAnalysisStats(f StatsFilters) (*PlayerAnalysisStats, error) {
	joins, where, baseArgs := statsBaseWhere(f)

	// Add player filter (either side).
	if len(f.PlayerNames) > 0 {
		ph, lowers := playerINClause(f.PlayerNames)
		where = append(where, "(LOWER(g.white) IN ("+ph+") OR LOWER(g.black) IN ("+ph+"))")
		baseArgs = append(baseArgs, lowers...)
		baseArgs = append(baseArgs, lowers...)
	}
	whereStr := strings.Join(where, " AND ") + " AND ga.status = 'complete'"

	q := `SELECT g.id, g.pgn, g.white, g.black, g.date, g.time_control,
	             ga.white_accuracy, ga.black_accuracy, ga.evals
	      FROM games g
	      JOIN game_analyses ga ON ga.game_id = g.id` + joins + `
	      WHERE ` + whereStr + `
	      ORDER BY g.date ASC`

	rows, err := d.db.Query(q, baseArgs...)
	if err != nil {
		return nil, fmt.Errorf("analysis stats query: %w", err)
	}
	defer rows.Close()

	nameSet := make(map[string]bool, len(f.PlayerNames))
	for _, n := range f.PlayerNames {
		nameSet[strings.ToLower(n)] = true
	}

	var result PlayerAnalysisStats
	heatmapCounts := make(map[string]int)
	positionCounts := make(map[string]int)
	var luck LuckStats

	for rows.Next() {
		var gameID, pgn, white, black, date, timeControl string
		var whiteAcc, blackAcc sql.NullFloat64
		var evalsJSON sql.NullString

		if err := rows.Scan(&gameID, &pgn, &white, &black, &date, &timeControl,
			&whiteAcc, &blackAcc, &evalsJSON); err != nil {
			return nil, fmt.Errorf("scan analysis row: %w", err)
		}

		if !evalsJSON.Valid || evalsJSON.String == "" {
			continue
		}
		var evals []analysis.MoveEval
		if err := json.Unmarshal([]byte(evalsJSON.String), &evals); err != nil {
			continue
		}

		// Determine player's side.
		playerIsWhite := len(nameSet) == 0 || nameSet[strings.ToLower(white)]
		if !playerIsWhite && len(nameSet) > 0 && !nameSet[strings.ToLower(black)] {
			continue // game doesn't involve the player
		}

		side := "white"
		var playerAcc float64
		if playerIsWhite {
			if whiteAcc.Valid {
				playerAcc = whiteAcc.Float64
			}
		} else {
			side = "black"
			if blackAcc.Valid {
				playerAcc = blackAcc.Float64
			}
		}

		result.AccuracyTimeSeries = append(result.AccuracyTimeSeries, AccuracyPoint{
			Date:        date,
			GameID:      gameID,
			PlayerSide:  side,
			PlayerAcc:   playerAcc,
			TimeControl: game.CategorizeTimeControl(timeControl),
		})

		// Walk PGN for heatmap + positions (only when the move index is in range).
		var moves []*chess.Move
		var positions []*chess.Position
		updateFn, parseErr := chess.PGN(strings.NewReader(pgn))
		if parseErr == nil {
			g := chess.NewGame()
			updateFn(g)
			moves = g.Moves()
			positions = g.Positions()
		}

		for i, eval := range evals {
			ply := eval.Ply
			if ply < 1 {
				continue
			}
			moveIdx := ply - 1

			// Ply 1 = white, ply 2 = black, ...
			moveIsWhite := ply%2 == 1
			playerMoved := (moveIsWhite && playerIsWhite) || (!moveIsWhite && !playerIsWhite)

			isBad := eval.Nag != nil && (*eval.Nag == nagBlunderVal || *eval.Nag == nagMistakeVal)
			if !isBad {
				continue
			}

			if playerMoved {
				luck.BlunderCount++

				// Heatmap: destination square of the bad move (requires PGN walk).
				if moveIdx < len(moves) {
					sq := moves[moveIdx].S2().String()
					heatmapCounts[sq]++
				}

				// Position FEN before the bad move (requires PGN walk).
				if moveIdx < len(positions) {
					fen := positions[moveIdx].String()
					positionCounts[fen]++
				}

				// Luck: opponent's next eval had no bad NAG → unpunished.
				if i+1 < len(evals) {
					nextNag := evals[i+1].Nag
					if nextNag == nil {
						luck.UnpunishedBlunders++
					}
				} else {
					luck.UnpunishedBlunders++
				}
			} else {
				// Opponent blundered.
				luck.OppBlunderCount++

				// Opportunism: player's next eval had no bad NAG → exploited.
				if i+1 < len(evals) {
					nextNag := evals[i+1].Nag
					if nextNag == nil {
						luck.ExploitedBlunders++
					}
				} else {
					luck.ExploitedBlunders++
				}
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Build heatmap slice.
	for sq, count := range heatmapCounts {
		result.BlunderHeatmap = append(result.BlunderHeatmap, BlunderSquare{Square: sq, Count: count})
	}

	// Build top-N blunder positions sorted by count descending.
	type posPair struct {
		fen   string
		count int
	}
	var posList []posPair
	for fen, count := range positionCounts {
		posList = append(posList, posPair{fen, count})
	}
	sort.Slice(posList, func(i, j int) bool { return posList[i].count > posList[j].count })
	n := blunderTopN
	if len(posList) < n {
		n = len(posList)
	}
	for _, p := range posList[:n] {
		result.BlunderPositions = append(result.BlunderPositions, BlunderPosition{FEN: p.fen, Count: p.count})
	}

	// Compute rates.
	if luck.BlunderCount > 0 {
		luck.LuckRate = float64(luck.UnpunishedBlunders) / float64(luck.BlunderCount) * 100
	}
	if luck.OppBlunderCount > 0 {
		luck.OpportunismRate = float64(luck.ExploitedBlunders) / float64(luck.OppBlunderCount) * 100
	}
	result.LuckStats = luck

	return &result, nil
}
