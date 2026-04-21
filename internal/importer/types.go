package importer

// ImportFilters narrows which games are fetched from an external source.
type ImportFilters struct {
	DateFrom     string   `json:"dateFrom"`     // inclusive, "YYYY-MM-DD"
	DateTo       string   `json:"dateTo"`       // inclusive, "YYYY-MM-DD"
	TimeControls []string `json:"timeControls"` // subset of "bullet","blitz","rapid","classical","correspondence"; empty = all
	MaxGames     int      `json:"maxGames"`     // 0 = no limit
}
