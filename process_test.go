package main

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
)

func TestLimitedBufferCapsAndContinuesAcceptingWrites(t *testing.T) {
	buffer := newLimitedBuffer(5)
	if count, err := buffer.Write([]byte("abc")); err != nil || count != 3 {
		t.Fatalf("first Write = (%d, %v), want (3, nil)", count, err)
	}
	if count, err := buffer.Write([]byte("defg")); err != nil || count != 4 {
		t.Fatalf("second Write = (%d, %v), want (4, nil)", count, err)
	}
	if got := buffer.String(); got != "abcde" {
		t.Fatalf("buffer = %q, want abcde", got)
	}
	if !buffer.Truncated() {
		t.Fatal("buffer did not report truncation")
	}
}

func TestGoFormatterUsesLocalGofmt(t *testing.T) {
	path, err := exec.LookPath("gofmt")
	if err != nil {
		t.Skip("gofmt is unavailable")
	}

	app := &application{lookPath: exec.LookPath}
	spec, err := app.resolveGoFormatter()
	if err != nil {
		t.Fatalf("resolveGoFormatter: %v", err)
	}
	if spec.binary != absolutePath(path) {
		t.Fatalf("formatter binary = %q, want %q", spec.binary, absolutePath(path))
	}

	response, err := executeSnippet(spec, runRequest{Code: "package main\nfunc main(){println(\"ok\")}\n"})
	if err != nil {
		t.Fatalf("executeSnippet: %v", err)
	}
	if response.ExitCode != 0 {
		t.Fatalf("gofmt exit code = %d; stderr: %s", response.ExitCode, response.Stderr)
	}
	want := "package main\n\nfunc main() { println(\"ok\") }\n"
	if response.Stdout != want {
		t.Fatalf("formatted Go = %q, want %q", response.Stdout, want)
	}
}

func TestEnvironmentOverridesRemovePreviousValue(t *testing.T) {
	environment := environmentWithOverrides(
		[]string{"PATH=/bin", "GOPROXY=https://proxy.example", "PLAIN=value"},
		"GOPROXY=off",
		"GOTOOLCHAIN=local",
	)
	got := strings.Join(environment, "\n")
	if strings.Contains(got, "GOPROXY=https://proxy.example") {
		t.Fatalf("old GOPROXY remained in environment:\n%s", got)
	}
	for _, expected := range []string{"PATH=/bin", "PLAIN=value", "GOPROXY=off", "GOTOOLCHAIN=local"} {
		if !strings.Contains(got, expected) {
			t.Fatalf("environment does not contain %q:\n%s", expected, got)
		}
	}
}

func TestExecuteSnippetReturnsNonZeroExitAsResult(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test uses /bin/sh")
	}
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("/bin/sh is unavailable")
	}

	response, err := executeSnippet(languageSpec{
		language: "test",
		binary:   "/bin/sh",
		filename: "snippet.sh",
		args:     []string{"snippet.sh"},
	}, runRequest{Code: "printf stdout; printf stderr >&2; exit 7"})
	if err != nil {
		t.Fatalf("executeSnippet returned infrastructure error: %v", err)
	}
	if response.ExitCode != 7 {
		t.Fatalf("exit code = %d, want 7", response.ExitCode)
	}
	if response.Stdout != "stdout" || response.Stderr != "stderr" {
		t.Fatalf("stdout/stderr = %q/%q", response.Stdout, response.Stderr)
	}
	if response.TimedOut {
		t.Fatal("short script incorrectly timed out")
	}
}
