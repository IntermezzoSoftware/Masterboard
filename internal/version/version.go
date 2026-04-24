// Package version holds the application version string. In release builds
// the linker overwrites Current via:
//
//	-ldflags "-X github.com/IntermezzoSoftware/Masterboard/internal/version.Current=<tag>"
package version

// Current is the running application version. Default is the development
// snapshot; CI injects the real tag at link time.
var Current = "v0.6.5"
