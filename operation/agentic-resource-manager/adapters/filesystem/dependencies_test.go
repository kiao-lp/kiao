package filesystem

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"kiao/agentic-resource-manager/core/entities"
)

func TestEditAgentDependenciesPreservesOtherAPMDependencies(t *testing.T) {
	s, agent := fixture(t)
	ctx := context.Background()
	s.DependencyRoot = t.TempDir()
	for repository, files := range map[string]map[string]string{
		"skill-review": {manifestFile: "name: review\n", "SKILL.md": "# Review\n"},
		"mcp-helper":   {manifestFile: "name: mcp-helper\n"},
	} {
		dir := filepath.Join(s.DependencyRoot, repository)
		if err := os.Mkdir(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if _, err := s.git(ctx, dir, "init"); err != nil {
			t.Fatal(err)
		}
		for name, content := range files {
			if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	manifest := `name: agent-coder
# Preserve this comment and the other dependencies.
dependencies:
  apm:
    - owner/ordinary-tool#v1.0.0
    - path: ./.apm/resources/skill-missing
    - path: ./.apm/resources/mcp-missing
    - git: owner/mcp-helper
      path: ./plugin
  mcp: [helper]
`
	path := filepath.Join(s.AgentRoot, "agent-coder", manifestFile)
	if err := os.WriteFile(path, []byte(manifest), 0644); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		kind        entities.AgentDependencyKind
		newLink     string
		missingLink string
	}{
		{entities.AgentSkill, "skill-review", "skill-missing"},
		{entities.AgentMCP, "mcp-helper", "mcp-missing"},
	} {
		t.Run(string(tc.kind), func(t *testing.T) {
			want := []entities.AgentDependency{{Name: tc.missingLink, Linked: true}, {Name: tc.newLink, Available: true}}
			slices.SortFunc(want, func(a, b entities.AgentDependency) int { return strings.Compare(a.Name, b.Name) })
			assertLinks := func(want []entities.AgentDependency) {
				t.Helper()
				got, err := s.ListAgentDependencies(ctx, agent.ID, tc.kind)
				if err != nil || !slices.Equal(got, want) {
					t.Fatalf("dependencies = %+v, %v; want %+v", got, err, want)
				}
			}
			assertLinks(want)
			for range 2 {
				if err := s.SetAgentDependency(ctx, agent.ID, tc.kind, tc.newLink, true, false); err != nil {
					t.Fatal(err)
				}
			}
			for i := range want {
				want[i].Linked = true
			}
			assertLinks(want)
			linked, err := os.ReadFile(path)
			relative, relErr := filepath.Rel(filepath.Dir(path), filepath.Join(s.DependencyRoot, tc.newLink))
			if err != nil || relErr != nil || strings.Count(string(linked), filepath.ToSlash(relative)) != 1 {
				t.Fatalf("manifest should contain one link to %s: %s, %v, %v", tc.newLink, linked, err, relErr)
			}
			if err := s.SetAgentDependency(ctx, agent.ID, tc.kind, tc.missingLink, false, false); err != nil {
				t.Fatal(err)
			}
			assertLinks([]entities.AgentDependency{{Name: tc.newLink, Linked: true, Available: true}})
		})
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, kept := range []string{"# Preserve this comment", "owner/ordinary-tool#v1.0.0", "git: owner/mcp-helper", "path: ./plugin", "mcp: [helper]", "skill-review"} {
		if !strings.Contains(string(updated), kept) {
			t.Errorf("manifest lost %q: %s", kept, updated)
		}
	}
	if strings.Contains(string(updated), "skill-missing") || strings.Contains(string(updated), "mcp-missing") {
		t.Errorf("manifest retained an unlinked dependency: %s", updated)
	}
}

func TestDependencyRemoteAndDraftOverride(t *testing.T) {
	s, agent := fixture(t)
	ctx := context.Background()
	s.DependencyRoot = t.TempDir()
	name := "skill-review"
	source := filepath.Join(s.DependencyRoot, name)
	initTestSkill(t, s, source)
	if _, err := s.git(ctx, source, "remote", "add", "upstream", "git@example.com:org/skill-review.git"); err != nil {
		t.Fatal(err)
	}
	link := func(local bool) {
		t.Helper()
		if err := s.SetAgentDependency(ctx, agent.ID, entities.AgentSkill, name, true, local); err != nil {
			t.Fatal(err)
		}
		got, err := s.ListAgentDependencies(ctx, agent.ID, entities.AgentSkill)
		want := []entities.AgentDependency{{Name: name, Linked: true, Available: true, HasRemote: true, Local: local}}
		if err != nil || !slices.Equal(got, want) {
			t.Fatalf("links = %+v, %v; want %+v", got, err, want)
		}
	}
	project := filepath.Join(s.AgentRoot, agent.Repository)
	manifest := filepath.Join(project, manifestFile)
	link(false)
	canonical, err := os.ReadFile(manifest)
	_, canonicalDeps, parseErr := parseDependencyManifest(canonical)
	if err != nil || parseErr != nil || len(canonicalDeps.Content) != 1 ||
		gitDependencyReference(canonicalDeps.Content[0]) != "git@example.com:org/skill-review.git" {
		t.Fatalf("canonical manifest: %s, %v", canonical, err)
	}
	link(true)
	s = New(s.AgentRoot, s.gitController, s.compiler, nil)
	s.DependencyRoot = filepath.Dir(source)
	strict, err := os.ReadFile(manifest)
	if err != nil || !bytes.Equal(strict, canonical) {
		t.Fatalf("override changed the manifest: %s, %v", strict, err)
	}
	stage := t.TempDir()
	draft, err := s.draftManifest(ctx, project, stage)
	relative, relErr := relativeDependencyPath(stage, source)
	_, draftDeps, parseErr := parseDependencyManifest(draft)
	var draftLink any
	if err != nil || relErr != nil || parseErr != nil || len(draftDeps.Content) != 1 ||
		draftDeps.Content[0].Decode(&draftLink) != nil || localAPMDependencyPath(draftLink) != relative {
		t.Fatalf("draft manifest: %s, %v, %v", draft, err, relErr)
	}
	if _, err := s.PublishAgent(ctx, agent.ID, nil, time.Now(), "owner", "", ""); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("published with local override: %v", err)
	}
	link(false)
	draft, err = s.draftManifest(ctx, project, stage)
	if err != nil || !bytes.Equal(draft, canonical) {
		t.Fatalf("draft did not restore Git link: %s, %v", draft, err)
	}
}

func TestPublicationAndGitPushRequireConfirmationForLocalDependencies(t *testing.T) {
	s, agent := fixture(t)
	ctx := context.Background()
	s.DependencyRoot = t.TempDir()
	project := filepath.Join(s.AgentRoot, agent.Repository)
	name := "skill-review"
	initTestSkill(t, s, filepath.Join(s.DependencyRoot, name))
	remote := filepath.Join(t.TempDir(), "agent.git")
	git := func(dir string, args ...string) string {
		t.Helper()
		data, err := s.git(ctx, dir, args...)
		if err != nil {
			t.Fatal(err)
		}
		return strings.TrimSpace(string(data))
	}
	git(project, "init", "--bare", "-b", "main", remote)
	git(project, "remote", "add", "origin", remote)
	if err := s.SetAgentDependency(ctx, agent.ID, entities.AgentSkill, name, true, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PublishAgent(ctx, agent.ID, nil, time.Now(), "owner", "", entities.BumpMajor); err == nil {
		t.Fatal("published without confirmation")
	} else {
		var warning *entities.PushConfirmation
		if !errors.As(err, &warning) || !slices.Equal(warning.Dependencies, []string{name}) {
			t.Fatalf("missing local dependency warning: %v", err)
		}
		if tags := git(project, "tag", "--list"); tags != "" {
			t.Fatalf("created a tag without confirmation: %s", tags)
		}
		if _, err := s.PublishAgent(ctx, agent.ID, nil, time.Now(), "owner", warning.Token, entities.BumpMinor); !errors.As(err, &warning) {
			t.Fatalf("confirmation for a different release was accepted: %v", err)
		} else if _, err := s.PublishAgent(ctx, agent.ID, nil, time.Now(), "owner", warning.Token, entities.BumpMinor); err != nil {
			t.Fatal(err)
		}
	}
	if want, got := "v0.1.0", git(remote, "tag", "--list"); want != got {
		t.Fatalf("pushed tags = %s, want %s", got, want)
	}
	if err := s.SetAgentDependency(ctx, agent.ID, entities.AgentSkill, name, false, false); err != nil {
		t.Fatal(err)
	}
	var warning *entities.PushConfirmation
	err := s.ResourceOperation(ctx, agent.Repository, "push", "", "", "")
	if !errors.As(err, &warning) || !slices.Equal(warning.Dependencies, []string{name}) {
		t.Fatalf("Git push should verify the commit instead of the draft: %v", err)
	}
	if err := s.ResourceOperation(ctx, agent.Repository, "push", "", warning.Token, ""); err != nil {
		t.Fatal(err)
	}
}

func initTestSkill(t *testing.T, s *Store, dir string) {
	t.Helper()
	ctx := context.Background()
	if err := os.Mkdir(dir, 0755); err != nil {
		t.Fatal(err)
	}
	for path, data := range map[string]string{manifestFile: "name: review\nversion: 1.0.0\n", "SKILL.md": "# Review\n"} {
		if err := os.WriteFile(filepath.Join(dir, path), []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for _, args := range [][]string{{"init"}, {"add", "--all"}, {"-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "Create review skill"}} {
		if _, err := s.git(ctx, dir, args...); err != nil {
			t.Fatal(err)
		}
	}
}
