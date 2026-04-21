package storage

import (
	"math"
	"strconv"
	"testing"
)

func TestInsertGTMResult(t *testing.T) {
	db := openTestDB(t)
	id, err := db.SaveGame(sampleGame())
	if err != nil {
		t.Fatalf("SaveGame: %v", err)
	}
	if err := db.InsertGTMResult(id, "white", 8, 10, 5, true); err != nil {
		t.Fatalf("InsertGTMResult: %v", err)
	}
	var count int
	db.db.QueryRow(`SELECT COUNT(*) FROM gtm_results WHERE game_id = ?`, id).Scan(&count) //nolint:errcheck
	if count != 1 {
		t.Errorf("want 1 row, got %d", count)
	}
}

func TestGetGTMRatingDefaults(t *testing.T) {
	db := openTestDB(t)
	r, err := db.GetGTMRating()
	if err != nil {
		t.Fatalf("GetGTMRating: %v", err)
	}
	if r.Rating != 1500 {
		t.Errorf("want default rating 1500, got %d", r.Rating)
	}
	if r.GamesPlayed != 0 {
		t.Errorf("want games_played 0, got %d", r.GamesPlayed)
	}
}

func TestUpdateGTMRatingPerfectScore(t *testing.T) {
	db := openTestDB(t)
	e := 1.0 / (1.0 + math.Pow(10, float64(2000-1500)/400.0))
	expected := int(math.Round(1500 + 40*(1.0-e)))

	r, err := db.UpdateGTMRating(10, 10)
	if err != nil {
		t.Fatalf("UpdateGTMRating: %v", err)
	}
	if r.Rating != expected {
		t.Errorf("want rating %d, got %d", expected, r.Rating)
	}
	if r.GamesPlayed != 1 {
		t.Errorf("want 1 game played, got %d", r.GamesPlayed)
	}
}

func TestUpdateGTMRatingKDropsAt30(t *testing.T) {
	db := openTestDB(t)
	db.SetSetting("gtm.rating", "1500")     //nolint:errcheck
	db.SetSetting("gtm.games_played", "30") //nolint:errcheck

	e := 1.0 / (1.0 + math.Pow(10, float64(2000-1500)/400.0))
	expected := int(math.Round(1500 + 20*(1.0-e)))

	r, err := db.UpdateGTMRating(10, 10)
	if err != nil {
		t.Fatalf("UpdateGTMRating: %v", err)
	}
	if r.Rating != expected {
		t.Errorf("with K=20: want %d, got %d", expected, r.Rating)
	}
	if r.GamesPlayed != 31 {
		t.Errorf("want 31 games played, got %d", r.GamesPlayed)
	}
}

func TestUpdateGTMRatingZeroScore(t *testing.T) {
	db := openTestDB(t)
	r, err := db.UpdateGTMRating(0, 10)
	if err != nil {
		t.Fatalf("UpdateGTMRating: %v", err)
	}
	if r.Rating >= 1500 {
		t.Errorf("zero score should reduce rating, got %d", r.Rating)
	}
}

func TestGetGTMRatingRoundTrip(t *testing.T) {
	db := openTestDB(t)
	if err := db.SetSetting("gtm.rating", "1600"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	if err := db.SetSetting("gtm.games_played", "5"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	r, err := db.GetGTMRating()
	if err != nil {
		t.Fatalf("GetGTMRating: %v", err)
	}
	if r.Rating != 1600 {
		t.Errorf("want 1600, got %d", r.Rating)
	}
	if r.GamesPlayed != 5 {
		t.Errorf("want 5, got %d", r.GamesPlayed)
	}
	_ = strconv.Itoa
}
