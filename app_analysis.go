package main

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"sync"

	"github.com/IntermezzoSoftware/Masterboard/internal/analysis"
	"github.com/IntermezzoSoftware/Masterboard/internal/engine"
)

const maxAnalysisWorkers = 4

func (a *App) engineSettingInt(key string, defaultVal int) int {
	if a.db == nil {
		return defaultVal
	}
	s, err := a.db.GetSetting(key)
	if err != nil || s == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return defaultVal
	}
	return n
}

type AnalysisProgress struct {
	GameID    string `json:"gameId"`
	Ply       int    `json:"ply"`
	TotalPlies int   `json:"totalPlies"`
}

type AnalysisComplete struct {
	GameID        string   `json:"gameId"`
	WhiteAccuracy *float64 `json:"whiteAccuracy"`
	BlackAccuracy *float64 `json:"blackAccuracy"`
	WhiteACPL     *float64 `json:"whiteAcpl"`
	BlackACPL     *float64 `json:"blackAcpl"`
	Status        string   `json:"status"`
	ErrorMsg      string   `json:"errorMsg"`
}

type AnalysisQueueUpdate struct {
	Remaining int `json:"remaining"`
	Active    int `json:"active"`
}

func (a *App) AnalyseGame(gameID string) error {
	return a.AnalyseGames([]string{gameID})
}

// enqueueGamesLocked appends or prepends gameIDs to the analysis queue.
// Caller MUST hold analysisMu.
func (a *App) enqueueGamesLocked(gameIDs []string, front bool) {
	if front {
		a.analysisQueue = append(gameIDs, a.analysisQueue...)
	} else {
		a.analysisQueue = append(a.analysisQueue, gameIDs...)
	}
}

// Caller must NOT hold analysisMu.
func (a *App) enqueueGames(gameIDs []string, front bool) {
	a.analysisMu.Lock()
	defer a.analysisMu.Unlock()
	a.enqueueGamesLocked(gameIDs, front)
}

func (a *App) AnalyseGames(gameIDs []string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	if len(gameIDs) == 0 {
		return nil
	}

	a.analysisMu.Lock()
	defer a.analysisMu.Unlock()

	for _, id := range gameIDs {
		if err := a.db.UpsertGameAnalysis(id, a.engineSettingInt("engine.analysisDepth", analysis.DefaultDepthAB), "pending"); err != nil {
			log.Printf("[analysis] upsert pending failed for %s: %v", id, err)
		}
	}

	a.enqueueGamesLocked(gameIDs, false)
	log.Printf("[analysis] queued %d game(s) for analysis", len(gameIDs))

	if a.analysisCancel == nil {
		ctx, cancel := context.WithCancel(a.ctx)
		a.analysisCancel = cancel
		a.analysisActive = make(map[string]bool)

		// Scale workers inversely with thread count so total threads stay bounded.
		threads := a.engineSettingInt("engine.threads", 1)
		numWorkers := maxAnalysisWorkers
		if threads > 1 {
			numWorkers = maxAnalysisWorkers / threads
			if numWorkers < 1 {
				numWorkers = 1
			}
		}
		if numWorkers > len(a.analysisQueue) {
			numWorkers = len(a.analysisQueue)
		}

		var wg sync.WaitGroup
		wg.Add(numWorkers)
		for i := 0; i < numWorkers; i++ {
			go func(workerID int) {
				defer wg.Done()
				a.analysisWorker(ctx, workerID)
			}(i)
		}

		go func() {
			wg.Wait()
			a.analysisMu.Lock()
			a.analysisCancel = nil
			for _, eng := range a.analysisEngines {
				if eng != nil {
					eng.Quit()
				}
			}
			a.analysisEngines = nil
			a.analysisMu.Unlock()
			log.Printf("[analysis] all workers finished")
		}()
	}

	a.emitQueueUpdateLocked()
	return nil
}

func (a *App) GetQueueStatus() AnalysisQueueUpdate {
	a.analysisMu.Lock()
	defer a.analysisMu.Unlock()
	return AnalysisQueueUpdate{
		Remaining: len(a.analysisQueue),
		Active:    len(a.analysisActive),
	}
}

func (a *App) GetGameAnalysis(gameID string) (*analysis.GameAnalysisResult, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetGameAnalysis(gameID)
}

func (a *App) CancelAnalysis() error {
	a.analysisMu.Lock()
	hadCancel := a.analysisCancel != nil
	if a.analysisCancel != nil {
		a.analysisCancel()
	}
	queueLen := len(a.analysisQueue)
	a.analysisQueue = nil
	a.analysisMu.Unlock()
	log.Printf("[analysis] cancel requested (hadCancel=%v, queueCleared=%d)", hadCancel, queueLen)

	if a.db != nil {
		ids, err := a.db.CancelActiveAnalyses()
		if err != nil {
			log.Printf("[analysis] cancel DB update: %v", err)
		}
		log.Printf("[analysis] cancelled %d game(s) in DB", len(ids))
		for _, id := range ids {
			if a.emitFn != nil {
				a.emitFn("analysis:complete", AnalysisComplete{
					GameID: id,
					Status: "cancelled",
				})
			}
		}
	}

	return nil
}

func (a *App) analysisWorker(ctx context.Context, workerID int) {
	// Lazily launch a dedicated engine for this worker.
	eng, err := a.getOrLaunchAnalysisEngine(workerID)
	if err != nil {
		log.Printf("[analysis] worker %d: failed to launch engine: %v", workerID, err)
		// Drain remaining queued games and fail them so they don't stay as "pending" forever.
		for {
			gameID := a.dequeueGame()
			if gameID == "" {
				return
			}
			a.failAnalysis(gameID, fmt.Sprintf("engine launch failed: %v", err))
		}
	}

	for {
		gameID := a.dequeueGame()
		if gameID == "" {
			return // queue empty
		}

		a.processGame(ctx, eng, workerID, gameID)
	}
}

func (a *App) dequeueGame() string {
	a.analysisMu.Lock()
	defer a.analysisMu.Unlock()

	if len(a.analysisQueue) == 0 {
		return ""
	}
	gameID := a.analysisQueue[0]
	a.analysisQueue = a.analysisQueue[1:]
	a.analysisActive[gameID] = true
	a.emitQueueUpdateLocked()
	return gameID
}

func (a *App) processGame(ctx context.Context, eng *engine.Manager, workerID int, gameID string) {
	defer func() {
		a.analysisMu.Lock()
		delete(a.analysisActive, gameID)
		a.emitQueueUpdateLocked()
		a.analysisMu.Unlock()
	}()

	rec, err := a.db.GetGame(gameID)
	if err != nil {
		a.failAnalysis(gameID, fmt.Sprintf("load game: %v", err))
		return
	}

	if err := a.db.UpdateAnalysisStatus(gameID, "running", ""); err != nil {
		log.Printf("[analysis] worker %d: update status: %v", workerID, err)
	}

	engType := detectEngineType(eng.EngineName())
	depth := a.engineSettingInt("engine.analysisDepth", analysis.DefaultDepthAB)

	evals, whiteAcc, blackAcc, whiteACPL, blackACPL, err := analysis.AnalyseGame(
		ctx, eng, engType, rec.PGN, depth,
		func(ply, totalPlies int) {
			if a.emitFn != nil {
				a.emitFn("analysis:progress", AnalysisProgress{
					GameID:     gameID,
					Ply:        ply,
					TotalPlies: totalPlies,
				})
			}
		},
	)
	if err != nil {
		// Context cancellation means the user cancelled — don't treat as error.
		// CancelAnalysis already updated the DB and emitted the event.
		if ctx.Err() != nil {
			return
		}
		a.failAnalysis(gameID, err.Error())
		return
	}

	if err := a.db.CompleteAnalysis(gameID, whiteAcc, blackAcc, whiteACPL, blackACPL, evals); err != nil {
		a.failAnalysis(gameID, fmt.Sprintf("complete analysis: %v", err))
		return
	}

	// Extract puzzles from this game's analysis non-blocking — failure is non-critical.
	if db := a.db; db != nil {
		go func() {
			if _, err := db.ExtractPuzzles(gameID); err != nil {
				log.Printf("[analysis] puzzle extraction for game %s: %v", gameID, err)
			}
		}()
	}

	// Update per-position accuracy from this game's evals (non-blocking).
	if db := a.db; db != nil {
		evalsSnap := evals
		pgnSnap := rec.PGN
		go func() {
			if err := db.UpdatePositionAccuracyFromEvals(gameID, pgnSnap, evalsSnap); err != nil {
				log.Printf("[analysis] accuracy update for game %s: %v", gameID, err)
			}
		}()
	}

	if a.emitFn != nil {
		a.emitFn("analysis:complete", AnalysisComplete{
			GameID:        gameID,
			WhiteAccuracy: &whiteAcc,
			BlackAccuracy: &blackAcc,
			WhiteACPL:     &whiteACPL,
			BlackACPL:     &blackACPL,
			Status:        "complete",
		})
	}
}

func (a *App) failAnalysis(gameID, errMsg string) {
	log.Printf("[analysis] failed game %s: %s", gameID, errMsg)
	if a.db != nil {
		a.db.UpdateAnalysisStatus(gameID, "error", errMsg)
	}
	if a.emitFn != nil {
		a.emitFn("analysis:complete", AnalysisComplete{
			GameID:   gameID,
			Status:   "error",
			ErrorMsg: errMsg,
		})
	}
}

func (a *App) getOrLaunchAnalysisEngine(workerID int) (*engine.Manager, error) {
	a.analysisMu.Lock()
	defer a.analysisMu.Unlock()

	// Grow the engines slice if needed.
	for len(a.analysisEngines) <= workerID {
		a.analysisEngines = append(a.analysisEngines, nil)
	}

	if a.analysisEngines[workerID] != nil {
		return a.analysisEngines[workerID], nil
	}

	// Use the same engine path as the interactive engine.
	a.slot1.mu.Lock()
	path := a.slot1.path
	a.slot1.mu.Unlock()

	if path == "" {
		return nil, fmt.Errorf("no engine path configured")
	}

	m := engine.NewManager(true)
	if err := m.Launch(path); err != nil {
		return nil, fmt.Errorf("launch analysis engine %d: %w", workerID, err)
	}

	// Configure using persisted engine settings.
	m.SetOption("Threads", strconv.Itoa(a.engineSettingInt("engine.threads", 1)))
	m.SetOption("Hash", strconv.Itoa(a.engineSettingInt("engine.hash", 16)))

	a.analysisEngines[workerID] = m
	log.Printf("[analysis] worker %d: engine launched (id=%q)", workerID, m.EngineName())
	return m, nil
}

// Caller must hold analysisMu.
func (a *App) emitQueueUpdateLocked() {
	if a.emitFn != nil {
		a.emitFn("analysis:queue-update", AnalysisQueueUpdate{
			Remaining: len(a.analysisQueue),
			Active:    len(a.analysisActive),
		})
	}
}
