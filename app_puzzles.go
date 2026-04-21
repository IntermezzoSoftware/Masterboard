package main

import (
	"fmt"
	"time"

	"github.com/IntermezzoSoftware/Masterboard/internal/storage"
)

func (a *App) ExtractPuzzles(gameID string) (int, error) {
	if err := a.requireDB(); err != nil {
		return 0, err
	}
	return a.db.ExtractPuzzles(gameID)
}

func (a *App) ExtractAllPuzzles() (int, error) {
	if err := a.requireDB(); err != nil {
		return 0, err
	}
	return a.db.ExtractAllPuzzles()
}

func (a *App) GetPuzzleSession(limit int, filters storage.PuzzleFilters) ([]storage.PersonalPuzzle, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetPuzzleSession(limit, filters)
}

func (a *App) RecordPuzzleResult(puzzleID string, correct bool) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	return a.db.RecordPuzzleResult(puzzleID, correct)
}

func (a *App) GetPuzzleSummary(since string) (storage.PuzzleSummary, error) {
	if err := a.requireDB(); err != nil {
		return storage.PuzzleSummary{}, err
	}
	t, err := time.Parse(time.RFC3339, since)
	if err != nil {
		return storage.PuzzleSummary{}, fmt.Errorf("invalid since timestamp: %w", err)
	}
	return a.db.GetPuzzleSummary(t)
}

func (a *App) GetPuzzleCount() (int, error) {
	if err := a.requireDB(); err != nil {
		return 0, err
	}
	return a.db.GetPuzzleCount()
}

func (a *App) GetTacticsLobbyStats(filters storage.PuzzleFilters) (storage.TacticsLobbyStats, error) {
	if err := a.requireDB(); err != nil {
		return storage.TacticsLobbyStats{}, err
	}
	return a.db.GetTacticsLobbyStats(filters)
}

func (a *App) GetPuzzleHistory(limit, offset int) ([]storage.PuzzleHistoryEntry, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetPuzzleHistory(limit, offset)
}
