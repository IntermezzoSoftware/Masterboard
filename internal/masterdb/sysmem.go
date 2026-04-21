package masterdb

import "github.com/pbnjay/memory"

const (
	// peakBytesPerEntry is the worst-case memory cost per flush-threshold entry.
	// Double buffering means two stats maps can coexist (old being flushed by bg
	// goroutine + new accumulating), plus index rows at the same threshold:
	//   2 × ~120 bytes (stats map entry with Go map overhead) + 16 bytes (indexRow)
	peakBytesPerEntry = 256

	minFlushThreshold = 4000000  // 4M entries floor (~1 GB peak)
	maxFlushThreshold = 32000000 // 32M entries ceiling (~8.2 GB peak)

	// memBudgetFraction is the fraction of available physical memory we budget
	// for stats+index accumulation. Leaves 60% headroom for GC overhead,
	// Wails/webview, OS, and other processes.
	memBudgetFraction = 0.40

	// memSafetyFloor is the minimum free physical memory (in bytes) that must
	// remain available during import. If free memory drops below this, a flush
	// is triggered regardless of the count-based threshold. 512 MB leaves room
	// for GC spikes, OS, and Wails/webview.
	memSafetyFloor = 512 * 1024 * 1024 // 512 MB
)

// autoFlushThreshold returns a stats flush threshold scaled to the currently
// available physical memory. Returns 0 if memory cannot be determined (caller
// should fall back to a hardcoded default).
func autoFlushThreshold() int {
	avail := memory.FreeMemory()
	if avail == 0 {
		return 0
	}
	budget := uint64(float64(avail) * memBudgetFraction)
	threshold := int(budget / peakBytesPerEntry)

	if threshold < minFlushThreshold {
		return minFlushThreshold
	}
	if threshold > maxFlushThreshold {
		return maxFlushThreshold
	}
	return threshold
}

// memoryPressured returns true when the system's free physical memory has
// dropped below memSafetyFloor. Called periodically during import to trigger
// early flushes before the count-based threshold is reached.
func memoryPressured() bool {
	avail := memory.FreeMemory()
	return avail > 0 && avail < memSafetyFloor
}
