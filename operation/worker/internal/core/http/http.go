package httpkit

import (
	"bufio"
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/access"
	idgen "kiao/worker/internal/core/ids"
	"kiao/worker/internal/core/logging"
	"net"
	"net/http"
	"runtime/debug"
	"slices"
	"strconv"
	"time"
)

// RecoverMiddleware is the outermost wrapper: it recovers a panicking handler, logs it with a
// stack, and returns 500 so a single bad request cannot take the process down. It deliberately
// does not wrap the ResponseWriter, so the WebSocket handler's http.Hijacker stays reachable.
func RecoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}
			// ErrAbortHandler is net/http's (and gorilla's) sentinel for an intentional abort;
			// re-panic so the server keeps its special handling.
			if rec == http.ErrAbortHandler {
				panic(rec)
			}
			logging.LogCtx(r).Error("panic recovered",
				"component", "files",
				"method", r.Method,
				"path", redactedPath(r),
				"panic", fmt.Sprint(rec),
				"stack", string(debug.Stack()))
			// Best-effort 500. If the handler already wrote or hijacked, this is a harmless no-op.
			w.WriteHeader(http.StatusInternalServerError)
		}()
		next.ServeHTTP(w, r)
	})
}

// WithRequestID assigns a short id to every request, stores it in the context (read by the trace
// line, handlers via LogCtx, and the WS handler) and echoes it back as X-Request-Id for
// client-side correlation. It wraps the WS paths too, so /ws/hybridflow-runner can log its request id.
func WithRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := idgen.RandID()
		w.Header().Set("X-Request-Id", id)
		ctx := logging.ContextWithRequestID(r.Context(), id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// CORSMiddleware mirrors the permissive CORS config (any origin, credentials allowed) and
// short-circuits preflight OPTIONS requests before authentication runs.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		h := w.Header()
		if origin != "" {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Add("Vary", "Origin")
		} else {
			h.Set("Access-Control-Allow-Origin", "*")
		}
		// PATCH is here for the conversation registry: a browser silently drops a method the preflight
		// did not allow, so an omission surfaces as a request that never leaves rather than an error.
		h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD")
		if reqHeaders := r.Header.Get("Access-Control-Request-Headers"); reqHeaders != "" {
			h.Set("Access-Control-Allow-Headers", reqHeaders)
		} else {
			h.Set("Access-Control-Allow-Headers", "*")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// TraceMiddleware logs one line per request (kiao.worker.AuthTraceFilter), capturing the
// final status to derive an auth decision. The paths it steps over are the WebSocket upgrades,
// which hijack the connection and never set a normal status — there is more than one of them
// because the turn socket answers on its own path and on the one it used to have.
func TraceMiddleware(hijacked []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if slices.Contains(hijacked, r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		id := access.IdentityFromRequest(r)
		attrs := []any{
			"request_id", logging.RequestID(r.Context()),
			"method", r.Method,
			"path", redactedPath(r),
			"user", id.User,
			"roles", id.Roles,
			"source", id.Source,
			"status", sw.status,
			"decision", decisionFor(sw.status),
			"elapsed", time.Since(start),
		}
		// The turn, on the requests a turn's own tools made. This is where the MCP callback traffic
		// belongs and the whole of what it needs: a turn's tools calling this service back is
		// traffic, not something the model said, so it is one attribute on the line every request
		// already writes rather than a second store. Appended rather than always present, so the
		// ordinary line — a browser reading a folder — is exactly the line it has always been.
		if id.Turn != "" {
			attrs = append(attrs, "turn", id.Turn)
		}
		logging.LogTrace.Info("request", attrs...)
	})
}

func decisionFor(status int) string {
	switch {
	case status == http.StatusUnauthorized:
		return "UNAUTHENTICATED"
	case status == http.StatusForbidden:
		return "FORBIDDEN"
	case status >= 200 && status < 400:
		return "GRANTED"
	default:
		return "STATUS_" + strconv.Itoa(status)
	}
}

func redactedPath(r *http.Request) string {
	q := r.URL.Query()
	if q.Get("access_token") != "" {
		q.Set("access_token", "<redacted>")
		return r.URL.Path + "?" + q.Encode()
	}
	if r.URL.RawQuery == "" {
		return r.URL.Path
	}
	return r.URL.Path + "?" + r.URL.RawQuery
}

// statusWriter captures the response status while preserving streaming (Flusher) and the
// connection-hijack capability required by the WebSocket handler.
type statusWriter struct {
	http.ResponseWriter
	status  int
	written bool
}

func (w *statusWriter) WriteHeader(code int) {
	if !w.written {
		w.status = code
		w.written = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.written {
		w.status = http.StatusOK
		w.written = true
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := w.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func WriteText(w http.ResponseWriter, status int, s string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(s))
}

// Route is one HTTP endpoint a library offers: the pattern net/http routes on, and what answers
// it. A library states its own surface as data, and the program mounts it — so nothing is served
// that the program did not mount, and no library reaches the mux.
type Route struct {
	Pattern string
	Handler http.HandlerFunc
}
