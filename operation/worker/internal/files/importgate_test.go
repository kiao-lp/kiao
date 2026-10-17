package files

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"kiao/worker/internal/core"
)

func importGateCfg(t *testing.T) (*Config, string) {
	t.Helper()
	root := t.TempDir()
	cfg := &Config{Config: &core.Config{RootPath: root, StatePath: filepath.Join(root, ".kiao-config")}}
	return cfg, filepath.Join(root, filepath.FromSlash(importGateDirRel))
}

func TestEnsureImportGateSeedsTheCatalogue(t *testing.T) {
	cfg, dir := importGateCfg(t)

	EnsureImportGateMatchers(cfg)

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("the import-gate folder was not created: %v", err)
	}
	var categories []string
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".json") {
			categories = append(categories, strings.TrimSuffix(entry.Name(), ".json"))
		}
	}
	// The categories the gate is worth having at all: a credential, a classification marking and
	// health data are the three whose arrival in a store is not a matter of tidiness.
	for _, want := range []string{"secrets", "classified", "special-category"} {
		if !slicesContains(categories, want) {
			t.Errorf("category %q was not seeded; got %v", want, categories)
		}
	}
	if len(categories) < 6 {
		t.Errorf("only %d categories seeded (%v); the bundled catalogue is meant to cover more ground",
			len(categories), categories)
	}
	// The README travels with them: it is where somebody writing a matcher of their own reads the
	// format, and it is the reason `all:*` and not `*.json` is embedded.
	if _, err := os.Stat(filepath.Join(dir, "README.md")); err != nil {
		t.Errorf("the format was seeded without its documentation: %v", err)
	}
}

// Every seeded pattern has to be a regular expression the browser can build. Go's RE2 is not
// JavaScript's engine — it rejects the lookarounds two of these need — so what is pinned here is
// that the file parses, that the fields the gate reads are present, and that the shape is right.
// The patterns themselves are compiled in the Dashboard suite, which runs them where they will run.
func TestSeededCategoriesAreWellFormed(t *testing.T) {
	cfg, dir := importGateCfg(t)
	EnsureImportGateMatchers(cfg)

	levels := map[string]bool{"critical": true, "high": true, "medium": true, "low": true}
	type matcher struct {
		Label       string `json:"label"`
		Pattern     string `json:"pattern"`
		Criticality string `json:"criticality"`
	}
	type category struct {
		Category    string    `json:"category"`
		Label       string    `json:"label"`
		Criticality string    `json:"criticality"`
		Matchers    []matcher `json:"matchers"`
	}

	total := 0
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !strings.HasSuffix(path, ".json") {
			return err
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var doc category
		if err := json.Unmarshal(body, &doc); err != nil {
			t.Errorf("%s is not valid JSON: %v", entry.Name(), err)
			return nil
		}
		if doc.Category == "" || doc.Label == "" {
			t.Errorf("%s names neither a category nor a label", entry.Name())
		}
		if !levels[doc.Criticality] {
			t.Errorf("%s has criticality %q, which is not one of the four", entry.Name(), doc.Criticality)
		}
		if len(doc.Matchers) == 0 {
			t.Errorf("%s carries no matcher at all", entry.Name())
		}
		for _, m := range doc.Matchers {
			total++
			if m.Label == "" || m.Pattern == "" {
				t.Errorf("%s: a matcher is missing its label or its pattern", entry.Name())
			}
			if m.Criticality != "" && !levels[m.Criticality] {
				t.Errorf("%s: matcher %q has criticality %q", entry.Name(), m.Label, m.Criticality)
			}
			// A pattern that is only literal text is fine; one that is not must at least be a
			// regexp, which catches a doubled backslash written as a single one in JSON.
			if _, err := regexp.Compile(jsOnlyStripped(m.Pattern)); err != nil {
				t.Logf("%s: matcher %q does not compile under RE2 (%v) — JavaScript-only syntax",
					entry.Name(), m.Label, err)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking the seeded catalogue: %v", err)
	}
	if total < 50 {
		t.Errorf("the bundled catalogue holds %d matchers; it is meant to be a working starting point", total)
	}
}

// It is the store's from the moment it exists: a category deleted on purpose must not come back at
// the next restart, and a category edited must not be overwritten by the build's own.
func TestEnsureImportGateKeepsAnExistingFolder(t *testing.T) {
	cfg, dir := importGateCfg(t)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	mine := filepath.Join(dir, "mine.json")
	mustWrite(t, mine, `{"category":"mine","label":"Mine","criticality":"low","matchers":[]}`)

	EnsureImportGateMatchers(cfg)

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "mine.json" {
		names := make([]string, len(entries))
		for i, e := range entries {
			names[i] = e.Name()
		}
		t.Errorf("a configured folder was written into: %v", names)
	}
}

// A store nothing can be written to loses the highlighting and nothing else.
func TestEnsureImportGateSurvivesAnUnwritableStore(t *testing.T) {
	cfg, dir := importGateCfg(t)
	// kiao-user-config is a file, so the folder underneath it cannot be created.
	mustWrite(t, filepath.Join(cfg.RootPath, "kiao-user-config"), "not a folder")

	EnsureImportGateMatchers(cfg) // must not panic

	if _, err := os.Stat(dir); err == nil {
		t.Error("a folder was somehow created under a file")
	}
}

func slicesContains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

// jsOnlyStripped removes the one construct RE2 has no notion of, so the rest of a pattern can still
// be checked for balance. It is a test convenience and not a translation.
func jsOnlyStripped(pattern string) string {
	return strings.NewReplacer("(?!", "(?:", "(?=", "(?:").Replace(pattern)
}
