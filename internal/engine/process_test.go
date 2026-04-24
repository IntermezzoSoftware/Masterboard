package engine

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBuildEngineArgs_NoSidecar(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "engine")
	if got := buildEngineArgs(path); got != nil {
		t.Errorf("no sidecar: want nil, got %v", got)
	}
}

func TestBuildEngineArgs_Sidecar(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "engine")
	weightsPath := filepath.Join(dir, "networks", "t1-256x10.pb.gz")
	if err := os.WriteFile(path+".weights", []byte(weightsPath+"\n"), 0644); err != nil {
		t.Fatalf("write sidecar: %v", err)
	}

	args := buildEngineArgs(path)
	if len(args) != 1 || args[0] != "--weights="+weightsPath {
		t.Errorf("sidecar: want [--weights=%s], got %v", weightsPath, args)
	}
}

func TestBuildEngineArgs_EmptySidecar(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "engine")
	if err := os.WriteFile(path+".weights", []byte("   \n"), 0644); err != nil {
		t.Fatalf("write sidecar: %v", err)
	}
	if got := buildEngineArgs(path); got != nil {
		t.Errorf("whitespace-only sidecar: want nil, got %v", got)
	}
}
