package catalog

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// downloadFile performs an HTTP GET of url and writes the body to a temporary
// file, calling onProgress with (percent, bytesReceived, totalBytes) every
// ~100 KB. Returns the path of the completed temp file.
// Uses a 60-second timeout (or ctx, whichever is shorter).
func downloadFile(ctx context.Context, url string, onProgress func(int, int64, int64)) (string, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(timeoutCtx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("downloadFile: create request: %w", err)
	}
	req.Header.Set("User-Agent", "Masterboard/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("downloadFile: GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("downloadFile: GET %s: unexpected status %d", url, resp.StatusCode)
	}

	tmp, err := os.CreateTemp("", "masterboard-engine-*")
	if err != nil {
		return "", fmt.Errorf("downloadFile: create temp file: %w", err)
	}
	defer func() {
		tmp.Close()
	}()

	total := resp.ContentLength
	var received int64
	const reportEvery = 100 * 1024 // 100 KB
	var lastReport int64

	buf := make([]byte, 32*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := tmp.Write(buf[:n]); writeErr != nil {
				os.Remove(tmp.Name())
				return "", fmt.Errorf("downloadFile: write: %w", writeErr)
			}
			received += int64(n)
			if received-lastReport >= reportEvery {
				lastReport = received
				if onProgress != nil {
					var pct int
					if total > 0 {
						pct = int(received * 100 / total)
					}
					onProgress(pct, received, total)
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			os.Remove(tmp.Name())
			return "", fmt.Errorf("downloadFile: read body: %w", readErr)
		}
	}

	// Final progress report
	if onProgress != nil && total > 0 {
		onProgress(100, received, total)
	}

	return tmp.Name(), nil
}

// extractZip extracts all files from zipPath into destDir, placing network
// files (.pb or .pb.gz) into destDir/networks/ instead. Returns the path of
// the largest executable found and the network path (empty if none present).
func extractZip(zipPath, destDir string) (binaryPath, networkPath string, err error) {
	r, openErr := zip.OpenReader(zipPath)
	if openErr != nil {
		return "", "", fmt.Errorf("extractZip: open %s: %w", zipPath, openErr)
	}
	defer r.Close()

	extractEntry := func(f *zip.File, dest string) error {
		rc, rcErr := f.Open()
		if rcErr != nil {
			return fmt.Errorf("open entry %s: %w", f.Name, rcErr)
		}
		defer rc.Close()
		out, outErr := os.Create(dest)
		if outErr != nil {
			return fmt.Errorf("create %s: %w", dest, outErr)
		}
		defer out.Close()
		if _, copyErr := io.Copy(out, rc); copyErr != nil {
			return fmt.Errorf("copy %s: %w", f.Name, copyErr)
		}
		return nil
	}

	var bestExe *zip.File
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := strings.ToLower(filepath.Base(f.Name))
		isNet := strings.HasSuffix(name, ".pb.gz") || strings.HasSuffix(name, ".pb")

		var dest string
		if isNet {
			// Network files go into destDir/networks/
			networksDir := filepath.Join(destDir, "networks")
			if mkErr := os.MkdirAll(networksDir, 0755); mkErr != nil {
				return "", "", fmt.Errorf("extractZip: mkdir networks: %w", mkErr)
			}
			dest = filepath.Join(networksDir, filepath.Base(f.Name))
			networkPath = dest
		} else {
			dest = filepath.Join(destDir, filepath.Base(f.Name))
		}

		if extractErr := extractEntry(f, dest); extractErr != nil {
			return "", "", fmt.Errorf("extractZip: %w", extractErr)
		}

		// Track the largest executable to return as binaryPath.
		isExe := false
		if runtime.GOOS == "windows" {
			isExe = strings.HasSuffix(name, ".exe")
		} else {
			isExe = filepath.Ext(name) == ""
		}
		if isExe && (bestExe == nil || f.UncompressedSize64 > bestExe.UncompressedSize64) {
			bestExe = f
			binaryPath = dest
		}
	}

	if binaryPath == "" {
		return "", "", fmt.Errorf("extractZip: no executable found in %s", zipPath)
	}

	return binaryPath, networkPath, nil
}

// DownloadTo downloads the engine described by e into destDir.
// Progress is reported via the onProgress callback (0..100).
// For Lc0 entries (NetworkURL != ""), downloads the network to destDir/networks/.
// Returns the path(s) of the downloaded file(s):
//   - [binaryPath] for Stockfish
//   - [binaryPath, networkPath] for Lc0
func DownloadTo(ctx context.Context, e DownloadableEngine, destDir string, onProgress func(percent int, received, total int64)) ([]string, error) {
	hasNetwork := e.NetworkURL != ""

	// Determine scaling for progress: binary uses 0..70% if there's a network file, else 0..100%.
	binaryMax := 100
	if hasNetwork {
		binaryMax = 70
	}

	binaryProgress := func(pct int, recv, tot int64) {
		if onProgress != nil {
			scaled := pct * binaryMax / 100
			onProgress(scaled, recv, tot)
		}
	}

	tmpZip, err := downloadFile(ctx, e.DownloadURL, binaryProgress)
	if err != nil {
		return nil, fmt.Errorf("DownloadTo %s: download binary: %w", e.ID, err)
	}
	defer os.Remove(tmpZip)

	var binaryPath string
	var bundledNetworkPath string
	if strings.HasSuffix(strings.ToLower(e.DownloadURL), ".zip") {
		binaryPath, bundledNetworkPath, err = extractZip(tmpZip, destDir)
		if err != nil {
			return nil, fmt.Errorf("DownloadTo %s: extract: %w", e.ID, err)
		}
	} else {
		// Copy directly
		ext := filepath.Ext(e.DownloadURL)
		if ext == "" && runtime.GOOS == "windows" {
			ext = ".exe"
		}
		binaryPath = filepath.Join(destDir, e.ID+ext)
		if err := copyFile(tmpZip, binaryPath); err != nil {
			return nil, fmt.Errorf("DownloadTo %s: copy binary: %w", e.ID, err)
		}
	}

	if err := os.Chmod(binaryPath, 0755); err != nil {
		return nil, fmt.Errorf("DownloadTo %s: chmod: %w", e.ID, err)
	}

	paths := []string{binaryPath}

	// A network bundled inside the zip counts the same as a separate NetworkURL.
	if bundledNetworkPath != "" {
		paths = append(paths, bundledNetworkPath)
	}

	if !hasNetwork {
		return paths, nil
	}

	networksDir := filepath.Join(destDir, "networks")
	if err := os.MkdirAll(networksDir, 0755); err != nil {
		return nil, fmt.Errorf("DownloadTo %s: mkdir networks: %w", e.ID, err)
	}

	networkProgress := func(pct int, recv, tot int64) {
		if onProgress != nil {
			scaled := binaryMax + pct*(100-binaryMax)/100
			onProgress(scaled, recv, tot)
		}
	}

	tmpNet, err := downloadFile(ctx, e.NetworkURL, networkProgress)
	if err != nil {
		return nil, fmt.Errorf("DownloadTo %s: download network: %w", e.ID, err)
	}
	defer os.Remove(tmpNet)

	netFilename := filepath.Base(e.NetworkURL)
	networkPath := filepath.Join(networksDir, netFilename)
	if err := copyFile(tmpNet, networkPath); err != nil {
		return nil, fmt.Errorf("DownloadTo %s: copy network: %w", e.ID, err)
	}

	paths = append(paths, networkPath)
	return paths, nil
}

// copyFile copies src to dst, creating dst if it doesn't exist.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("copyFile open src: %w", err)
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("copyFile create dst: %w", err)
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return fmt.Errorf("copyFile copy: %w", err)
	}
	return nil
}
