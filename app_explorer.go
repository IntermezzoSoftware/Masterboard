package main

import (
	"context"
	"fmt"
	"log"
	"sync/atomic"

	"github.com/IntermezzoSoftware/Masterboard/internal/storage"
)

type PersonalPositionFilters struct {
	FolderID     string   `json:"folderId"`
	CollectionID string   `json:"collectionId"`
	PlayerName   string   `json:"playerName"`
	PlayerNames  []string `json:"playerNames"` // multi-identity "Myself" filter
	PlayerSide   string   `json:"playerSide"`  // "white", "black", or ""
	SortBy       string   `json:"sortBy"`      // "elo" (default) or "date"
	DateFrom     string   `json:"dateFrom"`    // "YYYY-MM-DD"
	DateTo       string   `json:"dateTo"`      // "YYYY-MM-DD" inclusive
}

func (a *App) GetPersonalPositionStats(fen string, filters PersonalPositionFilters) ([]storage.PersonalMoveStat, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetPersonalPositionStats(fen, storage.PositionFilters{
		FolderID:     filters.FolderID,
		CollectionID: filters.CollectionID,
		PlayerName:   filters.PlayerName,
		PlayerNames:  filters.PlayerNames,
		PlayerSide:   filters.PlayerSide,
		DateFrom:     filters.DateFrom,
		DateTo:       filters.DateTo,
	})
}

func (a *App) GetPersonalGamesAtPosition(fen string, limit int, filters PersonalPositionFilters) ([]storage.PersonalGameSummary, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 10
	}
	return a.db.GetPersonalGamesAtPosition(fen, limit, storage.PositionFilters{
		FolderID:     filters.FolderID,
		CollectionID: filters.CollectionID,
		PlayerName:   filters.PlayerName,
		PlayerNames:  filters.PlayerNames,
		PlayerSide:   filters.PlayerSide,
		SortBy:       filters.SortBy,
		DateFrom:     filters.DateFrom,
		DateTo:       filters.DateTo,
	})
}

type PersonalIndexingStatusResult struct {
	Indexed int `json:"indexed"`
	Total   int `json:"total"`
}

func (a *App) GetPersonalIndexingStatus() (PersonalIndexingStatusResult, error) {
	total := atomic.LoadInt64(&a.indexingTotal)
	if total > 0 {
		return PersonalIndexingStatusResult{
			Indexed: int(atomic.LoadInt64(&a.indexingDone)),
			Total:   int(total),
		}, nil
	}
	indexed, err := a.db.IndexedGameCount()
	if err != nil {
		return PersonalIndexingStatusResult{}, err
	}
	dbTotal, err := a.db.GameCount()
	if err != nil {
		return PersonalIndexingStatusResult{}, err
	}
	return PersonalIndexingStatusResult{
		Indexed: int(indexed),
		Total:   int(dbTotal),
	}, nil
}

func (a *App) GetPlayerSuggestions(prefix string) ([]string, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetPlayerSuggestions(prefix)
}

func (a *App) GetIdentityNames() ([]string, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	names := a.db.GetIdentityNames()
	if names == nil {
		names = []string{}
	}
	return names, nil
}

func (a *App) ReindexPersonalGames() error {
	if a.db == nil {
		return fmt.Errorf("database not available")
	}

	total, err := a.db.GameCount()
	if err != nil {
		return fmt.Errorf("count games: %w", err)
	}
	atomic.StoreInt64(&a.indexingDone, 0)
	atomic.StoreInt64(&a.indexingTotal, total)

	go func() {
		if err := a.db.IndexAllGames(context.Background(), func(done, _ int) {
			atomic.StoreInt64(&a.indexingDone, int64(done))
		}); err != nil {
			log.Printf("[position-index] ReindexPersonalGames failed: %v", err)
		}
		// Reset counters so GetPersonalIndexingStatus falls back to DB queries.
		atomic.StoreInt64(&a.indexingDone, 0)
		atomic.StoreInt64(&a.indexingTotal, 0)
	}()
	return nil
}
