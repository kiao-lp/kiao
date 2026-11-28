package filesystem

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"kiao/agentic-resource-manager/adapters/apm"
	"kiao/agentic-resource-manager/adapters/gitcli"
	"kiao/agentic-resource-manager/core/entities"
)

func fixture(t *testing.T) (*Store, *entities.Agent) {
	t.Helper()
	root := t.TempDir()
	fake := filepath.Join(t.TempDir(), "apm")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\nif [ \"$1\" = install ]; then printf 'lockfile_version: 1\\n' > apm.lock.yaml; fi\n"), 0755); err != nil {
		t.Fatal(err)
	}
	store := New(root, gitcli.Controller{}, apm.Compiler{Binary: fake}, nil)
	a := &entities.Agent{ID: "agent-id", Name: "Coder", Harness: entities.HarnessCodex, Model: "model-one", Effort: "high", Instructions: "First instructions", CreatedAt: time.Now().UTC(), Revision: 1}
	if err := store.CreateAgent(context.Background(), a, "owner"); err != nil {
		t.Fatal(err)
	}
	return store, a
}

func TestPublicationsRetainCommitAndConfiguration(t *testing.T) {
	s, a := fixture(t)
	ctx := context.Background()
	first, err := s.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", entities.BumpMajor)
	if err != nil {
		t.Fatal(err)
	}
	if first.Published == nil || first.Published.Version != "1.0.0" || len(first.Published.Commit) != 40 || first.Published.LockDigest == "" {
		t.Fatalf("incomplete publication: %+v", first.Published)
	}
	oldCommit := first.Published.Commit
	if first.HasUnpublishedChanges {
		t.Fatal("newly published repository reports unpublished changes")
	}
	same, err := s.PatchAgent(ctx, a.ID, entities.AgentPatch{Instructions: &first.Instructions}, &first.Revision, "owner")
	if err != nil || same.HasUnpublishedChanges || same.Revision != first.Revision {
		t.Fatalf("unchanged patch: %+v %v", same, err)
	}
	if _, err := s.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", ""); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("publishing the same draft: %v", err)
	}
	model, instructions := "model-two", "Second instructions"
	if _, err = s.PatchAgent(ctx, a.ID, entities.AgentPatch{Model: &model, Instructions: &instructions}, &first.Revision, "owner"); err != nil {
		t.Fatal(err)
	}
	second, err := s.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if second.Published.Version != "1.0.1" || second.Published.Commit == oldCommit {
		t.Fatalf("second publication: %+v", second.Published)
	}
	versions, err := s.AgentVersions(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 || versions[0].Model != "model-one" || versions[0].Instructions != "First instructions" || versions[0].Effort != "high" || versions[0].Commit != oldCommit {
		t.Fatalf("history changed: %+v", versions)
	}
	fresh := New(s.AgentRoot, s.gitController, s.compiler, s.cache)
	loaded, err := fresh.FindAgent(ctx, a.ID)
	if err != nil || loaded.Published.Commit != second.Published.Commit {
		t.Fatalf("restart: %+v %v", loaded, err)
	}
}

func TestPublicationStatusFollowsGitFiles(t *testing.T) {
	s, a := fixture(t)
	ctx := context.Background()
	dir := filepath.Join(s.AgentRoot, a.Repository)
	assertStatus := func(want bool) {
		t.Helper()
		agents, err := s.ListAgents(ctx)
		if err != nil || len(agents) != 1 || agents[0].HasUnpublishedChanges != want {
			t.Fatalf("want unpublished changes %t, got %+v %v", want, agents, err)
		}
	}
	git := func(args ...string) {
		t.Helper()
		if _, err := s.git(ctx, dir, args...); err != nil {
			t.Fatal(err)
		}
	}
	commit := func(message string) {
		t.Helper()
		git("-c", "user.name=KIAO", "-c", "user.email=kiao@localhost", "commit", "-m", message)
	}
	git("add", "--all")
	commit("Initialize draft")
	assertStatus(true)
	if _, err := s.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", ""); err != nil {
		t.Fatal(err)
	}
	ignored := filepath.Join(dir, "apm_modules")
	if err := os.Mkdir(ignored, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ignored, "module"), []byte("module"), 0644); err != nil {
		t.Fatal(err)
	}
	assertStatus(false)
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("Agent details"), 0644); err != nil {
		t.Fatal(err)
	}
	assertStatus(true)
	git("add", "README.md")
	assertStatus(true)
	commit("Document the agent")
	assertStatus(true)
	git("rm", "README.md")
	commit("Remove draft documentation")
	assertStatus(false)
}

func TestDeletionRequiresCurrentConfirmation(t *testing.T) {
	s, a := fixture(t)
	ctx := context.Background()
	if _, err := s.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", ""); err != nil {
		t.Fatal(err)
	}
	status, err := s.DeletionStatus(ctx, a.ID)
	if err != nil || !status.NoRemote {
		t.Fatalf("status: %+v %v", status, err)
	}
	if err = s.DeleteAgent(ctx, a.ID, "", "owner"); err == nil {
		t.Fatal("deleted without confirmation")
	}
	name := "Changed"
	if _, err = s.PatchAgent(ctx, a.ID, entities.AgentPatch{Name: &name}, nil, "owner"); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteAgent(ctx, a.ID, status.Confirmation, "owner"); err == nil {
		t.Fatal("accepted stale confirmation")
	}
	status, err = s.DeletionStatus(ctx, a.ID)
	if err != nil || !status.Dirty {
		t.Fatalf("status: %+v %v", status, err)
	}
	if err = s.DeleteAgent(ctx, a.ID, status.Confirmation, "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.FindAgent(ctx, a.ID); err == nil {
		t.Fatal("agent survived deletion")
	}
}

func TestResourceFilesStayInsideRepository(t *testing.T) {
	s, _ := fixture(t)
	ctx := context.Background()
	resources, err := s.ListResources(ctx)
	if err != nil || len(resources) != 1 {
		t.Fatalf("list: %v %v", resources, err)
	}
	name := resources[0].Name
	for _, path := range []string{"../secret", ".git/config", "node_modules/x", "/etc/passwd", "..\\secret"} {
		if err := s.WriteResourceFile(ctx, name, entities.ResourceFile{Path: path, Content: "changed"}); err == nil {
			t.Errorf("accepted %q", path)
		}
	}
	outside := t.TempDir()
	if err = os.Symlink(outside, filepath.Join(s.AgentRoot, name, "escape")); err != nil {
		t.Fatal(err)
	}
	if err = s.WriteResourceFile(ctx, name, entities.ResourceFile{Path: "escape/file", Content: "changed"}); err == nil {
		t.Fatal("followed symlink")
	}
}

func TestAPMFailureDoesNotPublish(t *testing.T) {
	s, a := fixture(t)
	ctx := context.Background()
	compiler := s.compiler
	project := filepath.Join(s.AgentRoot, a.Repository)
	manifest := filepath.Join(project, manifestFile)
	original, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.git(ctx, project, "add", manifestFile); err != nil {
		t.Fatal(err)
	}
	draft := append(original, []byte("\n# Unstaged draft change\n")...)
	if err := os.WriteFile(manifest, draft, 0600); err != nil {
		t.Fatal(err)
	}
	indexPath := filepath.Join(project, ".git", "index")
	index, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	fail := filepath.Join(t.TempDir(), "apm")
	if err := os.WriteFile(fail, []byte("#!/bin/sh\nprintf 'lockfile_version: 1\\n' > apm.lock.yaml\nif [ \"$1\" = compile ]; then exit 1; fi\n"), 0755); err != nil {
		t.Fatal(err)
	}
	s.compiler = apm.Compiler{Binary: fail}
	if _, err := s.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", entities.BumpMinor); err == nil {
		t.Fatal("published despite failed APM resolution")
	}
	versions, err := s.AgentVersions(ctx, a.ID)
	if err != nil || len(versions) != 0 {
		t.Fatalf("failed publication retained: %v %v", versions, err)
	}
	for path, expected := range map[string][]byte{manifest: draft, indexPath: index} {
		if actual, err := os.ReadFile(path); err != nil || !bytes.Equal(actual, expected) {
			t.Fatalf("failed publication changed %s: %v", path, err)
		}
	}
	for _, name := range []string{"apm.lock.yaml", "kiao.lock.json"} {
		if _, err := os.Stat(filepath.Join(project, name)); !os.IsNotExist(err) {
			t.Fatalf("failed publication wrote %s: %v", name, err)
		}
	}
	s.compiler = compiler
	retried, err := s.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", entities.BumpMinor)
	if err != nil || retried.Published.Version != "0.1.0" {
		t.Fatalf("retry after failed publication: %+v %v", retried, err)
	}
}

func TestIncompleteDraftKeepsPublishedPackageReadable(t *testing.T) {
	s, a := fixture(t)
	ctx := context.Background()
	published, err := s.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", "")
	if err != nil {
		t.Fatal(err)
	}
	commit := published.Published.Commit
	name := "agent-coder"
	if err = s.WriteResourceFile(ctx, name, entities.ResourceFile{Path: definitionFile(name), Content: "incomplete front matter"}); err != nil {
		t.Fatal(err)
	}
	draft, err := s.FindAgent(ctx, a.ID)
	if err != nil || draft.DraftError == "" || draft.Published.Commit != commit {
		t.Fatalf("draft: %+v %v", draft, err)
	}
	if _, err = s.AgentPackage(ctx, a.ID, commit); err != nil {
		t.Fatal(err)
	}
	if _, err = s.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", ""); err == nil {
		t.Fatal("published an incomplete source")
	}
}

func TestSourceEditsCheckRevisionAndPreserveAgentIdentity(t *testing.T) {
	s, _ := fixture(t)
	ctx := context.Background()
	name := "agent-coder"
	file, err := s.ReadResourceFile(ctx, name, definitionFile(name))
	if err != nil {
		t.Fatal(err)
	}
	original := *file
	file.Content += "\n"
	if err = s.WriteResourceFile(ctx, name, *file); err != nil {
		t.Fatal(err)
	}
	if err = s.WriteResourceFile(ctx, name, original); err == nil {
		t.Fatal("overwrote a newer source revision")
	}
	if err = s.WriteResourceFile(ctx, name, entities.ResourceFile{Path: configurationFile, Content: `{"id":"different"}`}); err == nil {
		t.Fatal("changed stable agent identity through raw source editing")
	}
}

func TestAPMPublicationAfterClone(t *testing.T) {
	source := os.Getenv("KIAO_APM_TEST_PROJECT")
	if source == "" {
		t.Skip("set a published resource repository for the APM clone check")
	}
	ctx := context.Background()
	parent := t.TempDir()
	remote := filepath.Join(t.TempDir(), "cloned-project.git")
	if _, err := (gitcli.Controller{}).Run(ctx, parent, "clone", "--quiet", "--bare", "--no-hardlinks", source, remote); err != nil {
		t.Fatal(err)
	}
	store := New(parent, gitcli.Controller{}, apm.Compiler{Binary: "apm"}, nil)
	if _, err := store.ImportAgent(ctx, remote, nil); err != nil {
		t.Fatal(err)
	}

	list, err := store.ListAgents(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("cloned catalogue: %v %v", list, err)
	}
	first := list[0].Published
	instructions := "Instructions from the cloned project."
	if _, err = store.PatchAgent(ctx, list[0].ID, entities.AgentPatch{Instructions: &instructions}, nil, "test"); err != nil {
		t.Fatal(err)
	}
	published, err := store.PublishAgent(ctx, list[0].ID, nil, time.Now().UTC(), "test", "", "")
	var warning *entities.PushConfirmation
	if errors.As(err, &warning) {
		published, err = store.PublishAgent(ctx, list[0].ID, nil, time.Now().UTC(), "test", warning.Token, "")
	}
	if err != nil {
		t.Fatal(err)
	}
	previous, _ := entities.ParseReleaseVersion(first.Version)
	current, _ := entities.ParseReleaseVersion(published.Published.Version)
	if published.Published.Commit == first.Commit || current.Compare(previous) <= 0 || published.Published.Instructions != instructions {
		t.Fatalf("new publication: %+v", published.Published)
	}
	versions, err := store.AgentVersions(ctx, list[0].ID)
	if err != nil || len(versions) < 2 || versions[len(versions)-2].Commit != first.Commit ||
		versions[len(versions)-2].Instructions != first.Instructions {
		t.Fatalf("previous publication was not retained: %v", err)
	}
	bundle, err := store.AgentPackage(ctx, list[0].ID, published.Published.Commit)
	if err != nil || len(bundle.Files["deployment/apm.lock.yaml"]) == 0 {
		t.Fatalf("could not restore the newly published lock: %v", err)
	}
}
