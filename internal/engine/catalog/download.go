package catalog

import (
	"archive/tar"
	"archive/zip"
	"context"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
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
// the largest file whose magic bytes identify it as a native executable (ELF,
// Mach-O, or PE), and the network path (empty if none present).
func extractZip(zipPath, destDir string) (binaryPath, networkPath string, err error) {
	r, openErr := zip.OpenReader(zipPath)
	if openErr != nil {
		return "", "", fmt.Errorf("extractZip: open %s: %w", zipPath, openErr)
	}
	defer r.Close()

	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := strings.ToLower(filepath.Base(f.Name))
		isNet := strings.HasSuffix(name, ".pb.gz") || strings.HasSuffix(name, ".pb")

		var dest string
		if isNet {
			networksDir := filepath.Join(destDir, "networks")
			if mkErr := os.MkdirAll(networksDir, 0755); mkErr != nil {
				return "", "", fmt.Errorf("extractZip: mkdir networks: %w", mkErr)
			}
			dest = filepath.Join(networksDir, filepath.Base(f.Name))
			networkPath = dest
		} else {
			dest = filepath.Join(destDir, filepath.Base(f.Name))
		}

		rc, rcErr := f.Open()
		if rcErr != nil {
			return "", "", fmt.Errorf("extractZip: open entry %s: %w", f.Name, rcErr)
		}
		out, outErr := os.Create(dest)
		if outErr != nil {
			rc.Close()
			return "", "", fmt.Errorf("extractZip: create %s: %w", dest, outErr)
		}
		if _, copyErr := io.Copy(out, rc); copyErr != nil {
			out.Close()
			rc.Close()
			return "", "", fmt.Errorf("extractZip: copy %s: %w", f.Name, copyErr)
		}
		out.Close()
		rc.Close()
	}

	binaryPath = pickBinary(destDir)
	if binaryPath == "" {
		return "", "", fmt.Errorf("extractZip: no executable found in %s", zipPath)
	}
	return binaryPath, networkPath, nil
}

// extractTar extracts all regular files from tarPath (uncompressed tar) into
// destDir, flattening nested directories. Network files go into destDir/networks/.
// Returns the largest native executable (by magic bytes) and the network path.
func extractTar(tarPath, destDir string) (binaryPath, networkPath string, err error) {
	f, openErr := os.Open(tarPath)
	if openErr != nil {
		return "", "", fmt.Errorf("extractTar: open %s: %w", tarPath, openErr)
	}
	defer f.Close()

	tr := tar.NewReader(f)
	for {
		hdr, errN := tr.Next()
		if errN == io.EOF {
			break
		}
		if errN != nil {
			return "", "", fmt.Errorf("extractTar: next: %w", errN)
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}

		base := filepath.Base(hdr.Name)
		lower := strings.ToLower(base)
		isNet := strings.HasSuffix(lower, ".pb.gz") || strings.HasSuffix(lower, ".pb")

		var dest string
		if isNet {
			networksDir := filepath.Join(destDir, "networks")
			if mkErr := os.MkdirAll(networksDir, 0755); mkErr != nil {
				return "", "", fmt.Errorf("extractTar: mkdir networks: %w", mkErr)
			}
			dest = filepath.Join(networksDir, base)
			networkPath = dest
		} else {
			dest = filepath.Join(destDir, base)
		}

		out, outErr := os.Create(dest)
		if outErr != nil {
			return "", "", fmt.Errorf("extractTar: create %s: %w", dest, outErr)
		}
		if _, copyErr := io.Copy(out, tr); copyErr != nil {
			out.Close()
			return "", "", fmt.Errorf("extractTar: copy %s: %w", hdr.Name, copyErr)
		}
		out.Close()
	}

	binaryPath = pickBinary(destDir)
	if binaryPath == "" {
		return "", "", fmt.Errorf("extractTar: no executable found in %s", tarPath)
	}
	return binaryPath, networkPath, nil
}

// pickBinary walks dir (skipping the networks/ subtree) and returns the path of
// the largest file whose leading bytes identify it as a native executable.
// Returns "" if no such file is found.
func pickBinary(dir string) string {
	var best string
	var bestSize int64
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.IsDir() {
			if d.Name() == "networks" && p != dir {
				return fs.SkipDir
			}
			return nil
		}
		if !isNativeExecutable(p) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if best == "" || info.Size() > bestSize {
			best = p
			bestSize = info.Size()
		}
		return nil
	})
	return best
}

// isNativeExecutable returns true if the file at path starts with the magic
// bytes of a Windows PE, ELF, or Mach-O executable (including Mach-O fat/
// universal binaries). It only reads the first 4 bytes — enough to identify
// every relevant format without loading the whole file.
func isNativeExecutable(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	var hdr [4]byte
	n, _ := io.ReadFull(f, hdr[:])
	if n < 4 {
		return false
	}
	switch {
	// ELF: 0x7F 'E' 'L' 'F'
	case hdr[0] == 0x7f && hdr[1] == 'E' && hdr[2] == 'L' && hdr[3] == 'F':
		return true
	// Mach-O 32-bit LE (0xCEFAEDFE), 64-bit LE (0xCFFAEDFE)
	case hdr[0] == 0xce && hdr[1] == 0xfa && hdr[2] == 0xed && hdr[3] == 0xfe:
		return true
	case hdr[0] == 0xcf && hdr[1] == 0xfa && hdr[2] == 0xed && hdr[3] == 0xfe:
		return true
	// Mach-O 32/64-bit BE
	case hdr[0] == 0xfe && hdr[1] == 0xed && hdr[2] == 0xfa && hdr[3] == 0xce:
		return true
	case hdr[0] == 0xfe && hdr[1] == 0xed && hdr[2] == 0xfa && hdr[3] == 0xcf:
		return true
	// Mach-O fat/universal (CAFEBABE). Java class files share this magic but
	// are never shipped as standalone binaries in engine archives.
	case hdr[0] == 0xca && hdr[1] == 0xfe && hdr[2] == 0xba && hdr[3] == 0xbe:
		return true
	// PE: 'MZ' at offset 0.
	case hdr[0] == 'M' && hdr[1] == 'Z':
		return true
	}
	return false
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
	lowerURL := strings.ToLower(e.DownloadURL)
	switch {
	case strings.HasSuffix(lowerURL, ".zip"):
		binaryPath, bundledNetworkPath, err = extractZip(tmpZip, destDir)
		if err != nil {
			return nil, fmt.Errorf("DownloadTo %s: extract: %w", e.ID, err)
		}
	case strings.HasSuffix(lowerURL, ".tar"):
		binaryPath, bundledNetworkPath, err = extractTar(tmpZip, destDir)
		if err != nil {
			return nil, fmt.Errorf("DownloadTo %s: extract: %w", e.ID, err)
		}
	default:
		// Raw binary (e.g. Lc0's macOS asset `lc0-v0.32.0-macos_12.6.1`).
		// Preserve only a real `.exe` suffix — otherwise `filepath.Ext` picks
		// up trailing parts like `.1` from version strings.
		binaryPath = filepath.Join(destDir, e.ID)
		if strings.HasSuffix(lowerURL, ".exe") {
			binaryPath += ".exe"
		}
		if err := copyFile(tmpZip, binaryPath); err != nil {
			return nil, fmt.Errorf("DownloadTo %s: copy binary: %w", e.ID, err)
		}
	}

	if err := os.Chmod(binaryPath, 0755); err != nil {
		return nil, fmt.Errorf("DownloadTo %s: chmod: %w", e.ID, err)
	}

	if err := postprocessBinary(binaryPath); err != nil {
		return nil, fmt.Errorf("DownloadTo %s: postprocess: %w", e.ID, err)
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
