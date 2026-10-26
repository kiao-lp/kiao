package content

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMatchedSuffixAndMainFileName(t *testing.T) {
	cases := []struct {
		name       string
		wantSuffix string
		wantMain   string
		wantIsSub  bool
	}{
		{"report.pdf.index.txt", ".index.txt", "report.pdf", true},
		{"report.pdf.index.md", ".index.md", "report.pdf", true},
		{"report.pdf.blog.md", ".blog.md", "report.pdf", true},
		{"notes.md", "", "", false},
		{"archive.tar.gz", "", "", false},
		// A bare suffix has an empty main name but is still recognised as a subsidiary.
		{".index.md", ".index.md", "", true},
		// .index.md wins over nothing; ordering is by the suffix list, first match returned.
		{"x.blog.md", ".blog.md", "x", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := matchedSuffix(c.name); got != c.wantSuffix {
				t.Errorf("matchedSuffix(%q) = %q, want %q", c.name, got, c.wantSuffix)
			}
			main, ok := mainFileName(c.name)
			if ok != c.wantIsSub || main != c.wantMain {
				t.Errorf("mainFileName(%q) = (%q, %v), want (%q, %v)", c.name, main, ok, c.wantMain, c.wantIsSub)
			}
		})
	}
}

func TestSubsidiaryPaths(t *testing.T) {
	got := subsidiaryPaths(filepath.Join("/data", "sub", "report.pdf"))
	want := []string{
		filepath.Join("/data", "sub", "report.pdf.index.md"),
		filepath.Join("/data", "sub", "report.pdf.index.csv"),
		filepath.Join("/data", "sub", "report.pdf.index.txt"),
		filepath.Join("/data", "sub", "report.pdf.blog.md"),
	}
	if len(got) != len(want) {
		t.Fatalf("subsidiaryPaths len = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("subsidiaryPaths[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestDeleteSubsidiaries(t *testing.T) {
	root := t.TempDir()
	main := filepath.Join(root, "report.pdf")
	mustWrite(t, main, "main\n")
	mustWrite(t, main+".index.txt", "idx\n")
	mustWrite(t, main+".blog.md", "blog\n")
	// .index.md intentionally absent — deletion must tolerate missing companions.

	deleteSubsidiaries(main)

	if _, err := os.Stat(main); err != nil {
		t.Errorf("main file should survive deleteSubsidiaries, stat err = %v", err)
	}
	for _, sub := range []string{".index.txt", ".index.md", ".blog.md"} {
		if _, err := os.Stat(main + sub); !os.IsNotExist(err) {
			t.Errorf("subsidiary %s should be gone, stat err = %v", sub, err)
		}
	}
}

// A content file owns its settings sidecar: deleting the one deletes the other, or the store keeps
// a `.config.json` naming an article that is gone.
func TestDeleteSidecars(t *testing.T) {
	root := t.TempDir()
	main := filepath.Join(root, "article.md")
	mustWrite(t, main, "body\n")
	mustWrite(t, main+".config.json", "{}\n")
	neighbour := filepath.Join(root, "podcast.ttst.md.config.json")
	mustWrite(t, neighbour, "{}\n")

	deleteSidecars(main)

	if _, err := os.Stat(main); err != nil {
		t.Errorf("main file should survive deleteSidecars, stat err = %v", err)
	}
	if _, err := os.Stat(main + ".config.json"); !os.IsNotExist(err) {
		t.Errorf("sidecar should be gone, stat err = %v", err)
	}
	// Only the named file's own sidecar goes — never another item's.
	if _, err := os.Stat(neighbour); err != nil {
		t.Errorf("another item's sidecar must be untouched, stat err = %v", err)
	}
}

func TestMoveSubsidiaries(t *testing.T) {
	root := t.TempDir()
	oldMain := filepath.Join(root, "old.pdf")
	newMain := filepath.Join(root, "sub", "new.pdf")
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, oldMain+".index.txt", "idx\n")
	mustWrite(t, oldMain+".blog.md", "blog\n")

	moveSubsidiaries(oldMain, newMain)

	for _, sub := range []string{".index.txt", ".blog.md"} {
		if _, err := os.Stat(oldMain + sub); !os.IsNotExist(err) {
			t.Errorf("old subsidiary %s should be moved away, stat err = %v", sub, err)
		}
		if _, err := os.Stat(newMain + sub); err != nil {
			t.Errorf("new subsidiary %s should exist, stat err = %v", sub, err)
		}
	}
	// The absent .index.md must not be conjured at the destination.
	if _, err := os.Stat(newMain + ".index.md"); !os.IsNotExist(err) {
		t.Errorf("missing companion should not appear at destination")
	}
}

func TestCompanionsForMainFile(t *testing.T) {
	root := t.TempDir()
	main := filepath.Join(root, "report.pdf")
	mustWrite(t, main, "main\n")
	mustWrite(t, main+".index.md", "idx\n")
	// .index.txt and .blog.md absent.

	fam := companionsFor(main)
	// family = main entry + one entry per subsidiary suffix
	if want := len(subsidiarySuffixes) + 1; len(fam) != want {
		t.Fatalf("companionsFor len = %d, want %d", len(fam), want)
	}
	byName := map[string]FileCompanionDto{}
	for _, c := range fam {
		byName[c.Name] = c
	}
	if m := byName["report.pdf"]; m.Suffix != "" || !m.Exists {
		t.Errorf("main entry mismatch: %+v", m)
	}
	if c := byName["report.pdf.index.md"]; c.Suffix != ".index.md" || !c.Exists {
		t.Errorf(".index.md entry should exist: %+v", c)
	}
	if c := byName["report.pdf.index.txt"]; c.Suffix != ".index.txt" || c.Exists {
		t.Errorf(".index.txt entry should be marked absent: %+v", c)
	}
	if c := byName["report.pdf.blog.md"]; c.Suffix != ".blog.md" || c.Exists {
		t.Errorf(".blog.md entry should be marked absent: %+v", c)
	}
}

// TestCompanionsForSubsidiaryInput verifies that passing a companion path resolves the family
// back to the main file (the input name is normalised via mainFileName).
func TestCompanionsForSubsidiaryInput(t *testing.T) {
	root := t.TempDir()
	main := filepath.Join(root, "report.pdf")
	mustWrite(t, main, "main\n")
	mustWrite(t, main+".index.txt", "idx\n")

	// Ask about the .index.txt companion; the family should still be keyed off "report.pdf".
	fam := companionsFor(main + ".index.txt")
	if want := len(subsidiarySuffixes) + 1; len(fam) != want {
		t.Fatalf("companionsFor(subsidiary) len = %d, want %d", len(fam), want)
	}
	if fam[0].Name != "report.pdf" || fam[0].Suffix != "" || !fam[0].Exists {
		t.Errorf("main entry from subsidiary input mismatch: %+v", fam[0])
	}
}

// TestCompanionsForOrphanCompanion verifies a companion whose main file does not exist still
// lists the (absent) main entry.
func TestCompanionsForOrphanCompanion(t *testing.T) {
	root := t.TempDir()
	orphan := filepath.Join(root, "ghost.pdf.blog.md")
	mustWrite(t, orphan, "blog\n")

	fam := companionsFor(orphan)
	if fam[0].Name != "ghost.pdf" || fam[0].Exists {
		t.Errorf("orphan main entry should be absent: %+v", fam[0])
	}
	var blog FileCompanionDto
	for _, c := range fam {
		if c.Suffix == ".blog.md" {
			blog = c
		}
	}
	if !blog.Exists {
		t.Errorf(".blog.md companion should be marked present: %+v", blog)
	}
}
