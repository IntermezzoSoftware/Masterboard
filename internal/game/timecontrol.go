package game

import (
	"fmt"
	"strings"
)

// ParseTimeControlSecs parses a PGN TimeControl string and returns the base
// clock time in seconds. Returns 0 for correspondence, unknown, or unparseable
// values ("-", "", "∞", non-numeric).
func ParseTimeControlSecs(tc string) int {
	if tc == "" || tc == "-" || tc == "∞" || tc == "?" {
		return 0
	}
	parts := strings.SplitN(tc, "+", 2)
	var base int
	if _, err := fmt.Sscanf(parts[0], "%d", &base); err != nil {
		return 0
	}
	return base
}

// CategorizeTimeControl classifies a PGN TimeControl string into one of:
// "bullet" (<3 min), "blitz" (3–<10 min), "rapid" (10–<30 min),
// "classical" (>=30 min), or "other" (correspondence / unknown).
func CategorizeTimeControl(tc string) string {
	secs := ParseTimeControlSecs(tc)
	switch {
	case secs > 0 && secs < 180:
		return "bullet"
	case secs >= 180 && secs < 600:
		return "blitz"
	case secs >= 600 && secs < 1800:
		return "rapid"
	case secs >= 1800:
		return "classical"
	default:
		return "other"
	}
}
