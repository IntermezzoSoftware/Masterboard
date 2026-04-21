// Package catalog provides a curated list of downloadable UCI chess engines
// and utilities to resolve their latest versions from GitHub releases.
package catalog

import (
	"context"
	"fmt"
	"runtime"
	"strconv"
	"strings"

	"github.com/klauspost/cpuid/v2"
	"golang.org/x/sync/errgroup"
)


// DownloadableEngine describes one downloadable entry in the curated list.
type DownloadableEngine struct {
	// ID is a stable machine identifier, e.g. "stockfish", "lc0-strong", "lc0-maia-1100".
	ID string `json:"id"`
	// Name is the human-readable display name.
	Name string `json:"name"`
	// Description is a short description of the engine.
	Description string `json:"description"`
	// Version is populated by Resolve() from the GitHub release tag.
	Version string `json:"version"`
	// DownloadURL is populated by Resolve() — URL of the binary zip/exe.
	DownloadURL string `json:"downloadURL"`
	// NetworkURL is non-empty for Lc0 entries — URL of the .pb.gz network file.
	NetworkURL string `json:"networkURL"`
}

// StockfishVariant returns the Stockfish asset name suffix for this CPU.
// E.g. "avx2-bmi2", "avx2", "sse41-popcnt", or "x86-64" (fallback).
// Uses github.com/klauspost/cpuid/v2.
// Windows returns the appropriate variant; other platforms return "x86-64".
func StockfishVariant() string {
	if runtime.GOOS != "windows" {
		return "x86-64"
	}
	cpu := cpuid.CPU
	if cpu.Supports(cpuid.AVX2, cpuid.BMI2) {
		return "avx2-bmi2"
	}
	if cpu.Supports(cpuid.AVX2) {
		return "avx2"
	}
	if cpu.Supports(cpuid.SSE4, cpuid.POPCNT) {
		return "sse41-popcnt"
	}
	return "x86-64"
}

// Resolve fetches the latest releases from GitHub concurrently and returns the
// full curated list with Version and DownloadURL populated.
//
// It fetches:
//  1. Stockfish latest release from official-stockfish/Stockfish
//  2. Lc0 latest release from LeelaChessZero/lc0
//  3. Maia network assets from CSSLab/maia-chess
//
// All three fetches run concurrently via errgroup.
// Returns the merged []DownloadableEngine slice.
func Resolve(ctx context.Context) ([]DownloadableEngine, error) {
	var (
		sfRelease    githubRelease
		lc0Release   githubRelease
		maiaReleases []githubRelease
	)

	g, gctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		rel, err := fetchLatestRelease(gctx, "official-stockfish", "Stockfish")
		if err != nil {
			return fmt.Errorf("Resolve: stockfish: %w", err)
		}
		sfRelease = rel
		return nil
	})

	g.Go(func() error {
		rel, err := fetchLatestRelease(gctx, "LeelaChessZero", "lc0")
		if err != nil {
			return fmt.Errorf("Resolve: lc0: %w", err)
		}
		lc0Release = rel
		return nil
	})

	g.Go(func() error {
		rels, err := fetchAllReleases(gctx, "CSSLab", "maia-chess")
		if err != nil {
			return fmt.Errorf("Resolve: maia: %w", err)
		}
		maiaReleases = rels
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}

	var engines []DownloadableEngine

	sfEntry := resolveStockfish(sfRelease)
	if sfEntry != nil {
		engines = append(engines, *sfEntry)
	}

	lc0BinaryURL := resolveLc0BinaryURL(lc0Release)
	lc0Version := lc0Release.TagName

	if lc0Strong := resolveLc0Strong(lc0Release, lc0BinaryURL, lc0Version); lc0Strong != nil {
		engines = append(engines, *lc0Strong)
	}

	maiaEntries := resolveMaiaEntries(maiaReleases, lc0BinaryURL, lc0Version)
	engines = append(engines, maiaEntries...)

	return engines, nil
}

// DisplayName returns the display name to use in the engine list, with version
// embedded at the position that matches each engine family's naming convention:
//   - Stockfish: "Stockfish 17.1"   (strips the "sf_" tag prefix to match UCI id name)
//   - Lc0 strong: "Lc0 v0.30.0 (strong analysis)"
//   - Lc0 Maia:   "Lc0 v0.30.0 + Maia 1600"
func (e DownloadableEngine) DisplayName() string {
	switch {
	case e.ID == "stockfish":
		ver := strings.TrimPrefix(e.Version, "sf_")
		if ver == "" {
			return e.Name
		}
		return "Stockfish " + ver
	case e.ID == "lc0-strong":
		if e.Version == "" {
			return "Lc0"
		}
		return "Lc0 " + e.Version
	case strings.HasPrefix(e.ID, "lc0-maia-"):
		elo := strings.TrimPrefix(e.ID, "lc0-maia-")
		if e.Version == "" {
			return "Lc0 + Maia " + elo
		}
		return "Lc0 " + e.Version + " + Maia " + elo
	default:
		if e.Version != "" {
			return e.Name + " " + e.Version
		}
		return e.Name
	}
}

// resolveStockfish picks the best matching Stockfish asset for this platform.
func resolveStockfish(rel githubRelease) *DownloadableEngine {
	variant := StockfishVariant()
	// Fallback order from most to least capable on Windows.
	variants := []string{"avx2-bmi2", "avx2", "sse41-popcnt", "x86-64"}

	// Start from the preferred variant and fall back.
	startIdx := 0
	for i, v := range variants {
		if v == variant {
			startIdx = i
			break
		}
	}

	for _, v := range variants[startIdx:] {
		url := findAsset(rel.Assets, func(a githubAsset) bool {
			lower := strings.ToLower(a.Name)
			return strings.Contains(lower, "windows") &&
				strings.Contains(lower, v) &&
				strings.HasSuffix(lower, ".zip")
		})
		if url != "" {
			return &DownloadableEngine{
				ID:          "stockfish",
				Name:        "Stockfish",
				Description: "World's strongest traditional chess engine",
				Version:     rel.TagName,
				DownloadURL: url,
			}
		}
	}
	return nil
}

// resolveLc0BinaryURL picks the Lc0 CPU binary for Windows.
func resolveLc0BinaryURL(rel githubRelease) string {
	// Prefer dnnl; fall back to any cpu variant.
	url := findAsset(rel.Assets, func(a githubAsset) bool {
		lower := strings.ToLower(a.Name)
		return strings.Contains(lower, "windows") &&
			strings.Contains(lower, "cpu") &&
			strings.Contains(lower, "dnnl") &&
			strings.HasSuffix(lower, ".zip")
	})
	if url != "" {
		return url
	}
	return findAsset(rel.Assets, func(a githubAsset) bool {
		lower := strings.ToLower(a.Name)
		return strings.Contains(lower, "windows") &&
			strings.Contains(lower, "cpu") &&
			strings.HasSuffix(lower, ".zip")
	})
}

// resolveLc0Strong builds the lc0-strong entry. The release zip bundles both
// the binary and a recommended network, so no separate NetworkURL is needed.
func resolveLc0Strong(rel githubRelease, binaryURL, version string) *DownloadableEngine {
	if binaryURL == "" {
		return nil
	}
	return &DownloadableEngine{
		ID:          "lc0-strong",
		Name:        "Lc0 (strong analysis)",
		Description: "Neural network engine for strongest MCTS analysis (complement to Stockfish)",
		Version:     version,
		DownloadURL: binaryURL,
	}
}

// resolveMaiaEntries builds DownloadableEngine entries for each unique Maia ELO.
func resolveMaiaEntries(releases []githubRelease, lc0BinaryURL, lc0Version string) []DownloadableEngine {
	// Track which ELOs we've already seen to avoid duplicates.
	seen := make(map[int]bool)
	var entries []DownloadableEngine

	for _, rel := range releases {
		for _, asset := range rel.Assets {
			lower := strings.ToLower(asset.Name)
			// Match e.g. "maia-1100.pb.gz"
			if !strings.HasPrefix(lower, "maia-") || !strings.HasSuffix(lower, ".pb.gz") {
				continue
			}
			eloStr := strings.TrimPrefix(lower, "maia-")
			eloStr = strings.TrimSuffix(eloStr, ".pb.gz")
			elo, err := strconv.Atoi(eloStr)
			if err != nil {
				continue
			}
			// Only 1100–1900.
			if elo < 1100 || elo > 1900 {
				continue
			}
			if seen[elo] {
				continue
			}
			seen[elo] = true
			entries = append(entries, DownloadableEngine{
				ID:          fmt.Sprintf("lc0-maia-%d", elo),
				Name:        fmt.Sprintf("Lc0 + Maia %d", elo),
				Description: fmt.Sprintf("Neural network engine with human-like style (%d ELO)", elo),
				Version:     lc0Version,
				DownloadURL: lc0BinaryURL,
				NetworkURL:  asset.BrowserDownloadURL,
			})
		}
	}

	return entries
}

// findAsset returns the BrowserDownloadURL of the first asset matching pred,
// or "" if none match.
func findAsset(assets []githubAsset, pred func(githubAsset) bool) string {
	for _, a := range assets {
		if pred(a) {
			return a.BrowserDownloadURL
		}
	}
	return ""
}
