package files

import (
	"encoding/json"
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"testing"
)

func TestSyncPdfThemesRefreshesDefaultsAndPreservesCustomThemes(t *testing.T) {
	root := t.TempDir()
	cfg := &Config{Config: &core.Config{RootPath: root}}
	dir := filepath.Join(root, filepath.FromSlash(pdfThemesDirRel))
	SyncPdfThemes(cfg)
	neutral := filepath.Join(dir, "neutral.json")
	original, err := os.ReadFile(neutral)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Label     string            `json:"label"`
		Variables map[string]string `json:"variables"`
	}
	if err := json.Unmarshal(original, &doc); err != nil || doc.Label == "" || doc.Variables["--heading-1"] == "" {
		t.Fatalf("invalid delivered theme: %s (%v)", original, err)
	}
	custom := filepath.Join(dir, "company.json")
	mustWrite(t, custom, `{"label":"Company","css":"h1 { color: blue; }"}`)
	mustWrite(t, neutral, `{"label":"old default"}`)
	SyncPdfThemes(cfg)
	updated, err := os.ReadFile(neutral)
	if err != nil || string(updated) != string(original) {
		t.Fatalf("default not synchronized: %s (%v)", updated, err)
	}
	if err := os.Remove(neutral); err != nil {
		t.Fatal(err)
	}
	SyncPdfThemes(cfg)
	if restored, err := os.ReadFile(neutral); err != nil || string(restored) != string(original) {
		t.Fatalf("missing default not restored: %v", err)
	}
	if body, err := os.ReadFile(custom); err != nil || string(body) != `{"label":"Company","css":"h1 { color: blue; }"}` {
		t.Fatalf("custom theme was changed: %s (%v)", body, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "README.md")); err != nil {
		t.Fatal("theme format documentation missing:", err)
	}
}
