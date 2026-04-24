package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	goRuntime "runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	chesslib "github.com/corentings/chess/v2"
	"github.com/IntermezzoSoftware/Masterboard/internal/analysis"
	"github.com/IntermezzoSoftware/Masterboard/internal/engine"
	"github.com/IntermezzoSoftware/Masterboard/internal/game"
	"github.com/IntermezzoSoftware/Masterboard/internal/importer"
	"github.com/IntermezzoSoftware/Masterboard/internal/masterdb"
	"github.com/IntermezzoSoftware/Masterboard/internal/opening"
	pgnPkg      "github.com/IntermezzoSoftware/Masterboard/internal/pgn"
	polyglotPkg "github.com/IntermezzoSoftware/Masterboard/internal/polyglot"
	"github.com/IntermezzoSoftware/Masterboard/internal/repertoire"
	"github.com/IntermezzoSoftware/Masterboard/internal/storage"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Named by icon colour, not by the mode they're shown in: appIconBlack is the
// black-on-transparent mark (visible against light taskbars / About panels),
// appIconWhite is the white-on-transparent mark (visible against dark taskbars).
//
//go:embed build/appicon.png
var appIconBlack []byte

//go:embed build/appicon-white.png
var appIconWhite []byte

// App is the main application struct. Public methods on App are exposed
// to the React frontend as JavaScript bindings via Wails.
type App struct {
	ctx    context.Context
	db     *storage.DB
	emitFn func(string, any)

	slot1 *engineSlot
	slot2 *engineSlot

	availableEnginesMu sync.Mutex
	availableEngines   []string

	analysisMu      sync.Mutex
	analysisEngines []*engine.Manager
	analysisCancel  context.CancelFunc
	analysisQueue   []string
	analysisActive  map[string]bool

	masterDB     *masterdb.DB
	masterDBPath string
	masterDBMu   sync.Mutex
	importCancel context.CancelFunc // non-nil while a master DB import is running

	oauthMu     sync.Mutex
	oauthCancel context.CancelFunc // non-nil while a Lichess OAuth flow is in progress

	indexingDone  int64
	indexingTotal int64

	classifier *opening.Classifier
}

// NewApp creates and returns a new App instance. The database is opened here
// (before wails.Run) so that saved window geometry can be read by main().
//
// The data directory is resolved via resolveDataDir, which release builds
// always point at os.UserConfigDir()/Masterboard. Perf-tagged builds may
// redirect it to an isolated temp directory via MASTERBOARD_DATA_DIR for the
// automated performance test harness.
func NewApp() *App {
	a := &App{
		slot1: newEngineSlot("engine:info", "engine:ready"),
		slot2: newEngineSlot("engine2:info", "engine2:ready"),
	}

	dataDir := resolveDataDir()
	dbPath := filepath.Join(dataDir, "masterboard.db")
	db, err := storage.Open(dbPath)
	if err != nil {
		log.Printf("failed to open database: %v", err)
		return a
	}
	a.db = db
	log.Printf("database opened at %s", dbPath)

	masterDBPath := filepath.Join(dataDir, "masterboard_master.db")
	if savedPath, err := db.GetSetting("masterdb.path"); err == nil && savedPath != "" {
		masterDBPath = savedPath
	}
	a.masterDBPath = masterDBPath
	if mdb, err := masterdb.OpenForQuery(masterDBPath); err != nil {
		log.Printf("warning: open master db: %v", err)
	} else if mdb != nil {
		a.masterDB = mdb
		log.Printf("master database opened at %s", masterDBPath)
	}

	classifier, err := opening.NewClassifier()
	if err != nil {
		log.Printf("failed to init opening classifier: %v", err)
	} else {
		a.classifier = classifier
		if db != nil {
			db.SetClassifier(classifier)
		}
	}

	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	if a.emitFn == nil {
		a.emitFn = func(event string, data any) {
			wailsRuntime.EventsEmit(a.ctx, event, data)
		}
	}

	// Register perf-harness event handlers. In release builds this is a
	// no-op defined in app_perf_stub.go and inlined away by the compiler.
	a.registerPerfHandlers(ctx)

	a.registerProtocol()

	if a.db != nil {
		if n, err := a.db.ResetStaleAnalyses(); err != nil {
			log.Printf("failed to reset stale analyses: %v", err)
		} else if n > 0 {
			log.Printf("reset %d stale analysis record(s)", n)
		}
		go a.db.BackfillPositionAccuracyIfNeeded()
	}

	if x, y, w, h, maximized, ok := a.SavedWindowGeometry(); ok {
		if maximized {
			// Let Windows handle the geometry itself — this produces the same
			// result as snapping to fullscreen and correctly respects the
			// taskbar, rather than manually sizing to screen dimensions which
			// can leave the window edge behind/below the taskbar.
			wailsRuntime.WindowMaximise(ctx)
		} else {
			wailsRuntime.WindowSetSize(ctx, w, h)
			if !isWindowRectVisible(x, y, w, h) {
				// Saved position points to a disconnected monitor or otherwise
				// off-screen region. Fall back to centering on the current display.
				log.Printf("saved window position (%d,%d %dx%d) is off-screen; centering", x, y, w, h)
				wailsRuntime.WindowCenter(ctx)
			} else if !setWindowPositionAbsolute("Masterboard", x, y) {
				// Non-Windows platforms (and fallback if the HWND lookup fails)
				// use Wails' own WindowSetPosition. On Windows this codepath has
				// a known work-rect-origin asymmetry with WindowGetPosition, so
				// setWindowPositionAbsolute is preferred there.
				wailsRuntime.WindowSetPosition(ctx, x, y)
			}
		}
		wailsRuntime.WindowShow(ctx)
	}

	go a.startupEngine()
}

func (a *App) domReady(_ context.Context) {
	a.emitFn("app:ready", nil)
	go a.checkAndEmitUpdate()
}

// SavedWindowGeometry returns the last-saved window position and size from the
// settings database. maximized is true when the window was closed while
// maximised; in that case x/y/w/h are still valid (they are the restored
// dimensions) but the caller should maximise the window rather than restoring
// position/size manually. ok is false if no geometry has been saved yet.
func (a *App) SavedWindowGeometry() (x, y, w, h int, maximized, ok bool) {
	if a.db == nil {
		return
	}
	xs, _ := a.db.GetSetting("window.x")
	ys, _ := a.db.GetSetting("window.y")
	ws, _ := a.db.GetSetting("window.width")
	hs, _ := a.db.GetSetting("window.height")
	if xs == "" || ys == "" || ws == "" || hs == "" {
		return
	}
	xi, ex := strconv.Atoi(xs)
	yi, ey := strconv.Atoi(ys)
	wi, ew := strconv.Atoi(ws)
	hi, eh := strconv.Atoi(hs)
	if ex != nil || ey != nil || ew != nil || eh != nil || wi <= 0 || hi <= 0 {
		return
	}
	ms, _ := a.db.GetSetting("window.maximized")
	return xi, yi, wi, hi, ms == "1", true
}

// beforeClose is called by Wails just before the window closes. It saves the
// current window position, size, and maximised state so they can be restored
// on next launch. Returning false allows the close to proceed.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	if a.db != nil {
		maximized := wailsRuntime.WindowIsMaximised(ctx)
		x, y := wailsRuntime.WindowGetPosition(ctx)
		w, h := wailsRuntime.WindowGetSize(ctx)
		maxVal := "0"
		if maximized {
			maxVal = "1"
		}
		for k, v := range map[string]string{
			"window.x":         strconv.Itoa(x),
			"window.y":         strconv.Itoa(y),
			"window.width":     strconv.Itoa(w),
			"window.height":    strconv.Itoa(h),
			"window.maximized": maxVal,
		} {
			if err := a.db.SetSetting(k, v); err != nil {
				log.Printf("failed to save window geometry %s: %v", k, err)
			}
		}
	}
	return false
}

// shutdown is called by Wails when the application is about to quit.
func (a *App) shutdown(ctx context.Context) {
	a.analysisMu.Lock()
	if a.analysisCancel != nil {
		a.analysisCancel()
	}
	for _, eng := range a.analysisEngines {
		if eng != nil {
			eng.Quit()
		}
	}
	a.analysisEngines = nil
	a.analysisMu.Unlock()

	a.slot1.quit()
	a.slot2.quit()

	if a.db != nil {
		if err := a.db.Close(); err != nil {
			log.Printf("failed to close database: %v", err)
		}
	}

	// Cancel any running master DB import and close the sidecar DB.
	a.masterDBMu.Lock()
	cancel := a.importCancel
	mdb := a.masterDB
	a.masterDB = nil
	a.masterDBMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if mdb != nil {
		if err := mdb.Close(); err != nil {
			log.Printf("failed to close master database: %v", err)
		}
	}
}

func (a *App) GetPlatform() string {
	return goRuntime.GOOS
}

func (a *App) SetTitleBarTheme(dark bool) {
	setTitleBarTheme(dark, appIconBlack, appIconWhite)
}

func (a *App) startupEngine() {
	execPath, err := os.Executable()
	if err != nil {
		log.Printf("[engine] could not determine executable path: %v", err)
		return
	}
	// Engines live in <execDir>/engines/ — both in production and dev
	// (wails dev compiles to build/bin/Masterboard.exe, so engines go in build/bin/engines/).
	execDir := filepath.Dir(execPath)
	engines := engine.DefaultEngines(execDir)

	// Prepend any user-registered custom engine paths so they appear first.
	customPaths, _ := a.loadCustomEnginePaths()
	customSet := make(map[string]struct{}, len(customPaths))
	for _, p := range customPaths {
		customSet[p] = struct{}{}
	}
	var discovered []string
	for _, p := range engines {
		if _, ok := customSet[p]; !ok {
			discovered = append(discovered, p)
		}
	}
	engines = append(append([]string(nil), customPaths...), discovered...)

	a.availableEnginesMu.Lock()
	a.availableEngines = engines
	a.availableEnginesMu.Unlock()

	if len(engines) == 0 {
		log.Printf("[engine] no engines found")
		return
	}

	// Prefer the saved engine path if it exists.
	path := engines[0]
	if a.db != nil {
		if saved, _ := a.db.GetSetting("engine.path"); saved != "" {
			path = saved
		}
	}

	a.launchEngine(path)
}


func (a *App) ListGames(filters game.GameFilters) ([]game.GameSummary, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.ListGames(filters)
}

func (a *App) GetGame(id string) (*game.GameRecord, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	rec, err := a.db.GetGame(id)
	if errors.Is(err, storage.ErrNotFound) {
		return nil, fmt.Errorf("game not found")
	}
	return rec, err
}

func (a *App) UpdateGame(id, pgn string, markAnnotated bool, appliedEvalsJSON string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	if err := a.db.UpdateGame(id, pgn); err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			return fmt.Errorf("game not found")
		}
		return err
	}
	if markAnnotated {
		var appliedEvals []analysis.MoveEval
		if appliedEvalsJSON != "" {
			if err := json.Unmarshal([]byte(appliedEvalsJSON), &appliedEvals); err != nil {
				return fmt.Errorf("parse applied evals: %w", err)
			}
		}
		if err := a.db.MarkPgnAnnotated(id, appliedEvals); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) UpdateGameMetadata(id string, m game.GameMetadataInput) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	if err := a.db.UpdateGameMetadata(id, m); err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			return fmt.Errorf("game not found")
		}
		return err
	}
	return nil
}

func (a *App) SaveGame(input game.GameInput) (string, error) {
	if err := a.requireDB(); err != nil {
		return "", err
	}
	if len(input.PGN) > 1024*1024 {
		return "", fmt.Errorf("PGN exceeds 1MB limit")
	}
	if len(input.White) > 200 {
		return "", fmt.Errorf("White player name exceeds 200 characters")
	}
	if len(input.Black) > 200 {
		return "", fmt.Errorf("Black player name exceeds 200 characters")
	}
	id, err := a.db.SaveGame(input)
	if errors.Is(err, storage.ErrDuplicate) {
		return "", fmt.Errorf("game already exists")
	}
	return id, err
}

func (a *App) FindDuplicateGame(input game.GameInput) (string, error) {
	if err := a.requireDB(); err != nil {
		return "", err
	}
	return a.db.FindDuplicateGame(input)
}

func (a *App) DeleteGame(id string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	err := a.db.DeleteGame(id)
	if errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("game not found")
	}
	return err
}


func (a *App) ImportPGNFile(path string) ([]string, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}
	inputs, err := game.ParsePGN(string(data))
	if err != nil {
		return nil, fmt.Errorf("parse pgn: %w", err)
	}
	return a.saveMany(inputs)
}

func (a *App) OpenFileDialog() (string, error) {
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Import PGN File",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "PGN Files (*.pgn)", Pattern: "*.pgn"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	return path, err
}

func (a *App) OpenDirectoryDialog() (string, error) {
	path, err := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Import PGN Folder",
	})
	return path, err
}

func (a *App) ImportPGNFolder(dir string) ([]string, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	var allIDs []string
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			log.Printf("walk error at %s: %v", path, walkErr)
			return nil // skip unreadable entries
		}
		if d.IsDir() || !strings.EqualFold(filepath.Ext(path), ".pgn") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("skipping %s: %v", path, err)
			return nil
		}
		inputs, err := game.ParsePGN(string(data))
		if err != nil {
			log.Printf("skipping %s (parse error): %v", path, err)
			return nil
		}
		ids, err := a.saveMany(inputs)
		if err != nil {
			log.Printf("skipping %s (save error): %v", path, err)
			return nil
		}
		allIDs = append(allIDs, ids...)
		return nil
	})
	return allIDs, err
}


func (a *App) ImportFromLichess(username string, filters importer.ImportFilters) (int, error) {
	if err := a.requireDB(); err != nil {
		return 0, err
	}
	games, err := importer.FetchLichess(username, filters)
	if err != nil {
		return 0, err
	}
	ids, err := a.saveMany(games)
	return len(ids), err
}

func (a *App) ImportFromChessCom(username string, filters importer.ImportFilters) (int, error) {
	if err := a.requireDB(); err != nil {
		return 0, err
	}
	games, err := importer.FetchChessCom(username, filters)
	if err != nil {
		return 0, err
	}
	ids, err := a.saveMany(games)
	return len(ids), err
}

func (a *App) PreviewFromLichess(username string, filters importer.ImportFilters) ([]game.GameInput, error) {
	return importer.FetchLichess(username, filters)
}

func (a *App) PreviewFromChessCom(username string, filters importer.ImportFilters) ([]game.GameInput, error) {
	return importer.FetchChessCom(username, filters)
}

func (a *App) ImportSelectedGames(inputs []game.GameInput) ([]string, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.saveMany(inputs)
}


func (a *App) ListCollections() ([]storage.Collection, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.ListCollections()
}

func (a *App) CreateCollection(name string) (string, error) {
	if err := a.requireDB(); err != nil {
		return "", err
	}
	return a.db.CreateCollection(name)
}

func (a *App) AddGameToCollection(gameID, collectionID string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	return a.db.AddGameToCollection(gameID, collectionID)
}

func (a *App) RemoveGameFromCollection(gameID, collectionID string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	return a.db.RemoveGameFromCollection(gameID, collectionID)
}

func (a *App) ListGameCollections(gameID string) ([]storage.Collection, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.ListGameCollections(gameID)
}

func (a *App) DeleteCollection(id string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	err := a.db.DeleteCollection(id)
	if errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("collection not found")
	}
	return err
}


func (a *App) ListFolders() ([]storage.Folder, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.ListFolders()
}

func (a *App) CreateFolder(name string, parentID *string) (string, error) {
	if err := a.requireDB(); err != nil {
		return "", err
	}
	return a.db.CreateFolder(name, parentID)
}

func (a *App) RenameFolder(id, name string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	err := a.db.RenameFolder(id, name)
	if errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("folder not found")
	}
	return err
}

func (a *App) DeleteFolder(id string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	err := a.db.DeleteFolder(id)
	if errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("folder not found")
	}
	return err
}

func (a *App) DeleteFolderWithGames(id string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	err := a.db.DeleteFolderWithGames(id)
	if errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("folder not found")
	}
	return err
}

func (a *App) MoveGameToFolder(gameID string, folderID *string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	err := a.db.MoveGameToFolder(gameID, folderID)
	if errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("game not found")
	}
	return err
}


func (a *App) GetSetting(key string) (string, error) {
	if err := a.requireDB(); err != nil {
		return "", err
	}
	return a.db.GetSetting(key)
}

func (a *App) SetSetting(key, value string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	return a.db.SetSetting(key, value)
}


func (a *App) ListRepertoires() ([]repertoire.Repertoire, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.ListRepertoires()
}

func (a *App) CreateRepertoire(name, colour string) (string, error) {
	if err := a.requireDB(); err != nil {
		return "", err
	}
	return a.db.CreateRepertoire(name, colour)
}

func (a *App) RenameRepertoire(id, name string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	err := a.db.RenameRepertoire(id, name)
	if errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("repertoire not found")
	}
	return err
}

func (a *App) DeleteRepertoire(id string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	err := a.db.DeleteRepertoire(id)
	if errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("repertoire not found")
	}
	_ = a.db.ClearDeviationCache()
	return err
}

func (a *App) LoadRepertoire(id string) (*repertoire.RepertoireData, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	r, err := a.db.GetRepertoire(id)
	if errors.Is(err, storage.ErrNotFound) {
		return nil, fmt.Errorf("repertoire not found")
	}
	if err != nil {
		return nil, err
	}
	moves, err := a.db.LoadRepertoireMoves(id)
	if err != nil {
		return nil, err
	}
	return &repertoire.RepertoireData{Repertoire: *r, Moves: moves}, nil
}

func (a *App) SaveRepertoireMove(m repertoire.RepertoireMove) (string, error) {
	if err := a.requireDB(); err != nil {
		return "", err
	}
	id, err := a.db.SaveRepertoireMove(m)
	_ = a.db.ClearDeviationCache()
	return id, err
}

func (a *App) UpdateRepertoireMove(m repertoire.RepertoireMove) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	err := a.db.UpdateRepertoireMove(m)
	if errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("repertoire move not found")
	}
	_ = a.db.ClearDeviationCache()
	return err
}

func (a *App) DeleteRepertoireBranch(moveID string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	err := a.db.DeleteRepertoireBranch(moveID)
	if errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("repertoire move not found")
	}
	_ = a.db.ClearDeviationCache()
	return err
}

func (a *App) GetMovesForPosition(repertoireID, fen string) ([]repertoire.RepertoireMove, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetMovesForPosition(repertoireID, fen)
}

func (a *App) GetAllRepertoireMoves(fen string) ([]repertoire.RepertoireData, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetAllMovesForPosition(fen)
}

func (a *App) GetDrillSession(scope storage.DrillScope) ([]storage.DrillCard, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetDrillSession(scope)
}

func (a *App) RecordDrillResult(moveIDs []string, correct bool, playedUCI string) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	return a.db.RecordDrillResult(moveIDs, correct, playedUCI)
}

func (a *App) ResetDrillScope(scope storage.DrillScope) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	return a.db.ResetDrillScope(scope)
}

func (a *App) GetDrillCount(scope storage.DrillScope) (int, error) {
	if err := a.requireDB(); err != nil {
		return 0, err
	}
	return a.db.GetDrillCount(scope)
}

func (a *App) GetDrillSummary(since string) (storage.DrillSummary, error) {
	if err := a.requireDB(); err != nil {
		return storage.DrillSummary{}, err
	}
	t, err := time.Parse(time.RFC3339, since)
	if err != nil {
		return storage.DrillSummary{}, err
	}
	return a.db.GetDrillSummary(t)
}

func (a *App) GetRepertoireHeatmap(repertoireID string) ([]storage.HeatmapEntry, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetRepertoireHeatmap(repertoireID)
}


func (a *App) ReorderRepertoireMoves(updates []storage.ReorderUpdate) error {
	if err := a.requireDB(); err != nil {
		return err
	}
	return a.db.BatchReorderMoves(updates)
}

func (a *App) OpenPolyglotFileDialog() (string, error) {
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Import Polyglot Opening Book",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Polyglot Books (*.bin)", Pattern: "*.bin"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	return path, err
}

func (a *App) OpenAndReadPGNFile() (string, error) {
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Import PGN File",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "PGN Files (*.pgn)", Pattern: "*.pgn"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read PGN file: %w", err)
	}
	return string(data), nil
}

func (a *App) ImportPolyglotBook(repertoireID, path, colour string) (int, error) {
	if err := a.requireDB(); err != nil {
		return 0, err
	}
	f, err := os.Open(path)
	if err != nil {
		return 0, fmt.Errorf("open polyglot file: %w", err)
	}
	defer f.Close()

	book, err := chesslib.LoadFromReader(f)
	if err != nil {
		return 0, fmt.Errorf("read polyglot book: %w", err)
	}

	extracted, err := polyglotPkg.TraverseBook(book, colour, 50)
	if err != nil {
		return 0, fmt.Errorf("traverse book: %w", err)
	}

	existing, err := a.db.LoadRepertoireMoves(repertoireID)
	if err != nil {
		return 0, err
	}
	existingSet := make(map[string]bool, len(existing))
	savedByToFEN := make(map[string]string, len(existing))
	for _, m := range existing {
		existingSet[m.FromFEN+"|"+m.MoveUCI] = true
		if _, ok := savedByToFEN[m.ToFEN]; !ok {
			savedByToFEN[m.ToFEN] = m.ID
		}
	}

	saved := 0
	for _, ex := range extracted {
		key := ex.FromFEN + "|" + ex.MoveUCI
		if existingSet[key] {
			continue
		}
		var pID *string
		if id, ok := savedByToFEN[ex.FromFEN]; ok {
			pID = &id
		}
		order := countByPrefix(existingSet, ex.FromFEN+"|")
		m := repertoire.RepertoireMove{
			RepertoireID: repertoireID,
			ParentID:     pID,
			FromFEN:      ex.FromFEN,
			ToFEN:        ex.ToFEN,
			MoveSAN:      ex.MoveSAN,
			MoveUCI:      ex.MoveUCI,
			MoveOrder:    order,
		}
		id, err := a.db.SaveRepertoireMove(m)
		if err != nil {
			continue // non-fatal
		}
		existingSet[key] = true
		if _, alreadyCanon := savedByToFEN[ex.ToFEN]; !alreadyCanon {
			savedByToFEN[ex.ToFEN] = id
		}
		saved++
	}
	if saved > 0 {
		_ = a.db.ClearDeviationCache()
	}
	return saved, nil
}

func (a *App) ExportRepertoireToPolyglot(repertoireID string, overrides []polyglotPkg.WeightOverride) (string, error) {
	if err := a.requireDB(); err != nil {
		return "", err
	}
	rep, err := a.db.GetRepertoire(repertoireID)
	if err != nil {
		return "", err
	}
	moves, err := a.db.LoadRepertoireMoves(repertoireID)
	if err != nil {
		return "", err
	}

	entries, err := polyglotPkg.CompileRepertoire(moves, overrides)
	if err != nil {
		return "", fmt.Errorf("compile repertoire: %w", err)
	}

	savePath, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Export Polyglot Opening Book",
		DefaultFilename: rep.Name + ".bin",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Polyglot Books (*.bin)", Pattern: "*.bin"},
		},
	})
	if err != nil || savePath == "" {
		return "", err
	}

	f, err := os.Create(savePath)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	if err := polyglotPkg.WriteBook(f, entries); err != nil {
		return "", fmt.Errorf("write book: %w", err)
	}
	return savePath, nil
}

func countByPrefix(m map[string]bool, prefix string) int {
	n := 0
	for k := range m {
		if strings.HasPrefix(k, prefix) {
			n++
		}
	}
	return n
}

func (a *App) ExportRepertoireToPGN(repertoireID string) (string, error) {
	if err := a.requireDB(); err != nil {
		return "", err
	}
	rep, err := a.db.GetRepertoire(repertoireID)
	if err != nil {
		return "", err
	}
	moves, err := a.db.LoadRepertoireMoves(repertoireID)
	if err != nil {
		return "", err
	}

	pgn := pgnPkg.CompileRepertoire(*rep, moves)

	savePath, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Export Repertoire as PGN",
		DefaultFilename: rep.Name + ".pgn",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "PGN Files (*.pgn)", Pattern: "*.pgn"},
		},
	})
	if err != nil || savePath == "" {
		return "", err
	}

	if err := os.WriteFile(savePath, []byte(pgn), 0o644); err != nil {
		return "", fmt.Errorf("write pgn: %w", err)
	}
	return savePath, nil
}


func (a *App) ClassifyPosition(fen string) *opening.Entry {
	if a.classifier == nil {
		return nil
	}
	return a.classifier.Classify(fen)
}


func (a *App) requireDB() error {
	if a.db == nil {
		return fmt.Errorf("database not available")
	}
	return nil
}

func (a *App) saveMany(inputs []game.GameInput) ([]string, error) {
	ids := make([]string, 0)
	for _, input := range inputs {
		id, err := a.db.SaveGame(input)
		if errors.Is(err, storage.ErrDuplicate) {
			continue // skip silently
		}
		if err != nil {
			return ids, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}
