package analysis

import (
	"math"
	"testing"
)

func TestWinChance(t *testing.T) {
	tests := []struct {
		cp   int
		want float64 // approximate
	}{
		{0, 50},
		{100, 59.1},    // slight white advantage
		{-100, 40.9},   // slight black advantage
		{300, 75.1},    // clear white advantage
		{-300, 24.9},
		{1000, 97.5},   // winning
		{-1000, 2.5},
		{3000, 100.0},  // totally winning
	}
	for _, tt := range tests {
		got := winChance(tt.cp)
		if math.Abs(got-tt.want) > 1.0 {
			t.Errorf("winChance(%d) = %.1f, want ~%.1f", tt.cp, got, tt.want)
		}
	}
}

func TestWinChance_Symmetric(t *testing.T) {
	for _, cp := range []int{0, 50, 100, 200, 500, 1000} {
		pos := winChance(cp)
		neg := winChance(-cp)
		if math.Abs((pos+neg)-100) > 0.001 {
			t.Errorf("winChance(%d) + winChance(%d) = %.4f, want 100", cp, -cp, pos+neg)
		}
	}
}

func TestWinChanceMate(t *testing.T) {
	if got := winChanceMate(3); got != 100 {
		t.Errorf("winChanceMate(3) = %f, want 100", got)
	}
	if got := winChanceMate(-3); got != 0 {
		t.Errorf("winChanceMate(-3) = %f, want 0", got)
	}
}

func TestWinChanceFromEval(t *testing.T) {
	cp := 100
	mate := 3
	negMate := -3

	got := winChanceFromEval(&cp, nil)
	if math.Abs(got-winChance(100)) > 0.001 {
		t.Errorf("winChanceFromEval(cp=100) = %f, want %f", got, winChance(100))
	}

	got = winChanceFromEval(nil, &mate)
	if got != 100 {
		t.Errorf("winChanceFromEval(mate=3) = %f, want 100", got)
	}

	got = winChanceFromEval(nil, &negMate)
	if got != 0 {
		t.Errorf("winChanceFromEval(mate=-3) = %f, want 0", got)
	}

	got = winChanceFromEval(nil, nil)
	if got != 50 {
		t.Errorf("winChanceFromEval(nil, nil) = %f, want 50", got)
	}
}

func TestClassifyDelta(t *testing.T) {
	tests := []struct {
		delta float64
		nag   *int
	}{
		{0, nil},
		{3, nil},
		{4.9, nil},
		{5, intPtr(nagInaccuracy)},
		{7, intPtr(nagInaccuracy)},
		{9.9, intPtr(nagInaccuracy)},
		{10, intPtr(nagMistake)},
		{14.9, intPtr(nagMistake)},
		{15, intPtr(nagBlunder)},
		{20, intPtr(nagBlunder)},
		{50, intPtr(nagBlunder)},
	}
	for _, tt := range tests {
		got := classifyDelta(tt.delta)
		if tt.nag == nil && got != nil {
			t.Errorf("classifyDelta(%f) = %d, want nil", tt.delta, *got)
		} else if tt.nag != nil && (got == nil || *got != *tt.nag) {
			gotStr := "<nil>"
			if got != nil {
				gotStr = string(rune(*got + '0'))
			}
			t.Errorf("classifyDelta(%f) = %s, want %d", tt.delta, gotStr, *tt.nag)
		}
	}
}

func TestMoveAccuracy(t *testing.T) {
	// Perfect move: 0 loss -> ~100%
	acc := moveAccuracy(0)
	if acc < 99 || acc > 100 {
		t.Errorf("moveAccuracy(0) = %f, want ~100", acc)
	}

	// Small loss -> still high accuracy
	acc = moveAccuracy(5)
	if acc < 75 || acc > 100 {
		t.Errorf("moveAccuracy(5) = %f, want 75-100", acc)
	}

	// Large loss -> low accuracy
	acc = moveAccuracy(50)
	if acc > 20 {
		t.Errorf("moveAccuracy(50) = %f, want < 20", acc)
	}

	// Huge loss -> clamped to 0
	acc = moveAccuracy(200)
	if acc != 0 {
		t.Errorf("moveAccuracy(200) = %f, want 0", acc)
	}
}

func TestPlayerAccuracy(t *testing.T) {
	// With equal weights, result is (weighted_mean + harmonic_mean) / 2.
	// For [90, 80, 100] with equal weights:
	//   weighted_mean = (90+80+100)/3 = 90
	//   harmonic_mean = 3 / (1/90 + 1/80 + 1/100) ≈ 89.26
	//   result ≈ (90 + 89.26) / 2 ≈ 89.63
	accs := []float64{90, 80, 100}
	weights := []float64{1, 1, 1}
	got := playerAccuracy(accs, weights)
	hm := 3 / (1.0/90 + 1.0/80 + 1.0/100)
	wm := (90.0 + 80.0 + 100.0) / 3
	want := (wm + hm) / 2
	if math.Abs(got-want) > 0.001 {
		t.Errorf("playerAccuracy([90,80,100]) = %f, want %f", got, want)
	}

	// Unequal weights: higher-weighted moves count more in weighted mean.
	accs2 := []float64{80, 100}
	weights2 := []float64{3, 1} // 80 has 3x the weight of 100
	got2 := playerAccuracy(accs2, weights2)
	wm2 := (80*3 + 100*1) / 4.0
	hm2 := 2 / (1.0/80 + 1.0/100)
	want2 := (wm2 + hm2) / 2
	if math.Abs(got2-want2) > 0.001 {
		t.Errorf("playerAccuracy([80,100] w=[3,1]) = %f, want %f", got2, want2)
	}

	// Zeros are excluded from harmonic mean but included in weighted mean.
	accs3 := []float64{80, 0, 100}
	weights3 := []float64{1, 1, 1}
	got3 := playerAccuracy(accs3, weights3)
	hm3 := 2 / (1.0/80 + 1.0/100) // zeros excluded from harmonic
	wm3 := (80.0 + 0.0 + 100.0) / 3
	want3 := (wm3 + hm3) / 2
	if math.Abs(got3-want3) > 0.001 {
		t.Errorf("playerAccuracy([80,0,100]) = %f, want %f", got3, want3)
	}

	// All zeros → 0.
	got4 := playerAccuracy([]float64{0, 0}, []float64{1, 1})
	if got4 != 0 {
		t.Errorf("playerAccuracy([0,0]) = %f, want 0", got4)
	}

	got5 := playerAccuracy(nil, nil)
	if got5 != 0 {
		t.Errorf("playerAccuracy(nil) = %f, want 0", got5)
	}
}

func TestACPL(t *testing.T) {
	losses := []float64{10, 20, 30}
	got := acpl(losses)
	if got != 20 {
		t.Errorf("acpl([10,20,30]) = %f, want 20", got)
	}

	got = acpl(nil)
	if got != 0 {
		t.Errorf("acpl(nil) = %f, want 0", got)
	}
}

func intPtr(n int) *int { return &n }
