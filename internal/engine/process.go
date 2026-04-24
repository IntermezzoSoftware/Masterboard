package engine

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// osEnginePipe wraps an engine subprocess with line-oriented I/O.
type osEnginePipe struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	scanner *bufio.Scanner
}

// buildEngineArgs returns the argv extension for the engine binary at path.
// If a `<path>.weights` sidecar exists and is non-empty, its content is passed
// as `--weights=<content>` — needed for Lc0, whose auto-discovery does not
// recurse into our `networks/` subdirectory.
func buildEngineArgs(path string) []string {
	data, err := os.ReadFile(path + ".weights")
	if err != nil {
		return nil
	}
	weights := strings.TrimSpace(string(data))
	if weights == "" {
		return nil
	}
	return []string{"--weights=" + weights}
}

// newOsEnginePipe starts the engine at path and returns a ready pipe.
// If lowPriority is true the process is launched at below-normal priority
// so interactive processes are always preferred by the OS scheduler.
func newOsEnginePipe(path string, lowPriority bool) (*osEnginePipe, error) {
	cmd := exec.Command(path, buildEngineArgs(path)...)
	configureSysProcAttr(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		stdin.Close()
		return nil, err
	}
	if lowPriority {
		setBelowNormalPriority(cmd.Process.Pid)
	} else {
		setHighPriority(cmd.Process.Pid)
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4*1024*1024), 4*1024*1024)

	return &osEnginePipe{cmd: cmd, stdin: stdin, scanner: scanner}, nil
}

// WriteLine sends a single UCI command line to the engine.
func (p *osEnginePipe) WriteLine(s string) error {
	_, err := fmt.Fprintln(p.stdin, s)
	return err
}

// ReadLine blocks until the next output line is available.
// Returns io.EOF when the engine process has closed its stdout.
func (p *osEnginePipe) ReadLine() (string, error) {
	if p.scanner.Scan() {
		return p.scanner.Text(), nil
	}
	if err := p.scanner.Err(); err != nil {
		return "", err
	}
	return "", io.EOF
}

// Close closes stdin and waits for the process to exit.
func (p *osEnginePipe) Close() error {
	p.stdin.Close()
	return p.cmd.Wait()
}
