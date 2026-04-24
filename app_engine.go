package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/IntermezzoSoftware/Masterboard/internal/engine"
	"github.com/IntermezzoSoftware/Masterboard/internal/engine/catalog"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type EngineInfo struct {
	Depth     int      `json:"depth"`
	SelDepth  int      `json:"selDepth"`
	MultiPV   int      `json:"multiPV"`
	ScoreCp   int      `json:"scoreCp"`
	IsMate    bool     `json:"isMate"`
	ScoreMate int      `json:"scoreMate"`
	Nodes     int64    `json:"nodes"`
	TimeMs    int64    `json:"timeMs"`
	PVUci     []string `json:"pvUci"`
}

type EngineEntry struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type EngineState struct {
	IsReady          bool          `json:"isReady"`
	IsAnalysing      bool          `json:"isAnalysing"`
	ActiveEngine     string        `json:"activeEngine"`
	AvailableEngines []EngineEntry `json:"availableEngines"`
	EngineName       string        `json:"engineName"`
	EngineType       string        `json:"engineType"` // "ab" (alpha-beta) or "mcts"
}

// engineDisplayName returns a human-readable name for the engine at path.
// Resolution order:
//  1. Per-engine sidecar file: <path>.name  (written by discoverEngineNames)
//  2. engine-name.txt in the engine's directory (written by DownloadEngine)
//  3. Base filename fallback
func engineDisplayName(path string) string {
	if data, err := os.ReadFile(path + ".name"); err == nil {
		if name := strings.TrimSpace(string(data)); name != "" {
			return name
		}
	}
	if data, err := os.ReadFile(filepath.Join(filepath.Dir(path), "engine-name.txt")); err == nil {
		if name := strings.TrimSpace(string(data)); name != "" {
			return name
		}
	}
	return filepath.Base(path)
}

// resolveEntries converts engine paths to EngineEntry values. For the active
// engine, if no engine-name.txt exists (i.e. the display name is just the
// filename), the UCI name reported by the engine is used instead.
func resolveEntries(paths []string, activePath, uciName string) []EngineEntry {
	entries := make([]EngineEntry, len(paths))
	for i, p := range paths {
		name := engineDisplayName(p)
		if p == activePath && name == filepath.Base(p) && uciName != "" {
			name = uciName
		}
		entries[i] = EngineEntry{Path: p, Name: name}
	}
	return entries
}

// mctsEnginePrefixes are the lowercased UCI "id name" prefixes of known
// MCTS/neural-network chess engines. When the engine's reported name starts
// with one of these prefixes it is classified as MCTS.
var mctsEnginePrefixes = []string{
	"lc0",         // Leela Chess Zero (also covers Maia, Fat Fritz 1)
	"ceres",       // Ceres (MCTS, uses Lc0 networks)
	"allie",       // Allie / AllieStein
	"stoofvlees",  // Stoofvlees / Stoofvlees II
	"scorpio",     // Scorpio / ScorpioNN
	"dragon",      // Komodo Dragon (MCTS hybrid)
}

func detectEngineType(uciName string) string {
	lower := strings.ToLower(uciName)
	for _, prefix := range mctsEnginePrefixes {
		if strings.HasPrefix(lower, prefix) {
			return "mcts"
		}
	}
	return "ab"
}

func engineInfoFromInfoLine(line *engine.InfoLine, activeColor string) EngineInfo {
	scoreCp := line.ScoreCp
	scoreMate := line.ScoreMate
	if activeColor == "b" {
		scoreCp = -scoreCp
		scoreMate = -scoreMate
	}
	return EngineInfo{
		Depth:     line.Depth,
		SelDepth:  line.SelDepth,
		MultiPV:   line.MultiPV,
		ScoreCp:   scoreCp,
		IsMate:    line.IsMate,
		ScoreMate: scoreMate,
		Nodes:     line.Nodes,
		TimeMs:    line.TimeMs,
		PVUci:     append([]string{}, line.PV...),
	}
}

func (a *App) StartAnalysis(fen string, multiPV int) error {
	return a.slot1.startAnalysis(a.ctx, a.emitFn, fen, multiPV, "engine")
}

func (a *App) StartAnalysis2(fen string, multiPV int) error {
	return a.slot2.startAnalysis(a.ctx, a.emitFn, fen, multiPV, "engine2")
}

func (a *App) StopAnalysis() error {
	return a.slot1.stopAnalysis("engine")
}

func (a *App) StopAnalysis2() error {
	return a.slot2.stopAnalysis("engine2")
}

func (a *App) GetEngineState() EngineState {
	s := a.slot1.getState()

	a.availableEnginesMu.Lock()
	available := append([]string(nil), a.availableEngines...)
	a.availableEnginesMu.Unlock()

	s.AvailableEngines = resolveEntries(available, s.ActiveEngine, s.EngineName)
	return s
}

func (a *App) GetEngineState2() EngineState {
	s := a.slot2.getState()

	a.availableEnginesMu.Lock()
	available := append([]string(nil), a.availableEngines...)
	a.availableEnginesMu.Unlock()

	s.AvailableEngines = resolveEntries(available, s.ActiveEngine, s.EngineName)
	return s
}

func (a *App) SetEngineOption(name, value string) error {
	return a.slot1.setOption(name, value)
}

func (a *App) SetEngineOption2(name, value string) error {
	return a.slot2.setOption(name, value)
}

func (a *App) SetActiveEngine(path string) error {
	log.Printf("[engine] set-active-engine path=%s", path)

	m := engine.NewManager(false)
	if err := m.Launch(path); err != nil {
		return fmt.Errorf("launch engine: %w", err)
	}

	old := a.slot1.setManager(m, path)
	if old != nil {
		old.Quit()
	}

	if a.db != nil {
		if err := a.db.SetSetting("engine.path", path); err != nil {
			log.Printf("[engine] failed to save engine path: %v", err)
		}
	}
	engineName := m.EngineName()
	log.Printf("[engine] ready (switched to %s, id=%q)", path, engineName)

	a.availableEnginesMu.Lock()
	available := append([]string(nil), a.availableEngines...)
	a.availableEnginesMu.Unlock()
	if a.emitFn != nil {
		a.slot1.emitReady(a.emitFn, path, engineName, available)
	}
	return nil
}

// The path is NOT persisted to DB — the secondary engine slot is transient.
func (a *App) SetActiveEngine2(path string) error {
	log.Printf("[engine2] set-active-engine path=%s", path)

	m := engine.NewManager(false)
	if err := m.Launch(path); err != nil {
		return fmt.Errorf("launch engine: %w", err)
	}

	old := a.slot2.setManager(m, path)
	if old != nil {
		old.Quit()
	}

	engineName := m.EngineName()
	log.Printf("[engine2] ready (switched to %s, id=%q)", path, engineName)

	a.availableEnginesMu.Lock()
	available := append([]string(nil), a.availableEngines...)
	a.availableEnginesMu.Unlock()
	if a.emitFn != nil {
		a.slot2.emitReady(a.emitFn, path, engineName, available)
	}
	return nil
}


func (a *App) ListEngines() ([]string, error) {
	a.availableEnginesMu.Lock()
	defer a.availableEnginesMu.Unlock()
	return append([]string(nil), a.availableEngines...), nil
}

func (a *App) BrowseForEngine() (string, error) {
	var filters []wailsRuntime.FileFilter
	if runtime.GOOS == "windows" {
		filters = []wailsRuntime.FileFilter{
			{DisplayName: "Executables (*.exe)", Pattern: "*.exe"},
			{DisplayName: "All files", Pattern: "*"},
		}
	} else {
		// Unix engine binaries usually have no extension — default to showing
		// everything so the user can pick the binary without hunting for a filter.
		filters = []wailsRuntime.FileFilter{
			{DisplayName: "All files", Pattern: "*"},
		}
	}
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title:   "Select UCI engine binary",
		Filters: filters,
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) GetCustomEngines() ([]string, error) {
	if a.db == nil {
		return nil, nil
	}
	return a.loadCustomEnginePaths()
}

// Shared by DeleteEngine and UnregisterEngine.
func (a *App) detachEngine(path string) {
	old := a.slot1.detachIfPath(path)
	if old != nil {
		if a.db != nil {
			_ = a.db.SetSetting("engine.path", "")
		}
		old.Quit()
	}
	// Also detach from slot2 if it was loaded there.
	if old2 := a.slot2.detachIfPath(path); old2 != nil {
		old2.Quit()
	}

	paths, _ := a.loadCustomEnginePaths()
	filtered := make([]string, 0, len(paths))
	for _, p := range paths {
		if p != path {
			filtered = append(filtered, p)
		}
	}
	_ = a.saveCustomEnginePaths(filtered)
}

func (a *App) UnregisterEngine(path string) error {
	if path == "" {
		return fmt.Errorf("path must not be empty")
	}
	a.detachEngine(path)
	return a.RescanEngines()
}

func (a *App) DeleteEngine(path string) error {
	if path == "" {
		return fmt.Errorf("path must not be empty")
	}

	a.detachEngine(path)

	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("DeleteEngine: %w", err)
	}

	return a.RescanEngines()
}

func (a *App) RescanEngines() error {
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("RescanEngines: %w", err)
	}
	discovered := engine.DefaultEngines(filepath.Dir(execPath))

	customPaths, _ := a.loadCustomEnginePaths()
	customSet := make(map[string]struct{}, len(customPaths))
	for _, p := range customPaths {
		customSet[p] = struct{}{}
	}
	var newDiscovered []string
	for _, p := range discovered {
		if _, ok := customSet[p]; !ok {
			newDiscovered = append(newDiscovered, p)
		}
	}
	merged := append(append([]string(nil), customPaths...), newDiscovered...)

	a.availableEnginesMu.Lock()
	a.availableEngines = merged
	a.availableEnginesMu.Unlock()

	a.slot1.mu.Lock()
	noActiveEngine := a.slot1.path == ""
	a.slot1.mu.Unlock()

	a.emitEnginesChanged()

	// Auto-launch the first available engine if none is currently running.
	// Covers: 0→1 after a download, and auto-select after deleting the active engine.
	if noActiveEngine && len(merged) > 0 {
		go a.launchEngine(merged[0])
	}

	go a.discoverEngineNames(merged)

	return nil
}

func (a *App) discoverEngineNames(paths []string) {
	a.slot1.mu.Lock()
	activePath := a.slot1.path
	activeEng := a.slot1.manager
	a.slot1.mu.Unlock()

	if activePath != "" && activeEng != nil {
		if uciName := activeEng.EngineName(); uciName != "" {
			if engineDisplayName(activePath) == filepath.Base(activePath) {
				_ = os.WriteFile(activePath+".name", []byte(uciName), 0644)
			}
		}
	}

	var wg sync.WaitGroup
	for _, p := range paths {
		if p == activePath {
			continue // already handled above
		}
		if engineDisplayName(p) != filepath.Base(p) {
			continue // already has a cached name
		}
		p := p
		wg.Add(1)
		go func() {
			defer wg.Done()
			m := engine.NewManager(false)
			if err := m.Launch(p); err != nil {
				log.Printf("[engine] discoverEngineNames: launch %s: %v", p, err)
				return
			}
			name := m.EngineName()
			m.Quit()
			if name != "" {
				if err := os.WriteFile(p+".name", []byte(name), 0644); err != nil {
					log.Printf("[engine] discoverEngineNames: write sidecar %s: %v", p, err)
				}
			}
		}()
	}
	wg.Wait()

	a.emitEnginesChanged()
}

func (a *App) AddCustomEngine(path string) error {
	if path == "" {
		return fmt.Errorf("path must not be empty")
	}
	paths, err := a.loadCustomEnginePaths()
	if err != nil {
		return err
	}
	for _, p := range paths {
		if p == path {
			return nil // already present
		}
	}
	paths = append(paths, path)
	if err := a.saveCustomEnginePaths(paths); err != nil {
		return err
	}
	a.rebuildAvailableEngines(paths)

	a.slot1.mu.Lock()
	noActiveEngine := a.slot1.path == ""
	a.slot1.mu.Unlock()

	a.availableEnginesMu.Lock()
	merged := append([]string(nil), a.availableEngines...)
	a.availableEnginesMu.Unlock()

	a.emitEnginesChanged()

	if noActiveEngine && len(merged) > 0 {
		go a.launchEngine(merged[0])
	}

	go a.discoverEngineNames([]string{path})
	return nil
}

func (a *App) RemoveCustomEngine(path string) error {
	paths, err := a.loadCustomEnginePaths()
	if err != nil {
		return err
	}
	filtered := paths[:0]
	for _, p := range paths {
		if p != path {
			filtered = append(filtered, p)
		}
	}
	if err := a.saveCustomEnginePaths(filtered); err != nil {
		return err
	}
	a.rebuildAvailableEngines(filtered)

	// If the removed engine was the active one, switch to the first available
	// engine (or clear the engine if none remain).
	a.slot1.mu.Lock()
	activePath := a.slot1.path
	a.slot1.mu.Unlock()

	a.availableEnginesMu.Lock()
	available := append([]string(nil), a.availableEngines...)
	a.availableEnginesMu.Unlock()

	if activePath == path {
		if len(available) > 0 {
			go a.launchEngine(available[0])
		} else {
			a.slot1.quit()
		}
	}

	a.emitEnginesChanged()
	return nil
}

func (a *App) loadCustomEnginePaths() ([]string, error) {
	if a.db == nil {
		return nil, nil
	}
	raw, err := a.db.GetSetting("engine.customPaths")
	if err != nil || raw == "" {
		return nil, nil //nolint:nilerr
	}
	var paths []string
	if err := json.Unmarshal([]byte(raw), &paths); err != nil {
		return nil, err
	}
	return paths, nil
}

func (a *App) saveCustomEnginePaths(paths []string) error {
	if a.db == nil {
		return nil
	}
	b, err := json.Marshal(paths)
	if err != nil {
		return err
	}
	return a.db.SetSetting("engine.customPaths", string(b))
}

func (a *App) emitEnginesChanged() {
	a.availableEnginesMu.Lock()
	list := append([]string(nil), a.availableEngines...)
	a.availableEnginesMu.Unlock()

	a.slot1.mu.Lock()
	activePath := a.slot1.path
	m := a.slot1.manager
	a.slot1.mu.Unlock()

	var uciName string
	if m != nil {
		uciName = m.EngineName()
	}
	if a.emitFn != nil {
		a.emitFn("engine:engines-changed", resolveEntries(list, activePath, uciName))
	}
}

func (a *App) rebuildAvailableEngines(customPaths []string) {
	a.availableEnginesMu.Lock()
	current := append([]string(nil), a.availableEngines...)
	a.availableEnginesMu.Unlock()

	// Collect discovered (non-custom) paths: remove any that are now custom
	customSet := make(map[string]struct{}, len(customPaths))
	for _, p := range customPaths {
		customSet[p] = struct{}{}
	}
	var discovered []string
	for _, p := range current {
		if _, ok := customSet[p]; !ok {
			discovered = append(discovered, p)
		}
	}

	merged := append(append([]string(nil), customPaths...), discovered...)

	a.availableEnginesMu.Lock()
	a.availableEngines = merged
	a.availableEnginesMu.Unlock()
}

func (a *App) GetDownloadableEngines() ([]catalog.DownloadableEngine, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("app context not initialised")
	}
	return catalog.Resolve(a.ctx)
}

func (a *App) DownloadEngine(engineID string) error {
	if engineID == "" {
		return fmt.Errorf("engineID must not be empty")
	}

	entries, err := catalog.Resolve(a.ctx)
	if err != nil {
		return fmt.Errorf("DownloadEngine: resolve catalog: %w", err)
	}

	var entry catalog.DownloadableEngine
	found := false
	for _, e := range entries {
		if e.ID == engineID {
			entry = e
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("DownloadEngine: engine %q not found in catalog", engineID)
	}

	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("DownloadEngine: could not determine executable path: %w", err)
	}
	destDir := filepath.Join(filepath.Dir(execPath), "engines", engineID)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("DownloadEngine: mkdir %s: %w", destDir, err)
	}

	log.Printf("[engine] download start engineID=%s url=%s dest=%s", engineID, entry.DownloadURL, destDir)

	onProgress := func(percent int, received, total int64) {
		a.emitFn("engine:download-progress", map[string]any{
			"engineID":      engineID,
			"percent":       percent,
			"bytesReceived": received,
			"totalBytes":    total,
		})
	}

	paths, err := catalog.DownloadTo(a.ctx, entry, destDir, onProgress)
	if err != nil {
		log.Printf("[engine] download error engineID=%s: %v", engineID, err)
		if a.emitFn != nil {
			a.emitFn("engine:download-error", map[string]any{
				"engineID": engineID,
				"error":    err.Error(),
			})
		}
		return err
	}

	binaryPath := paths[0]
	log.Printf("[engine] download complete engineID=%s path=%s", engineID, binaryPath)

	// Write a name file so the engine list can display a human-readable label.
	displayName := entry.DisplayName()
	namePath := filepath.Join(destDir, "engine-name.txt")
	if writeErr := os.WriteFile(namePath, []byte(displayName), 0644); writeErr != nil {
		log.Printf("[engine] warning: could not write engine-name.txt: %v", writeErr)
	}

	// Lc0 needs `--weights=<path>` at launch because auto-discovery doesn't
	// recurse into our networks/ subdirectory. Write a sidecar so process.go
	// can append the flag. paths[1] is the network (bundled or separate).
	if strings.HasPrefix(engineID, "lc0-") && len(paths) >= 2 {
		weightsSidecar := binaryPath + ".weights"
		if writeErr := os.WriteFile(weightsSidecar, []byte(paths[1]), 0644); writeErr != nil {
			log.Printf("[engine] warning: could not write weights sidecar: %v", writeErr)
		}
	}

	if err := a.AddCustomEngine(binaryPath); err != nil {
		log.Printf("[engine] register downloaded engine error: %v", err)
	}

	if a.emitFn != nil {
		a.emitFn("engine:download-complete", map[string]any{
			"engineID": engineID,
			"path":     binaryPath,
		})
	}
	return nil
}

func (a *App) launchEngine(path string) {
	log.Printf("[engine] launch path=%s", path)
	m := engine.NewManager(false)
	if err := m.Launch(path); err != nil {
		log.Printf("[engine] launch failed: %v", err)
		return
	}
	engineName := m.EngineName()
	// Apply persisted settings so they survive engine restarts and switches.
	if a.db != nil {
		if hash, err := a.db.GetSetting("engine.hash"); err == nil && hash != "" {
			m.SetOption("Hash", hash)
		}
		if threads, err := a.db.GetSetting("engine.threads"); err == nil && threads != "" {
			m.SetOption("Threads", threads)
		}
	}
	old := a.slot1.setManager(m, path)
	if old != nil {
		old.Quit()
	}

	a.availableEnginesMu.Lock()
	available := append([]string(nil), a.availableEngines...)
	a.availableEnginesMu.Unlock()

	log.Printf("[engine] ready (id=%q)", engineName)
	// Notify the frontend — it may have already called GetEngineState and received
	// isReady:false due to the goroutine race. This event lets it update reactively.
	if a.emitFn != nil {
		a.slot1.emitReady(a.emitFn, path, engineName, available)
	}
}
