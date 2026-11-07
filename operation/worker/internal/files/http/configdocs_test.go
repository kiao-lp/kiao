package fileshttp

import (
	fileconfig "kiao/worker/internal/files/configuration"
	"kiao/worker/internal/files/migrations"
	"kiao/worker/internal/files/scope"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A document that was never written is a 404, and both clients seed on exactly that: a 200 with an
// empty body would be read as "the user has no feature flags", not as "first run".
func TestConfigDocMissingIsNotFound(t *testing.T) {
	s, _ := newFileTestServer(t)

	rec := do(s, httptest.NewRequest(http.MethodGet, "/config/"+fileconfig.ConfigDocDashboard, nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestConfigDocRoundTrip(t *testing.T) {
	s, _ := newFileTestServer(t)
	body := `{"claudeCodeEnabled":false}`

	rec := do(s, httptest.NewRequest(http.MethodPut, "/config/"+fileconfig.ConfigDocDashboard, strings.NewReader(body)))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("PUT status = %d, want 204 (%s)", rec.Code, rec.Body)
	}
	rec = do(s, httptest.NewRequest(http.MethodGet, "/config/"+fileconfig.ConfigDocDashboard, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200", rec.Code)
	}
	if got := rec.Body.String(); got != body {
		t.Errorf("body = %q, want %q", got, body)
	}

	// It is written where the rest of the state lives, and readable by the service user alone.
	info, err := os.Stat(filepath.Join(s.cfg.StatePath, fileconfig.ConfigDocDashboard))
	if err != nil {
		t.Fatalf("document not in the state directory: %v", err)
	}
	if perm := info.Mode().Perm(); perm != fileconfig.ConfigDocPerm {
		t.Errorf("mode = %o, want %o", perm, fileconfig.ConfigDocPerm)
	}
}

// The name is an allow-list, not a pattern: the state directory also holds the migration ledger and
// the conversation registry, and an endpoint meant for a toolbar's open/closed state must not be
// able to rewrite which migrations a store thinks it has already run.
func TestConfigDocNameIsAllowListed(t *testing.T) {
	s, _ := newFileTestServer(t)
	for _, name := range []string{migrations.MigrationLedgerFile, scope.LegacyMigrationIgnoreFile, "..%2Fescape.json", "anything.json"} {
		rec := do(s, httptest.NewRequest(http.MethodPut, "/config/"+name, strings.NewReader(`{}`)))
		if rec.Code != http.StatusNotFound {
			t.Errorf("PUT /config/%s status = %d, want 404", name, rec.Code)
		}
		if _, err := os.Stat(filepath.Join(s.cfg.StatePath, name)); err == nil {
			t.Errorf("PUT /config/%s wrote a file", name)
		}
	}
}

// The small-screen view state is a document of its own, so a phone's layout and a desktop's never
// overwrite each other. It is only useful if the service lets it through the allow-list, and it must
// land beside its sibling rather than on top of it.
func TestConfigDocSmallScreenViewStateIsItsOwnDocument(t *testing.T) {
	s, _ := newFileTestServer(t)

	for name, body := range map[string]string{
		fileconfig.ConfigDocViewState:      `{"global":{"wide":true}}`,
		fileconfig.ConfigDocViewStateSmall: `{"global":{"wide":false}}`,
	} {
		rec := do(s, httptest.NewRequest(http.MethodPut, "/config/"+name, strings.NewReader(body)))
		if rec.Code != http.StatusNoContent {
			t.Fatalf("PUT /config/%s status = %d, want 204 (%s)", name, rec.Code, rec.Body)
		}
	}
	for name, want := range map[string]string{
		fileconfig.ConfigDocViewState:      `{"global":{"wide":true}}`,
		fileconfig.ConfigDocViewStateSmall: `{"global":{"wide":false}}`,
	} {
		rec := do(s, httptest.NewRequest(http.MethodGet, "/config/"+name, nil))
		if got := rec.Body.String(); rec.Code != http.StatusOK || got != want {
			t.Errorf("GET /config/%s = %d %q, want 200 %q", name, rec.Code, got, want)
		}
	}
}

// A body that is not JSON is refused rather than stored: read back on the next startup it would be
// a corrupt document, and the client that re-seeds a corrupt document with defaults is the one that
// just lost its state.
func TestConfigDocRejectsNonJson(t *testing.T) {
	s, _ := newFileTestServer(t)

	rec := do(s, httptest.NewRequest(http.MethodPut, "/config/"+fileconfig.ConfigDocViewState, strings.NewReader("{oops")))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(s.cfg.StatePath, fileconfig.ConfigDocViewState)); err == nil {
		t.Error("a malformed document was stored")
	}
}

func TestConfigDocRejectsOversizedBody(t *testing.T) {
	s, _ := newFileTestServer(t)
	body := `{"x":"` + strings.Repeat("y", fileconfig.MaxConfigDocBytes) + `"}`

	rec := do(s, httptest.NewRequest(http.MethodPut, "/config/"+fileconfig.ConfigDocViewState, strings.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

// Which skills a store gets is its plugin list, and the half that installs them only ever ran at
// startup. So the save has to say so — before the 204, since a panel told the save succeeded is
// one the user may reload or open an agent tab from.
func TestSavingTheDashboardConfigTellsTheListener(t *testing.T) {
	s, _ := newFileTestServer(t)
	told := 0
	s.OnDashboardConfigSaved(func() { told++ })

	rec := do(s, httptest.NewRequest(http.MethodPut, "/config/"+fileconfig.ConfigDocDashboard, strings.NewReader(`{"plugins":[]}`)))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("PUT status = %d, want 204 (%s)", rec.Code, rec.Body)
	}
	if told != 1 {
		t.Errorf("listener called %d times, want 1", told)
	}
}

// And only that document. View state is written on every drag of a splitter, and nothing reacts to
// it: a listener called there would reinstall the store's skills a hundred times an afternoon.
func TestSavingAnythingElseTellsNobody(t *testing.T) {
	s, _ := newFileTestServer(t)
	told := 0
	s.OnDashboardConfigSaved(func() { told++ })

	for _, name := range []string{fileconfig.ConfigDocViewState, fileconfig.ConfigDocViewStateSmall, fileconfig.ConfigDocRunner} {
		do(s, httptest.NewRequest(http.MethodPut, "/config/"+name, strings.NewReader(`{}`)))
	}
	// And a write that fails is not a change either.
	do(s, httptest.NewRequest(http.MethodPut, "/config/"+fileconfig.ConfigDocDashboard, strings.NewReader(`not json`)))

	if told != 0 {
		t.Errorf("listener called %d times, want 0", told)
	}
}

// The runner document travels through the same allow-list: it is one of the state directory's
// small JSON files, written by the runners panel's "it's me" button.
func TestRunnerDocRoundTrip(t *testing.T) {
	s, _ := newFileTestServer(t)
	body := `{"runnerId":"runner-1"}`

	rec := do(s, httptest.NewRequest(http.MethodPut, "/config/"+fileconfig.ConfigDocRunner, strings.NewReader(body)))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("PUT status = %d, want 204 (%s)", rec.Code, rec.Body)
	}
	rec = do(s, httptest.NewRequest(http.MethodGet, "/config/"+fileconfig.ConfigDocRunner, nil))
	if rec.Code != http.StatusOK || rec.Body.String() != body {
		t.Errorf("GET = %d %q, want 200 %q", rec.Code, rec.Body.String(), body)
	}
}

// Saving the runner document says so on its own listener — before the 204, like the Dashboard one,
// since a panel told the save succeeded may re-read the identity straight away. Nothing else says
// so there: the skills listener above all, which must not reinstall a store's skills because the
// service was named another runner.
func TestSavingTheRunnerDocTellsItsListener(t *testing.T) {
	s, _ := newFileTestServer(t)
	runnerTold, dashboardTold := 0, 0
	s.OnRunnerConfigSaved(func() { runnerTold++ })
	s.OnDashboardConfigSaved(func() { dashboardTold++ })

	rec := do(s, httptest.NewRequest(http.MethodPut, "/config/"+fileconfig.ConfigDocRunner, strings.NewReader(`{"runnerId":"runner-1"}`)))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("PUT status = %d, want 204 (%s)", rec.Code, rec.Body)
	}
	if runnerTold != 1 {
		t.Errorf("runner listener called %d times, want 1", runnerTold)
	}
	if dashboardTold != 0 {
		t.Errorf("Dashboard listener called %d times, want 0", dashboardTold)
	}

	for _, name := range []string{fileconfig.ConfigDocDashboard, fileconfig.ConfigDocViewState, fileconfig.ConfigDocViewStateSmall} {
		do(s, httptest.NewRequest(http.MethodPut, "/config/"+name, strings.NewReader(`{}`)))
	}
	// And a write that fails is not a change either.
	do(s, httptest.NewRequest(http.MethodPut, "/config/"+fileconfig.ConfigDocRunner, strings.NewReader(`not json`)))

	if runnerTold != 1 {
		t.Errorf("runner listener called %d times after other saves, want 1", runnerTold)
	}
}
