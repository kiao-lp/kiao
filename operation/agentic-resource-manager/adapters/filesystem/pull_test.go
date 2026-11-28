package filesystem

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kiao/agentic-resource-manager/adapters/cache"
	"kiao/agentic-resource-manager/adapters/gitcli"
	"kiao/agentic-resource-manager/core/entities"
)

func TestPullFastForwardsToRemoteCommits(t *testing.T) {
	ctx := context.Background()
	remote := filepath.Join(t.TempDir(), "shared-agent.git")
	if _, err := (gitcli.Controller{}).Run(ctx, "", "init", "--bare", "-b", "main", remote); err != nil {
		t.Fatal(err)
	}
	source, a := fixture(t)
	if status, err := source.Remote(ctx, a.ID); err != nil || status.HasRemote || status.Behind != 0 {
		t.Fatalf("local repository: %+v %v", status, err)
	}
	if _, err := source.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", entities.BumpMajor); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(source.AgentRoot, a.Repository)
	if _, err := source.git(ctx, dir, "remote", "add", "origin", remote); err != nil {
		t.Fatal(err)
	}
	if _, err := source.git(ctx, dir, "push", "origin", "HEAD", "--tags"); err != nil {
		t.Fatal(err)
	}
	clone := New(t.TempDir(), source.gitController, source.compiler, cache.Directory{Root: t.TempDir()})
	imported, err := clone.ImportAgent(ctx, remote, nil)
	if err != nil {
		t.Fatal(err)
	}
	if status, err := clone.Remote(ctx, imported.ID); err != nil || !status.HasRemote || status.Behind != 0 || status.Problem != "" {
		t.Fatalf("fresh clone: %+v %v", status, err)
	}
	instructions := "Instructions from the remote."
	if _, err = source.PatchAgent(ctx, a.ID, entities.AgentPatch{Instructions: &instructions}, nil, "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err = source.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", entities.BumpPatch); err != nil {
		t.Fatal(err)
	}
	status, err := clone.Remote(ctx, imported.ID)
	if err != nil || !status.HasRemote || status.Behind != 1 || status.Problem != "" {
		t.Fatalf("remote ahead: %+v %v", status, err)
	}
	pulled, err := clone.PullAgent(ctx, imported.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pulled.Instructions != instructions || pulled.Published.Version != "1.0.1" {
		t.Fatalf("pulled draft: %+v", pulled)
	}
	if status, err = clone.Remote(ctx, pulled.ID); err != nil || status.Behind != 0 {
		t.Fatalf("after pull: %+v %v", status, err)
	}
	if _, err = clone.PullAgent(ctx, pulled.ID); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("pull without remote changes: %v", err)
	}
}

func TestPullReportsWhyItCannotFastForward(t *testing.T) {
	ctx := context.Background()
	remote := filepath.Join(t.TempDir(), "shared-agent.git")
	if _, err := (gitcli.Controller{}).Run(ctx, "", "init", "--bare", "-b", "main", remote); err != nil {
		t.Fatal(err)
	}
	source, a := fixture(t)
	if _, err := source.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", entities.BumpMajor); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(source.AgentRoot, a.Repository)
	if _, err := source.git(ctx, dir, "remote", "add", "origin", remote); err != nil {
		t.Fatal(err)
	}
	if _, err := source.git(ctx, dir, "push", "origin", "HEAD", "--tags"); err != nil {
		t.Fatal(err)
	}
	clone := New(t.TempDir(), source.gitController, source.compiler, cache.Directory{Root: t.TempDir()})
	imported, err := clone.ImportAgent(ctx, remote, nil)
	if err != nil {
		t.Fatal(err)
	}
	edited := "Uncommitted local instructions."
	if _, err = clone.PatchAgent(ctx, imported.ID, entities.AgentPatch{Instructions: &edited}, nil, "owner"); err != nil {
		t.Fatal(err)
	}
	instructions := "Instructions from the remote."
	if _, err = source.PatchAgent(ctx, a.ID, entities.AgentPatch{Instructions: &instructions}, nil, "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err = source.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", entities.BumpPatch); err != nil {
		t.Fatal(err)
	}
	_, err = clone.PullAgent(ctx, imported.ID)
	if err == nil || !strings.Contains(err.Error(), "would overwrite local changes") {
		t.Fatalf("conflicting pull: %v", err)
	}
}

func TestRemoteProblemExplainsAnUnreadableRemote(t *testing.T) {
	ctx := context.Background()
	source, a := fixture(t)
	dir := filepath.Join(source.AgentRoot, a.Repository)
	if _, err := source.git(ctx, dir, "remote", "add", "origin", filepath.Join(t.TempDir(), "missing.git")); err != nil {
		t.Fatal(err)
	}
	status, err := source.Remote(ctx, a.ID)
	if err != nil || !status.HasRemote || status.Behind != 0 || !strings.Contains(status.Problem, "could not") {
		t.Fatalf("unreadable remote: %+v %v", status, err)
	}
	if _, err = source.PullAgent(ctx, a.ID); err == nil {
		t.Fatal("pulling an unreadable remote succeeded")
	}
}
