//go:build !darwin

package catalog

// postprocessBinary is a no-op on non-darwin platforms. Windows and Linux do
// not apply quarantine attributes to files downloaded through our Go HTTP
// client, and neither kernel requires a code signature to exec a Mach-O.
func postprocessBinary(path string) error {
	return nil
}
