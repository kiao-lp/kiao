package filesystem

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kiao/agentic-resource-manager/adapters/cache"
	"kiao/agentic-resource-manager/adapters/gitcli"
	"kiao/agentic-resource-manager/core/entities"
)

func TestInitializeAgentRetriesAfterRejectedPush(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store := New(root, gitcli.Controller{}, nil, nil)
	remote := filepath.Join(t.TempDir(), "reviewer.git")
	if _, err := store.git(ctx, "", "init", "--bare", "-b", "trunk", remote); err != nil {
		t.Fatal(err)
	}
	hook := filepath.Join(remote, "hooks", "pre-receive")
	if err := os.WriteFile(hook, []byte("#!/bin/sh\nexit 1\n"), 0755); err != nil {
		t.Fatal(err)
	}
	draft := func(project string) (*entities.Agent, error) {
		return &entities.Agent{ID: "reviewer-id", Name: project, Harness: entities.HarnessCodex, Revision: 1}, nil
	}
	if _, err := store.ImportAgent(ctx, remote, draft); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("push rejection: %v", err)
	}
	if entries, err := os.ReadDir(root); err != nil || len(entries) != 0 {
		t.Fatalf("store after rejected push: %v %v", entries, err)
	}
	if refs, err := store.git(ctx, remote, "for-each-ref"); err != nil || len(refs) != 0 {
		t.Fatalf("remote after rejected push: %s %v", refs, err)
	}
	if err := os.Remove(hook); err != nil {
		t.Fatal(err)
	}
	agent, err := store.ImportAgent(ctx, remote, draft)
	if err != nil || agent.ID != "reviewer-id" {
		t.Fatalf("retry: %+v %v", agent, err)
	}
	status, err := store.DeletionStatus(ctx, agent.ID)
	if err != nil || status.Dirty || status.Unpushed || status.NoRemote {
		t.Fatalf("initial commit status: %+v %v", status, err)
	}
}

func TestCloneReleaseDeleteAndReinstall(t *testing.T) {
	source, a := fixture(t)
	ctx := context.Background()
	if _, err := source.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", entities.BumpMajor); err != nil {
		t.Fatal(err)
	}
	remote := filepath.Join(t.TempDir(), "custom-name.git")
	if _, err := source.git(ctx, "", "init", "--bare", "-b", "main", remote); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(source.AgentRoot, "agent-coder")
	if _, err := source.git(ctx, dir, "remote", "add", "origin", remote); err != nil {
		t.Fatal(err)
	}
	if _, err := source.git(ctx, dir, "push", "origin", "HEAD", "--tags"); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	store := New(root, source.gitController, source.compiler, cache.Directory{Root: t.TempDir()})
	agent, err := store.ImportAgent(ctx, remote, nil)
	if err != nil {
		t.Fatal(err)
	}
	if agent.ID != a.ID || agent.Project != "custom-name" || agent.Published.Version != "1.0.0" {
		t.Fatalf("cloned identity: %+v", agent)
	}
	if _, err = store.ImportAgent(ctx, remote, nil); err == nil {
		t.Fatal("accepted duplicate clone")
	}
	if _, err = store.git(ctx, filepath.Join(root, "custom-name"), "remote", "rename", "origin", "upstream"); err != nil {
		t.Fatal(err)
	}
	orders := "Instructions changed in Dashboard."
	if _, err = store.PatchAgent(ctx, a.ID, entities.AgentPatch{Instructions: &orders}, nil, ""); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "custom-name", ".apm", "agents", "agent-coder.agent.md"))
	if err != nil || !strings.Contains(string(data), orders) {
		t.Fatalf("working tree: %s %v", data, err)
	}
	before, err := store.DeletionStatus(ctx, a.ID)
	if err != nil || !before.Dirty || before.NoRemote {
		t.Fatalf("draft risk: %+v %v", before, err)
	}
	released, err := store.PublishAgent(ctx, a.ID, nil, time.Now(), "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	ref, err := source.git(ctx, remote, "rev-parse", "v1.0.1^{commit}")
	if err != nil || string(ref) != released.Published.Commit+"\n" {
		t.Fatalf("remote release: %s %v", ref, err)
	}
	status, err := store.DeletionStatus(ctx, a.ID)
	if err != nil || status.Dirty || status.Unpushed || status.NoRemote {
		t.Fatalf("released risk: %+v %v", status, err)
	}
	if _, err = store.AgentPackage(ctx, a.ID, released.Published.Commit); err != nil {
		t.Fatal(err)
	}
	if err = store.DeleteAgent(ctx, a.ID, status.Confirmation, ""); err != nil {
		t.Fatal(err)
	}
	if list, err := store.ListAgents(ctx); err != nil || len(list) != 0 {
		t.Fatalf("deleted catalogue: %v %v", list, err)
	}
	reinstalled, err := store.ImportAgent(ctx, remote, nil)
	if err != nil || reinstalled.ID != a.ID || reinstalled.Published.Commit != released.Published.Commit {
		t.Fatalf("reinstallation: %+v %v", reinstalled, err)
	}
	// Repositories cloned outside the API appear on the next read.
	if err = os.Rename(filepath.Join(root, "custom-name"), filepath.Join(root, "Clone manuel é")); err != nil {
		t.Fatal(err)
	}
	list, err := store.ListAgents(ctx)
	if err != nil || len(list) != 1 || list[0].ID != a.ID {
		t.Fatalf("manual discovery: %+v %v", list, err)
	}
	changed := "Committed locally."
	if _, err = store.PatchAgent(ctx, a.ID, entities.AgentPatch{Instructions: &changed}, nil, ""); err != nil {
		t.Fatal(err)
	}
	manual := filepath.Join(root, "Clone manuel é")
	if _, err = store.git(ctx, manual, "add", "--all"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.git(ctx, manual, "-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "fix: local edit"); err != nil {
		t.Fatal(err)
	}
	status, err = store.DeletionStatus(ctx, a.ID)
	if err != nil || status.Dirty || !status.Unpushed {
		t.Fatalf("unpushed risk: %+v %v", status, err)
	}
}
