package main

import (
	"encoding/json"
	"fmt"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Serve the SPA and origin-relative APIs with the image's nginx routing;
// render PlantUML locally.
const spaBase = "/dashboard/"

// Override bundled sw.js to evict service workers left on this origin by earlier
// installs or the image. Their precached bundles can reference chunks absent here.
// The SPA is built with VITE_NO_SERVICE_WORKER; this script unregisters the old
// worker, clears its caches and reloads controlled pages.
const selfDestroyingServiceWorker = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister()
      .then(() => self.caches.keys())
      .then((names) => Promise.all(names.map((name) => self.caches.delete(name))))
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url)))
  );
});
`

// Local requests must bypass environment proxies.
var loopbackTransport = &http.Transport{
	Proxy:               nil,
	DialContext:         (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
	MaxIdleConnsPerHost: 32,
	// No response-header timeout: store-wide operations may take a long time.
	// Let the service's own timeouts produce a reportable failure.
	IdleConnTimeout: 90 * time.Second,
}

func init() {
	// System MIME tables can override Go's defaults; wrong types prevent module loading.
	mime.AddExtensionType(".mjs", "application/javascript")
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
	mime.AddExtensionType(".ttf", "font/ttf")
}

// hybridflowBase is the SPA's same-origin boards API prefix, stripped before proxying.
const hybridflowBase = "/api/hybridflow"

// actorHeader identifies whose work a service-token request represents.
const actorHeader = "X-Kiao-Actor"

// Remote boards use TLS and environment proxies. No response-header timeout:
// GET /changes?wait=1 intentionally stays silent for up to 25 seconds.
var remoteTransport = &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
	ForceAttemptHTTP2:     true,
	MaxIdleConnsPerHost:   8,
	TLSHandshakeTimeout:   10 * time.Second,
	ExpectContinueTimeout: time.Second,
	IdleConnTimeout:       90 * time.Second,
}

// boardsBackend describes a remote or launcher-managed boards service.
// The zero value means this instance has no boards.
type boardsBackend struct {
	base   *url.URL
	token  string
	actor  string
	remote bool
}

func (b boardsBackend) describe() string {
	if b.base == nil {
		return ""
	}
	return b.base.String()
}

type frontServer struct {
	webDir    string
	root      string
	webPort   int
	workerPort int
	boards    boardsBackend
	proxy     *httputil.ReverseProxy
	plantuml  *plantUML
}

func newFrontServer(installDir, root string, webPort, workerPort int, boards boardsBackend, renderer *plantUML) http.Handler {
	backend := &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", workerPort)}
	s := &frontServer{
		webDir:    filepath.Join(installDir, "web"),
		root:      root,
		webPort:   webPort,
		workerPort: workerPort,
		boards:    boards,
		plantuml:  renderer,
		proxy: &httputil.ReverseProxy{
			Director: func(r *http.Request) {
				r.URL.Scheme, r.URL.Host = backend.Scheme, backend.Host
				r.URL.Path, r.URL.RawPath = backendPath(r.URL.Path), ""
				r.Host = backend.Host
			},
			Transport: loopbackTransport,
			// Stream turns without buffering.
			FlushInterval: -1,
			ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
				http.Error(w, "the worker is not answering: "+err.Error(), http.StatusBadGateway)
			},
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	// Override any bundled sw.js, including when the bundle has none.
	mux.HandleFunc(spaBase+"sw.js", s.handleServiceWorker)
	mux.HandleFunc(spaBase, s.handleSPA)
	mux.Handle("/api/", s.proxy)
	// These routes take precedence over the worker's /api/ catch-all.
	boardsHandler := s.boardsHandler()
	mux.Handle(hybridflowBase, boardsHandler)
	mux.Handle(hybridflowBase+"/", boardsHandler)
	mux.HandleFunc("/plantuml/", renderer.handle)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/dashboard" {
			http.Redirect(w, r, spaBase, http.StatusFound)
			return
		}
		http.NotFound(w, r)
	})
	return mux
}

// boardsHandler returns 503 when boards are unconfigured: the route exists, and
// the SPA displays the configuration error.
//
// Credentials stay server-side: this SPA has no security session. Replace browser
// Authorization (possibly stale) with the service token and identify the actor.
// Disable buffering for GET /changes?wait=1 long polling.
func (s *frontServer) boardsHandler() http.Handler {
	backend := s.boards
	if backend.base == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "this instance has no boards: set "+remoteEnv+
				" to a hybridflow-store, or "+databaseEnv+" to a PostgreSQL to serve them from",
				http.StatusServiceUnavailable)
		})
	}
	transport := http.RoundTripper(loopbackTransport)
	if backend.remote {
		transport = remoteTransport
	}
	return &httputil.ReverseProxy{
		Director: func(r *http.Request) {
			r.URL.Scheme, r.URL.Host = backend.base.Scheme, backend.base.Host
			r.URL.Path, r.URL.RawPath = backendBoardsPath(backend.base.Path, r.URL.Path), ""
			r.Host = backend.base.Host
			if backend.token != "" {
				r.Header.Set("Authorization", "Bearer "+backend.token)
			} else {
				r.Header.Del("Authorization")
			}
			if backend.actor != "" {
				r.Header.Set(actorHeader, backend.actor)
			}
		},
		Transport:     transport,
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "the hybridflow store is not answering: "+err.Error(), http.StatusBadGateway)
		},
	}
}

// Preserve the backend's own prefix when replacing /api/hybridflow.
func backendBoardsPath(prefix, path string) string {
	rest := strings.TrimPrefix(path, hybridflowBase)
	joined := strings.TrimSuffix(prefix, "/") + rest
	if joined == "" {
		return "/"
	}
	return joined
}

func (s *frontServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	// --list and instance reuse use root to verify that a remembered port still serves this store.
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"service":   "kiao",
		"root":      s.root,
		"webPort":   s.webPort,
		"workerPort": s.workerPort,
		"boards":    s.boards.describe(),
		"pid":       os.Getpid(),
		"version":   version,
	})
}

func (s *frontServer) handleServiceWorker(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	// Force refetch so a previous worker gets the chance to uninstall itself.
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Service-Worker-Allowed", spaBase)
	fmt.Fprint(w, selfDestroyingServiceWorker)
}

// handleSPA falls back to index.html only for navigation: Dashboard document
// paths belong to the SPA and must survive reloads.
func (s *frontServer) handleSPA(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, spaBase)
	// Clean before joining to prevent network paths containing ".." from escaping webDir.
	file := filepath.Join(s.webDir, filepath.Clean("/"+rel))

	// Reinstall can replace the bundle under the same filenames.
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")

	if info, err := os.Stat(file); err == nil && !info.IsDir() {
		http.ServeFile(w, r, file)
		return
	}
	// Missing assets must return 404, not HTML masquerading as a JavaScript chunk.
	if !isNavigation(r) {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.webDir, "index.html"))
}

// Document extensions cannot identify navigation: Dashboard routes include the
// opened file's extension. Prefer fetch metadata, falling back to Accept.
func isNavigation(r *http.Request) bool {
	if dest := r.Header.Get("Sec-Fetch-Dest"); dest != "" {
		return dest == "document" || dest == "iframe" || dest == "frame"
	}
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

// Map the SPA's API paths to worker routes, including legacy agent aliases.
func backendPath(p string) string {
	switch {
	case p == "/api/files":
		return "/"
	case strings.HasPrefix(p, "/api/files/"):
		return strings.TrimPrefix(p, "/api/files")
	case strings.HasPrefix(p, "/api/ws/"):
		return "/ws/" + strings.TrimPrefix(p, "/api/ws/")
	case strings.HasPrefix(p, "/api/hybridflow-runner"):
		return "/hybridflow-runner" + strings.TrimPrefix(p, "/api/hybridflow-runner")
	case strings.HasPrefix(p, "/api/agents"):
		return "/agents" + strings.TrimPrefix(p, "/api/agents")
	case strings.HasPrefix(p, "/api/claude"):
		return "/claude" + strings.TrimPrefix(p, "/api/claude")
	}
	return p
}
