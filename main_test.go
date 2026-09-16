package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestPageVisitDoesNotDiscoverRuntime(t *testing.T) {
	lookups := 0
	app := &application{lookPath: func(name string) (string, error) {
		lookups++
		return "", errors.New("unexpected lookup for " + name)
	}}

	for _, test := range []struct {
		path string
		host string
	}{
		{path: "/", host: serverAddress},
		{path: "/json", host: serverAddress},
		{path: "/base64", host: serverAddress},
		{path: "/jwt", host: serverAddress},
		{path: "/graphql", host: serverAddress},
		{path: "/python", host: serverAddress},
		{path: "/go", host: localhostHost},
	} {
		request := httptest.NewRequest(http.MethodGet, test.path, nil)
		request.Host = test.host
		response := httptest.NewRecorder()
		app.handler().ServeHTTP(response, request)

		if response.Code != http.StatusOK {
			t.Fatalf("GET %s with Host %s returned %d", test.path, test.host, response.Code)
		}
	}
	if lookups != 0 {
		t.Fatalf("page visits performed %d runtime lookups", lookups)
	}
}

func TestBrowserSessionIdentifiesServerProcessWithoutRuntimeLookup(t *testing.T) {
	lookups := 0
	app := &application{
		lookPath: func(string) (string, error) {
			lookups++
			return "", errors.New("unexpected lookup")
		},
		sessionID: "test-server-session",
	}
	request := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	request.Host = serverAddress
	response := httptest.NewRecorder()
	app.handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200; body: %s", response.Code, response.Body.String())
	}
	var result browserSessionResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.ID != "test-server-session" {
		t.Fatalf("session ID = %q, want test-server-session", result.ID)
	}
	if result.MaxAgeMS != int64((24*time.Hour)/time.Millisecond) {
		t.Fatalf("max age = %d, want 24 hours", result.MaxAgeMS)
	}
	if lookups != 0 {
		t.Fatalf("session check performed %d runtime lookups", lookups)
	}
}

func TestRunRequiresMatchingLocalHostAndOriginBeforeLookup(t *testing.T) {
	tests := []struct {
		name   string
		host   string
		origin string
	}{
		{name: "arbitrary host", host: "attacker.example:8787", origin: "http://attacker.example:8787"},
		{name: "missing origin", host: serverAddress},
		{name: "foreign origin", host: serverAddress, origin: "https://attacker.example"},
		{name: "mismatched local names", host: localhostHost, origin: serverOrigin},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			lookups := 0
			app := &application{lookPath: func(name string) (string, error) {
				lookups++
				return "", errors.New("unexpected lookup for " + name)
			}}
			request := httptest.NewRequest(http.MethodPost, "/api/run/python", strings.NewReader(`{"code":"print(1)","stdin":""}`))
			request.Host = test.host
			request.Header.Set("Content-Type", "application/json")
			if test.origin != "" {
				request.Header.Set("Origin", test.origin)
			}
			response := httptest.NewRecorder()
			app.handler().ServeHTTP(response, request)

			if response.Code != http.StatusForbidden {
				t.Fatalf("got status %d, want 403", response.Code)
			}
			if lookups != 0 {
				t.Fatalf("rejected request performed %d runtime lookups", lookups)
			}
		})
	}
}

func TestRunDiscoversRuntimeOnlyAfterValidRequest(t *testing.T) {
	lookups := 0
	app := &application{lookPath: func(name string) (string, error) {
		lookups++
		return "", errors.New("not installed")
	}}
	request := httptest.NewRequest(http.MethodPost, "/api/run/python", strings.NewReader(`{"code":"print(1)","stdin":""}`))
	request.Host = localhostHost
	request.Header.Set("Origin", localhostURL)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	app.handler().ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("got status %d, want 503; body: %s", response.Code, response.Body.String())
	}
	if lookups != 2 {
		t.Fatalf("got %d Python candidate lookups, want 2", lookups)
	}
}

func TestMalformedRunDoesNotDiscoverRuntime(t *testing.T) {
	lookups := 0
	app := &application{lookPath: func(name string) (string, error) {
		lookups++
		return "", errors.New("unexpected lookup")
	}}
	request := httptest.NewRequest(http.MethodPost, "/api/run/go", strings.NewReader(`{"code":"package main","extra":true}`))
	request.Host = serverAddress
	request.Header.Set("Origin", serverOrigin)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	app.handler().ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", response.Code)
	}
	if lookups != 0 {
		t.Fatalf("malformed request performed %d runtime lookups", lookups)
	}
}

func TestFormatGoDiscoversFormatterOnlyAfterValidRequest(t *testing.T) {
	lookups := 0
	app := &application{lookPath: func(name string) (string, error) {
		lookups++
		if name != "gofmt" {
			t.Fatalf("looked up %q, want gofmt", name)
		}
		return "", errors.New("not installed")
	}}
	request := httptest.NewRequest(http.MethodPost, "/api/format/go", strings.NewReader(`{"code":"package main","stdin":""}`))
	request.Host = serverAddress
	request.Header.Set("Origin", serverOrigin)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	app.handler().ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("got status %d, want 503; body: %s", response.Code, response.Body.String())
	}
	if lookups != 1 {
		t.Fatalf("got %d gofmt lookups, want 1", lookups)
	}
}

func TestFormatGoRequiresMatchingOriginBeforeLookup(t *testing.T) {
	lookups := 0
	app := &application{lookPath: func(name string) (string, error) {
		lookups++
		return "", errors.New("unexpected lookup for " + name)
	}}
	request := httptest.NewRequest(http.MethodPost, "/api/format/go", strings.NewReader(`{"code":"package main","stdin":""}`))
	request.Host = serverAddress
	request.Header.Set("Origin", "https://attacker.example")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	app.handler().ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("got status %d, want 403", response.Code)
	}
	if lookups != 0 {
		t.Fatalf("rejected format request performed %d lookups", lookups)
	}
}

func TestFormatGoEndpointUsesLocalGofmt(t *testing.T) {
	if _, err := exec.LookPath("gofmt"); err != nil {
		t.Skip("gofmt is unavailable")
	}

	app := &application{lookPath: exec.LookPath}
	request := httptest.NewRequest(http.MethodPost, "/api/format/go", strings.NewReader(`{"code":"package main\nfunc main(){println(\"ok\")}\n","stdin":""}`))
	request.Host = serverAddress
	request.Header.Set("Origin", serverOrigin)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	app.handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200; body: %s", response.Code, response.Body.String())
	}
	var result runResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.ExitCode != 0 || result.Stdout != "package main\n\nfunc main() { println(\"ok\") }\n" {
		t.Fatalf("unexpected format result: %+v", result)
	}
}

func TestGoRunAutomaticallyImportsAndFormatsBeforeExecution(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("Go toolchain is unavailable")
	}

	app := &application{lookPath: exec.LookPath}
	body := `{"code":"package main\nfunc main(){fmt.Println(strings.ToUpper(\"ok\"))}\n","stdin":""}`
	request := httptest.NewRequest(http.MethodPost, "/api/run/go", strings.NewReader(body))
	request.Host = serverAddress
	request.Header.Set("Origin", serverOrigin)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	app.handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200; body: %s", response.Code, response.Body.String())
	}
	var result runResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.ExitCode != 0 || result.Stdout != "OK\n" {
		t.Fatalf("unexpected run result: %+v", result)
	}
	for _, expected := range []string{`"fmt"`, `"strings"`, `func main() { fmt.Println(strings.ToUpper("ok")) }`} {
		if !strings.Contains(result.Code, expected) {
			t.Fatalf("prepared code does not contain %q:\n%s", expected, result.Code)
		}
	}
}

func TestSecurityHeadersArePresentOnRejectedRequests(t *testing.T) {
	app := &application{lookPath: func(string) (string, error) { return "", errors.New("unused") }}
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Host = "not-local.example"
	response := httptest.NewRecorder()
	app.handler().ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("got status %d, want 403", response.Code)
	}
	if got := response.Header().Get("Content-Security-Policy"); got == "" {
		t.Fatal("Content-Security-Policy was not set")
	}
	if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
}
