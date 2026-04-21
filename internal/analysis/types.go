package analysis

// All scores are from white's perspective.
type MoveEval struct {
	Ply        int      `json:"ply"`
	BestCp     *int     `json:"bestCp"`
	BestMate   *int     `json:"bestMate"`
	PlayedCp   *int     `json:"playedCp"`
	PlayedMate *int     `json:"playedMate"`
	BestPV     string   `json:"bestPv"`     // space-separated UCI principal variation from the engine
	Accuracy   float64  `json:"accuracy"`
	Nag        *int     `json:"nag"`
}

type AnalysisRecord struct {
	GameID        string   `json:"gameId"`
	Depth         int      `json:"depth"`
	WhiteAccuracy *float64 `json:"whiteAccuracy"`
	BlackAccuracy *float64 `json:"blackAccuracy"`
	WhiteACPL     *float64 `json:"whiteAcpl"`
	BlackACPL     *float64 `json:"blackAcpl"`
	Status        string   `json:"status"` // pending|running|complete|error
	ErrorMsg      string   `json:"errorMsg"`
	AnalysedAt    string   `json:"analysedAt"`
	PgnAnnotated  bool     `json:"pgnAnnotated"`
}

// GameAnalysisResult bundles the analysis header with per-move evaluations.
type GameAnalysisResult struct {
	AnalysisRecord
	Evals        []MoveEval `json:"evals"`
	AppliedEvals []MoveEval `json:"appliedEvals"`
}
