package analysis

import (
	"context"
	"fmt"
	"math"
	"strings"

	chess "github.com/corentings/chess/v2"

	"github.com/IntermezzoSoftware/Masterboard/internal/engine"
)

const (
	DefaultDepthAB   = 22
	defaultNodesMCTS = 3000000
)

func moveToUCI(m *chess.Move) string {
	uci := m.S1().String() + m.S2().String()
	if p := m.Promo(); p != chess.NoPieceType {
		uci += strings.ToLower(p.String())
	}
	return uci
}

type posEval struct {
	cp     *int
	mate   *int
	bestPV []string // full principal variation (UCI moves)
}

func evalPosition(ctx context.Context, eng *engine.Manager, engineType, fen string, depth int) (posEval, error) {
	var lastInfo *engine.InfoLine
	onInfo := func(info *engine.InfoLine) {
		if info.MultiPV == 1 && len(info.PV) > 0 {
			lastInfo = info
		}
	}

	var bm *engine.BestMoveMsg
	var err error
	if engineType == "mcts" {
		bm, err = eng.AnalyseNodes(ctx, fen, 1, defaultNodesMCTS, onInfo)
	} else {
		bm, err = eng.AnalyseDepth(ctx, fen, 1, depth, onInfo)
	}
	if err != nil {
		return posEval{}, err
	}

	var result posEval
	if lastInfo != nil {
		if lastInfo.IsMate {
			m := lastInfo.ScoreMate
			result.mate = &m
		} else {
			c := lastInfo.ScoreCp
			result.cp = &c
		}
		if len(lastInfo.PV) > 0 {
			result.bestPV = lastInfo.PV
		}
	}
	if len(result.bestPV) == 0 && bm.Move != "" && bm.Move != "(none)" {
		result.bestPV = []string{bm.Move}
	}
	return result, nil
}

// cpCeiling mirrors Lichess's Cp.CEILING: all evals are clamped to ±1000cp
// before computing ACPL diffs, so mate scores and extreme evals don't produce
// unreasonably large per-move losses.
const cpCeiling = 1000

func evalToCp(pe posEval) float64 {
	if pe.mate != nil {
		if *pe.mate > 0 {
			return cpCeiling
		}
		return -cpCeiling
	}
	if pe.cp != nil {
		v := float64(*pe.cp)
		if v > cpCeiling {
			return cpCeiling
		}
		if v < -cpCeiling {
			return -cpCeiling
		}
		return v
	}
	return 0
}

func normaliseToWhite(pe posEval, fen string) posEval {
	fields := strings.Fields(fen)
	if len(fields) >= 2 && fields[1] == "b" {
		if pe.cp != nil {
			neg := -(*pe.cp)
			pe.cp = &neg
		}
		if pe.mate != nil {
			neg := -(*pe.mate)
			pe.mate = &neg
		}
	}
	return pe
}

// Each position is evaluated once. For position i, the eval gives us:
//   - The "best score" for the position (engine's top line evaluation)
//   - The "best move" for the position (engine's recommended move)
//
// The "played move score" is derived from the eval of the next position (negated
// for perspective), avoiding a second engine call per move.
func AnalyseGame(
	ctx context.Context,
	eng *engine.Manager,
	engineType string,
	pgn string,
	depth int,
	onProgress func(ply, totalPlies int),
) (evals []MoveEval, whiteAcc, blackAcc, whiteACPL, blackACPL float64, err error) {

	// Parse PGN.
	updateFn, parseErr := chess.PGN(strings.NewReader(pgn))
	if parseErr != nil {
		return nil, 0, 0, 0, 0, fmt.Errorf("parse PGN: %w", parseErr)
	}
	g := chess.NewGame()
	updateFn(g)

	moves := g.Moves()
	positions := g.Positions()
	totalPlies := len(moves)

	if totalPlies == 0 {
		return nil, 0, 0, 0, 0, nil
	}

	// Evaluate every position (totalPlies + 1 positions for totalPlies moves).
	// posEvals[i] is the eval of positions[i].
	posEvals := make([]posEval, totalPlies+1)
	for i := 0; i <= totalPlies; i++ {
		select {
		case <-ctx.Done():
			return nil, 0, 0, 0, 0, ctx.Err()
		default:
		}

		fen := positions[i].String()

		// Terminal positions: assign scores directly instead of calling the
		// engine (which returns empty results for positions with no legal moves).
		status := positions[i].Status()
		if status == chess.Checkmate {
			// Side to move is checkmated → they lost. Use mate = -1 (from
			// side-to-move's perspective); normaliseToWhite flips the sign
			// so white's perspective is always correct.
			m := -1
			posEvals[i] = normaliseToWhite(posEval{mate: &m}, fen)
			if onProgress != nil && i > 0 {
				onProgress(i, totalPlies)
			}
			continue
		}
		if status == chess.Stalemate {
			cp := 0
			posEvals[i] = posEval{cp: &cp}
			if onProgress != nil && i > 0 {
				onProgress(i, totalPlies)
			}
			continue
		}

		pe, evalErr := evalPosition(ctx, eng, engineType, fen, depth)
		if evalErr != nil {
			return nil, 0, 0, 0, 0, fmt.Errorf("eval position %d: %w", i, evalErr)
		}
		posEvals[i] = normaliseToWhite(pe, fen)

		if onProgress != nil && i > 0 {
			onProgress(i, totalPlies)
		}
	}

	// Compute per-move volatility weights (Lichess gameAccuracy formula).
	// Each weight is the population std dev of a sliding win-percent window,
	// clamped to [0.5, 12]. Window size = clamp(totalPlies/10, 2, 8).
	allWc := make([]float64, totalPlies+1)
	for i, pe := range posEvals {
		allWc[i] = winChanceFromEval(pe.cp, pe.mate)
	}
	windowSize := totalPlies / 10
	if windowSize < 2 {
		windowSize = 2
	}
	if windowSize > 8 {
		windowSize = 8
	}
	clampedWS := windowSize
	if clampedWS > len(allWc) {
		clampedWS = len(allWc)
	}
	// Build windows: (clampedWS-2) copies of the first window, then sliding.
	moveWeights := make([]float64, 0, totalPlies)
	firstWindow := allWc
	if len(firstWindow) > windowSize {
		firstWindow = allWc[:windowSize]
	}
	for range clampedWS - 2 {
		sd := standardDeviation(firstWindow)
		if sd < 0.5 {
			sd = 0.5
		}
		if sd > 12 {
			sd = 12
		}
		moveWeights = append(moveWeights, sd)
	}
	for i := range totalPlies + 1 - windowSize + 1 {
		win := allWc[i : i+windowSize]
		sd := standardDeviation(win)
		if sd < 0.5 {
			sd = 0.5
		}
		if sd > 12 {
			sd = 12
		}
		moveWeights = append(moveWeights, sd)
	}

	evals = make([]MoveEval, 0, totalPlies)
	var whiteAccs, blackAccs []float64
	var whiteWeights, blackWeights []float64
	var whiteCpLosses, blackCpLosses []float64

	for i := range moves {
		ply := i + 1
		posBeforeFen := positions[i].String()

		beforeEval := posEvals[i]   // eval of position before this move (white perspective)
		afterEval := posEvals[i+1]  // eval of position after this move (white perspective)

		// Compute winning chances from white's perspective.
		wcBefore := winChanceFromEval(beforeEval.cp, beforeEval.mate)
		wcAfter := winChanceFromEval(afterEval.cp, afterEval.mate)

		// Compute WC loss from the moving side's perspective.
		fields := strings.Fields(posBeforeFen)
		isWhiteMove := len(fields) < 2 || fields[1] == "w"

		var wcLoss float64
		if isWhiteMove {
			wcLoss = wcBefore - wcAfter
		} else {
			wcLoss = wcAfter - wcBefore
		}
		if wcLoss < 0 {
			wcLoss = 0
		}

		nag := classifyDelta(wcLoss)

		// If the engine's best move matches the played move, don't classify.
		// Any eval swing is search instability, not a player error — there's
		// no better alternative to suggest.
		if nag != nil && len(beforeEval.bestPV) > 0 {
			playedUci := moveToUCI(moves[i])
			if beforeEval.bestPV[0] == playedUci {
				nag = nil
			}
		}

		acc := moveAccuracy(wcLoss)

		// Centipawn loss for ACPL (handles mate scores via evalToCp).
		cpBefore := evalToCp(beforeEval)
		cpAfter := evalToCp(afterEval)
		var cpLoss float64
		if isWhiteMove {
			cpLoss = cpBefore - cpAfter
		} else {
			cpLoss = cpAfter - cpBefore
		}
		if cpLoss < 0 {
			cpLoss = 0
		}

		eval := MoveEval{
			Ply:        ply,
			BestCp:     beforeEval.cp,
			BestMate:   beforeEval.mate,
			PlayedCp:   afterEval.cp,
			PlayedMate: afterEval.mate,
			BestPV:     strings.Join(beforeEval.bestPV, " "),
			Accuracy:   math.Round(acc*100) / 100,
			Nag:        nag,
		}
		evals = append(evals, eval)

		var mw float64 = 1.0
		if i < len(moveWeights) {
			mw = moveWeights[i]
		}
		if isWhiteMove {
			whiteAccs = append(whiteAccs, acc)
			whiteWeights = append(whiteWeights, mw)
			whiteCpLosses = append(whiteCpLosses, cpLoss)
		} else {
			blackAccs = append(blackAccs, acc)
			blackWeights = append(blackWeights, mw)
			blackCpLosses = append(blackCpLosses, cpLoss)
		}
	}

	whiteAcc = math.Round(playerAccuracy(whiteAccs, whiteWeights)*100) / 100
	blackAcc = math.Round(playerAccuracy(blackAccs, blackWeights)*100) / 100
	whiteACPL = math.Round(acpl(whiteCpLosses)*100) / 100
	blackACPL = math.Round(acpl(blackCpLosses)*100) / 100

	return evals, whiteAcc, blackAcc, whiteACPL, blackACPL, nil
}
