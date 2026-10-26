package skills

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeCatalog(t *testing.T, dir string, entries []catalogEntry) {
	t.Helper()
	data, err := json.Marshal(map[string]any{"skills": entries})
	if err != nil {
		t.Fatal(err)
	}
	writeSourceFile(t, dir, CatalogManifest, string(data))
}

func writeSourceFile(t *testing.T, dir, name, content string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func additionalEntry() catalogEntry {
	return catalogEntry{Name: "lessons", Plugin: "lesson-edit", Source: "reference/extra-skills/lessons/"}
}

func TestLoadComposesEmbeddedAndAdditionalSkills(t *testing.T) {
	dir := t.TempDir()
	entry := additionalEntry()
	writeCatalog(t, dir, []catalogEntry{entry})
	writeSourceFile(t, dir, "lessons/SKILL.md", "---\nname: lessons\ndescription: teaching\n---\n\n# Lessons\n")
	writeSourceFile(t, dir, "lessons/references/format.md", "format")
	writeSourceFile(t, dir, "lessons/.editorconfig", "root = true")
	writeSourceFile(t, dir, "not-declared/SKILL.md", "not delivered")

	found, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != len(All())+1 {
		t.Fatalf("got %d skills, want embedded + 1", len(found))
	}
	for i, skill := range found {
		if i > 0 && found[i-1].Name >= skill.Name {
			t.Error("catalogue is not sorted")
		}
		if skill.Name != entry.Name {
			continue
		}
		if skill.Plugin != entry.Plugin || skill.Source != entry.Source {
			t.Errorf("additional metadata = %+v", skill)
		}
		for _, path := range []string{Manifest, "references/format.md", ".editorconfig"} {
			if _, err := fs.ReadFile(skill.Files, path); err != nil {
				t.Errorf("cannot read companion %s: %v", path, err)
			}
		}
	}
}

func TestLoadEmbeddedOnlyOrExplicitlyEmptyAdditions(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, []catalogEntry{})
	for _, path := range []string{"", dir} {
		found, err := Load(path)
		if err != nil || len(found) != len(All()) {
			t.Errorf("Load(%q) = %d skills, %v", path, len(found), err)
		}
	}
}

func TestLoadRejectsIncompleteOrAmbiguousSources(t *testing.T) {
	for _, test := range []struct {
		name string
		edit func(*testing.T, string)
	}{
		{"missing catalogue", func(t *testing.T, dir string) { os.Remove(filepath.Join(dir, CatalogManifest)) }},
		{"malformed JSON", func(t *testing.T, dir string) { writeSourceFile(t, dir, CatalogManifest, `{"skills":[`) }},
		{"missing array", func(t *testing.T, dir string) { writeSourceFile(t, dir, CatalogManifest, `{}`) }},
		{"null array", func(t *testing.T, dir string) { writeSourceFile(t, dir, CatalogManifest, `{"skills":null}`) }},
		{"unknown field", func(t *testing.T, dir string) { writeSourceFile(t, dir, CatalogManifest, `{"skills":[],"skill":[]}`) }},
		{"trailing JSON", func(t *testing.T, dir string) { writeSourceFile(t, dir, CatalogManifest, `{"skills":[]} {}`) }},
		{"embedded conflict", func(t *testing.T, dir string) {
			entry := additionalEntry()
			entry.Name = "graph"
			writeCatalog(t, dir, []catalogEntry{entry})
		}},
		{"additional conflict", func(t *testing.T, dir string) {
			writeCatalog(t, dir, []catalogEntry{additionalEntry(), additionalEntry()})
		}},
		{"path traversal", func(t *testing.T, dir string) {
			entry := additionalEntry()
			entry.Name = "../lessons"
			writeCatalog(t, dir, []catalogEntry{entry})
		}},
		{"no plugin", func(t *testing.T, dir string) {
			entry := additionalEntry()
			entry.Plugin = ""
			writeCatalog(t, dir, []catalogEntry{entry})
		}},
		{"no provenance", func(t *testing.T, dir string) {
			entry := additionalEntry()
			entry.Source = ""
			writeCatalog(t, dir, []catalogEntry{entry})
		}},
		{"multiline provenance", func(t *testing.T, dir string) {
			entry := additionalEntry()
			entry.Source = "source\nother"
			writeCatalog(t, dir, []catalogEntry{entry})
		}},
		{"padded provenance", func(t *testing.T, dir string) {
			entry := additionalEntry()
			entry.Source = " source "
			writeCatalog(t, dir, []catalogEntry{entry})
		}},
		{"missing skill", func(t *testing.T, dir string) { os.RemoveAll(filepath.Join(dir, "lessons")) }},
		{"missing manifest", func(t *testing.T, dir string) { os.Remove(filepath.Join(dir, "lessons", Manifest)) }},
		{"invalid manifest", func(t *testing.T, dir string) {
			writeSourceFile(t, dir, "lessons/SKILL.md", "---\nname: renamed\n---\n")
		}},
		{"installation copy", func(t *testing.T, dir string) { writeSourceFile(t, dir, "lessons/.kiao-skill", "digest=abc") }},
		{"marker directory", func(t *testing.T, dir string) {
			if err := os.Mkdir(filepath.Join(dir, "lessons", ".kiao-skill"), 0o755); err != nil {
				t.Fatal(err)
			}
		}},
		{"broken companion symlink", func(t *testing.T, dir string) {
			if err := os.Symlink("absent", filepath.Join(dir, "lessons", "reference.md")); err != nil {
				t.Fatal(err)
			}
		}},
		{"symlink skill directory", func(t *testing.T, dir string) {
			if err := os.Rename(filepath.Join(dir, "lessons"), filepath.Join(dir, "moved")); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink("moved", filepath.Join(dir, "lessons")); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			writeCatalog(t, dir, []catalogEntry{additionalEntry()})
			writeSourceFile(t, dir, "lessons/SKILL.md", "---\nname: lessons\n---\n")
			test.edit(t, dir)
			if got, err := Load(dir); err == nil || got != nil {
				t.Fatalf("Load returned %d skills and %v; an error must never become a reduced catalogue", len(got), err)
			}
		})
	}
	for _, path := range []string{"relative", filepath.Join(t.TempDir(), "missing")} {
		if _, err := Load(path); err == nil {
			t.Errorf("Load(%s) succeeded", path)
		}
	}
}

func TestLoadNamesBothSidesOfAConflict(t *testing.T) {
	dir := t.TempDir()
	entry := additionalEntry()
	entry.Name = "graph"
	writeCatalog(t, dir, []catalogEntry{entry})
	_, err := Load(dir)
	if err == nil || !strings.Contains(err.Error(), "embedded catalogue") || !strings.Contains(err.Error(), filepath.Join(dir, CatalogManifest)) {
		t.Fatalf("conflict error = %v", err)
	}
}
