package filesystem

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"kiao/agentic-resource-manager/adapters/gitcli"
	"kiao/agentic-resource-manager/core/entities"
)

func publishedAgentWithHistory(t *testing.T) (*Store, *entities.AgentVersion, *entities.AgentVersion) {
	t.Helper()
	s, agent := fixture(t)
	ctx := context.Background()
	first, err := s.PublishAgent(ctx, agent.ID, nil, time.Now(), "owner", "", "")
	if err != nil {
		t.Fatal(err)
	}
	instructions := "Updated instructions"
	if _, err := s.PatchAgent(ctx, agent.ID, entities.AgentPatch{Instructions: &instructions}, nil, "owner"); err != nil {
		t.Fatal(err)
	}
	latest, err := s.PublishAgent(ctx, agent.ID, nil, time.Now(), "owner", "", "")
	if err != nil {
		t.Fatal(err)
	}
	return s, first.Published, latest.Published
}

type recordingGit struct {
	gitcli.Controller
	mu    sync.Mutex
	calls []gitCall
}

type gitCall struct {
	dir     string
	command string
}

func (g *recordingGit) Run(ctx context.Context, dir string, args ...string) ([]byte, error) {
	g.mu.Lock()
	g.calls = append(g.calls, gitCall{dir: dir, command: args[0]})
	g.mu.Unlock()
	return g.Controller.Run(ctx, dir, args...)
}

func (g *recordingGit) treeReads() int {
	count := 0
	for _, call := range g.calls {
		if call.command == "ls-tree" {
			count++
		}
	}
	return count
}

func TestAgentReadsReusePublicationObjectsAndLoadHistoryOnDemand(t *testing.T) {
	writer, first, latest := publishedAgentWithHistory(t)
	ctx := context.Background()
	other := &entities.Agent{ID: "another-id", Name: "Another", Harness: entities.HarnessCodex}
	if err := writer.CreateAgent(ctx, other, "owner"); err != nil {
		t.Fatal(err)
	}
	git := &recordingGit{}
	reader := New(writer.AgentRoot, git, writer.compiler, nil)
	agent, err := reader.FindAgent(ctx, latest.AgentID)
	if err != nil || agent.Published == nil || agent.Published.Commit != latest.Commit {
		t.Fatalf("latest publication: %+v, %v", agent, err)
	}
	for _, call := range git.calls {
		if call.dir != filepath.Join(reader.AgentRoot, agent.Project) {
			t.Fatalf("lookup ran Git in another repository: %+v", call)
		}
	}
	if reads := git.treeReads(); reads != 1 {
		t.Fatalf("first lookup read %d publication trees, want 1", reads)
	}

	agents, err := reader.ListAgents(ctx)
	if err != nil || len(agents) != 2 || agents[0].ID != other.ID || agents[1].Published == nil || agents[1].Published.Commit != latest.Commit {
		t.Fatalf("catalogue: %+v, %v", agents, err)
	}
	if reads := git.treeReads(); reads != 1 {
		t.Fatalf("catalogue reread publication objects, %d tree reads so far", reads)
	}

	versions, err := reader.AgentVersions(ctx, latest.AgentID)
	if err != nil || len(versions) != 2 || versions[0].Commit != first.Commit || versions[1].Commit != latest.Commit {
		t.Fatalf("history: %+v, %v", versions, err)
	}
	if reads := git.treeReads(); reads != 2 {
		t.Fatalf("history read %d publication trees in total, want 2", reads)
	}
}

func TestAgentReadsFollowTagAndRemoteChanges(t *testing.T) {
	s, first, latest := publishedAgentWithHistory(t)
	ctx := context.Background()
	agent, err := s.FindAgent(ctx, latest.AgentID)
	if err != nil || agent.Published == nil || agent.Published.Commit != latest.Commit {
		t.Fatalf("latest publication: %+v, %v", agent, err)
	}
	dir := filepath.Join(s.AgentRoot, agent.Project)
	git := func(args ...string) {
		t.Helper()
		if _, err := s.git(ctx, dir, args...); err != nil {
			t.Fatal(err)
		}
	}
	const remote = "https://example.invalid/agent.git"
	git("remote", "add", "origin", remote)
	agent, err = s.FindAgent(ctx, latest.AgentID)
	if err != nil || agent.Published == nil || agent.Published.Commit != latest.Commit ||
		agent.Published.Repository != remote || agent.Repository != remote {
		t.Fatalf("changed remote: %+v, %v", agent, err)
	}

	git("tag", "-f", latest.Tag, first.Commit)
	agent, err = s.FindAgent(ctx, latest.AgentID)
	if err != nil || agent.Published == nil || agent.Published.Tag != latest.Tag ||
		agent.Published.Commit != first.Commit || agent.Published.Instructions != first.Instructions ||
		!agent.HasUnpublishedChanges {
		t.Fatalf("replaced tag: %+v, %v", agent, err)
	}

	git("tag", "-d", latest.Tag)
	git("remote", "remove", "origin")
	agent, err = s.FindAgent(ctx, latest.AgentID)
	if err != nil || agent.Published == nil || agent.Published.Tag != first.Tag || agent.Published.Repository != "" || agent.Repository != "" {
		t.Fatalf("deleted tag and remote: %+v, %v", agent, err)
	}
}
