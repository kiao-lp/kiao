package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// A stand-in for the installed layout: an install directory with a web/ in it, holding an
// index.html and one hashed chunk.
func serverOnBundle(t *testing.T) http.Handler {
	t.Helper()
	installDir := t.TempDir()
	webDir := filepath.Join(installDir, "web")
	if err := os.MkdirAll(filepath.Join(webDir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"index.html":                "<!DOCTYPE html><title>Dashboard</title>",
		"assets/flowDiagram-Bpc.js": "export const diagram = {};",
		"sw.js":                     "// a precaching worker from some earlier build",
	} {
		if err := os.WriteFile(filepath.Join(webDir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return newFrontServer(installDir, t.TempDir(), 48400, 48401, noBoards, &plantUML{})
}

// A folder with no boards configured, which is what the stand-in above serves by default.
var noBoards = boardsBackend{}

// backendOn is the boards backend a test server stands in for.
func backendOn(t *testing.T, server *httptest.Server, token, actor string, remote bool) boardsBackend {
	t.Helper()
	base, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	return boardsBackend{base: base, token: token, actor: actor, remote: remote}
}

// emptyInstall is an install directory with nothing in it but the web/ the front server expects.
func emptyInstall(t *testing.T) string {
	t.Helper()
	installDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(installDir, "web"), 0o755); err != nil {
		t.Fatal(err)
	}
	return installDir
}

func get(t *testing.T, h http.Handler, path string, headers map[string]string) *http.Response {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Result()
}

// The bug this exists to keep fixed: a lazily imported chunk that is not on disk — the state every
// reinstall leaves a browser holding the previous bundle in — must come back as a 404 and not as
// index.html, which the browser reports as "Failed to fetch dynamically imported module".
func TestAMissingChunkIs404NotIndexHTML(t *testing.T) {
	h := serverOnBundle(t)

	res := get(t, h, spaBase+"assets/flowDiagram-BU_.js", map[string]string{"Sec-Fetch-Dest": "script"})
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("a chunk that is not there answered %d, want 404", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); strings.Contains(ct, "text/html") {
		t.Errorf("a missing chunk answered with %s — that is index.html where JavaScript was asked for", ct)
	}

	// The chunk that is there is still served, as JavaScript.
	res = get(t, h, spaBase+"assets/flowDiagram-Bpc.js", map[string]string{"Sec-Fetch-Dest": "script"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("the chunk on disk answered %d, want 200", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("the chunk on disk is typed %q, want JavaScript", ct)
	}
}

// The fallback the 404 must not have taken away: Dashboard puts the open document in the path, so a
// reload arrives at a route with a file extension on it that only the SPA can resolve.
func TestANavigationStillFallsBackToIndexHTML(t *testing.T) {
	h := serverOnBundle(t)
	for _, headers := range []map[string]string{
		{"Sec-Fetch-Dest": "document"},
		{"Accept": "text/html,application/xhtml+xml"}, // no fetch metadata at all
	} {
		res := get(t, h, spaBase+"works/beta/article.md", headers)
		if res.StatusCode != http.StatusOK {
			t.Errorf("a reload on %v answered %d, want the SPA", headers, res.StatusCode)
		}
		if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "text/html") {
			t.Errorf("a reload on %v answered %q, want index.html", headers, ct)
		}
	}
}

// Whatever sw.js the bundle happens to carry, the one served is the one that uninstalls itself:
// that is what clears a precaching worker left by an earlier install off this port.
func TestServiceWorkerUninstallsItself(t *testing.T) {
	h := serverOnBundle(t)
	res := get(t, h, spaBase+"sw.js", nil)

	body := make([]byte, 2048)
	n, _ := res.Body.Read(body)
	worker := string(body[:n])

	if !strings.Contains(worker, "registration.unregister()") {
		t.Errorf("sw.js does not unregister itself:\n%s", worker)
	}
	if !strings.Contains(worker, "caches.delete") {
		t.Errorf("sw.js does not drop the caches it left behind:\n%s", worker)
	}
	if strings.Contains(worker, "precaching worker") {
		t.Error("sw.js came from the bundle — the bundle's worker wins over the one that uninstalls it")
	}
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("sw.js is Cache-Control %q — a reused worker script never runs its uninstall", cc)
	}
}

// The boards route, on a folder with no database behind it: a sentence saying what is missing,
// and not a proxy to a port nothing is on. 503, because the route exists and the deployment is
// what is not there.
func TestBoardsWithoutADatabaseSaysSo(t *testing.T) {
	h := serverOnBundle(t)
	res := get(t, h, "/api/hybridflow/boards", nil)
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("the boards route answered %d, want 503", res.StatusCode)
	}
	body := make([]byte, 512)
	n, _ := res.Body.Read(body)
	for _, name := range []string{remoteEnv, databaseEnv} {
		if !strings.Contains(string(body[:n]), name) {
			t.Errorf("the answer does not name %s, one of the two ways out:\n%s", name, body[:n])
		}
	}
}

// And with one: everything under /api/hybridflow goes to the boards service with the prefix taken
// off, while everything else under /api goes to the worker. The two live under the same
// /api/ and only the longer pattern keeps them apart — which is the thing worth a test.
func TestBoardsAndFilesAreRoutedApart(t *testing.T) {
	asked := make(chan string, 4)
	boards := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked <- "boards " + r.URL.Path
	}))
	defer boards.Close()
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked <- "files " + r.URL.Path
	}))
	defer files.Close()

	h := newFrontServer(emptyInstall(t), t.TempDir(), 48400, portOf(t, files.URL),
		backendOn(t, boards, "", "", false), &plantUML{})

	for path, want := range map[string]string{
		"/api/hybridflow/boards/major": "boards /boards/major",
		"/api/hybridflow":              "boards /",
		"/api/files/getFile":           "files /getFile",
	} {
		get(t, h, path, nil)
		if got := <-asked; got != want {
			t.Errorf("%s reached %q, want %q", path, got, want)
		}
	}
}

func portOf(t *testing.T, rawURL string) int {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil {
		t.Fatal(err)
	}
	return port
}

// The boards live on a remote service, and this instance is a client of that one service. Three things have
// to be true of every request the SPA makes, and none of them is the SPA's doing: the path lands
// under the remote's own prefix, the deployment's token is presented, and the person at this
// machine is named — a browser here has no session to borrow, so without these a card moved from a
// laptop is either refused or recorded as nobody.
func TestRemoteBoardsCarryTheTokenAndTheActor(t *testing.T) {
	type call struct{ path, auth, actor string }
	seen := make(chan call, 4)
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen <- call{r.URL.Path, r.Header.Get("Authorization"), r.Header.Get(actorHeader)}
	}))
	defer remote.Close()

	// A server deployment publishes the service under a prefix of its own, so the two halves are joined.
	base, err := url.Parse(remote.URL + "/api/hybridflow")
	if err != nil {
		t.Fatal(err)
	}
	backend := boardsBackend{base: base, token: "the-service-token", actor: "alex", remote: true}
	h := newFrontServer(emptyInstall(t), t.TempDir(), 48400, 48401, backend, &plantUML{})

	// An Authorization the page happened to carry is replaced, not added to: what it could hold
	// here is a leftover, and the token this end holds is the one the other end is checking.
	get(t, h, "/api/hybridflow/boards/major", map[string]string{"Authorization": "Bearer stale"})
	got := <-seen
	if got.path != "/api/hybridflow/boards/major" {
		t.Errorf("the remote was asked for %q, want the prefix kept", got.path)
	}
	if got.auth != "Bearer the-service-token" {
		t.Errorf("Authorization was %q, want the service token", got.auth)
	}
	if got.actor != "alex" {
		t.Errorf("%s was %q, want the person at this machine", actorHeader, got.actor)
	}
}

// The one combination that cannot be resolved by guessing: a service to send the boards to and a
// database to serve them from are two different places to write a card, and picking one silently is
// how work ends up in the wrong one.
func TestAServiceAndADatabaseTogetherAreRefused(t *testing.T) {
	t.Setenv(remoteEnv, "https://boards.example.com/api/hybridflow")
	t.Setenv(databaseEnv, "postgres://hybridflow:x@127.0.0.1:5432/hybridflow")
	if _, err := boardsFromEnv(); err == nil {
		t.Fatal("both set was accepted; one of the two would have been written to silently")
	}
}

// And what a plain remote reads as, including who the work will be recorded as.
func TestARemoteIsReadWithTheLoginNameAsActor(t *testing.T) {
	t.Setenv(remoteEnv, "https://boards.example.com/api/hybridflow/")
	t.Setenv(tokenEnv, "tok")
	t.Setenv(databaseEnv, "")
	t.Setenv(actorEnv, "")
	cfg, err := boardsFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.remoteBoards() || cfg.ownBoards() {
		t.Errorf("a remote read as %+v", cfg)
	}
	if cfg.remote != "https://boards.example.com/api/hybridflow" {
		t.Errorf("the trailing slash survived: %q", cfg.remote)
	}
	if cfg.actor == "" {
		t.Error("no actor: every card moved from here would be recorded as the service itself")
	}
	if !strings.Contains(cfg.describe(), cfg.actor) {
		t.Errorf("the startup line %q does not say who the work will be recorded as", cfg.describe())
	}
}

// A URL that is not one is a refusal to start, not a proxy answering 502 later.
func TestANonsenseRemoteIsRefused(t *testing.T) {
	t.Setenv(databaseEnv, "")
	for _, bad := range []string{"boards.example.com/api/hybridflow", "postgres://host/db", "::"} {
		t.Setenv(remoteEnv, bad)
		if _, err := boardsFromEnv(); err == nil {
			t.Errorf("%q was accepted as a service URL", bad)
		}
	}
}
