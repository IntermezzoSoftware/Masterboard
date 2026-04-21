package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/IntermezzoSoftware/Masterboard/internal/engine"
)

// engineSlot owns a single UCI engine instance (manager + path) plus the Wails
// event names that should be used when emitting analysis results for that slot.
// It centralises the start/stop/getState logic so the primary and secondary
// engine slots share a single implementation.
type engineSlot struct {
	mu         sync.Mutex
	manager    *engine.Manager
	path       string
	infoEvent  string // e.g. "engine:info" / "engine2:info"
	readyEvent string // e.g. "engine:ready" / "engine2:ready"
}

func newEngineSlot(infoEvent, readyEvent string) *engineSlot {
	return &engineSlot{infoEvent: infoEvent, readyEvent: readyEvent}
}

// getState returns a partial EngineState snapshot for this slot. The caller is
// responsible for populating AvailableEngines (which is shared across slots).
func (s *engineSlot) getState() EngineState {
	s.mu.Lock()
	m := s.manager
	savedPath := s.path
	s.mu.Unlock()

	var uciName string
	if m != nil {
		uciName = m.EngineName()
	}
	st := EngineState{
		ActiveEngine: savedPath,
	}
	if m != nil {
		st.IsReady = m.IsReady()
		// IsAnalysing is a misnomer — it actually means "engine is loaded and responsive"
		// (same as IsReady). Renaming the JSON field would be a breaking change for the
		// frontend, so it stays as-is. The frontend uses its own isAnalysing ref
		// (from useEngineAnalysis) for actual analysis state.
		st.IsAnalysing = m.IsReady()
		st.EngineName = uciName
		st.EngineType = detectEngineType(uciName)
	}
	return st
}

func (s *engineSlot) startAnalysis(ctx context.Context, emitFn func(string, any), fen string, multiPV int, logPrefix string) error {
	s.mu.Lock()
	m := s.manager
	s.mu.Unlock()
	if m == nil {
		return fmt.Errorf("no engine available")
	}
	fields := strings.Fields(fen)
	activeColor := "w"
	if len(fields) >= 2 {
		activeColor = fields[1]
	}
	log.Printf("[%s] start-analysis fen=%.40s multiPV=%d", logPrefix, fen, multiPV)
	go func() {
		err := m.StartAnalysis(ctx, fen, multiPV, func(info *engine.InfoLine) {
			ei := engineInfoFromInfoLine(info, activeColor)
			emitFn(s.infoEvent, ei)
		})
		if err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("[%s] start-analysis error: %v", logPrefix, err)
		}
	}()
	return nil
}

func (s *engineSlot) stopAnalysis(logPrefix string) error {
	s.mu.Lock()
	m := s.manager
	s.mu.Unlock()
	if m == nil {
		return nil
	}
	err := m.StopAnalysis()
	if err != nil {
		log.Printf("[%s] stop error: %v", logPrefix, err)
	}
	return err
}

func (s *engineSlot) setManager(m *engine.Manager, path string) (old *engine.Manager) {
	s.mu.Lock()
	old = s.manager
	s.manager = m
	s.path = path
	s.mu.Unlock()
	return old
}

func (s *engineSlot) quit() {
	s.mu.Lock()
	m := s.manager
	s.manager = nil
	s.path = ""
	s.mu.Unlock()
	if m != nil {
		m.Quit()
	}
}

func (s *engineSlot) detachIfPath(target string) *engine.Manager {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.path != target {
		return nil
	}
	old := s.manager
	s.manager = nil
	s.path = ""
	return old
}

func (s *engineSlot) emitReady(emitFn func(string, any), path, engineName string, available []string) {
	emitFn(s.readyEvent, EngineState{
		IsReady:          true,
		IsAnalysing:      true,
		ActiveEngine:     path,
		AvailableEngines: resolveEntries(available, path, engineName),
		EngineName:       engineName,
		EngineType:       detectEngineType(engineName),
	})
}

func (s *engineSlot) setOption(name, value string) error {
	s.mu.Lock()
	m := s.manager
	s.mu.Unlock()
	if m == nil {
		return fmt.Errorf("no engine available")
	}
	return m.SetOption(name, value)
}
