package masterdb

import (
	"cmp"
	"encoding/binary"
	"fmt"
	"slices"
	"strings"

	chess "github.com/corentings/chess/v2"
)

// MoveStat holds aggregated result and Elo statistics for one candidate move
// from a given position. WhiteWins and BlackWins are stored from white's
// perspective regardless of which side plays the move.
type MoveStat struct {
	MoveSAN   string `json:"moveSan"`
	WhiteWins int    `json:"whiteWins"`
	Draws     int    `json:"draws"`
	BlackWins int    `json:"blackWins"`
	AvgElo    int    `json:"avgElo"` // 0 if no Elo data available
	Total     int    `json:"total"`  // WhiteWins + Draws + BlackWins
}

// GameSummary is a lightweight game record returned by GetGamesAtPosition.
type GameSummary struct {
	ID       int64  `json:"id"`
	White    string `json:"white"`
	Black    string `json:"black"`
	Result   string `json:"result"`
	Date     string `json:"date"`
	EloWhite int    `json:"eloWhite"`
	EloBlack int    `json:"eloBlack"`
	MoveSAN  string `json:"moveSan"` // move played from the queried position (decoded from moves_blob)
}

// GetPositionStats returns aggregated move statistics for the position
// described by fen, sorted by total game count descending.
func (db *DB) GetPositionStats(fen string) ([]MoveStat, error) {
	hash, err := HashFEN(fen)
	if err != nil {
		return nil, err
	}
	rows, err := db.sql.Query(`
		SELECT ml.move_san, s.wins, s.draws, s.losses, s.total_elo, s.elo_count
		FROM master_position_stats s
		JOIN master_move_lookup ml ON ml.move_id = s.move_id
		WHERE s.position_hash = ?`,
		hash,
	)
	if err != nil {
		return nil, fmt.Errorf("query stats: %w", err)
	}
	defer rows.Close()

	var stats []MoveStat
	for rows.Next() {
		var s MoveStat
		var totalElo, eloCount int
		if err := rows.Scan(&s.MoveSAN, &s.WhiteWins, &s.Draws, &s.BlackWins, &totalElo, &eloCount); err != nil {
			return nil, fmt.Errorf("scan stats row: %w", err)
		}
		s.Total = s.WhiteWins + s.Draws + s.BlackWins
		if eloCount > 0 {
			s.AvgElo = totalElo / eloCount
		}
		stats = append(stats, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate stats: %w", err)
	}

	slices.SortFunc(stats, func(a, b MoveStat) int {
		return cmp.Compare(b.Total, a.Total) // descending
	})
	return stats, nil
}

// GetGamesAtPosition returns up to limit games that passed through the position
// described by fen, sorted by combined Elo descending.
// Only positions indexed within GameIndexMaxPly half-moves are findable here.
// Each returned GameSummary includes MoveSAN — the move played from the queried
// position, decoded from the game's moves_blob.
func (db *DB) GetGamesAtPosition(fen string, limit int) ([]GameSummary, error) {
	hash, err := HashFEN(fen)
	if err != nil {
		return nil, err
	}
	rows, err := db.sql.Query(`
		SELECT g.id, g.white, g.black, g.result, g.date, g.elo_white, g.elo_black, g.moves_blob
		FROM master_position_game_index idx
		JOIN master_games g ON g.id = idx.game_id
		WHERE idx.position_hash = ?
		ORDER BY (g.elo_white + g.elo_black) DESC
		LIMIT ?`,
		hash, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query games at position: %w", err)
	}
	defer rows.Close()

	var games []GameSummary
	for rows.Next() {
		var g GameSummary
		var movesBlob []byte
		if err := rows.Scan(&g.ID, &g.White, &g.Black, &g.Result, &g.Date, &g.EloWhite, &g.EloBlack, &movesBlob); err != nil {
			return nil, fmt.Errorf("scan game row: %w", err)
		}
		g.MoveSAN = moveAtPosition(movesBlob, hash)
		games = append(games, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate games: %w", err)
	}
	return games, nil
}

// moveAtPosition decodes the moves blob and returns the SAN of the move played
// from the position identified by targetHash. Returns "" if the position is not
// found (e.g. truncated blob or hash mismatch).
func moveAtPosition(blob []byte, targetHash int64) string {
	if len(blob) < 2 || len(blob)%2 != 0 {
		return ""
	}

	pos := cachedStartPos
	ph := newPositionHasher()
	an := chess.AlgebraicNotation{}

	for i := 0; i < len(blob); i += 2 {
		h := ph.Hash(pos)
		if h == targetHash {
			// Found the position — decode this move to get SAN.
			v := binary.BigEndian.Uint16(blob[i : i+2])
			from, to, promo := decodeMove2B(v)
			legal := pos.ValidMoves()
			for j := range legal {
				m := &legal[j]
				if m.S1() == from && m.S2() == to && m.Promo() == promo {
					return an.Encode(pos, m)
				}
			}
			return ""
		}

		// Advance position.
		v := binary.BigEndian.Uint16(blob[i : i+2])
		from, to, promo := decodeMove2B(v)
		legal := pos.ValidMoves()
		var played *chess.Move
		for j := range legal {
			m := &legal[j]
			if m.S1() == from && m.S2() == to && m.Promo() == promo {
				played = m
				break
			}
		}
		if played == nil {
			return ""
		}
		pos = pos.Update(played)
	}
	return ""
}

// GetGamePGN reconstructs a PGN string for the game with the given ID.
// The returned string includes standard headers and the move list.
func (db *DB) GetGamePGN(gameID int64) (string, error) {
	var g GameSummary
	var movesBlob []byte
	err := db.sql.QueryRow(`
		SELECT id, white, black, result, date, elo_white, elo_black, moves_blob
		FROM master_games WHERE id = ?`, gameID).
		Scan(&g.ID, &g.White, &g.Black, &g.Result, &g.Date, &g.EloWhite, &g.EloBlack, &movesBlob)
	if err != nil {
		return "", fmt.Errorf("query game %d: %w", gameID, err)
	}

	sans, err := DecodeGame2B(movesBlob)
	if err != nil {
		return "", fmt.Errorf("decode game %d: %w", gameID, err)
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "[White %q]\n[Black %q]\n[Result %q]\n[Date %q]\n[WhiteElo \"%d\"]\n[BlackElo \"%d\"]\n\n",
		g.White, g.Black, g.Result, g.Date, g.EloWhite, g.EloBlack)

	moveNum := 1
	for i, san := range sans {
		if i%2 == 0 {
			fmt.Fprintf(&sb, "%d. ", moveNum)
			moveNum++
		}
		sb.WriteString(san)
		sb.WriteByte(' ')
	}
	sb.WriteString(g.Result)
	return sb.String(), nil
}

