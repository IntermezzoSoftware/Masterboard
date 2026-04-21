package engine

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

// StartPosFEN is the FEN string for the starting chess position.
const StartPosFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

type engineState int

const (
	stateIdle      engineState = iota // no engine launched
	stateReady                        // engine ready, not analysing
	stateAnalysing                    // engine currently searching
)

type Manager struct {
	mu          sync.Mutex
	pipe        *osEnginePipe
	state       engineState
	currentPV   int
	done        chan struct{} // closed by readLoop when it exits
	engineName  string       // UCI "id name" reported during handshake
	lowPriority bool         // if true, process runs at below-normal OS priority
}

// If lowPriority is true the engine process is launched at below-normal OS
// priority so interactive processes are always preferred by the scheduler.
func NewManager(lowPriority bool) *Manager {
	return &Manager{lowPriority: lowPriority}
}

// Launch starts the engine at path and completes the UCI handshake.
// Returns an error if the handshake does not complete or the binary cannot start.
func (m *Manager) Launch(path string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	pipe, err := newOsEnginePipe(path, m.lowPriority)
	if err != nil {
		return err
	}
	m.pipe = pipe
	m.state = stateIdle

	if err := m.doHandshake(); err != nil {
		m.pipe.Close()
		m.pipe = nil
		return err
	}
	return nil
}

func (m *Manager) EngineName() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.engineName
}

func (m *Manager) IsReady() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state == stateReady || m.state == stateAnalysing
}

// SetOption sends a UCI setoption command. Must be called while the engine is
// ready (not currently analysing).
func (m *Manager) SetOption(name, value string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != stateReady {
		return fmt.Errorf("engine not ready")
	}
	return m.pipe.WriteLine(fmt.Sprintf("setoption name %s value %s", name, value))
}

func (m *Manager) StartAnalysis(ctx context.Context, fen string, multiPV int, onInfo func(*InfoLine)) error {
	m.mu.Lock()

	if m.state == stateAnalysing {
		m.stopAndWait() // releases and reacquires mu
	}
	if m.state != stateReady {
		m.mu.Unlock()
		return fmt.Errorf("engine not ready")
	}

	m.currentPV = multiPV
	if err := m.sendCommands(fen, multiPV, "go infinite"); err != nil {
		m.mu.Unlock()
		return err
	}
	m.state = stateAnalysing
	done := make(chan struct{})
	m.done = done
	m.mu.Unlock()

	go m.readLoop(onInfo, nil, done)

	select {
	case <-ctx.Done():
		m.StopAnalysis()
		return ctx.Err()
	case <-done:
		return nil
	}
}

// StopAnalysis sends "stop" and waits for the bestmove response.
// Safe to call when not analysing (no-op in that case).
func (m *Manager) StopAnalysis() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != stateAnalysing {
		return nil
	}
	m.stopAndWait()
	return nil
}

// AnalyseDepth runs a fixed-depth search and returns the bestmove.
// multiPV controls the number of principal variations.
// onInfo is called for every parsed info line during the search.
func (m *Manager) AnalyseDepth(ctx context.Context, fen string, multiPV, depth int, onInfo func(*InfoLine)) (*BestMoveMsg, error) {
	m.mu.Lock()

	if m.state == stateAnalysing {
		m.stopAndWait()
	}
	if m.state != stateReady {
		m.mu.Unlock()
		return nil, fmt.Errorf("engine not ready")
	}

	m.currentPV = multiPV
	if err := m.sendCommands(fen, multiPV, fmt.Sprintf("go depth %d", depth)); err != nil {
		m.mu.Unlock()
		return nil, err
	}
	m.state = stateAnalysing
	done := make(chan struct{})
	m.done = done

	bestCh := make(chan *BestMoveMsg, 1)
	m.mu.Unlock()

	go m.readLoop(onInfo, bestCh, done)

	select {
	case <-ctx.Done():
		m.StopAnalysis()
		return nil, ctx.Err()
	case bm := <-bestCh:
		return bm, nil
	}
}

// AnalyseNodes runs a fixed-node-count search and returns the bestmove.
// This is the natural search limit for MCTS engines like Leela Chess Zero.
// multiPV controls the number of principal variations.
// onInfo is called for every parsed info line during the search.
func (m *Manager) AnalyseNodes(ctx context.Context, fen string, multiPV, nodes int, onInfo func(*InfoLine)) (*BestMoveMsg, error) {
	m.mu.Lock()

	if m.state == stateAnalysing {
		m.stopAndWait()
	}
	if m.state != stateReady {
		m.mu.Unlock()
		return nil, fmt.Errorf("engine not ready")
	}

	m.currentPV = multiPV
	if err := m.sendCommands(fen, multiPV, fmt.Sprintf("go nodes %d", nodes)); err != nil {
		m.mu.Unlock()
		return nil, err
	}
	m.state = stateAnalysing
	done := make(chan struct{})
	m.done = done

	bestCh := make(chan *BestMoveMsg, 1)
	m.mu.Unlock()

	go m.readLoop(onInfo, bestCh, done)

	select {
	case <-ctx.Done():
		m.StopAnalysis()
		return nil, ctx.Err()
	case bm := <-bestCh:
		return bm, nil
	}
}

// Quit shuts down the engine. Safe to call multiple times.
func (m *Manager) Quit() {
	m.mu.Lock()
	if m.state == stateAnalysing {
		m.stopAndWait()
	}
	if m.pipe != nil {
		m.pipe.WriteLine("quit")
		m.pipe.Close()
		m.pipe = nil
	}
	m.state = stateIdle
	m.mu.Unlock()
}


// doHandshake sends "uci", reads until "uciok", then sends "isready" and reads
// until "readyok". Leaves state = stateReady.
// Must be called with mu held.
func (m *Manager) doHandshake() error {
	if err := m.pipe.WriteLine("uci"); err != nil {
		return err
	}
	for {
		line, err := m.pipe.ReadLine()
		if err != nil {
			return fmt.Errorf("reading uciok: %w", err)
		}
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "id name ") {
			m.engineName = strings.TrimPrefix(trimmed, "id name ")
		}
		if trimmed == "uciok" {
			break
		}
	}
	if err := m.pipe.WriteLine("isready"); err != nil {
		return err
	}
	for {
		line, err := m.pipe.ReadLine()
		if err != nil {
			return fmt.Errorf("reading readyok: %w", err)
		}
		if strings.TrimSpace(line) == "readyok" {
			break
		}
	}
	m.state = stateReady
	return nil
}

// stopAndWait sends "stop", releases mu, waits for the read loop to finish,
// then reacquires mu. Leaves state = stateReady.
// Must be called with mu held; returns with mu held.
func (m *Manager) stopAndWait() {
	done := m.done
	m.pipe.WriteLine("stop")
	m.mu.Unlock()
	<-done
	m.mu.Lock()
}

// sendCommands sends "setoption name MultiPV", "position fen <fen>", and
// then the provided go command (e.g. "go infinite", "go depth 20", "go nodes 10000").
// Must be called with mu held.
func (m *Manager) sendCommands(fen string, multiPV int, goCmd string) error {
	if err := m.pipe.WriteLine(fmt.Sprintf("setoption name MultiPV value %d", multiPV)); err != nil {
		return err
	}
	if err := m.pipe.WriteLine(fmt.Sprintf("position fen %s", fen)); err != nil {
		return err
	}
	return m.pipe.WriteLine(goCmd)
}

// readLoop reads UCI output lines, calling onInfo for info lines and sending
// the BestMoveMsg to bestCh (if non-nil) when bestmove arrives.
// On return it updates state to stateReady and closes done.
// Must NOT hold mu when called.
func (m *Manager) readLoop(onInfo func(*InfoLine), bestCh chan<- *BestMoveMsg, done chan struct{}) {
	defer func() {
		m.mu.Lock()
		m.state = stateReady
		m.mu.Unlock()
		close(done)
	}()

	for {
		line, err := m.pipe.ReadLine()
		if err != nil {
			return
		}
		if info := parseInfo(line); info != nil {
			if onInfo != nil {
				onInfo(info)
			}
			continue
		}
		if bm := parseBestMove(line); bm != nil {
			if bestCh != nil {
				bestCh <- bm
			}
			return
		}
	}
}
