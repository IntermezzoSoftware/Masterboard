package main

import "github.com/IntermezzoSoftware/Masterboard/internal/storage"

// GetGTMGame loads a game's full move list, enriched with eval data when the
// game has been analysed. Used to initialise a Guess the Move session.
func (a *App) GetGTMGame(gameID string) (*storage.GTMGame, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetGTMGame(gameID)
}

// RecordGTMResult persists a completed session and returns the updated Elo rating.
func (a *App) RecordGTMResult(gameID, colour string, pointsEarned, maxPoints, moveCount int, analysed bool) (*storage.GTMRating, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	if err := a.db.InsertGTMResult(gameID, colour, pointsEarned, maxPoints, moveCount, analysed); err != nil {
		return nil, err
	}
	r, err := a.db.UpdateGTMRating(pointsEarned, maxPoints)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// GetGTMRating returns the current GTM Elo rating and games played count.
func (a *App) GetGTMRating() (*storage.GTMRating, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	r, err := a.db.GetGTMRating()
	if err != nil {
		return nil, err
	}
	return &r, nil
}
