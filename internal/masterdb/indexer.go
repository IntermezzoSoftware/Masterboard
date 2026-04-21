package masterdb

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// RunIndexer imports all PGN files into the sidecar database according to cfg.
// It handles all phases from parsing through SQLite writes, including optional
// game-index population and parallelism.
func RunIndexer(pgnFiles []string, cfg IndexConfig) (*IndexResult, error) {
	if cfg.OutputPath == "" {
		return nil, fmt.Errorf("output path is required")
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 1000
	}
	if cfg.Workers <= 0 {
		cfg.Workers = runtime.NumCPU()
	}

	ctx := cfg.Ctx
	if ctx == nil {
		ctx = context.Background()
	}

	// Remove existing databases if replacing.
	if cfg.Replace {
		for _, p := range []string{cfg.OutputPath, cfg.OutputPath + "-wal", cfg.OutputPath + "-shm"} {
			_ = os.Remove(p)
		}
		sp, ip := SplitDBPaths(cfg.OutputPath)
		for _, p := range []string{sp, sp + "-wal", sp + "-shm", ip, ip + "-wal", ip + "-shm"} {
			_ = os.Remove(p)
		}
	}

	db, err := Open(cfg.OutputPath)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	defer db.Close()

	statsDB, indexDB, err := openSplitDBs(cfg.OutputPath)
	if err != nil {
		return nil, fmt.Errorf("open split dbs: %w", err)
	}
	defer statsDB.Close()
	defer indexDB.Close()

	start := time.Now()

	// Pre-stat all input files for provenance tracking.
	result := &IndexResult{
		FileStats: make([]FileImportInfo, len(pgnFiles)),
	}
	for i, path := range pgnFiles {
		info := FileImportInfo{Filename: filepath.Base(path)}
		if fi, err := os.Stat(path); err == nil {
			info.SizeBytes = fi.Size()
		}
		result.FileStats[i] = info
	}

	if err = runPipeline(ctx, db, statsDB, indexDB, pgnFiles, cfg, result); err != nil {
		return nil, err
	}

	if cfg.PhaseFn != nil {
		cfg.PhaseFn("optimizing")
	}

	if err := db.finalize(); err != nil {
		return nil, fmt.Errorf("finalize: %w", err)
	}
	if err := statsDB.finalize(); err != nil {
		return nil, fmt.Errorf("finalize stats db: %w", err)
	}
	if err := indexDB.finalize(); err != nil {
		return nil, fmt.Errorf("finalize index db: %w", err)
	}

	result.TotalDuration = time.Since(start)

	// Write import provenance log (non-fatal — don't fail the import over a log write).
	importDate := time.Now().UTC().Format(time.RFC3339)
	logEntries := make([]importLogEntry, 0, len(result.FileStats))
	for _, fs := range result.FileStats {
		if fs.Filename != "" {
			logEntries = append(logEntries, importLogEntry{
				Filename:      fs.Filename,
				SizeBytes:     fs.SizeBytes,
				GamesImported: fs.GamesImported,
				ImportDate:    importDate,
			})
		}
	}
	if err := db.writeImportLog(logEntries); err != nil {
		fmt.Printf("[masterdb] warning: write import log: %v\n", err)
	}

	return result, nil
}

// runPipeline implements per-game parallelism using a producer-consumer pipeline:
//
//	[1 Parser goroutine] → gameCh → [N Encoder goroutines] → encodedCh → [1 Writer goroutine]
//
// This scales encoding to NumCPU regardless of how many PGN files there are.
func runPipeline(ctx context.Context, db *DB, statsDB, indexDB *DB, files []string, cfg IndexConfig, result *IndexResult) error {
	gameCh := make(chan ParsedGame, cfg.Workers*4)
	encodedCh := make(chan encodedGame, cfg.Workers*4)

	pipelineStart := time.Now()

	emitPhase := func(phase string) {
		if cfg.PhaseFn != nil {
			cfg.PhaseFn(phase)
		}
	}
	emitPhase("processing")

	// Encoder goroutines call EncodeGame2BWithLookup which calls moveLookup.GetOrAdd
	// (thread-safe) during encoding, so the lookup must exist before they launch.
	var moveLookup *moveLookup
	var knownFingerprints map[int64]bool // nil in replace mode
	if cfg.Replace {
		moveLookup = newMoveLookup()
	} else {
		var err error
		moveLookup, err = db.loadMoveLookup()
		if err != nil {
			return fmt.Errorf("load move lookup: %w", err)
		}
		knownFingerprints, err = db.allFingerprints(ctx)
		if err != nil {
			return fmt.Errorf("load fingerprints: %w", err)
		}
		existingGames, _ := db.GameCount()
		fmt.Printf("[masterdb] append mode: %d existing games, %d existing moves, %d fingerprints\n",
			existingGames, moveLookup.count(), len(knownFingerprints))
	}

	// currentFileIdx is written here and read from ProgressFn (writer goroutine).
	// We use an atomic so both goroutines can access it without a mutex.
	var currentFileIdx int32
	go func() {
		defer close(gameCh)
		for i, path := range files {
			if ctx.Err() != nil {
				break
			}
			atomic.StoreInt32(&currentFileIdx, int32(i))
			if cfg.CurrentFileFn != nil {
				cfg.CurrentFileFn(i)
			}
			count := 0
			parseErr := ParseFile(path, func(pg ParsedGame) {
				select {
				case <-ctx.Done():
					return
				case gameCh <- pg:
					count++
				}
			})
			if parseErr != nil {
				fmt.Printf("[masterdb] warning: parse %s: %v\n", path, parseErr)
			}
			result.FileStats[i].GamesImported = count
		}
	}()

	// Each goroutine calls EncodeGame2BWithLookup which resolves SANs to moveIDs
	// via moveLookup (thread-safe). This moves the GetOrAdd call into the parallel
	// encode phase, eliminating it from the single-threaded writer loop.
	var encWg sync.WaitGroup
	for i := 0; i < cfg.Workers; i++ {
		encWg.Add(1)
		go func() {
			defer encWg.Done()
			for pg := range gameCh {
				blob, positions, err := EncodeGame2BWithLookup(pg.MoveText, moveLookup)
				if err != nil {
					continue // skip games that fail to encode
				}
				encodedCh <- encodedGame{
					ParsedGame: pg,
					MovesBlob:  blob,
					Positions:  positions,
				}
			}
		}()
	}

	// Close encodedCh when all encoders finish.
	go func() {
		encWg.Wait()
		close(encodedCh)
	}()

	// Stats and index rows are accumulated in memory for pre-aggregation and
	// sorted insertion. In replace mode, the first stats flush uses
	// WriteStatsDirect (plain INSERT, no UPSERT overhead) since the table is
	// empty; subsequent flushes use WriteStats (UPSERT) to handle cross-flush
	// key collisions. In append mode, all flushes use WriteStats (UPSERT).
	// Games are flushed every BatchSize.
	//
	// Double-buffered flush: when a periodic stats/index flush is triggered, the
	// map is handed to a background goroutine for writing while the writer loop
	// immediately allocates a fresh map and continues consuming from encodedCh.
	// This keeps the encoding pipeline running during multi-second SQLite writes.
	// SQLite serializes at the connection pool level (MaxOpenConns=1), so the
	// background goroutine blocks on the connection when game writes are happening,
	// but the writer loop continues accumulating stats without blocking.
	statsFlushThreshold := 32000000 // default: 32M entries (~3.8 GB)
	if cfg.StatsFlushLimit > 0 {
		statsFlushThreshold = cfg.StatsFlushLimit
	} else if auto := autoFlushThreshold(); auto > 0 {
		statsFlushThreshold = auto
		fmt.Printf("[masterdb] auto flush threshold: %dM entries (based on available memory)\n", auto/1000000)
	}
	indexFlushThreshold := statsFlushThreshold // flush index at same threshold

	var batch []encodedGame
	allStats := make(map[statsKey]statRow)
	var allIndexRows []indexRow
	// syncWriteTime counts only synchronous write operations (game writes, final
	// stats/index flushes). Background flush durations are tracked separately in
	// bgStatsTime/bgIndexTime because they overlap with encoding — adding them to
	// syncWriteTime would make encodeTime = pipelineTotal - syncWriteTime go
	// negative.
	var syncWriteTime time.Duration
	var gamesWriteTime, bgStatsTime, bgIndexTime time.Duration
	var finalStatsTime, finalIndexTime time.Duration
	statsFlushCount := 0 // tracks number of stats flushes for replace-mode optimization

	// Double-buffer channels for background flushes (buffered size 1).
	type flushResult struct {
		err     error
		elapsed time.Duration
		rows    int
	}
	statsBgCh := make(chan flushResult, 1)
	indexBgCh := make(chan flushResult, 1)
	statsBgActive := false
	indexBgActive := false

	// waitStatsBg waits for any in-flight background stats flush to complete.
	waitStatsBg := func() error {
		if !statsBgActive {
			return nil
		}
		r := <-statsBgCh
		statsBgActive = false
		if r.err != nil {
			return r.err
		}
		bgStatsTime += r.elapsed
		result.StatsRows += r.rows
		return nil
	}

	// waitIndexBg waits for any in-flight background index flush to complete.
	waitIndexBg := func() error {
		if !indexBgActive {
			return nil
		}
		r := <-indexBgCh
		indexBgActive = false
		if r.err != nil {
			return r.err
		}
		bgIndexTime += r.elapsed
		result.IndexRows += r.rows
		return nil
	}

	// batchPositions tracks position hashes per game in the current batch,
	// used to build game-index rows after INSERT RETURNING id.
	var batchPositions [][]int64 // batchPositions[i] = position hashes for batch[i]
	var skippedDuplicates int
	// Reusable dedup map for game-index building — avoids per-game allocation.
	seen := make(map[int64]bool, 64)

	for eg := range encodedCh {
		// In append mode, skip games whose fingerprint is already known.
		// This prevents double-counting in stats and avoids unnecessary DB work.
		if knownFingerprints != nil {
			fp := gameFingerprint(eg.White, eg.Black, eg.Date, eg.Result, eg.MovesBlob)
			if knownFingerprints[fp] {
				skippedDuplicates++
				continue
			}
			// Mark this fingerprint as known for intra-import dedup.
			knownFingerprints[fp] = true
		}

		// Accumulate position stats for this game.
		avgElo := 0
		hasElo := eg.EloWhite > 0 && eg.EloBlack > 0
		if hasElo {
			avgElo = (eg.EloWhite + eg.EloBlack) / 2
		}

		for _, pos := range eg.Positions {
			k := statsKey{hash: pos.hash, moveID: pos.moveID}
			row := allStats[k]
			switch eg.Result {
			case "1-0":
				row.WhiteWins++
			case "0-1":
				row.BlackWins++
			case "1/2-1/2":
				row.Draws++
			}
			if hasElo {
				row.TotalElo += avgElo
				row.EloCount++
			}
			allStats[k] = row
		}

		// Collect position hashes for game-index building (done after game insert).
		if !cfg.SkipGameIndex {
			clear(seen)
			var hashes []int64
			for ply, pos := range eg.Positions {
				if ply >= GameIndexMaxPly {
					break
				}
				if seen[pos.hash] {
					continue
				}
				seen[pos.hash] = true
				hashes = append(hashes, pos.hash)
			}
			batchPositions = append(batchPositions, hashes)
		}

		batch = append(batch, eg)

		if len(batch) >= cfg.BatchSize {
			t0 := time.Now()
			if err := writeGamesAndIndex(ctx, db, batch, batchPositions, cfg, &allIndexRows, result); err != nil {
				return err
			}
			d := time.Since(t0)
			gamesWriteTime += d
			syncWriteTime += d
			batch = batch[:0]
			batchPositions = batchPositions[:0]
			if cfg.ProgressFn != nil {
				fileIdx := int(atomic.LoadInt32(&currentFileIdx))
				cfg.ProgressFn(result.GamesIndexed, fileIdx)
			}
		}

		// Memory-pressure safety valve: if free system memory drops below
		// memSafetyFloor, force an early flush even if the count-based threshold
		// hasn't been reached. Checked at every batch write (~1000 games).
		// Only triggers if the map has accumulated enough entries to be worth
		// flushing (minFlushThreshold = 4M).
		memPressure := len(allStats) >= minFlushThreshold && memoryPressured()
		if memPressure {
			fmt.Printf("[masterdb] memory pressure flush at %dM stats entries (free RAM < %d MB)\n",
				len(allStats)/1000000, memSafetyFloor/1024/1024)
		}

		// Periodic stats flush to bound memory (double-buffered).
		// In replace mode, the first flush uses WriteStatsDirect (plain INSERT)
		// since the table is guaranteed empty; subsequent flushes use WriteStats
		// (UPSERT) to handle cross-flush duplicate keys.
		if len(allStats) >= statsFlushThreshold || memPressure {
			// Wait for any previous background stats flush before launching a new one.
			if err := waitStatsBg(); err != nil {
				return fmt.Errorf("write stats (bg): %w", err)
			}
			// Launch background flush.
			flushStats := allStats
			flushCount := statsFlushCount
			flushReplace := cfg.Replace
			statsBgActive = true
			go func() {
				t0 := time.Now()
				var err error
				if flushReplace && flushCount == 0 {
					err = statsDB.writeStatsDirect(ctx, flushStats, nil)
				} else {
					err = statsDB.writeStats(ctx, flushStats, nil)
				}
				statsBgCh <- flushResult{err: err, elapsed: time.Since(t0), rows: len(flushStats)}
			}()
			statsFlushCount++
			allStats = make(map[statsKey]statRow)
		}

		// Periodic index flush to bound memory (double-buffered).
		if len(allIndexRows) >= indexFlushThreshold || (memPressure && len(allIndexRows) > 0) {
			// Wait for any previous background index flush before launching a new one.
			if err := waitIndexBg(); err != nil {
				return fmt.Errorf("write game index (bg): %w", err)
			}
			flushIndex := allIndexRows
			indexBgActive = true
			go func() {
				t0 := time.Now()
				err := indexDB.writeGameIndex(ctx, flushIndex, nil)
				indexBgCh <- flushResult{err: err, elapsed: time.Since(t0), rows: len(flushIndex)}
			}()
			allIndexRows = nil // fresh slice (can't reuse backing array — bg goroutine owns it)
		}
	}

	// Wait for any in-flight background flushes before final flushes.
	if err := waitStatsBg(); err != nil {
		return fmt.Errorf("write stats (bg final): %w", err)
	}
	if err := waitIndexBg(); err != nil {
		return fmt.Errorf("write game index (bg final): %w", err)
	}

	// Final games flush.
	if len(batch) > 0 {
		t0 := time.Now()
		if err := writeGamesAndIndex(ctx, db, batch, batchPositions, cfg, &allIndexRows, result); err != nil {
			return err
		}
		d := time.Since(t0)
		gamesWriteTime += d
		syncWriteTime += d
	}

	emitPhase("building-stats")

	// Write move lookup table.
	t0 := time.Now()
	if err := db.writeMoveLookup(ctx, moveLookup); err != nil {
		return fmt.Errorf("write move lookup: %w", err)
	}
	fmt.Printf("[masterdb] move lookup: %d unique SANs\n", moveLookup.count())
	syncWriteTime += time.Since(t0)

	// Final stats flush.
	if len(allStats) > 0 {
		t0 = time.Now()
		if cfg.Replace && statsFlushCount == 0 {
			// Replace mode, first (and only) flush: plain INSERT, no UPSERT overhead.
			if err := statsDB.writeStatsDirect(ctx, allStats, cfg.PhaseProgressFn); err != nil {
				return fmt.Errorf("write stats: %w", err)
			}
		} else {
			// Append mode, or replace mode after periodic flushes already wrote data.
			if err := statsDB.writeStats(ctx, allStats, cfg.PhaseProgressFn); err != nil {
				return fmt.Errorf("write stats: %w", err)
			}
		}
		result.StatsRows += len(allStats)
		finalStatsTime = time.Since(t0)
		syncWriteTime += finalStatsTime
	}

	emitPhase("building-index")

	// Final index flush.
	if !cfg.SkipGameIndex && len(allIndexRows) > 0 {
		t0 = time.Now()
		if err := indexDB.writeGameIndex(ctx, allIndexRows, cfg.PhaseProgressFn); err != nil {
			return fmt.Errorf("write game index: %w", err)
		}
		result.IndexRows += len(allIndexRows)
		finalIndexTime = time.Since(t0)
		syncWriteTime += finalIndexTime
	}

	pipelineTotal := time.Since(pipelineStart)
	// encodeTime = pipeline wall time minus synchronous write time.
	// Background flush times (bgStatsTime, bgIndexTime) are excluded because they
	// ran concurrently with encoding — counting them would make encodeTime negative.
	// Note: gamesWriteTime includes SQLite contention delays when a background flush
	// holds the connection, so it is inflated relative to the no-overlap baseline.
	encodeTime := pipelineTotal - syncWriteTime
	fmt.Printf("[masterdb] pipeline: total=%.1fs  encode=~%.1fs  games=%.1fs  stats(bg)=%.1fs  stats(final)=%.1fs  idx(bg)=%.1fs  idx(final)=%.1fs  workers=%d\n",
		pipelineTotal.Seconds(), encodeTime.Seconds(), gamesWriteTime.Seconds(),
		bgStatsTime.Seconds(), finalStatsTime.Seconds(),
		bgIndexTime.Seconds(), finalIndexTime.Seconds(), cfg.Workers)
	if skippedDuplicates > 0 {
		fmt.Printf("[masterdb] skipped %d duplicate games\n", skippedDuplicates)
	}

	result.EncodeTime = encodeTime
	result.GamesWriteTime = gamesWriteTime
	result.StatsWriteTime = bgStatsTime + finalStatsTime
	result.IndexWriteTime = bgIndexTime + finalIndexTime
	result.SkippedDupes = skippedDuplicates
	result.Workers = cfg.Workers

	return nil
}

// writeGamesAndIndex writes game rows and builds game-index entries from the
// returned AUTOINCREMENT IDs. In append mode, duplicate games (matching
// fingerprint) are filtered out before insertion so the returned IDs map
// exactly to the inserted games' positions.
//
// batchPositions[i] contains the position hashes for games[i] (capped at
// GameIndexMaxPly, deduped). It may be nil if game-index is disabled.
func writeGamesAndIndex(ctx context.Context, db *DB, games []encodedGame, batchPositions [][]int64, cfg IndexConfig, allIndexRows *[]indexRow, result *IndexResult) error {
	// In append mode, pre-filter duplicates so returned IDs map 1:1 to games.
	filteredGames := games
	filteredPositions := batchPositions
	if !cfg.Replace && len(games) > 0 {
		// Compute fingerprints and check which already exist.
		fps := make([]int64, len(games))
		for i, g := range games {
			fps[i] = gameFingerprint(g.White, g.Black, g.Date, g.Result, g.MovesBlob)
		}
		existing, err := db.existingFingerprints(ctx, fps)
		if err != nil {
			return fmt.Errorf("check fingerprints: %w", err)
		}
		if len(existing) > 0 {
			filteredGames = make([]encodedGame, 0, len(games))
			if batchPositions != nil {
				filteredPositions = make([][]int64, 0, len(games))
			}
			for i, g := range games {
				if !existing[fps[i]] {
					filteredGames = append(filteredGames, g)
					if batchPositions != nil {
						filteredPositions = append(filteredPositions, batchPositions[i])
					}
				}
			}
		}
	}

	if len(filteredGames) == 0 {
		return nil // all games were duplicates
	}

	var gameIDs []int64
	var gidsPtr *[]int64
	if !cfg.SkipGameIndex {
		gidsPtr = &gameIDs
	}

	if err := db.writeBatch(ctx, filteredGames, gidsPtr); err != nil {
		return fmt.Errorf("write games batch: %w", err)
	}

	if cfg.SkipGameIndex {
		result.GamesIndexed += len(filteredGames)
	} else {
		result.GamesIndexed += len(gameIDs)
	}

	// Build game-index rows. filteredGames and gameIDs are 1:1 after dedup.
	if !cfg.SkipGameIndex && len(gameIDs) == len(filteredPositions) {
		for i, gid := range gameIDs {
			for _, h := range filteredPositions[i] {
				*allIndexRows = append(*allIndexRows, indexRow{posHash: h, gameID: gid})
			}
		}
	}

	return nil
}

