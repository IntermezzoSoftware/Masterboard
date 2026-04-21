package analysis

import "math"

// Lichess winning-chances sigmoid coefficient.
// Source: https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/AccuracyPercent.scala
const wcCoeff = 0.00368208

// NAG constants used for move classification.
const (
	nagInaccuracy = 6  // ?!
	nagMistake    = 2  // ?
	nagBlunder    = 4  // ??
)

// Winning-chance loss thresholds (percentage points).
const (
	thresholdInaccuracy = 5.0
	thresholdMistake    = 10.0
	thresholdBlunder    = 15.0
)

// winChance converts a centipawn score to a winning-chance percentage (0-100)
// using the Lichess sigmoid model.
func winChance(cp int) float64 {
	return 50 + 50*(2/(1+math.Exp(-wcCoeff*float64(cp)))-1)
}

// winChanceMate returns the winning chance for a mate score.
// Positive mateIn means mating (100%), negative means being mated (0%).
func winChanceMate(mateIn int) float64 {
	if mateIn > 0 {
		return 100
	}
	return 0
}

// winChanceFromEval returns the winning chance from a score that may be cp or mate.
func winChanceFromEval(cp *int, mate *int) float64 {
	if mate != nil {
		return winChanceMate(*mate)
	}
	if cp != nil {
		return winChance(*cp)
	}
	return 50 // no score = equal
}

// classifyDelta classifies a winning-chance loss (delta >= 0) into a NAG.
// Returns nil if the loss is below the inaccuracy threshold.
func classifyDelta(delta float64) *int {
	switch {
	case delta >= thresholdBlunder:
		nag := nagBlunder
		return &nag
	case delta >= thresholdMistake:
		nag := nagMistake
		return &nag
	case delta >= thresholdInaccuracy:
		nag := nagInaccuracy
		return &nag
	default:
		return nil
	}
}

// Lichess per-move accuracy formula coefficients.
// Source: https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/AccuracyPercent.scala
const (
	accA = 103.1668100711649
	accB = -0.04354415386753951
	accC = -3.166924740191411
)

// moveAccuracy computes the per-move accuracy for a winning-chance loss.
// wcLoss should be >= 0 (the drop in winning chances caused by the move).
// Returns a value clamped to [0, 100]. Includes Lichess's +1 uncertainty bonus.
func moveAccuracy(wcLoss float64) float64 {
	acc := accA*math.Exp(accB*wcLoss) + accC + 1
	if acc > 100 {
		return 100
	}
	if acc < 0 {
		return 0
	}
	return acc
}

// avgFloat64 returns the arithmetic mean of vs, or 0 if vs is empty.
func avgFloat64(vs []float64) float64 {
	if len(vs) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range vs {
		sum += v
	}
	return sum / float64(len(vs))
}

// harmonicMean returns the harmonic mean of vs, excluding zeros (matching
// Lichess's Maths.harmonicMean behaviour). Returns 0 if no positive values
// are present.
func harmonicMean(vs []float64) float64 {
	var recipSum float64
	var count int
	for _, v := range vs {
		if v > 0 {
			recipSum += 1 / v
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return float64(count) / recipSum
}

// weightedMean returns the weighted mean of (value, weight) pairs.
// Returns 0 if the total weight is zero.
func weightedMean(pairs [][2]float64) float64 {
	var sumW, sumWV float64
	for _, p := range pairs {
		sumWV += p[0] * p[1]
		sumW += p[1]
	}
	if sumW == 0 {
		return 0
	}
	return sumWV / sumW
}

// standardDeviation returns the population standard deviation of vs.
// Returns 0 if vs is empty.
func standardDeviation(vs []float64) float64 {
	n := len(vs)
	if n == 0 {
		return 0
	}
	mean := avgFloat64(vs)
	var sumSq float64
	for _, v := range vs {
		d := v - mean
		sumSq += d * d
	}
	return math.Sqrt(sumSq / float64(n))
}

// playerAccuracy computes player accuracy matching Lichess's gameAccuracy formula:
// (volatility_weighted_mean + harmonic_mean) / 2.
// weights[i] is the standard deviation of the win-percent sliding window for
// move i, clamped to [0.5, 12]. Using the mean of both averages rather than
// harmonic alone prevents the formula from under-reporting accuracy.
func playerAccuracy(moveAccuracies []float64, weights []float64) float64 {
	if len(moveAccuracies) == 0 {
		return 0
	}
	hm := harmonicMean(moveAccuracies)

	pairs := make([][2]float64, len(moveAccuracies))
	for i, acc := range moveAccuracies {
		w := 1.0
		if i < len(weights) {
			w = weights[i]
		}
		pairs[i] = [2]float64{acc, w}
	}
	wm := weightedMean(pairs)

	return (wm + hm) / 2
}

// acpl computes the average centipawn loss from a slice of per-move cp losses.
// Each value should be >= 0. Returns 0 if the slice is empty.
func acpl(cpLosses []float64) float64 {
	return avgFloat64(cpLosses)
}
