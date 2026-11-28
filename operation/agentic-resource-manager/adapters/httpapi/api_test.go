package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kiao/agentic-resource-manager/adapters/apm"
	"kiao/agentic-resource-manager/adapters/filesystem"
	"kiao/agentic-resource-manager/adapters/httpapi"
	"kiao/agentic-resource-manager/core/services"
)

func installFailure(t *testing.T, ctx context.Context, script string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "mcp-example"), 0755); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "apm")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\n"+script), 0755); err != nil {
		t.Fatal(err)
	}
	store := filesystem.New(root, nil, apm.Compiler{Binary: binary}, nil)
	handler := httpapi.API{Resources: services.NewAgenticResources(store)}.Handler()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequestWithContext(ctx, http.MethodPost, "/agentic-resources/mcp-example/install", strings.NewReader(`{}`)))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("install returned %d: %s", response.Code, response.Body)
	}
	var result struct{ Error string }
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.Error
}

func TestInstallExplainsMissingAPMDependency(t *testing.T) {
	message := installFailure(t, t.Context(), `
cat >&2 <<'EOF'
[>] Resolving dependencies...
[x] Local package path does not exist: ./missing-skill. Restore the source or correct the dependency path.
fatal: could not access https://owner:test-token@example.com/resource.git
[x] Install failed after 0.1s.
EOF
exit 1
`)
	if message != `APM could not find the local dependency "./missing-skill". Restore it or correct its path in apm.yml.` {
		t.Fatalf("unexpected diagnostic: %q", message)
	}
}

func TestInstallNamesTheDependencyWithRejectedGitAccess(t *testing.T) {
	message := installFailure(t, t.Context(), `
cat >&2 <<'EOF'
  Failed to resolve transitive dep example/skill-x (via example/agent): Failed to clone
fatal: Authentication failed for 'https://owner:test-token@example.com/example/skill-x.git'
EOF
exit 1
`)
	want := `APM could not authenticate to dependency "example/skill-x". Check the resource manager's Git access to the repository or the bundled copy of its locked commit.`
	if message != want {
		t.Fatalf("unexpected diagnostic: %q", message)
	}
}

func TestInstallTimeoutReportsTheLastDependency(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	started := time.Now()
	message := installFailure(t, ctx, `
printf '%s\n' '[>] Resolving example/skill-first...' '[>] Resolving example/skill-slow...'
printf '%s\n' 'https://owner:test-token@example.com/example/skill-slow.git' >&2
sleep 10
`)
	if time.Since(started) > 3*time.Second {
		t.Fatal("timeout waited for the child process")
	}
	if !strings.HasPrefix(message, "APM install timed out after ") ||
		!strings.HasSuffix(message, `APM last reported resolving dependency "example/skill-slow".`) ||
		strings.Contains(message, "test-token") {
		t.Fatalf("unexpected diagnostic: %q", message)
	}
}
