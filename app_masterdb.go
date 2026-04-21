package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/IntermezzoSoftware/Masterboard/internal/masterdb"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type MasterDBStatus struct {
	State      string   `json:"state"`      // "not-configured" | "indexed"
	Importing  bool     `json:"importing"`  // true while a background import is running
	TotalGames int64    `json:"totalGames"`
	FileCount  int64    `json:"fileCount"`
	LastImport string   `json:"lastImport"` // ISO-8601 UTC or ""
	Filenames  []string `json:"filenames"`  // distinct source filenames, for hover tooltip
}

type MasterDBProgressEvent struct {
	GamesProcessed int    `json:"gamesProcessed"`
	CurrentFile    string `json:"currentFile"` // basename of current file
	FileIndex      int    `json:"fileIndex"`   // 1-based
	TotalFiles     int    `json:"totalFiles"`
	Phase          string `json:"phase"`          // "processing", "building-stats", "building-index", "optimizing"
	PhaseDone      int    `json:"phaseDone"`      // rows written in current phase (stats/index)
	PhaseTotal     int    `json:"phaseTotal"`     // total rows to write in current phase
}

type MasterDBCompleteEvent struct {
	Success      bool   `json:"success"`
	GamesIndexed int    `json:"gamesIndexed"`
	ErrorMsg     string `json:"errorMsg"`
}

type importPerfLog struct {
	Timestamp    string  `json:"timestamp"`
	GamesIndexed int     `json:"gamesIndexed"`
	TotalSecs    float64 `json:"totalSecs"`
	EncodeSecs   float64 `json:"encodeSecs"`
	GamesSecs    float64 `json:"gamesSecs"`
	StatsSecs    float64 `json:"statsSecs"`
	IndexSecs    float64 `json:"indexSecs"`
	Workers      int     `json:"workers"`
	SkippedDupes int     `json:"skippedDupes"`
	Replace      bool    `json:"replace"`
}

func (a *App) GetMasterDBStatus() (*MasterDBStatus, error) {
	a.masterDBMu.Lock()
	mdb := a.masterDB
	importing := a.importCancel != nil
	a.masterDBMu.Unlock()

	if mdb == nil {
		return &MasterDBStatus{State: "not-configured", Importing: importing}, nil
	}
	s, err := mdb.GetImportSummary()
	if err != nil {
		log.Printf("[masterdb] GetImportSummary: %v", err)
		return &MasterDBStatus{State: "not-configured", Importing: importing}, nil
	}
	filenames := s.Filenames
	if filenames == nil {
		filenames = []string{}
	}
	return &MasterDBStatus{
		State:      "indexed",
		Importing:  importing,
		TotalGames: s.TotalGames,
		FileCount:  s.FileCount,
		LastImport: s.LastImport,
		Filenames:  filenames,
	}, nil
}

func (a *App) OpenMasterDBFileDialog() ([]string, error) {
	paths, err := wailsRuntime.OpenMultipleFilesDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select PGN Files for Master Database",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "PGN Files (*.pgn)", Pattern: "*.pgn"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, err
	}
	return paths, nil
}

func (a *App) GetFileSizes(paths []string) []int64 {
	sizes := make([]int64, len(paths))
	for i, p := range paths {
		if info, err := os.Stat(p); err == nil {
			sizes[i] = info.Size()
		}
	}
	return sizes
}

func (a *App) StartMasterDBImport(paths []string, replace bool) error {
	if len(paths) == 0 {
		return fmt.Errorf("no files selected")
	}
	a.masterDBMu.Lock()
	if a.importCancel != nil {
		a.masterDBMu.Unlock()
		return fmt.Errorf("import already in progress")
	}
	ctx, cancel := context.WithCancel(a.ctx)
	a.importCancel = cancel
	a.masterDBMu.Unlock()

	go a.runMasterDBImport(ctx, paths, replace)
	return nil
}

func (a *App) CancelMasterDBImport() error {
	a.masterDBMu.Lock()
	defer a.masterDBMu.Unlock()
	if a.importCancel != nil {
		a.importCancel()
	}
	return nil
}

func (a *App) ClearMasterDB() error {
	a.masterDBMu.Lock()
	defer a.masterDBMu.Unlock()

	if a.masterDB != nil {
		if err := a.masterDB.Close(); err != nil {
			log.Printf("[masterdb] ClearMasterDB close: %v", err)
		}
		a.masterDB = nil
	}

	statsPath, indexPath := masterdb.SplitDBPaths(a.masterDBPath)
	for _, p := range []string{a.masterDBPath, statsPath, indexPath} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			log.Printf("[masterdb] ClearMasterDB remove %s: %v", p, err)
		}
	}
	return nil
}

func (a *App) GetMasterDBPath() string {
	a.masterDBMu.Lock()
	defer a.masterDBMu.Unlock()
	return a.masterDBPath
}

func (a *App) GetMasterDBDir() string {
	a.masterDBMu.Lock()
	defer a.masterDBMu.Unlock()
	return filepath.Dir(a.masterDBPath)
}

func (a *App) OpenMasterDBDirectoryDialog() (string, error) {
	return wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Choose Master Database Storage Folder",
	})
}

func (a *App) SetMasterDBStorageDir(dir string) error {
	if dir == "" {
		return fmt.Errorf("directory path is empty")
	}

	newPath := filepath.Join(dir, "masterboard_master.db")

	a.masterDBMu.Lock()
	if a.importCancel != nil {
		a.masterDBMu.Unlock()
		return fmt.Errorf("cannot change storage location while an import is running")
	}
	oldPath := a.masterDBPath
	a.masterDBMu.Unlock()

	if filepath.Clean(newPath) == filepath.Clean(oldPath) {
		return nil
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create directory: %w", err)
	}

	// Close existing DB before moving files.
	a.masterDBMu.Lock()
	if a.masterDB != nil {
		if err := a.masterDB.Close(); err != nil {
			log.Printf("[masterdb] SetMasterDBStorageDir close: %v", err)
		}
		a.masterDB = nil
	}
	a.masterDBMu.Unlock()

	// Move all three DB files to the new location.
	oldStats, oldIndex := masterdb.SplitDBPaths(oldPath)
	newStats, newIndex := masterdb.SplitDBPaths(newPath)
	for _, pair := range [][2]string{
		{oldPath, newPath},
		{oldStats, newStats},
		{oldIndex, newIndex},
	} {
		src, dst := pair[0], pair[1]
		if _, err := os.Stat(src); os.IsNotExist(err) {
			continue
		}
		if err := moveFile(src, dst); err != nil {
			// Attempt to reopen at old path before returning the error.
			if mdb, rerr := masterdb.OpenForQuery(oldPath); rerr == nil && mdb != nil {
				a.masterDBMu.Lock()
				a.masterDB = mdb
				a.masterDBMu.Unlock()
			}
			return fmt.Errorf("move %s: %w", filepath.Base(src), err)
		}
	}

	a.masterDBMu.Lock()
	a.masterDBPath = newPath
	a.masterDBMu.Unlock()

	if a.db != nil {
		if err := a.db.SetSetting("masterdb.path", newPath); err != nil {
			log.Printf("[masterdb] save path setting: %v", err)
		}
	}

	if mdb, err := masterdb.OpenForQuery(newPath); err != nil {
		log.Printf("[masterdb] reopen after move: %v", err)
	} else if mdb != nil {
		a.masterDBMu.Lock()
		a.masterDB = mdb
		a.masterDBMu.Unlock()
	}

	log.Printf("[masterdb] storage moved to %s", newPath)
	return nil
}

// Falls back to copy+delete for cross-volume moves.
func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(dst)
		return err
	}
	return os.Remove(src)
}

func (a *App) GetMasterPositionStats(fen string) ([]masterdb.MoveStat, error) {
	a.masterDBMu.Lock()
	mdb := a.masterDB
	a.masterDBMu.Unlock()
	if mdb == nil {
		return nil, nil
	}
	stats, err := mdb.GetPositionStats(fen)
	if err != nil {
		return nil, err
	}
	if stats == nil {
		stats = []masterdb.MoveStat{}
	}
	return stats, nil
}

func (a *App) GetMasterGamesAtPosition(fen string, limit int) ([]masterdb.GameSummary, error) {
	a.masterDBMu.Lock()
	mdb := a.masterDB
	a.masterDBMu.Unlock()
	if mdb == nil {
		return nil, nil
	}
	games, err := mdb.GetGamesAtPosition(fen, limit)
	if err != nil {
		return nil, err
	}
	if games == nil {
		games = []masterdb.GameSummary{}
	}
	return games, nil
}

func (a *App) GetMasterGamePGN(gameID int64) (string, error) {
	a.masterDBMu.Lock()
	mdb := a.masterDB
	a.masterDBMu.Unlock()
	if mdb == nil {
		return "", fmt.Errorf("master database not available")
	}
	return mdb.GetGamePGN(gameID)
}

func (a *App) GetMasterGameCount() (int64, error) {
	a.masterDBMu.Lock()
	mdb := a.masterDB
	a.masterDBMu.Unlock()
	if mdb == nil {
		return 0, nil
	}
	return mdb.GameCount()
}

func (a *App) runMasterDBImport(ctx context.Context, paths []string, replace bool) {
	defer func() {
		a.masterDBMu.Lock()
		a.importCancel = nil
		a.masterDBMu.Unlock()
	}()

	// Close the existing query connection before import. RunIndexer calls
	// Open() which sets PRAGMA journal_mode = OFF; SQLite requires exclusive
	// access to switch away from WAL mode, so the import fails immediately if
	// the query connection is still open. We reopen on both success and failure.
	a.masterDBMu.Lock()
	if a.masterDB != nil {
		if err := a.masterDB.Close(); err != nil {
			log.Printf("[masterdb] close before import: %v", err)
		}
		a.masterDB = nil
	}
	a.masterDBMu.Unlock()

	reopenDB := func() {
		mdb, err := masterdb.OpenForQuery(a.masterDBPath)
		if err != nil {
			log.Printf("[masterdb] reopen after import: %v", err)
			return
		}
		a.masterDBMu.Lock()
		a.masterDB = mdb
		a.masterDBMu.Unlock()
	}

	totalFiles := len(paths)
	fileNames := make([]string, totalFiles)
	for i, p := range paths {
		fileNames[i] = filepath.Base(p)
	}

	var currentPhase string
	var lastGamesProcessed int

	cfg := masterdb.IndexConfig{
		OutputPath: a.masterDBPath,
		Replace:    replace,
		Ctx:        ctx,
		ProgressFn: func(gamesProcessed, fileIdx int) {
			if a.emitFn == nil {
				return
			}
			lastGamesProcessed = gamesProcessed
			name := ""
			if fileIdx >= 0 && fileIdx < len(fileNames) {
				name = fileNames[fileIdx]
			}
			a.emitFn("masterdb:progress", MasterDBProgressEvent{
				GamesProcessed: gamesProcessed,
				CurrentFile:    name,
				FileIndex:      fileIdx + 1,
				TotalFiles:     totalFiles,
				Phase:          currentPhase,
			})
		},
		PhaseFn: func(phase string) {
			currentPhase = phase
			if a.emitFn == nil {
				return
			}
			a.emitFn("masterdb:progress", MasterDBProgressEvent{
				GamesProcessed: lastGamesProcessed,
				FileIndex:      totalFiles,
				TotalFiles:     totalFiles,
				Phase:          phase,
			})
		},
		PhaseProgressFn: func(done, total int) {
			if a.emitFn == nil {
				return
			}
			a.emitFn("masterdb:progress", MasterDBProgressEvent{
				GamesProcessed: lastGamesProcessed,
				FileIndex:      totalFiles,
				TotalFiles:     totalFiles,
				Phase:          currentPhase,
				PhaseDone:      done,
				PhaseTotal:     total,
			})
		},
	}

	result, err := masterdb.RunIndexer(paths, cfg)

	if ctx.Err() != nil {
		reopenDB()
		if a.emitFn != nil {
			a.emitFn("masterdb:complete", MasterDBCompleteEvent{
				Success:  false,
				ErrorMsg: "cancelled",
			})
		}
		return
	}

	if err != nil {
		log.Printf("[masterdb] import failed: %v", err)
		reopenDB()
		if a.emitFn != nil {
			a.emitFn("masterdb:complete", MasterDBCompleteEvent{
				Success:  false,
				ErrorMsg: err.Error(),
			})
		}
		return
	}

	mdb, openErr := masterdb.OpenForQuery(a.masterDBPath)
	if openErr != nil {
		log.Printf("[masterdb] reopen after import: %v", openErr)
	}
	a.masterDBMu.Lock()
	a.masterDB = mdb
	a.masterDBMu.Unlock()

	log.Printf("[masterdb] import complete: %d games in %v  encode=%.1fs  games=%.1fs  stats=%.1fs  idx=%.1fs  workers=%d  dupes=%d",
		result.GamesIndexed, result.TotalDuration,
		result.EncodeTime.Seconds(), result.GamesWriteTime.Seconds(),
		result.StatsWriteTime.Seconds(), result.IndexWriteTime.Seconds(),
		result.Workers, result.SkippedDupes)

	perf := importPerfLog{
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		GamesIndexed: result.GamesIndexed,
		TotalSecs:    result.TotalDuration.Seconds(),
		EncodeSecs:   result.EncodeTime.Seconds(),
		GamesSecs:    result.GamesWriteTime.Seconds(),
		StatsSecs:    result.StatsWriteTime.Seconds(),
		IndexSecs:    result.IndexWriteTime.Seconds(),
		Workers:      result.Workers,
		SkippedDupes: result.SkippedDupes,
		Replace:      replace,
	}
	if perfBytes, err := json.MarshalIndent(perf, "", "  "); err == nil {
		perfPath := filepath.Join(filepath.Dir(a.masterDBPath), "masterboard_master_perf.json")
		if err := os.WriteFile(perfPath, perfBytes, 0644); err != nil {
			log.Printf("[masterdb] warning: write perf log: %v", err)
		}
	}

	if a.emitFn != nil {
		a.emitFn("masterdb:complete", MasterDBCompleteEvent{
			Success:      true,
			GamesIndexed: result.GamesIndexed,
		})
	}

}
