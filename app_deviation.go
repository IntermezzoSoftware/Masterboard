package main

import "github.com/IntermezzoSoftware/Masterboard/internal/storage"

func (a *App) DetectDeviation(gameID string) (*storage.DeviationResult, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.DetectDeviation(gameID)
}

func (a *App) GetGameDeviation(gameID string) (*storage.DeviationResult, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetGameDeviation(gameID)
}

func (a *App) DetectDeviations(gameIDs []string) ([]storage.DeviationResult, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.DetectDeviationsForGames(gameIDs)
}
