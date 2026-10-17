package files

import (
	"bytes"
	"encoding/json"
	"io"
	"kiao/worker/internal/core"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// boolPtr is the local spelling of an optional bool in an applicability rule.
func boolPtr(b bool) *bool { return &b }

// writeManifest drops a manifest in a temp dir and returns its path.
func writeManifest(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "actions.json")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("writing manifest: %v", err)
	}
	return path
}

// ── applicability: the rule is the contract, mirrored in the Dashboard client ───

func TestActionApplies(t *testing.T) {
	cases := []struct {
		name  string
		rule  ActionAppliesToDto
		path  string
		isDir bool
		want  bool
	}{
		{"empty rule matches anything", ActionAppliesToDto{}, "a/b.md", false, true},
		{"empty rule matches a directory", ActionAppliesToDto{}, "a/b", true, true},
		{"extension matches", ActionAppliesToDto{Extensions: []string{".ttst.md"}}, "u/x.ttst.md", false, true},
		{"extension is case-insensitive", ActionAppliesToDto{Extensions: []string{".ttst.md"}}, "u/X.TTST.MD", false, true},
		{"plain markdown is not a ttst script", ActionAppliesToDto{Extensions: []string{".ttst.md"}}, "u/x.md", false, false},
		{"compound extension wins over its tail", ActionAppliesToDto{Extensions: []string{".mlunit.json"}}, "u/x.mlunit.json", false, true},
		{"other json is not a unit", ActionAppliesToDto{Extensions: []string{".mlunit.json"}}, "u/x.config.json", false, false},
		{"any of several extensions", ActionAppliesToDto{Extensions: []string{".md", ".txt"}}, "u/x.txt", false, true},
		{"directory required, file given", ActionAppliesToDto{Directory: boolPtr(true)}, "u/x.md", false, false},
		{"directory required, directory given", ActionAppliesToDto{Directory: boolPtr(true)}, "u", true, true},
		{"file required, directory given", ActionAppliesToDto{Directory: boolPtr(false)}, "u", true, false},
		{"rules are AND-ed", ActionAppliesToDto{Extensions: []string{".md"}, Directory: boolPtr(true)}, "u/x.md", false, false},
		{"a folder named like an extension does not match by path", ActionAppliesToDto{Extensions: []string{".md"}}, "x.md/child.json", false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := actionApplies(c.rule, c.path, c.isDir); got != c.want {
				t.Errorf("actionApplies(%q, dir=%v) = %v, want %v", c.path, c.isDir, got, c.want)
			}
		})
	}
}

// ── manifest loading & validation ─────────────────────────────────────────────

func TestLoadActionCatalogBlankPathDisablesFeature(t *testing.T) {
	catalog, err := loadActionCatalog("")
	if err != nil {
		t.Fatalf("blank path should not be an error, got %v", err)
	}
	if len(catalog.descriptors()) != 0 {
		t.Errorf("descriptors = %d, want 0", len(catalog.descriptors()))
	}
}

func TestLoadActionCatalogReadsManifest(t *testing.T) {
	path := writeManifest(t, `{"actions":[
		{"id":"audio.speech","label":"Generate speech","group":"6-actions","order":10,
		 "appliesTo":{"extensions":[".ttst.md"]},
		 "provider":"http://localhost:1/actions/audio.speech"},
		{"id":"doc.publish","label":"Publish","appliesTo":{"extensions":[".mlunit.json"]},
		 "params":[{"name":"environment","type":"enum","values":["prod"],"default":"prod"}],
		 "provider":"http://localhost:1/actions/doc.publish"}
	]}`)

	catalog, err := loadActionCatalog(path)
	if err != nil {
		t.Fatalf("loadActionCatalog: %v", err)
	}
	if got := len(catalog.descriptors()); got != 2 {
		t.Fatalf("descriptors = %d, want 2", got)
	}
	if catalog.find("audio.speech") == nil {
		t.Error("find(audio.speech) = nil, want the action")
	}
	if catalog.find("nope") != nil {
		t.Error("find(nope) should be nil")
	}

	applicable := catalog.applicableTo(&FileDto{Path: "units/u/intro.ttst.md"})
	if len(applicable) != 1 || applicable[0].ID != "audio.speech" {
		t.Errorf("applicableTo(.ttst.md) = %+v, want only audio.speech", applicable)
	}
}

func TestLoadActionCatalogRejectsBadManifests(t *testing.T) {
	cases := []struct{ name, body string }{
		{"not json", `{`},
		{"missing id", `{"actions":[{"label":"x","provider":"http://h/a"}]}`},
		{"missing label", `{"actions":[{"id":"a","provider":"http://h/a"}]}`},
		{"duplicate id", `{"actions":[
			{"id":"a","label":"x","provider":"http://h/a"},
			{"id":"a","label":"y","provider":"http://h/b"}]}`},
		{"relative provider", `{"actions":[{"id":"a","label":"x","provider":"/actions/a"}]}`},
		{"empty provider", `{"actions":[{"id":"a","label":"x","provider":""}]}`},
		{"unknown param type", `{"actions":[{"id":"a","label":"x","provider":"http://h/a",
			"params":[{"name":"p","type":"date"}]}]}`},
		{"enum without values", `{"actions":[{"id":"a","label":"x","provider":"http://h/a",
			"params":[{"name":"p","type":"enum"}]}]}`},
		{"param without name", `{"actions":[{"id":"a","label":"x","provider":"http://h/a",
			"params":[{"type":"string"}]}]}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := loadActionCatalog(writeManifest(t, c.body)); err == nil {
				t.Error("want an error, got nil")
			}
		})
	}
}

func TestLoadActionCatalogMissingFileIsAnError(t *testing.T) {
	if _, err := loadActionCatalog(filepath.Join(t.TempDir(), "absent.json")); err == nil {
		t.Error("a configured but absent manifest must fail loudly")
	}
}

// A misconfigured manifest must surface at startup, not as a silently missing menu entry.
func TestConfigValidateReportsBadActionManifest(t *testing.T) {
	cfg := &Config{Config: &core.Config{RootPath: t.TempDir(), AuthMode: "debug"}, ActionsPath: writeManifest(t, `{`)}
	if problems := cfg.Validate(); len(problems) == 0 {
		t.Error("Validate() = no problems, want the manifest error")
	}
}

// ── GET /actions ──────────────────────────────────────────────────────────────

// newActionTestServer is newFileTestServer with a two-action catalog whose providers point at
// stub, so a run can be observed end to end.
func newActionTestServer(t *testing.T, stub string) (*Service, string) {
	t.Helper()
	s, root := newFileTestServer(t)
	path := writeManifest(t, `{"actions":[
		{"id":"audio.speech","label":"Generate speech","appliesTo":{"extensions":[".ttst.md"]},
		 "provider":"`+stub+`/tts"},
		{"id":"folder.thing","label":"Folder thing","appliesTo":{"directory":true},
		 "provider":"`+stub+`/folder"}
	]}`)
	catalog, err := loadActionCatalog(path)
	if err != nil {
		t.Fatalf("loadActionCatalog: %v", err)
	}
	s.actions = catalog
	return s, root
}

func TestListActions(t *testing.T) {
	s, root := newActionTestServer(t, "http://127.0.0.1:1")
	mustWrite(t, filepath.Join(root, "intro.ttst.md"), "hello")
	mustWrite(t, filepath.Join(root, "notes.md"), "hello")
	if err := os.Mkdir(filepath.Join(root, "dir"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	decode := func(target string) []ActionDto {
		t.Helper()
		rec := do(s, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d, want 200", target, rec.Code)
		}
		var got []ActionDto
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decoding %s: %v (body %s)", target, err, rec.Body.String())
		}
		return got
	}

	if got := decode("/actions"); len(got) != 2 {
		t.Errorf("GET /actions = %d actions, want 2", len(got))
	}
	if got := decode("/actions?path=intro.ttst.md"); len(got) != 1 || got[0].ID != "audio.speech" {
		t.Errorf("GET /actions?path=intro.ttst.md = %+v, want only audio.speech", got)
	}
	if got := decode("/actions?path=notes.md"); len(got) != 0 {
		t.Errorf("GET /actions?path=notes.md = %+v, want none", got)
	}
	if got := decode("/actions?path=dir"); len(got) != 1 || got[0].ID != "folder.thing" {
		t.Errorf("GET /actions?path=dir = %+v, want only folder.thing", got)
	}
}

// The provider URL is deployment topology: a browser names an action by id and this service
// routes it, so the URL must never reach the client.
func TestListActionsHidesProviderURL(t *testing.T) {
	s, _ := newActionTestServer(t, "http://secret-host:9999")
	rec := do(s, httptest.NewRequest(http.MethodGet, "/actions", nil))
	if bytes.Contains(rec.Body.Bytes(), []byte("secret-host")) {
		t.Errorf("provider URL leaked to the client: %s", rec.Body.String())
	}
}

func TestListActionsUnknownPathIs404(t *testing.T) {
	s, _ := newActionTestServer(t, "http://127.0.0.1:1")
	rec := do(s, httptest.NewRequest(http.MethodGet, "/actions?path=absent.ttst.md", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestListActionsTraversalIsBadRequest(t *testing.T) {
	s, _ := newActionTestServer(t, "http://127.0.0.1:1")
	rec := do(s, httptest.NewRequest(http.MethodGet, "/actions?path=../escape", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

// ── POST /actions/run ─────────────────────────────────────────────────────────

func runAction(s *Service, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/actions/run", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	return do(s, req)
}

func TestRunActionForwardsToProvider(t *testing.T) {
	var gotPath string
	var gotParams map[string]any
	var gotAuth string
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Path   string         `json:"path"`
			Params map[string]any `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		gotPath, gotParams, gotAuth = req.Path, req.Params, r.Header.Get("Authorization")
		core.WriteJSON(w, http.StatusOK, ActionResultDto{
			OK: true, Message: "done", ChangedPaths: []string{"intro.mp3"},
		})
	}))
	t.Cleanup(stub.Close)

	s, root := newActionTestServer(t, stub.URL)
	mustWrite(t, filepath.Join(root, "intro.ttst.md"), "hello")

	req := httptest.NewRequest(http.MethodPost, "/actions/run",
		bytes.NewBufferString(`{"id":"audio.speech","path":"intro.ttst.md","params":{"k":"v"}}`))
	req.Header.Set("Authorization", "Bearer token-123")
	rec := do(s, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if gotPath != "intro.ttst.md" {
		t.Errorf("provider saw path %q, want intro.ttst.md", gotPath)
	}
	if gotParams["k"] != "v" {
		t.Errorf("provider saw params %v, want k=v", gotParams)
	}
	// The caller's token is what lets the provider read and write the store on their behalf.
	if gotAuth != "Bearer token-123" {
		t.Errorf("provider saw Authorization %q, want the caller's bearer", gotAuth)
	}

	var result ActionResultDto
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decoding result: %v", err)
	}
	if !result.OK || result.Message != "done" || len(result.ChangedPaths) != 1 {
		t.Errorf("result = %+v, want the provider's answer verbatim", result)
	}
}

// A provider that refuses the operation in the contract's shape is authoritative: the user must
// see its reason, not a generic error.
func TestRunActionPassesThroughProviderRefusal(t *testing.T) {
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		core.WriteJSON(w, http.StatusOK, ActionResultDto{OK: false, Message: "no voice configured"})
	}))
	t.Cleanup(stub.Close)

	s, root := newActionTestServer(t, stub.URL)
	mustWrite(t, filepath.Join(root, "intro.ttst.md"), "hello")

	rec := runAction(s, `{"id":"audio.speech","path":"intro.ttst.md"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var result ActionResultDto
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	if result.OK || result.Message != "no voice configured" {
		t.Errorf("result = %+v, want the refusal verbatim", result)
	}
	if result.ChangedPaths == nil {
		t.Error("changedPaths must serialize as [], never null")
	}
}

// A provider failure that is not phrased in the contract becomes a readable failed operation,
// the same choice /git/* makes for a failed git command.
func TestRunActionMapsOpaqueProviderFailure(t *testing.T) {
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("<html>gateway blew up</html>"))
	}))
	t.Cleanup(stub.Close)

	s, root := newActionTestServer(t, stub.URL)
	mustWrite(t, filepath.Join(root, "intro.ttst.md"), "hello")

	rec := runAction(s, `{"id":"audio.speech","path":"intro.ttst.md"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var result ActionResultDto
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	if result.OK || !strings.Contains(result.Message, "500") {
		t.Errorf("result = %+v, want a failed operation naming the status", result)
	}
}

// A non-2xx body may look message-shaped without being an answer in the contract — an auth
// rejection is the everyday case. The status decides what happened; the body only supplies the
// wording, which is kept because it is the only actionable part of it.
func TestRunActionKeepsProviderWordingButNotItsVerdict(t *testing.T) {
	cases := []struct {
		name, body string
		status     int
		wantIn     string
	}{
		{"message field", `{"error":"Unauthorized","message":"no token"}`, http.StatusUnauthorized, "no token"},
		{"error field only", `{"error":"Forbidden"}`, http.StatusForbidden, "Forbidden"},
		{"ok:true on a 4xx is not believed", `{"ok":true,"message":"nope"}`, http.StatusBadRequest, "nope"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(c.status)
				_, _ = w.Write([]byte(c.body))
			}))
			t.Cleanup(stub.Close)

			s, root := newActionTestServer(t, stub.URL)
			mustWrite(t, filepath.Join(root, "intro.ttst.md"), "hello")

			rec := runAction(s, `{"id":"audio.speech","path":"intro.ttst.md"}`)
			var result ActionResultDto
			_ = json.Unmarshal(rec.Body.Bytes(), &result)
			if result.OK {
				t.Errorf("result.ok = true for a %d answer; the status decides, not the body", c.status)
			}
			if !strings.Contains(result.Message, c.wantIn) {
				t.Errorf("message = %q, want it to carry %q", result.Message, c.wantIn)
			}
		})
	}
}

// An unreachable provider is an infrastructure failure, not a failed operation.
func TestRunActionUnreachableProviderIsBadGateway(t *testing.T) {
	stub := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := stub.URL
	stub.Close() // nothing listens there any more

	s, root := newActionTestServer(t, url)
	mustWrite(t, filepath.Join(root, "intro.ttst.md"), "hello")

	rec := runAction(s, `{"id":"audio.speech","path":"intro.ttst.md"}`)
	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", rec.Code)
	}
}

// An action taking no parameters must reach its provider with an empty object, not a null: a
// provider validating its input rejects the latter, and the difference is invisible until then.
func TestRunActionSendsEmptyParamsNotNull(t *testing.T) {
	var raw string
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		raw = string(b)
		core.WriteJSON(w, http.StatusOK, ActionResultDto{OK: true, Message: "done"})
	}))
	t.Cleanup(stub.Close)

	s, root := newActionTestServer(t, stub.URL)
	mustWrite(t, filepath.Join(root, "intro.ttst.md"), "hello")

	runAction(s, `{"id":"audio.speech","path":"intro.ttst.md"}`)

	if strings.Contains(raw, `"params":null`) {
		t.Errorf("provider received %s, want an empty params object", raw)
	}
	if !strings.Contains(raw, `"params":{}`) {
		t.Errorf("provider received %s, want \"params\":{}", raw)
	}
}

func TestRunActionUnknownIdIs404(t *testing.T) {
	s, _ := newActionTestServer(t, "http://127.0.0.1:1")
	if rec := runAction(s, `{"id":"nope","path":"x.md"}`); rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestRunActionInvalidBodyIsBadRequest(t *testing.T) {
	s, _ := newActionTestServer(t, "http://127.0.0.1:1")
	if rec := runAction(s, `not json`); rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

// The path is bounds-checked before anything leaves the process: forwarding an unchecked path
// would make the service a confused deputy for whatever the provider does with it.
func TestRunActionTraversalIsRefusedBeforeProxying(t *testing.T) {
	reached := false
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
		core.WriteJSON(w, http.StatusOK, ActionResultDto{OK: true})
	}))
	t.Cleanup(stub.Close)

	s, _ := newActionTestServer(t, stub.URL)
	rec := runAction(s, `{"id":"audio.speech","path":"../../etc/passwd"}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
	if reached {
		t.Error("the provider was called with a path outside the storage root")
	}
}
