package engine

import (
	"strconv"
	"strings"
)

// InfoLine holds the fields parsed from a single UCI "info" output line.
type InfoLine struct {
	Depth     int
	SelDepth  int
	MultiPV   int      // 1-based; defaults to 1 if not present in the line
	ScoreCp   int      // centipawns (meaningful only when IsMate is false)
	IsMate    bool
	ScoreMate int      // signed: positive = engine is mating, negative = being mated
	Nodes     int64
	NPS       int64
	TimeMs    int64
	PV        []string // raw UCI move strings, e.g. ["e2e4", "e7e5"]
}

// BestMoveMsg holds the fields from a UCI "bestmove" line.
type BestMoveMsg struct {
	Move   string // e.g. "e2e4"; "(none)" when the engine has no legal move
	Ponder string // may be empty
}

// ParseInfo parses a UCI "info" line into an InfoLine. Returns nil for any
// other line (e.g. "uciok", "readyok", comments).
func parseInfo(line string) *InfoLine {
	tokens := strings.Fields(line)
	if len(tokens) == 0 || tokens[0] != "info" {
		return nil
	}
	// "info string ..." is a free-form debug message, not analysis data.
	if len(tokens) >= 2 && tokens[1] == "string" {
		return nil
	}
	info := &InfoLine{MultiPV: 1}
	i := 1
outer:
	for i < len(tokens) {
		switch tokens[i] {
		case "depth":
			if i+1 < len(tokens) {
				info.Depth, _ = strconv.Atoi(tokens[i+1])
				i++
			}
		case "seldepth":
			if i+1 < len(tokens) {
				info.SelDepth, _ = strconv.Atoi(tokens[i+1])
				i++
			}
		case "multipv":
			if i+1 < len(tokens) {
				info.MultiPV, _ = strconv.Atoi(tokens[i+1])
				i++
			}
		case "score":
			if i+1 >= len(tokens) {
				break
			}
			i++
			switch tokens[i] {
			case "cp":
				if i+1 < len(tokens) {
					info.ScoreCp, _ = strconv.Atoi(tokens[i+1])
					i++
				}
			case "mate":
				info.IsMate = true
				if i+1 < len(tokens) {
					info.ScoreMate, _ = strconv.Atoi(tokens[i+1])
					i++
				}
			}
			// "lowerbound" / "upperbound" after score fall through to default (skipped).
		case "nodes":
			if i+1 < len(tokens) {
				info.Nodes, _ = strconv.ParseInt(tokens[i+1], 10, 64)
				i++
			}
		case "nps":
			if i+1 < len(tokens) {
				info.NPS, _ = strconv.ParseInt(tokens[i+1], 10, 64)
				i++
			}
		case "time":
			if i+1 < len(tokens) {
				info.TimeMs, _ = strconv.ParseInt(tokens[i+1], 10, 64)
				i++
			}
		case "pv":
			// PV is always the last field; all remaining tokens are moves.
			info.PV = tokens[i+1:]
			break outer
		// "wdl", "hashfull", "tbhits", "currmove", "currmovenumber",
		// "cpuload", "refutation", "currline", "string", "lowerbound",
		// "upperbound" and any other unknown tokens are silently skipped.
		}
		i++
	}
	return info
}

// ParseBestMove parses a UCI "bestmove" line. Returns nil for any other line.
func parseBestMove(line string) *BestMoveMsg {
	tokens := strings.Fields(line)
	if len(tokens) == 0 || tokens[0] != "bestmove" {
		return nil
	}
	bm := &BestMoveMsg{}
	if len(tokens) >= 2 {
		bm.Move = tokens[1]
	}
	if len(tokens) >= 4 && tokens[2] == "ponder" {
		bm.Ponder = tokens[3]
	}
	return bm
}
