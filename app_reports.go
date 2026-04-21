package main

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/IntermezzoSoftware/Masterboard/internal/storage"
)

func (a *App) GetPlayerNames(prefix string) ([]string, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetPlayerNames(prefix, 20)
}

func (a *App) GetDeviationPositions(playerNames []string) ([]storage.DeviationRow, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	a.masterDBMu.Lock()
	mdb := a.masterDB
	a.masterDBMu.Unlock()
	return storage.GetDeviationPositions(a.db, mdb, playerNames, 10)
}

func (a *App) GetRepertoireDeviations(playerNames []string) ([]storage.RepertoireDeviationRow, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	rows, err := a.db.GetRepertoireDeviations(playerNames, 0) // 0 → uses default limit (10)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []storage.RepertoireDeviationRow{}
	}
	return rows, nil
}

func (a *App) ExportOpponentReport(playerNames []string) (string, error) {
	if err := a.requireDB(); err != nil {
		return "", err
	}

	stats, err := a.db.GetPlayerStats(storage.StatsFilters{PlayerNames: playerNames})
	if err != nil {
		return "", fmt.Errorf("GetPlayerStats: %w", err)
	}
	if stats == nil {
		return "", nil
	}

	analysisStats, err := a.db.GetPlayerAnalysisStats(storage.StatsFilters{PlayerNames: playerNames})
	if err != nil {
		// Analysis stats are optional — proceed without them.
		analysisStats = nil
	}

	date := time.Now().UTC().Format("2006.01.02")
	nameStr := strings.Join(playerNames, ", ")

	var b strings.Builder

	totalW := stats.AsWhite.Total
	totalB := stats.AsBlack.Total
	total := stats.TotalGames

	pct := func(num, denom int) string {
		if denom == 0 {
			return "0"
		}
		return fmt.Sprintf("%.0f", float64(num)/float64(denom)*100)
	}

	whiteWinPct := pct(stats.AsWhite.Wins, totalW)
	whiteDrawPct := pct(stats.AsWhite.Draws, totalW)
	whiteLossPct := pct(stats.AsWhite.Losses, totalW)
	blackWinPct := pct(stats.AsBlack.Wins, totalB)
	blackDrawPct := pct(stats.AsBlack.Draws, totalB)
	blackLossPct := pct(stats.AsBlack.Losses, totalB)

	summary := fmt.Sprintf(
		"Summary: %d games total. As White: %d games, %s%%W/%s%%D/%s%%L. As Black: %d games, %s%%W/%s%%D/%s%%L.",
		total,
		totalW, whiteWinPct, whiteDrawPct, whiteLossPct,
		totalB, blackWinPct, blackDrawPct, blackLossPct,
	)

	if analysisStats != nil && analysisStats.LuckStats.BlunderCount > 0 {
		ls := analysisStats.LuckStats
		summary += fmt.Sprintf(
			" Luck rate: %.0f%% (blunders unpunished). Opportunism rate: %.0f%% (exploits mistakes).",
			ls.LuckRate,
			ls.OpportunismRate,
		)
	}

	fmt.Fprintf(&b, "[Event \"Opponent Report: %s\"]\n", nameStr)
	fmt.Fprintf(&b, "[Site \"Masterboard\"]\n")
	fmt.Fprintf(&b, "[Date \"%s\"]\n", date)
	fmt.Fprintf(&b, "[White \"?\"]\n")
	fmt.Fprintf(&b, "[Black \"?\"]\n")
	fmt.Fprintf(&b, "[Result \"*\"]\n")
	fmt.Fprintf(&b, "\n{ %s }\n*\n\n", summary)

	whiteOpenings := make([]storage.OpeningRow, 0)
	for _, o := range stats.ByOpening {
		if o.AsWhite > 0 {
			whiteOpenings = append(whiteOpenings, o)
		}
	}
	sort.Slice(whiteOpenings, func(i, j int) bool {
		return whiteOpenings[i].AsWhite > whiteOpenings[j].AsWhite
	})
	if len(whiteOpenings) > 5 {
		whiteOpenings = whiteOpenings[:5]
	}

	for _, o := range whiteOpenings {
		wWinPct := fmt.Sprintf("%.0f", float64(o.WhiteWins)/float64(o.AsWhite)*100)
		wDrawPct := fmt.Sprintf("%.0f", float64(o.WhiteDraws)/float64(o.AsWhite)*100)
		wLossPct := fmt.Sprintf("%.0f", float64(o.AsWhite-o.WhiteWins-o.WhiteDraws)/float64(o.AsWhite)*100)

		fmt.Fprintf(&b, "[Event \"Opponent Report: %s — As White\"]\n", nameStr)
		fmt.Fprintf(&b, "[ECO \"%s\"]\n", o.ECO)
		fmt.Fprintf(&b, "[Opening \"%s\"]\n", o.Opening)
		fmt.Fprintf(&b, "[White \"%s\"]\n", nameStr)
		fmt.Fprintf(&b, "[Black \"?\"]\n")
		fmt.Fprintf(&b, "[Result \"*\"]\n")
		fmt.Fprintf(&b, "[Annotator \"Masterboard\"]\n")
		fmt.Fprintf(&b, "\n{ %d games as White. Win: %s%% Draw: %s%% Loss: %s%% }\n*\n\n",
			o.AsWhite, wWinPct, wDrawPct, wLossPct)
	}

	blackOpenings := make([]storage.OpeningRow, 0)
	for _, o := range stats.ByOpening {
		if o.AsBlack > 0 {
			blackOpenings = append(blackOpenings, o)
		}
	}
	sort.Slice(blackOpenings, func(i, j int) bool {
		return blackOpenings[i].AsBlack > blackOpenings[j].AsBlack
	})
	if len(blackOpenings) > 5 {
		blackOpenings = blackOpenings[:5]
	}

	for _, o := range blackOpenings {
		bWinPct := fmt.Sprintf("%.0f", float64(o.BlackWins)/float64(o.AsBlack)*100)
		bDrawPct := fmt.Sprintf("%.0f", float64(o.BlackDraws)/float64(o.AsBlack)*100)
		bLossPct := fmt.Sprintf("%.0f", float64(o.AsBlack-o.BlackWins-o.BlackDraws)/float64(o.AsBlack)*100)

		fmt.Fprintf(&b, "[Event \"Opponent Report: %s — As Black\"]\n", nameStr)
		fmt.Fprintf(&b, "[ECO \"%s\"]\n", o.ECO)
		fmt.Fprintf(&b, "[Opening \"%s\"]\n", o.Opening)
		fmt.Fprintf(&b, "[White \"?\"]\n")
		fmt.Fprintf(&b, "[Black \"%s\"]\n", nameStr)
		fmt.Fprintf(&b, "[Result \"*\"]\n")
		fmt.Fprintf(&b, "[Annotator \"Masterboard\"]\n")
		fmt.Fprintf(&b, "\n{ %d games as Black. Win: %s%% Draw: %s%% Loss: %s%% }\n*\n\n",
			o.AsBlack, bWinPct, bDrawPct, bLossPct)
	}

	return b.String(), nil
}

func (a *App) AnalyzeOpponentGames(playerNames []string) (int, error) {
	if err := a.requireDB(); err != nil {
		return 0, err
	}
	ids, err := a.db.GetUnanalyzedGameIDsForPlayer(playerNames, 0)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	// AnalyseGames marks the games as pending in the DB and starts the worker
	// pool — without this, a bare enqueueGames call would lose the queue on
	// restart and never start processing.
	if err := a.AnalyseGames(ids); err != nil {
		return 0, err
	}
	return len(ids), nil
}
