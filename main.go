package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

const (
	serverAddress = "127.0.0.1:8787"
	serverOrigin  = "http://127.0.0.1:8787"
	localhostHost = "localhost:8787"
	localhostURL  = "http://localhost:8787"

	maxRequestBytes = 300 << 10
	maxCodeBytes    = 128 << 10
	maxStdinBytes   = 128 << 10
	maxActiveRuns   = 4
	draftMaxAge     = 24 * time.Hour
)

var activeRuns = make(chan struct{}, maxActiveRuns)

// staticFiles contains only the browser application. Merely serving these files
// never looks for, starts, or otherwise touches a language runtime.
//
//go:embed static
var staticFiles embed.FS

type application struct {
	lookPath  func(string) (string, error)
	sessionID string
}

type browserSessionResponse struct {
	ID       string `json:"id"`
	MaxAgeMS int64  `json:"maxAgeMs"`
}

type runRequest struct {
	Code  string `json:"code"`
	Stdin string `json:"stdin"`
}

type runResponse struct {
	Language        string `json:"language"`
	Binary          string `json:"binary"`
	Code            string `json:"code,omitempty"`
	Stdout          string `json:"stdout"`
	Stderr          string `json:"stderr"`
	ExitCode        int    `json:"exitCode"`
	DurationMS      int64  `json:"durationMs"`
	TimedOut        bool   `json:"timedOut"`
	StdoutTruncated bool   `json:"stdoutTruncated"`
	StderrTruncated bool   `json:"stderrTruncated"`
	Error           string `json:"error,omitempty"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := &application{lookPath: exec.LookPath, sessionID: newSessionID()}
	server := &http.Server{
		Addr:              serverAddress,
		Handler:           app.handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	listener, err := net.Listen("tcp4", serverAddress)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("LS Tools available at %s", serverOrigin)
	log.Fatal(server.Serve(listener))
}

func (app *application) handler() http.Handler {
	staticRoot, err := fs.Sub(staticFiles, "static")
	if err != nil {
		panic(fmt.Sprintf("prepare embedded static files: %v", err))
	}

	mux := http.NewServeMux()
	mux.Handle("/assets/", getOrHeadOnly(http.FileServer(http.FS(staticRoot))))
	mux.HandleFunc("/api/session", app.handleBrowserSession)
	mux.HandleFunc("/api/format/go", app.handleFormatGo)
	mux.HandleFunc("/api/run/", app.handleRun)
	mux.HandleFunc("/", pageHandler(staticRoot))

	return securityHeaders(requireLocalRequest(mux))
}

func newSessionID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err == nil {
		return hex.EncodeToString(value[:])
	}
	return fmt.Sprintf("%x", time.Now().UnixNano())
}

func (app *application) handleBrowserSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"})
		return
	}
	if app.sessionID == "" {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "session unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, browserSessionResponse{
		ID:       app.sessionID,
		MaxAgeMS: int64(draftMaxAge / time.Millisecond),
	})
}

func pageHandler(staticRoot fs.FS) http.HandlerFunc {
	pages := map[string]string{
		"/":        "index.html",
		"/json":    "json.html",
		"/base64":  "base64.html",
		"/jwt":     "jwt.html",
		"/graphql": "graphql.html",
		"/python":  "python.html",
		"/go":      "go.html",
	}

	return func(w http.ResponseWriter, r *http.Request) {
		filename, ok := pages[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		contents, err := fs.ReadFile(staticRoot, filename)
		if err != nil {
			http.Error(w, "page unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(contents)))
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet {
			_, _ = w.Write(contents)
		}
	}
}

func (app *application) handleRun(w http.ResponseWriter, r *http.Request) {
	language := strings.TrimPrefix(r.URL.Path, "/api/run/")
	if language != "python" && language != "go" {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "unknown language"})
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"})
		return
	}

	request, ok := decodeSourceRequest(w, r)
	if !ok {
		return
	}
	select {
	case activeRuns <- struct{}{}:
		defer func() { <-activeRuns }()
	default:
		writeJSON(w, http.StatusTooManyRequests, errorResponse{Error: "too many snippets are already running"})
		return
	}

	// Runtime discovery deliberately occurs here, after a valid Run request.
	// Startup and all GET/HEAD requests take no path through resolveLanguage.
	spec, err := app.resolveLanguage(language)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, runResponse{
			Language: language,
			ExitCode: -1,
			Error:    err.Error(),
		})
		return
	}
	if language == "go" {
		request.Code = prepareGoCode(request.Code, standardPackagesFor(spec))
	}

	response, err := executeSnippet(spec, request)
	if language == "go" {
		response.Code = request.Code
	}
	if err != nil {
		response.Error = err.Error()
		writeJSON(w, http.StatusInternalServerError, response)
		return
	}
	// Compilation errors and non-zero snippet exits are valid runner results.
	writeJSON(w, http.StatusOK, response)
}

func (app *application) handleFormatGo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"})
		return
	}

	request, ok := decodeSourceRequest(w, r)
	if !ok {
		return
	}

	select {
	case activeRuns <- struct{}{}:
		defer func() { <-activeRuns }()
	default:
		writeJSON(w, http.StatusTooManyRequests, errorResponse{Error: "too many snippets are already running"})
		return
	}

	// gofmt is discovered only for an explicit Format request.
	spec, err := app.resolveGoFormatter()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, runResponse{
			Language: "go",
			ExitCode: -1,
			Error:    err.Error(),
		})
		return
	}

	response, err := executeSnippet(spec, request)
	if err != nil {
		response.Error = err.Error()
		writeJSON(w, http.StatusInternalServerError, response)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func decodeSourceRequest(w http.ResponseWriter, r *http.Request) (runRequest, bool) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, errorResponse{Error: "Content-Type must be application/json"})
		return runRequest{}, false
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request runRequest
	if err := decoder.Decode(&request); err != nil {
		writeDecodeError(w, err)
		return runRequest{}, false
	}
	if err := ensureJSONEnd(decoder); err != nil {
		writeDecodeError(w, err)
		return runRequest{}, false
	}
	if len(request.Code) == 0 {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "code is required"})
		return runRequest{}, false
	}
	if len(request.Code) > maxCodeBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{Error: "code exceeds the 128 KiB limit"})
		return runRequest{}, false
	}
	if len(request.Stdin) > maxStdinBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{Error: "stdin exceeds the 128 KiB limit"})
		return runRequest{}, false
	}
	return request, true
}

func getOrHeadOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("request body must contain one JSON object")
	}
	return err
}

func writeDecodeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{Error: "request body exceeds the 300 KiB limit"})
		return
	}
	writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid JSON request: " + err.Error()})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func requireLocalRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expectedOrigin, ok := localOriginForHost(r.Host)
		if !ok {
			http.Error(w, "invalid Host", http.StatusForbidden)
			return
		}

		origin := r.Header.Get("Origin")
		if origin != "" && origin != expectedOrigin {
			http.Error(w, "invalid Origin", http.StatusForbidden)
			return
		}
		isExecutionRequest := strings.HasPrefix(r.URL.Path, "/api/run/") || strings.HasPrefix(r.URL.Path, "/api/format/")
		if r.Method == http.MethodPost && isExecutionRequest && origin != expectedOrigin {
			http.Error(w, "missing or invalid Origin", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func localOriginForHost(host string) (string, bool) {
	switch host {
	case serverAddress:
		return serverOrigin, true
	case localhostHost:
		return localhostURL, true
	default:
		return "", false
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers := w.Header()
		headers.Set("Cache-Control", "no-store")
		headers.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		headers.Set("Cross-Origin-Opener-Policy", "same-origin")
		headers.Set("Cross-Origin-Resource-Policy", "same-origin")
		headers.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		headers.Set("Referrer-Policy", "no-referrer")
		headers.Set("X-Content-Type-Options", "nosniff")
		headers.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}
