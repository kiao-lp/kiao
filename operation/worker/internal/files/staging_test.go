package files

import (
	"errors"
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCreateStagingOpensAnEmptyDirectoryUnderTheStagingRoot(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	staging, err := svc.createStaging()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(staging.Path, core.StagingDirName+"/"+stagingIDPrefix) {
		t.Errorf("staging path = %q, want one under %s/%s", staging.Path, core.StagingDirName, stagingIDPrefix)
	}
	info, err := os.Stat(filepath.Join(root, staging.Path))
	if err != nil || !info.IsDir() {
		t.Fatalf("the staging area should be a directory on disk: %v", err)
	}

	// Two uploads at once are two areas: an id that could collide would have one review deleting
	// the other's files.
	second, err := svc.createStaging()
	if err != nil {
		t.Fatal(err)
	}
	if second.Path == staging.Path {
		t.Errorf("two staging areas share the path %q", staging.Path)
	}
}

// In production the store root IS a git work tree. An upload waiting to be reviewed must not reach
// the Source Control panel, so the staging root hides itself the way the state directory does.
func TestCreateStagingHidesTheStagingRootFromGit(t *testing.T) {
	root := t.TempDir()
	if _, err := newTestService(root).createStaging(); err != nil {
		t.Fatal(err)
	}

	body, err := os.ReadFile(filepath.Join(root, core.StagingDirName, ".gitignore"))
	if err != nil {
		t.Fatalf("the staging root should carry a .gitignore: %v", err)
	}
	if strings.TrimSpace(string(body)) != "*" {
		t.Errorf(".gitignore = %q, want everything ignored", body)
	}
}

// The staging root is machinery: a listing of the store must not show a folder of files nobody has
// accepted, while a listing of a staging area — the review's own — has to work like any other.
func TestListHidesTheStagingRootButNotWhatIsInIt(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	staging, err := svc.createStaging()
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "kept.md"), "content\n")
	mustWrite(t, filepath.Join(root, staging.Path, "arrived.md"), "content\n")

	entries, err := svc.list("")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Path == core.StagingDirName {
			t.Fatalf("the store listing shows %q", core.StagingDirName)
		}
	}

	inside, err := svc.list(staging.Path)
	if err != nil {
		t.Fatal(err)
	}
	if len(inside) != 1 || inside[0].Path != staging.Path+"/arrived.md" {
		t.Errorf("listing the staging area = %+v, want the uploaded file", inside)
	}
}

func TestDiscardStagingRemovesTheAreaAndWhatIsLeftInIt(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	staging, err := svc.createStaging()
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, staging.Path, "sub", "rejected.pdf"), "pdf\n")

	if err := svc.discardStaging(staging.Path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, staging.Path)); !os.IsNotExist(err) {
		t.Errorf("the staging area is still there: %v", err)
	}
	// The root itself stays: the next upload writes into it, and its .gitignore is still wanted.
	if _, err := os.Stat(filepath.Join(root, core.StagingDirName)); err != nil {
		t.Errorf("the staging root should survive one area being discarded: %v", err)
	}
}

// A recursive delete with no confirmation in front of it may only ever reach what this service
// minted — otherwise the endpoint is "remove any folder of the store, silently".
func TestDiscardStagingRefusesAnythingThatIsNotAStagingArea(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	if _, err := svc.createStaging(); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "units", "lesson.md"), "content\n")

	for _, p := range []string{
		"units",                              // an ordinary folder of the store
		"",                                   // the store root
		core.StagingDirName,                  // the staging root, which holds every other upload
		core.StagingDirName + "/handwritten", // a folder in it this service did not mint
	} {
		if err := svc.discardStaging(p); !errors.Is(err, ErrNotStaging) {
			t.Errorf("discardStaging(%q) = %v, want ErrNotStaging", p, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "units", "lesson.md")); err != nil {
		t.Errorf("a refused discard must not have removed anything: %v", err)
	}
}

// An upload the browser was closed on leaves files in a folder nobody can see. The next upload is
// when somebody is there to pay for the sweep.
func TestCreateStagingSweepsAreasNobodyCameBackFor(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)

	stale, err := svc.createStaging()
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, stale.Path, "forgotten.pdf"), "pdf\n")
	old := time.Now().Add(-stagingMaxAge - time.Hour)
	if err := os.Chtimes(filepath.Join(root, stale.Path), old, old); err != nil {
		t.Fatal(err)
	}
	fresh, err := svc.createStaging()
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.createStaging(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, stale.Path)); !os.IsNotExist(err) {
		t.Errorf("the stale staging area survived the sweep: %v", err)
	}
	// And the one that is merely open is not: a sweep that reached an upload in flight would delete
	// the files being written into it.
	if _, err := os.Stat(filepath.Join(root, fresh.Path)); err != nil {
		t.Errorf("the sweep took an area that is still being used: %v", err)
	}
}

// Importing is a moveBatch out of the staging area, and this is the property the whole feature
// rests on: the index a document was converted into is a subsidiary, so it travels with it and the
// review never has to name it.
func TestMoveOutOfStagingTakesTheIndexWithTheDocument(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	staging, err := svc.createStaging()
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, staging.Path, "rapport.pdf"), "pdf\n")
	mustWrite(t, filepath.Join(root, staging.Path, "rapport.pdf.index.md"), "# Rapport\n")
	if err := svc.createFolder("archive"); err != nil {
		t.Fatal(err)
	}

	_, err = svc.moveBatch(MoveBatchRequestDto{Items: []MoveItemDto{
		{From: staging.Path + "/rapport.pdf", To: "archive/rapport.pdf"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{"archive/rapport.pdf", "archive/rapport.pdf.index.md"} {
		if _, err := os.Stat(filepath.Join(root, want)); err != nil {
			t.Errorf("%s should have been imported: %v", want, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, staging.Path, "rapport.pdf.index.md")); !os.IsNotExist(err) {
		t.Errorf("the index was left behind in the staging area")
	}
}
