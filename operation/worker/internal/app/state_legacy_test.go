package app

import (
	coreconfig "kiao/worker/internal/core/config"
	fileconfig "kiao/worker/internal/files/configuration"
	"kiao/worker/internal/hybridflow-runner/conversations"
	"os"
	"path/filepath"
	"testing"
)

// A store written by the previous layout keeps its registry and the Dashboard documents in the data
// root. Startup collects them into the state directory under their new names.
func TestAdoptLegacyStateMovesDocumentsAndRetainsLedger(t *testing.T) {
	root := t.TempDir()
	cfg := &coreconfig.Config{RootPath: root, StatePath: t.TempDir()}
	mustWrite(t, filepath.Join(root, ".kiao", "migrations.json"), `{"schemaVersion":7,"applied":[]}`)
	mustWrite(t, filepath.Join(root, ".kiao", conversations.ConversationsDirName, "abc", "meta.json"), `{"id":"abc"}`)
	// The previous layout wrote the documents under their pre-rename names; adopting them lands
	// them under the current ones.
	mustWrite(t, filepath.Join(root, "config", "quickcms.json"), `{"gitEnabled":false}`)
	mustWrite(t, filepath.Join(root, "config", "quickcms-view-state.json"), `{"global":{}}`)

	if moved := adoptLegacyState(cfg); moved != 3 {
		t.Errorf("adopted %d entries, want 3", moved)
	}
	for name, want := range map[string]string{
		fileconfig.ConfigDocDashboard: `{"gitEnabled":false}`,
		fileconfig.ConfigDocViewState: `{"global":{}}`,
	} {
		if got := mustRead(t, filepath.Join(cfg.StatePath, name)); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	if got := mustRead(t, filepath.Join(cfg.StatePath, conversations.ConversationsDirName, "abc", "meta.json")); got != `{"id":"abc"}` {
		t.Errorf("the conversation directory did not come across: %q", got)
	}
	if got := mustRead(t, filepath.Join(root, ".kiao", "migrations.json")); got != `{"schemaVersion":7,"applied":[]}` {
		t.Errorf("legacy ledger changed: %q", got)
	}
	if _, err := os.Stat(filepath.Join(root, ".kiao", conversations.ConversationsDirName)); !os.IsNotExist(err) {
		t.Errorf("old conversations survived: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "config", "quickcms.json")); !os.IsNotExist(err) {
		t.Errorf("the old config document survived: %v", err)
	}
}

// An adoption that overwrote a live document with a stale one would hand back state the user has
// since changed. The destination always wins.
func TestAdoptLegacyStateNeverOverwritesCurrentState(t *testing.T) {
	root := t.TempDir()
	cfg := &coreconfig.Config{RootPath: root, StatePath: t.TempDir()}
	mustWrite(t, filepath.Join(root, "config", "quickcms.json"), `{"gitEnabled":true}`)
	mustWrite(t, filepath.Join(cfg.StatePath, fileconfig.ConfigDocDashboard), `{"gitEnabled":false}`)

	if moved := adoptLegacyState(cfg); moved != 0 {
		t.Errorf("adopted %d entries, want 0", moved)
	}
	if got := mustRead(t, filepath.Join(cfg.StatePath, fileconfig.ConfigDocDashboard)); got != `{"gitEnabled":false}` {
		t.Errorf("current document = %q, want the one already in the state directory", got)
	}
}

// The trusted-folder registry is gone from the service, so a store that still carries one has it
// deleted rather than adopted or left in place — in either layout. Leaving it would keep a file
// listing folders Claude may run in on a service where Claude runs in all of them.
func TestAdoptLegacyStateRemovesTheRetiredTrustRegistry(t *testing.T) {
	root := t.TempDir()
	cfg := &coreconfig.Config{RootPath: root, StatePath: t.TempDir()}
	mustWrite(t, filepath.Join(root, ".kiao", retiredTrustStoreFile), `{"version":1,"folders":["units"]}`)
	mustWrite(t, filepath.Join(cfg.StatePath, retiredTrustStoreFile), `{"version":1,"folders":["docs"]}`)

	adoptLegacyState(cfg)
	if _, err := os.Stat(filepath.Join(cfg.StatePath, retiredTrustStoreFile)); !os.IsNotExist(err) {
		t.Errorf("the registry survived in the state directory (stat error = %v)", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".kiao")); !os.IsNotExist(err) {
		t.Errorf("the old state directory survived: %v", err)
	}
}

func TestAdoptLegacyStateRetainsOldLedgerForExplicitUpgrade(t *testing.T) {
	root := t.TempDir()
	cfg := &coreconfig.Config{RootPath: root, StatePath: t.TempDir()}
	mustWrite(t, filepath.Join(root, ".kiao", "migrations.json"), `{"schemaVersion":7}`)

	adoptLegacyState(cfg)
	if _, err := os.Stat(filepath.Join(cfg.StatePath, "files-migrations.json")); !os.IsNotExist(err) {
		t.Errorf("the old ledger was adopted (stat error = %v)", err)
	}
	if got := mustRead(t, filepath.Join(root, ".kiao", "migrations.json")); got != `{"schemaVersion":7}` {
		t.Errorf("legacy ledger changed: %q", got)
	}
}

// A fresh store has none of this, and a second startup has nothing left to do. Neither may leave a
// mark on the store — an empty .kiao recreated at every boot would be the exact hidden directory
// this layout exists to remove.
func TestAdoptLegacyStateIsANoOpWithoutALegacyStore(t *testing.T) {
	root := t.TempDir()
	cfg := &coreconfig.Config{RootPath: root, StatePath: t.TempDir()}
	mustWrite(t, filepath.Join(root, "welcome.md"), "hello")

	if moved := adoptLegacyState(cfg); moved != 0 {
		t.Errorf("adopted %d entries, want 0", moved)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "welcome.md" {
		t.Errorf("the data root changed: %v", entries)
	}
}

// A directory holding something this code does not recognise is left alone: it sits inside the
// user's own content tree, and "unknown" is not the same as "disposable".
func TestAdoptLegacyStateKeepsAnUnrecognisedLegacyDir(t *testing.T) {
	root := t.TempDir()
	cfg := &coreconfig.Config{RootPath: root, StatePath: t.TempDir()}
	mustWrite(t, filepath.Join(root, ".kiao", "migrations.json"), `{"schemaVersion":7}`)
	mustWrite(t, filepath.Join(root, ".kiao", "notes-of-mine.txt"), "keep me")

	adoptLegacyState(cfg)
	if got := mustRead(t, filepath.Join(root, ".kiao", "notes-of-mine.txt")); got != "keep me" {
		t.Errorf("an unrecognised file was removed: %q", got)
	}
}

// A store that last ran before the Dashboard rename still carries its configuration
// documents under their old names. Startup renames them in place, contents untouched.
func TestAdoptRenamedStateDocsRenamesEveryDocument(t *testing.T) {
	state := t.TempDir()
	mustWrite(t, filepath.Join(state, "quickcms.json"), `{"gitEnabled":false}`)
	mustWrite(t, filepath.Join(state, "quickcms-view-state.json"), `{"global":{}}`)
	mustWrite(t, filepath.Join(state, "quickcms-view-state-small.json"), `{"global":{"small":true}}`)

	if renamed := adoptRenamedStateDocs(state); renamed != 3 {
		t.Errorf("renamed %d documents, want 3", renamed)
	}
	for name, want := range map[string]string{
		fileconfig.ConfigDocDashboard:      `{"gitEnabled":false}`,
		fileconfig.ConfigDocViewState:      `{"global":{}}`,
		fileconfig.ConfigDocViewStateSmall: `{"global":{"small":true}}`,
	} {
		if got := mustRead(t, filepath.Join(state, name)); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	for _, old := range []string{"quickcms.json", "quickcms-view-state.json", "quickcms-view-state-small.json"} {
		if _, err := os.Stat(filepath.Join(state, old)); !os.IsNotExist(err) {
			t.Errorf("the pre-rename file survived: %s (%v)", old, err)
		}
	}
}

// A document already under its new name wins over the old one beside it: the live document is
// never overwritten, and the stale one is left for the operator rather than deleted.
func TestAdoptRenamedStateDocsNeverOverwritesCurrentState(t *testing.T) {
	state := t.TempDir()
	mustWrite(t, filepath.Join(state, "quickcms.json"), `{"gitEnabled":true}`)
	mustWrite(t, filepath.Join(state, fileconfig.ConfigDocDashboard), `{"gitEnabled":false}`)

	if renamed := adoptRenamedStateDocs(state); renamed != 0 {
		t.Errorf("renamed %d documents, want 0", renamed)
	}
	if got := mustRead(t, filepath.Join(state, fileconfig.ConfigDocDashboard)); got != `{"gitEnabled":false}` {
		t.Errorf("current document = %q, want the one already under the new name", got)
	}
	if got := mustRead(t, filepath.Join(state, "quickcms.json")); got != `{"gitEnabled":true}` {
		t.Errorf("stale document = %q, want it left alone", got)
	}
}

// A store that already carries the new names — or none at all — is left byte-identical.
func TestAdoptRenamedStateDocsIsANoOpOnceRenamed(t *testing.T) {
	state := t.TempDir()
	mustWrite(t, filepath.Join(state, fileconfig.ConfigDocDashboard), `{"gitEnabled":false}`)

	if renamed := adoptRenamedStateDocs(state); renamed != 0 {
		t.Errorf("renamed %d documents, want 0", renamed)
	}
	if renamed := adoptRenamedStateDocs(t.TempDir()); renamed != 0 {
		t.Errorf("renamed %d documents on an empty state directory, want 0", renamed)
	}
	if got := mustRead(t, filepath.Join(state, fileconfig.ConfigDocDashboard)); got != `{"gitEnabled":false}` {
		t.Errorf("current document = %q, want it untouched", got)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
