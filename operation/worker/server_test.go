package main

import (
	"kiao/worker/internal/core"
	"kiao/worker/internal/files"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// newTestServer builds the program over a fresh temp store: the file half wired for real, no
// hybridflow-runner half, and the same mux and middleware chain a deployment serves through.
func newTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	root := t.TempDir()
	// The state directory is a temp directory of its own: these tests list and count the store root,
	// and service state appearing there would break them for a reason they are not about.
	shared := &core.Config{AuthMode: "debug", RootPath: root, StatePath: t.TempDir(), MaxUploadBytes: 1 << 20}
	fileSvc, err := files.Start(files.LoadConfig(shared))
	if err != nil {
		t.Fatalf("files.Start: %v", err)
	}
	return &Server{auth: core.NewAuthenticator(shared, readerRoutes), files: fileSvc}, root
}

// do runs a request through the full handler chain and returns the recorded response.
func do(s *Server, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	s.handler().ServeHTTP(rec, req)
	return rec
}

// mustWriteBytes writes raw bytes, creating parent dirs.
func mustWriteBytes(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// /healthz must answer 200 without a token even under prod auth, while a normal endpoint under
// the same server still requires one — proving the probe is registered outside the auth chain.
func TestHealthzBypassesAuth(t *testing.T) {
	s, _ := newTestServer(t)
	s.auth = core.NewAuthenticator(&core.Config{AuthMode: "prod", IssuerURI: "https://issuer", JwkSetURI: "https://jwks"}, readerRoutes)

	rec := do(s, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("healthz status = %d, want 200", rec.Code)
	}
	if body := strings.TrimSpace(rec.Body.String()); body != `{"status":"ok"}` {
		t.Errorf("healthz body = %q, want {\"status\":\"ok\"}", body)
	}

	if code := do(s, httptest.NewRequest(http.MethodGet, "/list?path=.", nil)).Code; code != http.StatusUnauthorized {
		t.Errorf("unauthenticated /list under prod: status = %d, want 401 (proves auth is active)", code)
	}
}

// The read-only surface is an allowlist beside the mux, which is only worth anything as long as
// the two agree: a route named there but never registered would be an entry that grants nothing,
// and would go unnoticed. Each one is asked for and must be answered by its handler rather than by
// the mux's own "no such route".
func TestReaderRoutesAreRouted(t *testing.T) {
	s, root := newTestServer(t)
	mustWriteBytes(t, filepath.Join(root, "units", "note.md"), []byte("hello\n"))

	targets := map[string]string{
		"GET /getFile":       "/getFile?path=units/note.md",
		"GET /list":          "/list?path=units",
		"GET /listRecursive": "/listRecursive?path=units",
		"GET /info":          "/info?path=units/note.md",
		"GET /search":        "/search?path=units&query=hello",
	}
	for route := range readerRoutes {
		target, ok := targets[route]
		if !ok {
			t.Fatalf("reader route %q has no request in this test; add one", route)
		}
		method, _, _ := strings.Cut(route, " ")
		rec := do(s, httptest.NewRequest(method, target, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want 200 (%s)", route, rec.Code, strings.TrimSpace(rec.Body.String()))
		}
	}
}

// Every non-health request gets a short request id echoed in X-Request-Id, and two requests get
// distinct ids.
func TestRequestIDHeader(t *testing.T) {
	s, _ := newTestServer(t)
	shortHex := regexp.MustCompile(`^[0-9a-f]{16}$`)

	first := do(s, httptest.NewRequest(http.MethodGet, "/list?path=.", nil)).Header().Get("X-Request-Id")
	second := do(s, httptest.NewRequest(http.MethodGet, "/list?path=.", nil)).Header().Get("X-Request-Id")

	if !shortHex.MatchString(first) {
		t.Errorf("X-Request-Id = %q, want 16 hex chars", first)
	}
	if first == second {
		t.Errorf("two requests shared a request id (%q)", first)
	}
}
