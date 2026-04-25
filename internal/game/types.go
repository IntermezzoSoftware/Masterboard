package game

// GameSummary is a lightweight view of a game used in list/search results.
type GameSummary struct {
	ID              string   `json:"id"`
	White           string   `json:"white"`
	Black           string   `json:"black"`
	WhiteElo        *int     `json:"whiteElo"`
	BlackElo        *int     `json:"blackElo"`
	Result          string   `json:"result"`
	Date            string   `json:"date"`
	Event           string   `json:"event"`
	ECO             string   `json:"eco"`
	Opening         string   `json:"opening"`
	TimeControl     string   `json:"timeControl"`
	Source          string   `json:"source"`
	CollectionNames []string `json:"collectionNames"`
	FolderID        *string  `json:"folderId"`
	AnalysisStatus  *string  `json:"analysisStatus"`
}

// GameRecord is a full game record including the raw PGN.
type GameRecord struct {
	GameSummary
	Site  string `json:"site"`
	Round string `json:"round"`
	PGN   string `json:"pgn"`
}

// GameInput is the payload used to create or update a game.
type GameInput struct {
	White       string `json:"white"`
	Black       string `json:"black"`
	WhiteElo    *int   `json:"whiteElo"`
	BlackElo    *int   `json:"blackElo"`
	Result      string `json:"result"`
	Date        string `json:"date"`
	Event       string `json:"event"`
	Site        string `json:"site"`
	Round       string `json:"round"`
	ECO         string `json:"eco"`
	Opening     string `json:"opening"`
	TimeControl string `json:"timeControl"`
	Source      string `json:"source"`
	SourceID    string `json:"sourceId"`
	PGN         string `json:"pgn"`
}

// GameMetadataInput is the payload used to update editable metadata on an
// existing game. It intentionally omits pgn, time_control, and source — those
// are either updated separately or are not user-editable.
// ECO and Opening may be left empty to let the app auto-classify from the
// game's moves; setting either locks both from automatic reclassification.
type GameMetadataInput struct {
	White    string `json:"white"`
	Black    string `json:"black"`
	WhiteElo *int   `json:"whiteElo"`
	BlackElo *int   `json:"blackElo"`
	Result   string `json:"result"`
	Date     string `json:"date"`
	Event    string `json:"event"`
	Site     string `json:"site"`
	Round    string `json:"round"`
	ECO      string `json:"eco"`
	Opening  string `json:"opening"`
}

// GameFilters is used to filter and paginate the game list.
type GameFilters struct {
	Player       string `json:"player"`       // matches white or black (case-insensitive prefix)
	White        string `json:"white"`
	Black        string `json:"black"`
	Result       string `json:"result"`
	ECO          string `json:"eco"`
	DateFrom     string `json:"dateFrom"`
	DateTo       string `json:"dateTo"`
	Source       string `json:"source"`
	CollectionID      string `json:"collectionId"`      // filter to games in this collection
	FolderID          string `json:"folderId"`          // filter to games in this folder (UUID)
	IncludeSubfolders bool   `json:"includeSubfolders"` // include games in descendant folders too
	Unfiled           bool     `json:"unfiled"`           // filter to games with no folder
	PlayerNames       []string `json:"playerNames"`       // exact case-insensitive OR match (used for "Myself" multi-identity)
	TimeControls      []string `json:"timeControls"`      // categories: bullet/blitz/rapid/classical/other; OR-matched
	Limit             int      `json:"limit"`
	Offset            int      `json:"offset"`
}
