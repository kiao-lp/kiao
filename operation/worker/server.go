package main

import (
	"net/http"

	"kiao/worker/internal/core"
	"kiao/worker/internal/files"
	"kiao/worker/internal/hybridflow-runner"
	"kiao/worker/internal/toolbox"
)

// Server mounts the libraries behind a shared middleware chain.
type Server struct {
	auth *core.Authenticator

	// Nil services are allowed in tests; their routes are omitted.
	files            *files.Service
	hybridflowRunner *hybridflowrunner.Service
	toolbox          *toolbox.Service
}

// readerRoutes is an exact route-pattern allowlist for read-only callers; all others get 403.
// Reader roots separately restrict which store paths these routes may access.
var readerRoutes = map[string]bool{
	"GET /getFile":       true,
	"GET /list":          true,
	"GET /listRecursive": true,
	"GET /info":          true,
	"GET /search":        true,
}

func (s *Server) routes() []core.Route {
	var routes []core.Route
	if s.files != nil {
		routes = append(routes, s.files.Routes()...)
	}
	if s.hybridflowRunner != nil {
		routes = append(routes, s.hybridflowRunner.Routes()...)
	}
	if s.toolbox != nil {
		routes = append(routes, s.toolbox.Routes()...)
	}
	return routes
}

// Middleware order: recovery → cors → request-id → trace → auth → mux.
// /healthz bypasses all but recovery so probes stay unauthenticated and untraced.
func (s *Server) handler() http.Handler {
	mux := http.NewServeMux()
	for _, route := range s.routes() {
		mux.HandleFunc(route.Pattern, route.Handler)
	}

	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", handleHealthz)
	root.Handle("/", core.CORSMiddleware(core.WithRequestID(
		core.TraceMiddleware(hybridflowrunner.SocketPaths(), s.auth.Middleware(mux)))))

	return core.RecoverMiddleware(root)
}

func handleHealthz(w http.ResponseWriter, _ *http.Request) {
	core.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
