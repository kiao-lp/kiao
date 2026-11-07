package fileshttp

import (
	"kiao/worker/internal/core/access"
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/core/http"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// mustMkdir creates a folder of the store, so a conversation has something to resolve.
func mustMkdir(t *testing.T, root, virtual string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(root, virtual), 0o755); err != nil {
		t.Fatal(err)
	}
}

// mustWriteBytes writes raw bytes (used for binary fixtures), creating parent dirs.
func mustWriteBytes(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// mustReadBytes reads raw bytes from path.
func mustReadBytes(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// handler mounts this half's routes behind the same middleware chain the program wraps them in, so
// a test reaches a handler exactly the way a browser does.
func (s *Service) handler() http.Handler {
	mux := http.NewServeMux()
	for _, r := range s.Routes() {
		mux.HandleFunc(r.Pattern, r.Handler)
	}
	auth := access.NewAuthenticator(&coreconfig.Config{AuthMode: "debug"}, nil)
	return httpkit.RecoverMiddleware(
		httpkit.CORSMiddleware(httpkit.WithRequestID(httpkit.TraceMiddleware(nil, auth.Middleware(mux)))))
}

// do runs a request through the full handler chain and returns the recorded response.
func do(s *Service, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	s.handler().ServeHTTP(rec, req)
	return rec
}
