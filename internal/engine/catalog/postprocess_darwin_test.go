//go:build darwin

package catalog

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// TestPostprocessBinary_SignsAndDequarantines copies /bin/ls (a real signed
// Mach-O) into a temp directory, which strips its signature, then runs
// postprocessBinary and verifies codesign --verify succeeds afterwards.
func TestPostprocessBinary_SignsAndDequarantines(t *testing.T) {
	src := "/bin/ls"
	if _, err := os.Stat(src); err != nil {
		t.Skipf("%s not available: %v", src, err)
	}

	dst := filepath.Join(t.TempDir(), "engine-binary")
	if err := copyTestFile(src, dst); err != nil {
		t.Fatalf("copy: %v", err)
	}
	if err := os.Chmod(dst, 0755); err != nil {
		t.Fatalf("chmod: %v", err)
	}

	// Copying a signed Mach-O strips the signature; the freshly-copied file
	// has no valid signature until we ad-hoc sign it.
	if err := postprocessBinary(dst); err != nil {
		t.Fatalf("postprocessBinary: %v", err)
	}

	if out, err := exec.Command("codesign", "--verify", "--verbose=2", dst).CombinedOutput(); err != nil {
		t.Fatalf("codesign --verify failed after postprocess: %v\noutput: %s", err, out)
	}
}

// TestPostprocessBinary_Idempotent verifies a second call is a no-op.
func TestPostprocessBinary_Idempotent(t *testing.T) {
	src := "/bin/ls"
	if _, err := os.Stat(src); err != nil {
		t.Skipf("%s not available: %v", src, err)
	}

	dst := filepath.Join(t.TempDir(), "engine-binary")
	if err := copyTestFile(src, dst); err != nil {
		t.Fatalf("copy: %v", err)
	}
	if err := os.Chmod(dst, 0755); err != nil {
		t.Fatalf("chmod: %v", err)
	}

	if err := postprocessBinary(dst); err != nil {
		t.Fatalf("first postprocess: %v", err)
	}
	if err := postprocessBinary(dst); err != nil {
		t.Fatalf("second postprocess (should be idempotent): %v", err)
	}
}

func copyTestFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}
