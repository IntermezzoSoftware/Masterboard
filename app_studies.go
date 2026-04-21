package main

import (
	"fmt"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
	"github.com/IntermezzoSoftware/Masterboard/internal/importer"
	pgnPkg "github.com/IntermezzoSoftware/Masterboard/internal/pgn"
)

// ImportStudyRequest is the payload for ImportLichessStudy.
type ImportStudyRequest struct {
	StudyID        string   `json:"studyId"`
	ChapterIDs     []string `json:"chapterIds"`
	Destination    string   `json:"destination"`
	RepertoireID   string   `json:"repertoireId"`
	RepertoireName string   `json:"repertoireName"`
	Colour         string   `json:"colour"`
	FolderID       string   `json:"folderId"`
}

// ImportStudyResult reports what was imported.
type ImportStudyResult struct {
	ChaptersImported int    `json:"chaptersImported"`
	MovesImported    int    `json:"movesImported"`
	GamesImported    int    `json:"gamesImported"`
	Duplicates       int    `json:"duplicates"`
	RepertoireID     string `json:"repertoireId"`
}

// ListLichessStudies returns all studies owned by the connected Lichess account.
func (a *App) ListLichessStudies() ([]importer.StudySummary, error) {
	token, _ := a.db.GetSetting("lichess.oauth_token")
	username, _ := a.db.GetSetting("lichess.oauth_username")
	if token == "" || username == "" {
		return nil, fmt.Errorf("not connected")
	}
	return importer.FetchStudiesByUser(username, token)
}

// FetchLichessStudyMeta returns chapter names and orientations for the preview step.
func (a *App) FetchLichessStudyMeta(studyID string) (importer.StudyMeta, error) {
	token, _ := a.db.GetSetting("lichess.oauth_token")
	return importer.FetchStudyMeta(studyID, token)
}

// ImportLichessStudy fetches a study and imports it to the chosen destination.
func (a *App) ImportLichessStudy(req ImportStudyRequest) (ImportStudyResult, error) {
	token, _ := a.db.GetSetting("lichess.oauth_token")

	fullPGN, err := importer.FetchStudyPGN(req.StudyID, token)
	if err != nil {
		return ImportStudyResult{}, fmt.Errorf("fetch study PGN: %w", err)
	}

	allChapters := importer.SplitChapterPGNs(fullPGN)
	chapters := filterChapters(allChapters, req.ChapterIDs)

	if req.Destination == "games" {
		return a.importStudyAsGames(chapters, req.FolderID)
	}
	return a.importStudyAsRepertoire(chapters, req)
}

func filterChapters(all []string, ids []string) []string {
	if len(ids) == 0 {
		return all
	}
	idSet := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		idSet[id] = struct{}{}
	}
	var filtered []string
	for _, ch := range all {
		site := importer.ExtractPGNHeader(ch, "Site")
		chapterID := splitLast(site, "/")
		if _, ok := idSet[chapterID]; ok {
			filtered = append(filtered, ch)
		}
	}
	return filtered
}

func (a *App) importStudyAsGames(chapters []string, folderID string) (ImportStudyResult, error) {
	var inputs []game.GameInput
	for _, ch := range chapters {
		parsed, err := game.ParsePGN(ch)
		if err != nil {
			return ImportStudyResult{}, fmt.Errorf("parse chapter PGN: %w", err)
		}
		if len(parsed) == 0 {
			continue
		}
		g := parsed[0]
		g.Source = "lichess_study"
		inputs = append(inputs, g)
	}
	ids, err := a.saveMany(inputs)
	if err != nil {
		return ImportStudyResult{}, err
	}
	if folderID != "" {
		fid := folderID
		for _, id := range ids {
			if err := a.db.MoveGameToFolder(id, &fid); err != nil {
				return ImportStudyResult{}, fmt.Errorf("move game to folder: %w", err)
			}
		}
	}
	return ImportStudyResult{
		ChaptersImported: len(inputs),
		GamesImported:    len(ids),
		Duplicates:       len(inputs) - len(ids),
	}, nil
}

func (a *App) importStudyAsRepertoire(chapters []string, req ImportStudyRequest) (ImportStudyResult, error) {
	repID := req.RepertoireID
	if repID == "" {
		var err error
		repID, err = a.db.CreateRepertoire(req.RepertoireName, req.Colour)
		if err != nil {
			return ImportStudyResult{}, fmt.Errorf("create repertoire: %w", err)
		}
	}

	var totalMoves int
	chaptersImported := 0
	for _, ch := range chapters {
		moves, err := pgnPkg.ImportChapterAsRepertoireMoves(ch, repID)
		if err != nil {
			return ImportStudyResult{}, fmt.Errorf("parse chapter: %w", err)
		}
		n, err := a.db.BatchSaveRepertoireMoves(moves)
		if err != nil {
			return ImportStudyResult{}, fmt.Errorf("save moves: %w", err)
		}
		totalMoves += n
		chaptersImported++
	}

	return ImportStudyResult{
		ChaptersImported: chaptersImported,
		MovesImported:    totalMoves,
		RepertoireID:     repID,
	}, nil
}

func splitLast(s, sep string) string {
	for i := len(s) - len(sep); i >= 0; i-- {
		if s[i:i+len(sep)] == sep {
			return s[i+len(sep):]
		}
	}
	return s
}
