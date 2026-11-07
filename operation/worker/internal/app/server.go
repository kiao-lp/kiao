package app

import (
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	"kiao/worker/internal/files"
	runner "kiao/worker/internal/hybridflow-runner"
	"kiao/worker/internal/hybridflow-runner/http"
	"kiao/worker/internal/toolbox"
	"kiao/worker/internal/toolbox/http"
	"net/http"
)

// Server mounts the libraries behind a shared middleware chain.
type Server struct {
	auth *access.Authenticator

	// Nil services are allowed in tests; their routes are omitted.
	files            *files.Service
	hybridflowRunner *runner.Service
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

func (s *Server) routes() []httpkit.Route {
	var routes []httpkit.Route
	if s.files != nil {
		routes = append(routes, s.files.Routes()...)
	}
	if s.hybridflowRunner != nil {
		routes = append(routes, s.hybridflowRunner.Routes()...)
	}
	if s.toolbox != nil {
		routes = append(routes, toolboxhttp.NewHandler(s.toolbox).Routes()...)
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
	root.Handle("/", httpkit.CORSMiddleware(httpkit.WithRequestID(
		httpkit.TraceMiddleware(runnerhttp.SocketPaths(), s.auth.Middleware(mux)))))

	return httpkit.RecoverMiddleware(root)
}

func handleHealthz(w http.ResponseWriter, _ *http.Request) {
	httpkit.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
