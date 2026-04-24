//go:build darwin

package catalog

import (
	"fmt"
	"os/exec"
	"strings"
)

// postprocessBinary prepares a freshly-downloaded engine binary for execution
// on macOS:
//  1. Strip the `com.apple.quarantine` xattr applied by the kernel to files
//     downloaded via HTTP. Without this Gatekeeper blocks the exec on Intel.
//  2. Apply an ad-hoc code signature. Apple Silicon's kernel refuses to exec
//     any Mach-O without at least an ad-hoc signature.
//
// Both steps are idempotent: running them on an already-clean binary is a
// no-op. Errors from missing xattrs are ignored; all other failures surface.
func postprocessBinary(path string) error {
	// `xattr -d` exits non-zero if the attribute is missing. That's fine —
	// an engine binary without the quarantine flag is the desired state.
	if out, err := exec.Command("xattr", "-d", "com.apple.quarantine", path).CombinedOutput(); err != nil {
		msg := string(out)
		if !strings.Contains(msg, "No such xattr") && !strings.Contains(msg, "no such xattr") {
			return fmt.Errorf("strip quarantine: %w: %s", err, strings.TrimSpace(msg))
		}
	}
	// Ad-hoc sign with `-`. Preserving runtime/flags keeps any hardened-runtime
	// configuration the upstream binary may ship with.
	if out, err := exec.Command(
		"codesign",
		"--sign", "-",
		"--force",
		"--preserve-metadata=entitlements,requirements,flags,runtime",
		path,
	).CombinedOutput(); err != nil {
		return fmt.Errorf("ad-hoc codesign: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
