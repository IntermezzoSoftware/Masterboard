package catalog

import (
	"archive/tar"
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
			{Name: "stockfish-windows-x86-64-avx2-bmi2.zip", BrowserDownloadURL: "http://placeholder/sf-win-avx2-bmi2.zip", Size: 1000},
			{Name: "stockfish-windows-x86-64-avx2.zip", BrowserDownloadURL: "http://placeholder/sf-win-avx2.zip", Size: 900},
			{Name: "stockfish-windows-x86-64.zip", BrowserDownloadURL: "http://placeholder/sf-win-x86-64.zip", Size: 850},
			{Name: "stockfish-macos-m1-apple-silicon.tar", BrowserDownloadURL: "http://placeholder/sf-mac-arm.tar", Size: 900},
			{Name: "stockfish-macos-x86-64-avx2.tar", BrowserDownloadURL: "http://placeholder/sf-mac-avx2.tar", Size: 800},
			{Name: "stockfish-macos-x86-64.tar", BrowserDownloadURL: "http://placeholder/sf-mac-x86-64.tar", Size: 750},
			{Name: "stockfish-ubuntu-x86-64-avx2.tar", BrowserDownloadURL: "http://placeholder/sf-linux-avx2.tar", Size: 800},
			{Name: "stockfish-ubuntu-x86-64.tar", BrowserDownloadURL: "http://placeholder/sf-linux-x86-64.tar", Size: 750},
		},
	}

	// Mirror the real Lc0 release pattern: newest tag ships only Windows, an
	// earlier stable tag also has the macOS binary, and there's a pre-release
	// between them that should be skipped.
	lc0Releases := []githubRelease{
		{
			TagName: "v0.32.1",
			Assets: []githubAsset{
				{
					Name:               "lc0-v0.32.1-windows-cpu-dnnl.zip",
					BrowserDownloadURL: "http://placeholder/lc0-v0.32.1-cpu-dnnl.zip",
					Size:               5000000,
				},
			},
		},
		{
			TagName:    "v0.32.0-rc2",
			Prerelease: true,
			Assets: []githubAsset{
				{
					Name:               "lc0-v0.32.0-rc2-windows-cpu-dnnl.zip",
					BrowserDownloadURL: "http://placeholder/lc0-rc2-cpu-dnnl.zip",
					Size:               5000000,
				},
				{
					Name:               "lc0-v0.32.0-rc2-macos_12.6.1",
					BrowserDownloadURL: "http://placeholder/lc0-rc2-macos",
					Size:               5000000,
				},
			},
		},
		{
			TagName: "v0.32.0",
			Assets: []githubAsset{
				{
					Name:               "lc0-v0.32.0-windows-cpu-dnnl.zip",
					BrowserDownloadURL: "http://placeholder/lc0-v0.32.0-cpu-dnnl.zip",
					Size:               5000000,
				},
				{
					Name:               "lc0-v0.32.0-macos_12.6.1",
					BrowserDownloadURL: "http://placeholder/lc0-v0.32.0-macos",
					Size:               5000000,
				},
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

	mux.HandleFunc("/repos/LeelaChessZero/lc0/releases", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(lc0Releases)
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

	// Lc0 only ships prebuilt binaries for Windows and macOS. On Linux the
	// catalog intentionally omits the Lc0 family, so skip those assertions.
	if runtime.GOOS == "linux" {
		var hasLc0 bool
		for _, e := range engines {
			if e.ID == "lc0-strong" || strings.HasPrefix(e.ID, "lc0-maia-") {
				hasLc0 = true
				break
			}
		}
		if hasLc0 {
			t.Error("Linux catalog should not include Lc0/Maia entries (no prebuilt binaries)")
		}
		return
	}

	// Verify lc0-strong entry exists. On Windows the network is bundled inside
	// the release zip (NetworkURL empty). On macOS the asset is a raw binary
	// with no bundled network, so NetworkURL must point at a default net.
	var hasLc0Strong bool
	for _, e := range engines {
		if e.ID == "lc0-strong" {
			hasLc0Strong = true
			if e.DownloadURL == "" {
				t.Error("lc0-strong missing DownloadURL")
			}
			switch runtime.GOOS {
			case "darwin":
				if e.NetworkURL == "" {
					t.Error("lc0-strong on darwin must have NetworkURL (Mac asset is a raw binary without bundled network)")
				}
			case "windows":
				if e.NetworkURL != "" {
					t.Errorf("lc0-strong on windows should rely on bundled network, got NetworkURL=%q", e.NetworkURL)
				}
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

// TestResolveLc0BinaryWalksPastReleasesWithoutMacOS verifies that we walk
// back through releases until we find one that has a macOS asset. Lc0's
// latest release frequently ships only Windows binaries, so sticking to the
// "latest" release leaves Mac users without Lc0 (and hence without Maia).
func TestResolveLc0BinaryWalksPastReleasesWithoutMacOS(t *testing.T) {
	releases := []githubRelease{
		{
			TagName: "v0.32.1",
			Assets: []githubAsset{
				{Name: "lc0-v0.32.1-windows-cpu-dnnl.zip", BrowserDownloadURL: "http://placeholder/win"},
			},
		},
		{
			TagName:    "v0.32.0-rc2",
			Prerelease: true,
			Assets: []githubAsset{
				{Name: "lc0-v0.32.0-rc2-macos_12.6.1", BrowserDownloadURL: "http://placeholder/rc2"},
			},
		},
		{
			TagName: "v0.32.0",
			Assets: []githubAsset{
				{Name: "lc0-v0.32.0-macos_12.6.1", BrowserDownloadURL: "http://placeholder/stable-mac"},
				{Name: "lc0-v0.32.0-windows-cpu-dnnl.zip", BrowserDownloadURL: "http://placeholder/stable-win"},
			},
		},
	}

	url, version := resolveLc0Binary(releases)
	switch runtime.GOOS {
	case "windows":
		// Should pick the newest stable (v0.32.1), even though v0.32.0 also has
		// a Windows asset — we don't walk past newer releases on Windows.
		if version != "v0.32.1" {
			t.Errorf("Windows: version = %q, want v0.32.1", version)
		}
		if !strings.HasSuffix(url, "/win") {
			t.Errorf("Windows: url = %q, want the v0.32.1 Windows asset", url)
		}
	case "darwin":
		// Should skip v0.32.1 (no macOS asset) and v0.32.0-rc2 (pre-release),
		// landing on the v0.32.0 stable release.
		if version != "v0.32.0" {
			t.Errorf("Mac: version = %q, want v0.32.0 (RC must be skipped)", version)
		}
		if !strings.HasSuffix(url, "/stable-mac") {
			t.Errorf("Mac: url = %q, want the v0.32.0 macOS asset", url)
		}
	default:
		if url != "" || version != "" {
			t.Errorf("%s: expected no Lc0 binary, got url=%q version=%q", runtime.GOOS, url, version)
		}
	}
}

// TestPickBinaryIgnoresNonExecutable verifies that pickBinary only returns
// files whose magic bytes identify them as native executables, so extraneous
// archive contents (Makefile, README, shell scripts without shebangs) aren't
// mistakenly treated as the engine binary. This is the fix for the Mac Stockfish
// bug where the Makefile ended up chmodded and registered as the engine.
func TestPickBinaryIgnoresNonExecutable(t *testing.T) {
	dir := t.TempDir()
	// A Makefile-shaped text file: much larger than the binary but no magic.
	makefile := filepath.Join(dir, "Makefile")
	if err := os.WriteFile(makefile, []byte(strings.Repeat("# make rules\n", 5000)), 0644); err != nil {
		t.Fatal(err)
	}
	// A shell script: has shebang, passes +x on unix, but not a native binary.
	script := filepath.Join(dir, "net.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho hi\n"), 0755); err != nil {
		t.Fatal(err)
	}
	// A fake ELF binary.
	binary := filepath.Join(dir, "stockfish")
	elfHeader := []byte{0x7f, 'E', 'L', 'F', 0x02, 0x01, 0x01, 0x00}
	if err := os.WriteFile(binary, append(elfHeader, bytes.Repeat([]byte{0}, 100)...), 0755); err != nil {
		t.Fatal(err)
	}

	got := pickBinary(dir)
	if got != binary {
		t.Errorf("pickBinary = %q, want %q", got, binary)
	}
}

// TestIsNativeExecutable verifies the magic-byte detection covers ELF, Mach-O,
// Mach-O fat, and PE, and rejects text.
func TestIsNativeExecutable(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want bool
	}{
		{"elf", []byte{0x7f, 'E', 'L', 'F', 0x02, 0, 0, 0}, true},
		{"macho64_le", []byte{0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0}, true},
		{"macho32_le", []byte{0xce, 0xfa, 0xed, 0xfe, 0, 0, 0, 0}, true},
		{"macho_fat", []byte{0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0}, true},
		{"pe", []byte{'M', 'Z', 0x90, 0, 0, 0, 0, 0}, true},
		{"text_makefile", []byte("# Makefile\n\nall:\n\tcc..."), false},
		{"shell_script", []byte("#!/bin/sh\necho hi\n"), false},
		{"too_short", []byte{'M', 'Z'}, false},
	}
	for _, tc := range cases {
		p := filepath.Join(t.TempDir(), tc.name)
		if err := os.WriteFile(p, tc.data, 0644); err != nil {
			t.Fatal(err)
		}
		if got := isNativeExecutable(p); got != tc.want {
			t.Errorf("isNativeExecutable(%s) = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// TestExtractTar verifies extractTar handles a nested tar archive (as
// Stockfish's macOS/Linux releases ship), picks the real binary by magic
// bytes, and flattens paths so discovery finds it at one level deep.
func TestExtractTar(t *testing.T) {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	// Stockfish tars contain a `stockfish/` folder with the binary + docs.
	entries := []struct {
		name string
		body []byte
		mode int64
	}{
		{"stockfish/Copying.txt", []byte("license text"), 0644},
		{"stockfish/AUTHORS", []byte("contributor list"), 0644},
		// ELF-shaped "binary" — magic bytes followed by padding.
		{"stockfish/stockfish", append([]byte{0x7f, 'E', 'L', 'F'}, bytes.Repeat([]byte{0}, 500000)...), 0755},
	}
	for _, e := range entries {
		if err := tw.WriteHeader(&tar.Header{
			Name:     e.name,
			Mode:     e.mode,
			Size:     int64(len(e.body)),
			Typeflag: tar.TypeReg,
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write(e.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}

	tmp, err := os.CreateTemp(t.TempDir(), "sf-*.tar")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tmp.Write(buf.Bytes()); err != nil {
		t.Fatal(err)
	}
	tmp.Close()

	destDir := t.TempDir()
	binaryPath, networkPath, err := extractTar(tmp.Name(), destDir)
	if err != nil {
		t.Fatalf("extractTar: %v", err)
	}
	if networkPath != "" {
		t.Errorf("expected no network path, got %q", networkPath)
	}
	wantBin := filepath.Join(destDir, "stockfish")
	if binaryPath != wantBin {
		t.Errorf("binaryPath = %q, want %q", binaryPath, wantBin)
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
