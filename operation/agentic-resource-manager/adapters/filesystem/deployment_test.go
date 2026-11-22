package filesystem

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kiao/agentic-resource-manager/adapters/apm"
	"kiao/agentic-resource-manager/adapters/cache"
	"kiao/agentic-resource-manager/core/entities"
)

type deploymentCompiler struct {
	t *testing.T
}

func (c deploymentCompiler) Run(_ context.Context, source string, args ...string) ([]byte, error) {
	c.t.Helper()
	if len(args) != 5 || strings.Join(args[:4], " ") != "install --frozen --trust-transitive-mcp --root" {
		c.t.Fatalf("deployment command: %v", args)
	}
	definition, err := os.ReadFile(filepath.Join(source, definitionFile(source)))
	if err != nil || !strings.Contains(string(definition), "First instructions") {
		c.t.Fatalf("deployment did not use the published source: %s %v", definition, err)
	}
	for name, content := range map[string]string{
		".agents/skills/proof/SKILL.md":             "---\ndescription: Proof skill\n---\nPublished skill\n",
		".mcp.json":                                 `{"mcpServers":{"proof":{"command":"kiao-mcp-proof"}}}`,
		"apm_modules/host/proof/apm.yml":            "name: mcp-proof\n",
		"apm_modules/host/proof/runtime/server.mjs": "console.log('published runtime')\n",
		"apm_modules/host/proof/.git/config":        "server credentials stay here\n",
	} {
		file := filepath.Join(args[len(args)-1], filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			return nil, err
		}
		if err := os.WriteFile(file, []byte(content), 0600); err != nil {
			return nil, err
		}
	}
	return nil, nil
}

func TestPackageDeliversCachedDeploymentFromPublishedCommit(t *testing.T) {
	s, a := fixture(t)
	ctx := context.Background()
	published, err := s.PublishAgent(ctx, a.ID, nil, time.Now(), "owner", "", "")
	if err != nil {
		t.Fatal(err)
	}
	instructions := "Unpublished instructions"
	if _, err = s.PatchAgent(ctx, a.ID, entities.AgentPatch{Instructions: &instructions}, nil, "owner"); err != nil {
		t.Fatal(err)
	}
	s.compiler = deploymentCompiler{t: t}
	s.cache = cache.Directory{Root: t.TempDir()}
	bundle, err := s.AgentPackage(ctx, a.ID, published.Published.Commit)
	if err != nil {
		t.Fatal(err)
	}
	if bundle.Format != entities.AgentPackageFormat || bundle.Project != "deployment" || len(bundle.Files["deployment/.agents/skills/proof/SKILL.md"]) == 0 || len(bundle.Files["deployment/.mcp.json"]) == 0 {
		t.Fatalf("incomplete deployment: %+v", bundle)
	}
	for name := range bundle.Files {
		if !strings.HasPrefix(name, "deployment/") || strings.Contains(name, "/.git/") || strings.HasSuffix(name, "/agent.json") {
			t.Fatalf("delivered source or Git metadata: %s", name)
		}
	}
	fresh := New(s.AgentRoot, s.gitController, apm.Compiler{Binary: "/missing/apm"}, s.cache)
	again, err := fresh.AgentPackage(ctx, a.ID, published.Published.Commit)
	if err != nil || len(again.Files) != len(bundle.Files) {
		t.Fatalf("prepared package was not cached: %+v %v", again, err)
	}
}
