package catalog

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestStockfishVariantNonEmpty verifies StockfishVariant returns a non-empty string.
func TestStockfishVariantNonEmpty(t *testing.T) {
	v := StockfishVariant()
	if v == "" {
		t.Fatal("StockfishVariant returned empty string")
	}
}

// TestStockfishVariantKnownValues verifies the return value is one of the known variants.
func TestStockfishVariantKnownValues(t *testing.T) {
	v := StockfishVariant()
	known := map[string]bool{
		"avx2-bmi2":    true,
		"avx2":         true,
		"sse41-popcnt": true,
		"x86-64":       true,
	}
	if !known[v] {
		t.Fatalf("unexpected StockfishVariant %q", v)
	}
}

// mockGitHubServer creates a test HTTP server that serves canned GitHub-shaped
// responses for Stockfish, Lc0, and Maia releases. Returns the server and a
// teardown function that also restores the HTTP client.
func mockGitHubServer(t *testing.T) (*httptest.Server, func()) {
	t.Helper()

	sfRelease := githubRelease{
		TagName: "sf_17",
		Assets: []githubAsset{
			{
				Name:               "stockfish-windows-x86-64-avx2-bmi2.zip",
				BrowserDownloadURL: "http://placeholder/sf-avx2-bmi2.zip",
				Size:               1000,
			},
			{
				Name:               "stockfish-windows-x86-64-avx2.zip",
				BrowserDownloadURL: "http://placeholder/sf-avx2.zip",
				Size:               900,
			},
		},
	}

	lc0Release := githubRelease{
		TagName: "v0.31.2",
		Assets: []githubAsset{
			{
				Name:               "lc0-v0.31.2-windows-cpu-dnnl.zip",
				BrowserDownloadURL: "http://placeholder/lc0-cpu-dnnl.zip",
				Size:               5000000,
			},
		},
	}

	maiaReleases := []githubRelease{
		{
			TagName: "v1.0",
			Assets: []githubAsset{
				{
					Name:               "maia-1100.pb.gz",
					BrowserDownloadURL: "http://placeholder/maia-1100.pb.gz",
					Size:               50000,
				},
				{
					Name:               "maia-1900.pb.gz",
					BrowserDownloadURL: "http://placeholder/maia-1900.pb.gz",
					Size:               50000,
				},
			},
		},
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/repos/official-stockfish/Stockfish/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sfRelease)
	})

	mux.HandleFunc("/repos/LeelaChessZero/lc0/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(lc0Release)
	})

	mux.HandleFunc("/repos/CSSLab/maia-chess/releases", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(maiaReleases)
	})

	srv := httptest.NewServer(mux)

	// Redirect http.DefaultClient to the test server by rewriting the base URL.
	// We do this by patching the transport so all requests to api.github.com
	// are forwarded to the test server instead.
	origTransport := http.DefaultClient.Transport
	http.DefaultClient.Transport = &rewriteTransport{base: srv.URL}

	teardown := func() {
		http.DefaultClient.Transport = origTransport
		srv.Close()
	}
	return srv, teardown
}

// rewriteTransport rewrites the host of every request to the configured base URL,
// so that API calls to api.github.com are forwarded to the test server.
type rewriteTransport struct {
	base string
}

func (rt *rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = "http"
	// Strip the "api.github.com" host and replace with test server.
	baseURL := strings.TrimPrefix(rt.base, "http://")
	clone.URL.Host = baseURL
	// Keep path, query as-is.
	return http.DefaultTransport.RoundTrip(clone)
}

// TestResolve verifies that Resolve returns well-formed entries using a mock server.
func TestResolve(t *testing.T) {
	_, teardown := mockGitHubServer(t)
	defer teardown()

	engines, err := Resolve(context.Background())
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	if len(engines) == 0 {
		t.Fatal("Resolve returned empty slice")
	}

	// Check all entries have required fields.
	for _, e := range engines {
		if e.ID == "" {
			t.Errorf("entry missing ID: %+v", e)
		}
		if e.Name == "" {
			t.Errorf("entry %q missing Name", e.ID)
		}
		if e.DownloadURL == "" {
			t.Errorf("entry %q missing DownloadURL", e.ID)
		}
	}

	// Verify Stockfish entry exists.
	var hasSF bool
	for _, e := range engines {
		if e.ID == "stockfish" {
			hasSF = true
			if e.Version == "" {
				t.Error("stockfish entry missing Version")
			}
		}
	}
	if !hasSF {
		t.Error("Resolve did not return a stockfish entry")
	}

	// Verify lc0-strong entry exists (network is bundled in the zip, not a separate URL).
	var hasLc0Strong bool
	for _, e := range engines {
		if e.ID == "lc0-strong" {
			hasLc0Strong = true
			if e.DownloadURL == "" {
				t.Error("lc0-strong missing DownloadURL")
			}
		}
	}
	if !hasLc0Strong {
		t.Error("Resolve did not return lc0-strong entry")
	}

	// Verify at least one Maia entry exists.
	var hasMaia bool
	for _, e := range engines {
		if strings.HasPrefix(e.ID, "lc0-maia-") {
			hasMaia = true
			if e.NetworkURL == "" {
				t.Errorf("maia entry %q missing NetworkURL", e.ID)
			}
		}
	}
	if !hasMaia {
		t.Error("Resolve did not return any maia entries")
	}
}

// TestDisplayName verifies the DisplayName formatting for each engine family.
func TestDisplayName(t *testing.T) {
	cases := []struct {
		engine DownloadableEngine
		want   string
	}{
		{
			engine: DownloadableEngine{ID: "stockfish", Name: "Stockfish", Version: "sf_17.1"},
			want:   "Stockfish 17.1",
		},
		{
			engine: DownloadableEngine{ID: "stockfish", Name: "Stockfish", Version: "sf_17"},
			want:   "Stockfish 17",
		},
		{
			engine: DownloadableEngine{ID: "lc0-strong", Name: "Lc0 (strong analysis)", Version: "v0.31.2"},
			want:   "Lc0 v0.31.2",
		},
		{
			engine: DownloadableEngine{ID: "lc0-maia-1100", Name: "Lc0 + Maia 1100", Version: "v0.31.2"},
			want:   "Lc0 v0.31.2 + Maia 1100",
		},
		{
			engine: DownloadableEngine{ID: "lc0-maia-1900", Name: "Lc0 + Maia 1900", Version: "v0.31.2"},
			want:   "Lc0 v0.31.2 + Maia 1900",
		},
		// No version fallbacks.
		{
			engine: DownloadableEngine{ID: "stockfish", Name: "Stockfish", Version: ""},
			want:   "Stockfish",
		},
		{
			engine: DownloadableEngine{ID: "lc0-strong", Name: "Lc0 (strong analysis)", Version: ""},
			want:   "Lc0",
		},
		{
			engine: DownloadableEngine{ID: "lc0-maia-1600", Name: "Lc0 + Maia 1600", Version: ""},
			want:   "Lc0 + Maia 1600",
		},
	}
	for _, tc := range cases {
		got := tc.engine.DisplayName()
		if got != tc.want {
			t.Errorf("DisplayName(%q v%q) = %q, want %q", tc.engine.ID, tc.engine.Version, got, tc.want)
		}
	}
}

// makeTestZip creates a minimal valid zip file in memory containing one .exe file.
func makeTestZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, err := w.Create("engine.exe")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(f, "MZ fake exe content for testing"); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// TestDownloadTo verifies that DownloadTo extracts the binary and sets it executable.
func TestDownloadTo(t *testing.T) {
	zipData := makeTestZip(t)

	// Serve the zip file and a tiny network file.
	mux := http.NewServeMux()
	mux.HandleFunc("/engine.zip", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(zipData)))
		w.Write(zipData)
	})
	mux.HandleFunc("/network.pb.gz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Write([]byte("fake network data"))
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	e := DownloadableEngine{
		ID:          "test-engine",
		Name:        "Test Engine",
		Description: "Test only",
		DownloadURL: srv.URL + "/engine.zip",
	}

	destDir := t.TempDir()
	var lastPct int
	paths, err := DownloadTo(context.Background(), e, destDir, func(pct int, recv, total int64) {
		lastPct = pct
	})
	if err != nil {
		t.Fatalf("DownloadTo: %v", err)
	}

	if len(paths) != 1 {
		t.Fatalf("expected 1 path, got %d: %v", len(paths), paths)
	}

	// Verify binary exists.
	info, err := os.Stat(paths[0])
	if err != nil {
		t.Fatalf("binary not found at %s: %v", paths[0], err)
	}
	// On non-Windows platforms, verify executable bits are set.
	// Windows does not use Unix permission bits, so skip that check there.
	if runtime.GOOS != "windows" && info.Mode()&0111 == 0 {
		t.Errorf("binary at %s is not executable (mode %v)", paths[0], info.Mode())
	}

	_ = lastPct // progress was exercised

	// Now test with a network URL too.
	e2 := DownloadableEngine{
		ID:          "test-lc0",
		Name:        "Test Lc0",
		Description: "Test only",
		DownloadURL: srv.URL + "/engine.zip",
		NetworkURL:  srv.URL + "/network.pb.gz",
	}
	paths2, err := DownloadTo(context.Background(), e2, destDir, nil)
	if err != nil {
		t.Fatalf("DownloadTo with network: %v", err)
	}
	if len(paths2) != 2 {
		t.Fatalf("expected 2 paths for lc0, got %d: %v", len(paths2), paths2)
	}
	// Verify network file is in destDir/networks/.
	netPath := paths2[1]
	if !strings.Contains(filepath.ToSlash(netPath), "/networks/") {
		t.Errorf("network path %q does not contain /networks/", netPath)
	}
	if _, err := os.Stat(netPath); err != nil {
		t.Fatalf("network file not found at %s: %v", netPath, err)
	}
}

// TestExtractZip verifies that extractZip picks the .exe from a zip.
func TestExtractZip(t *testing.T) {
	zipData := makeTestZip(t)

	// Write zip to a temp file.
	tmp, err := os.CreateTemp("", "test-*.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tmp.Write(zipData); err != nil {
		t.Fatal(err)
	}
	tmp.Close()
	defer os.Remove(tmp.Name())

	destDir := t.TempDir()
	binaryPath, networkPath, err := extractZip(tmp.Name(), destDir)
	if err != nil {
		t.Fatalf("extractZip: %v", err)
	}
	if _, err := os.Stat(binaryPath); err != nil {
		t.Fatalf("extracted binary not found: %v", err)
	}
	// makeTestZip contains no network file, so networkPath should be empty.
	if networkPath != "" {
		t.Errorf("expected no network path, got %q", networkPath)
	}
}
