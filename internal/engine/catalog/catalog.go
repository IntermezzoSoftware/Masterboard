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

// StockfishVariant returns the Stockfish asset name suffix for the current CPU
// and GOOS. E.g. "avx2-bmi2", "avx2", "sse41-popcnt", or "x86-64".
// Uses github.com/klauspost/cpuid/v2 for feature detection on x86-64.
// On darwin/arm64 returns "m1-apple-silicon".
func StockfishVariant() string {
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		return "m1-apple-silicon"
	}
	cpu := cpuid.CPU
	if cpu.Supports(cpuid.AVX2, cpuid.BMI2) {
		// On Windows the asset is "avx2-bmi2"; Mac/Linux ship separate "avx2"
		// and "bmi2" variants — prefer bmi2 when available.
		if runtime.GOOS == "windows" {
			return "avx2-bmi2"
		}
		return "bmi2"
	}
	if cpu.Supports(cpuid.AVX2) {
		return "avx2"
	}
	if cpu.Supports(cpuid.SSE4, cpuid.POPCNT) {
		return "sse41-popcnt"
	}
	return "x86-64"
}

// stockfishPlatformInfo returns the release-asset platform prefix, the ordered
// list of variants to try (preferred first), and the archive extension for the
// current GOOS. The returned variant strings are matched as the suffix of the
// asset stem (after "stockfish-<platform>-").
func stockfishPlatformInfo() (prefix string, variants []string, ext string) {
	switch runtime.GOOS {
	case "windows":
		prefix, ext = "windows", ".zip"
		variants = windowsVariantFallbacks()
	case "darwin":
		prefix, ext = "macos", ".tar"
		variants = darwinVariantFallbacks()
	case "linux":
		prefix, ext = "ubuntu", ".tar"
		variants = linuxVariantFallbacks()
	}
	return
}

func windowsVariantFallbacks() []string {
	cpu := cpuid.CPU
	switch {
	case cpu.Supports(cpuid.AVX2, cpuid.BMI2):
		return []string{"x86-64-avx2-bmi2", "x86-64-avx2", "x86-64-sse41-popcnt", "x86-64"}
	case cpu.Supports(cpuid.AVX2):
		return []string{"x86-64-avx2", "x86-64-sse41-popcnt", "x86-64"}
	case cpu.Supports(cpuid.SSE4, cpuid.POPCNT):
		return []string{"x86-64-sse41-popcnt", "x86-64"}
	default:
		return []string{"x86-64"}
	}
}

func darwinVariantFallbacks() []string {
	if runtime.GOARCH == "arm64" {
		return []string{"m1-apple-silicon"}
	}
	cpu := cpuid.CPU
	switch {
	case cpu.Supports(cpuid.AVX2, cpuid.BMI2):
		return []string{"x86-64-bmi2", "x86-64-avx2", "x86-64-sse41-popcnt", "x86-64"}
	case cpu.Supports(cpuid.AVX2):
		return []string{"x86-64-avx2", "x86-64-sse41-popcnt", "x86-64"}
	case cpu.Supports(cpuid.SSE4, cpuid.POPCNT):
		return []string{"x86-64-sse41-popcnt", "x86-64"}
	default:
		return []string{"x86-64"}
	}
}

func linuxVariantFallbacks() []string {
	cpu := cpuid.CPU
	switch {
	case cpu.Supports(cpuid.AVX2, cpuid.BMI2):
		return []string{"x86-64-bmi2", "x86-64-avx2", "x86-64-sse41-popcnt", "x86-64"}
	case cpu.Supports(cpuid.AVX2):
		return []string{"x86-64-avx2", "x86-64-sse41-popcnt", "x86-64"}
	case cpu.Supports(cpuid.SSE4, cpuid.POPCNT):
		return []string{"x86-64-sse41-popcnt", "x86-64"}
	default:
		return []string{"x86-64"}
	}
}

// Resolve fetches the latest releases from GitHub concurrently and returns the
// full curated list with Version and DownloadURL populated.
//
// It fetches:
//  1. Stockfish latest release from official-stockfish/Stockfish
//  2. Lc0 releases from LeelaChessZero/lc0 (walked back to find one that
//     ships a binary for this platform — Lc0 doesn't build for macOS on
//     every release, so we can't rely on "latest")
//  3. Maia network assets from CSSLab/maia-chess
//
// All three fetches run concurrently via errgroup.
// Returns the merged []DownloadableEngine slice.
func Resolve(ctx context.Context) ([]DownloadableEngine, error) {
	var (
		sfRelease    githubRelease
		lc0Releases  []githubRelease
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
		rels, err := fetchAllReleases(gctx, "LeelaChessZero", "lc0")
		if err != nil {
			return fmt.Errorf("Resolve: lc0: %w", err)
		}
		lc0Releases = rels
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

	// Walk Lc0 releases newest-first (skipping pre-releases) and pick the
	// first one that ships a binary for this platform. On platforms where
	// Lc0 ships no binary at all (e.g. Linux today), lc0BinaryURL is empty
	// and the Lc0 family is omitted from the catalog.
	lc0BinaryURL, lc0Version := resolveLc0Binary(lc0Releases)
	if lc0BinaryURL != "" {
		if lc0Strong := resolveLc0Strong(lc0BinaryURL, lc0Version); lc0Strong != nil {
			engines = append(engines, *lc0Strong)
		}

		maiaEntries := resolveMaiaEntries(maiaReleases, lc0BinaryURL, lc0Version)
		engines = append(engines, maiaEntries...)
	}

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
	prefix, variants, ext := stockfishPlatformInfo()
	if prefix == "" {
		return nil
	}

	for _, v := range variants {
		suffix := "-" + v + ext
		url := findAsset(rel.Assets, func(a githubAsset) bool {
			lower := strings.ToLower(a.Name)
			return strings.Contains(lower, prefix) && strings.HasSuffix(lower, suffix)
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

// resolveLc0Binary walks releases newest-first (skipping pre-releases) and
// returns the first release's binary URL + version for the current platform.
// Lc0 doesn't build for macOS on every release — for example v0.32.1 ships
// only Windows assets, while v0.32.0 ships both — so sticking to the "latest"
// release would leave Mac users without Lc0. Returns empty strings on
// platforms where Lc0 publishes no prebuilt binaries.
func resolveLc0Binary(releases []githubRelease) (binaryURL, version string) {
	for _, rel := range releases {
		if rel.Prerelease {
			continue
		}
		if url := findLc0Asset(rel); url != "" {
			return url, rel.TagName
		}
	}
	return "", ""
}

// findLc0Asset returns the asset URL matching the current platform, or "" if
// this release has no suitable asset. Windows prefers the CPU/DNNL build;
// macOS takes the single `lc0-*-macos_*` asset the project publishes.
func findLc0Asset(rel githubRelease) string {
	switch runtime.GOOS {
	case "windows":
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
	case "darwin":
		return findAsset(rel.Assets, func(a githubAsset) bool {
			return strings.Contains(strings.ToLower(a.Name), "macos")
		})
	}
	// Linux: Lc0 does not publish prebuilt binaries to GitHub releases.
	return ""
}

// lc0StrongMacNetworkURL is the default network downloaded alongside the
// macOS Lc0 binary. The Windows Lc0 release zip bundles a recommended
// network, but the macOS asset is a raw Mach-O with no bundled network, so
// we fetch one explicitly. T1 256x10 distilled (~30 MB) is a strong
// CPU-friendly default.
const lc0StrongMacNetworkURL = "https://storage.lczero.org/files/networks-contrib/t1-256x10-distilled-swa-2432500.pb.gz"

// resolveLc0Strong builds the lc0-strong entry. On Windows the release zip
// bundles both the binary and a recommended network; on macOS the asset is a
// raw binary, so we attach a default NetworkURL for Mac users.
func resolveLc0Strong(binaryURL, version string) *DownloadableEngine {
	if binaryURL == "" {
		return nil
	}
	entry := &DownloadableEngine{
		ID:          "lc0-strong",
		Name:        "Lc0 (strong analysis)",
		Description: "Neural network engine for strongest MCTS analysis (complement to Stockfish)",
		Version:     version,
		DownloadURL: binaryURL,
	}
	if runtime.GOOS == "darwin" {
		entry.NetworkURL = lc0StrongMacNetworkURL
	}
	return entry
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
