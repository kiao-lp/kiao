package core

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A panicking handler must be turned into a 500, not propagated out of ServeHTTP.
func TestRecoverMiddlewareReturns500(t *testing.T) {
	h := RecoverMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
}

// RecoverMiddleware must not wrap the ResponseWriter in a way that hides http.Hijacker, or the
// WebSocket upgrade in the /ws/claude handler would break.
func TestRecoverMiddlewarePreservesHijacker(t *testing.T) {
	var sawHijacker bool
	h := RecoverMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, sawHijacker = w.(http.Hijacker)
	}))
	h.ServeHTTP(hijackableRecorder{httptest.NewRecorder()}, httptest.NewRequest(http.MethodGet, "/x", nil))
	if !sawHijacker {
		t.Error("RecoverMiddleware hid http.Hijacker from the handler")
	}
}

// hijackableRecorder is an httptest recorder that also advertises http.Hijacker, standing in for
// the real connection the WebSocket handler upgrades.
type hijackableRecorder struct{ *httptest.ResponseRecorder }

func (hijackableRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) { return nil, nil, nil }
