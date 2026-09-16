package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	runTimeout     = 10 * time.Second
	maxOutputBytes = 1 << 20
)

type languageSpec struct {
	language string
	binary   string
	filename string
	args     []string
	env      []string
}

func (app *application) resolveLanguage(language string) (languageSpec, error) {
	switch language {
	case "python":
		binary, err := firstExecutable(app.lookPath, "python3", "python")
		if err != nil {
			return languageSpec{}, errors.New("Python interpreter not found in PATH")
		}
		return languageSpec{
			language: "python",
			binary:   absolutePath(binary),
			filename: "snippet.py",
			args:     []string{"snippet.py"},
			env: []string{
				"PYTHONDONTWRITEBYTECODE=1",
				"PYTHONNOUSERSITE=1",
				"PYTHONUNBUFFERED=1",
			},
		}, nil
	case "go":
		binary, err := firstExecutable(app.lookPath, "go")
		if err != nil {
			return languageSpec{}, errors.New("Go toolchain not found in PATH")
		}
		return languageSpec{
			language: "go",
			binary:   absolutePath(binary),
			filename: "main.go",
			args:     []string{"run", "main.go"},
			env: []string{
				"GO111MODULE=off",
				"GOENV=off",
				"GONOSUMDB=*",
				"GONOPROXY=none",
				"GOPROXY=off",
				"GOSUMDB=off",
				"GOTOOLCHAIN=local",
				"GOWORK=off",
			},
		}, nil
	default:
		return languageSpec{}, fmt.Errorf("unsupported language %q", language)
	}
}

func (app *application) resolveGoFormatter() (languageSpec, error) {
	binary, err := firstExecutable(app.lookPath, "gofmt")
	if err != nil {
		return languageSpec{}, errors.New("gofmt not found in PATH")
	}
	return languageSpec{
		language: "go",
		binary:   absolutePath(binary),
		filename: "main.go",
		args:     []string{"main.go"},
	}, nil
}

func firstExecutable(lookPath func(string) (string, error), names ...string) (string, error) {
	var lastErr error
	for _, name := range names {
		path, err := lookPath(name)
		if err == nil {
			return path, nil
		}
		lastErr = err
	}
	return "", lastErr
}

func absolutePath(path string) string {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	return absolute
}

func executeSnippet(spec languageSpec, request runRequest) (runResponse, error) {
	response := runResponse{
		Language: spec.language,
		Binary:   spec.binary,
		ExitCode: -1,
	}

	tempDir, err := os.MkdirTemp("", "local-tools-"+spec.language+"-*")
	if err != nil {
		return response, fmt.Errorf("create temporary directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	sourcePath := filepath.Join(tempDir, spec.filename)
	if err := os.WriteFile(sourcePath, []byte(request.Code), 0o600); err != nil {
		return response, fmt.Errorf("write source file: %w", err)
	}

	stdout := newLimitedBuffer(maxOutputBytes)
	stderr := newLimitedBuffer(maxOutputBytes)
	cmd := exec.Command(spec.binary, spec.args...)
	cmd.Dir = tempDir
	cmd.Env = environmentWithOverrides(os.Environ(), spec.env...)
	cmd.Stdin = strings.NewReader(request.Stdin)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	configureProcessGroup(cmd)

	started := time.Now()
	if err := cmd.Start(); err != nil {
		response.DurationMS = time.Since(started).Milliseconds()
		return response, fmt.Errorf("start %s: %w", spec.language, err)
	}

	waited := make(chan error, 1)
	go func() {
		waited <- cmd.Wait()
	}()

	timer := time.NewTimer(runTimeout)
	var waitErr error
	select {
	case waitErr = <-waited:
		if !timer.Stop() {
			<-timer.C
		}
		// Also remove any background children that outlived the interpreter or
		// go command after it returned normally.
		terminateProcessGroup(cmd)
	case <-timer.C:
		response.TimedOut = true
		terminateProcessGroup(cmd)
		waitErr = <-waited
	}

	response.DurationMS = time.Since(started).Milliseconds()
	response.Stdout = stdout.String()
	response.Stderr = stderr.String()
	response.StdoutTruncated = stdout.Truncated()
	response.StderrTruncated = stderr.Truncated()
	if cmd.ProcessState != nil {
		response.ExitCode = cmd.ProcessState.ExitCode()
	}

	if waitErr == nil || response.TimedOut {
		return response, nil
	}
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		return response, nil
	}
	return response, fmt.Errorf("wait for %s: %w", spec.language, waitErr)
}

func environmentWithOverrides(base []string, overrides ...string) []string {
	keys := make(map[string]struct{}, len(overrides))
	for _, entry := range overrides {
		key, _, ok := strings.Cut(entry, "=")
		if ok {
			keys[key] = struct{}{}
		}
	}

	result := make([]string, 0, len(base)+len(overrides))
	for _, entry := range base {
		key, _, ok := strings.Cut(entry, "=")
		if _, replaced := keys[key]; ok && replaced {
			continue
		}
		result = append(result, entry)
	}
	return append(result, overrides...)
}

type limitedBuffer struct {
	mu        sync.Mutex
	buffer    bytes.Buffer
	remaining int
	truncated bool
}

func newLimitedBuffer(limit int) *limitedBuffer {
	return &limitedBuffer{remaining: limit}
}

func (buffer *limitedBuffer) Write(data []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()

	originalLength := len(data)
	if len(data) > buffer.remaining {
		data = data[:buffer.remaining]
		buffer.truncated = true
	}
	if len(data) > 0 {
		_, _ = buffer.buffer.Write(data)
		buffer.remaining -= len(data)
	}
	return originalLength, nil
}

func (buffer *limitedBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.buffer.String()
}

func (buffer *limitedBuffer) Truncated() bool {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.truncated
}
