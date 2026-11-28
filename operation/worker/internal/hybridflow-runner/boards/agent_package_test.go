package boards

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func agentPackageTestState(t *testing.T) string {
	t.Helper()
	state := t.TempDir()
	t.Cleanup(func() { removeStagedPackage(state) })
	return state
}

func replaceTestPackageFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestAgentPackageRejectsPathsOutsideCache(t *testing.T) {
	for _, path := range []string{"../escaped", "/absolute", "..\\escaped", "deployment/../../escaped", "deployment/../escaped", "deployment/./apm.lock.yaml"} {
		t.Run(path, func(t *testing.T) {
			commit := strings.Repeat("a", 40)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				json.NewEncoder(w).Encode(AgentPackage{Format: agentPackageFormat, Project: "deployment", Commit: commit, Files: map[string][]byte{path: []byte("invalid")}})
			}))
			defer server.Close()
			client := NewHybridflowStore(server.URL, "")
			if _, err := client.PrepareAgentPackage(t.TempDir(), "node", "http://127.0.0.1", &ManagedAgentVersion{AgentID: "agent", Commit: commit}); err == nil || !strings.Contains(err.Error(), "package path") {
				t.Fatalf("invalid path: %v", err)
			}
		})
	}
}

// Enable against a throwaway resource manager with a prepared publication.
func TestPreparedPublicationAcrossMachines(t *testing.T) {
	base, id := os.Getenv("KIAO_APM_TEST_RESOURCE_URL"), os.Getenv("KIAO_APM_TEST_AGENT_ID")
	if base == "" || id == "" {
		t.Skip("set the throwaway resource-manager URL and agent ID for the APM integration check")
	}
	t.Setenv("KIAO_APM_BINARY", "/missing/apm")
	client := NewHybridflowStore(base, "")
	agent, err := client.Agent(id)
	if err != nil {
		t.Fatal(err)
	}
	if agent.Published == nil || agent.Published.Commit == "" {
		t.Fatal("fixture has no Git publication")
	}
	state := agentPackageTestState(t)
	prepared, err := client.PrepareAgentPackage(state, "node", "http://127.0.0.1:1", agent.Published)
	if err != nil {
		t.Fatal(err)
	}
	if len(prepared.Servers) == 0 || !strings.Contains(prepared.Instructions, "SKILL.md") {
		t.Fatal("publication did not include prepared tools and skills")
	}
	for _, server := range prepared.Servers {
		if server.URL != "" {
			continue
		}
		if !filepath.IsAbs(server.Command) {
			t.Fatalf("unresolved server: %+v", server)
		}
		if server.Env["WORKER_URL"] != "" {
			if len(server.Args) != 1 {
				t.Fatalf("unresolved packaged runtime: %+v", server)
			}
			if _, err = os.Stat(server.Args[0]); err != nil {
				t.Fatal(err)
			}
		}
	}
	again, err := client.PrepareAgentPackage(state, "node", "http://127.0.0.1:1", agent.Published)
	if err != nil || again.Root != prepared.Root {
		t.Fatalf("immutable cache not reused: %v", err)
	}
	restarted, err := client.PrepareAgentPackage(state, "node", "http://127.0.0.1:1", agent.Published)
	if err != nil || restarted.Root != prepared.Root || restarted.Instructions != prepared.Instructions {
		t.Fatalf("persisted cache was not reused: %+v %v", restarted, err)
	}
	replaceTestPackageFile(t, filepath.Join(prepared.Root, "apm.lock.yaml"), []byte("modified"))
	if err = restarted.EnsureIntact(); err != nil {
		t.Fatal(err)
	}
	if err := verifyPackageDigest(prepared.base, prepared.digest); err != nil {
		t.Fatal(err)
	}
}

func TestAgentPackageUsesPreparedDeploymentWithoutAPM(t *testing.T) {
	lock := []byte("lockfile_version: 1\n")
	sum := sha256.Sum256(lock)
	commit := strings.Repeat("c", 40)
	var requests atomic.Int64
	var changedSource atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/api/agentic/agents/agent/packages/"+commit || r.Header.Get("Authorization") != "Bearer resource-token" {
			t.Errorf("package request: %s, auth %q", r.URL, r.Header.Get("Authorization"))
		}
		runtime := "console.log('published runtime')\n"
		if changedSource.Load() {
			runtime = "changed upstream runtime"
		}
		_ = json.NewEncoder(w).Encode(AgentPackage{Format: agentPackageFormat, Project: "deployment", Commit: commit, Files: map[string][]byte{
			"deployment/apm.lock.yaml":                                                  lock,
			"deployment/.agents/skills/proof/SKILL.md":                                  []byte("---\ndescription: Proof skill\n---\nPublished skill\n"),
			"deployment/.claude/skills/proof/SKILL.md":                                  []byte("---\ndescription: Proof skill\n---\nPublished skill\n"),
			"deployment/.claude/skills/guide/SKILL.md":                                  []byte("---\ndescription: Claude guide\n---\nPublished guide\n"),
			"deployment/apm_modules/host/custom-runtime/apm.yml":                        []byte("name: mcp-proof\n"),
			"deployment/apm_modules/host/custom-runtime/runtime/server.mjs":             []byte(runtime),
			"deployment/apm_modules/host/custom-runtime/logs/kiao-mcp/2026-11-20.jsonl": []byte("delivered fixture\n"),
			"deployment/apm_modules/host/custom-runtime-note":                           []byte("tests component ordering\n"),
			"deployment/.mcp.json": []byte(`{"mcpServers":{
			    "missing": {"command": "kiao-mcp-missing"},
			    "proof": {"command": "kiao-mcp-proof"}
			}}`),
		}})
	}))
	defer upstream.Close()
	t.Setenv("KIAO_APM_BINARY", "/missing/apm")
	t.Setenv("PATH", t.TempDir())
	node, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	state := agentPackageTestState(t)
	client := NewHybridflowStore("http://unused-boards.invalid", "boards-token")
	client.ResourceURL, client.ResourceToken = upstream.URL+"/api/agentic", "resource-token"
	version := &ManagedAgentVersion{AgentID: "agent", Commit: commit, LockDigest: hex.EncodeToString(sum[:])}
	prepared, err := client.PrepareAgentPackage(state, node, "http://127.0.0.1:1", version)
	if err != nil {
		t.Fatal(err)
	}
	if len(prepared.Servers) != 1 || len(prepared.Servers[0].Args) != 1 || !strings.Contains(prepared.Instructions, "Proof skill") {
		t.Fatalf("prepared deployment: %+v", prepared)
	}
	if diagnostics := prepared.MCPDiagnostics; len(diagnostics) != 1 || diagnostics[0].Server != "missing" || !strings.Contains(diagnostics[0].Message, "omit runtime for mcp-missing") {
		t.Fatalf("deployment without MCP runtime: %+v", diagnostics)
	}
	if strings.Count(prepared.Instructions, "Skill proof:") != 1 || !strings.Contains(prepared.Instructions, "Claude guide") {
		t.Fatalf("skill catalogue = %q", prepared.Instructions)
	}
	expected := filepath.Join(prepared.Root, "apm_modules", "host", "custom-runtime", "runtime", "server.mjs")
	if prepared.Servers[0].Args[0] != expected {
		t.Fatalf("runtime: %+v", prepared.Servers[0])
	}
	if prepared.Servers[0].Env["WORKER_URL"] != "http://127.0.0.1:1" || prepared.Servers[0].Env["KIAO_MCP_ACCESS_TOKEN"] == "" {
		t.Fatal("callback configuration missing")
	}
	logDir := filepath.Join(state, "logs", "kiao-mcp", filepath.Base(prepared.base))
	if got := prepared.Servers[0].Env["KIAO_MCP_LOG_DIR"]; got != logDir {
		t.Fatalf("MCP log directory = %q, want %q", got, logDir)
	}
	for _, path := range []string{prepared.base, prepared.Root, expected} {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm()&0222 != 0 {
			t.Fatalf("installed path %s must be read-only: %v, %v", path, info, err)
		}
	}
	// Simulate bindings and instructions persisted by an older worker.
	held := *prepared
	held.Instructions = "Old cached instructions"
	delete(held.Servers[0].Env, "KIAO_MCP_LOG_DIR")
	metadata, err := json.Marshal(struct {
		Prepared PreparedAgentPackage
		Digest   string
	}{held, prepared.digest})
	if err != nil {
		t.Fatal(err)
	}
	replaceTestPackageFile(t, prepared.base+".json", metadata)
	again, err := client.PrepareAgentPackage(state, node, "http://127.0.0.1:1", version)
	if err != nil || again.Root != prepared.Root || requests.Load() != 1 {
		t.Fatalf("deployment cache was not reused: %+v %v (%d requests)", again, err, requests.Load())
	}
	if again.Instructions != prepared.Instructions {
		t.Fatalf("instructions after restart = %q, want %q", again.Instructions, prepared.Instructions)
	}
	if got := again.Servers[0].Env["KIAO_MCP_LOG_DIR"]; got != logDir {
		t.Fatalf("MCP log directory after restart = %q, want %q", got, logDir)
	}
	// A delivered log-shaped file is part of the digest, including during recovery.
	log := filepath.Join(prepared.Root, "apm_modules", "host", "custom-runtime", "logs", "kiao-mcp", "2026-11-20.jsonl")
	replaceTestPackageFile(t, log, []byte("modified"))
	changedSource.Store(true)
	if _, err = client.PrepareAgentPackage(state, node, "http://127.0.0.1:1", version); err == nil || !strings.Contains(err.Error(), "source digest differs") {
		t.Fatalf("accepted a different deployment for the same commit and lock: %v", err)
	}
	if content, err := os.ReadFile(log); err != nil || string(content) != "modified" {
		t.Fatalf("failed recovery changed the cache: %q, %v", content, err)
	}
	changedSource.Store(false)
	restored, err := client.PrepareAgentPackage(state, node, "http://127.0.0.1:1", version)
	if err != nil || restored.Root != prepared.Root || restored.digest != prepared.digest || requests.Load() != 3 {
		t.Fatalf("deployment was not restored: %+v %v (%d requests)", restored, err, requests.Load())
	}
	if content, err := os.ReadFile(log); err != nil || string(content) != "delivered fixture\n" {
		t.Fatalf("restored log fixture = %q, %v", content, err)
	}
}

func TestDraftAgentPackageReinstallsFromVerifiedSource(t *testing.T) {
	lock := []byte("lockfile_version: 1\n")
	sum := sha256.Sum256(lock)
	draftID := strings.Repeat("A", 26)
	draft := &DraftAgentPackage{
		Agent: ManagedAgentVersion{AgentID: "agent", DraftID: draftID, LockDigest: hex.EncodeToString(sum[:])},
		Package: AgentPackage{Format: agentPackageFormat, Project: "deployment", DraftID: draftID, Files: map[string][]byte{
			"deployment/apm.lock.yaml":                                   lock,
			"deployment/apm_modules/_local/mcp-proof/apm.yml":            []byte("name: mcp-proof\n"),
			"deployment/apm_modules/_local/mcp-proof/runtime/server.mjs": []byte("// packaged runtime\n"),
			"deployment/.mcp.json":                                       []byte(`{"mcpServers":{"proof":{"command":"kiao-mcp-proof"}}}`),
		}},
	}
	node, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	state := agentPackageTestState(t)
	const workerURL = "http://127.0.0.1:1"
	if err = InstallDraftAgentPackage(state, node, workerURL, draft); err != nil {
		t.Fatal(err)
	}
	client := NewHybridflowStore("http://unused-boards.invalid", "")
	prepared, err := client.PrepareAgentPackage(state, node, workerURL, &draft.Agent)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(filepath.Dir(prepared.base), draftID+".draft.json")
	if err := os.Remove(source); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PrepareAgentPackage(state, node, workerURL, &draft.Agent); err != nil {
		t.Fatalf("adopt a healthy legacy draft: %v", err)
	}
	snapshot, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	const logName = "2026-11-21.jsonl"
	legacyLogPath := filepath.Join("deployment", "apm_modules", "_local", "mcp-proof", "logs", "kiao-mcp", logName)
	legacyLog := filepath.Join(prepared.base, legacyLogPath)
	logRecord := []byte("{\"tool_name\":\"proof\"}\n")
	if err = os.Chmod(filepath.Dir(filepath.Dir(filepath.Dir(legacyLog))), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(legacyLog), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(legacyLog, logRecord, 0600); err != nil {
		t.Fatal(err)
	}
	unexpected := filepath.Join(prepared.Root, logName)
	if err = os.Chmod(prepared.Root, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(unexpected, logRecord, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(source); err != nil {
		t.Fatal(err)
	}
	if _, err = client.PrepareAgentPackage(state, node, workerURL, &draft.Agent); err == nil || !strings.Contains(err.Error(), "no recovery source") {
		t.Fatalf("a damaged legacy draft was accepted: %v", err)
	}
	if _, err = os.Stat(legacyLog); err != nil {
		t.Fatalf("legacy log moved from a modified package: %v", err)
	}
	if err = os.WriteFile(source, snapshot, 0400); err != nil {
		t.Fatal(err)
	}
	recovered, err := client.PrepareAgentPackage(state, node, workerURL, &draft.Agent)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Root != prepared.Root || recovered.digest != prepared.digest {
		t.Fatal("recovery changed the package identity")
	}
	if _, err = os.Stat(legacyLog); !os.IsNotExist(err) {
		t.Fatalf("legacy log still in the package: %v", err)
	}
	if _, err = os.Stat(unexpected); !os.IsNotExist(err) {
		t.Fatalf("unexpected file still in the package: %v", err)
	}
	logDir := recovered.Servers[0].Env["KIAO_MCP_LOG_DIR"]
	archived, err := filepath.Glob(filepath.Join(filepath.Dir(prepared.base), ".quarantine-"+filepath.Base(prepared.base)+"-*", legacyLogPath))
	if err != nil || len(archived) != 1 {
		t.Fatalf("expected one archived log, got %v: %v", archived, err)
	}
	if content, err := os.ReadFile(archived[0]); err != nil || string(content) != string(logRecord) {
		t.Fatalf("archived log = %q: %v", content, err)
	}
	if err = os.MkdirAll(logDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(logDir, logName), logRecord, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = client.PrepareAgentPackage(state, node, workerURL, &draft.Agent); err != nil {
		t.Fatalf("new log affected package reuse: %v", err)
	}
}

func TestAgentPackageRejectsInvalidPublication(t *testing.T) {
	lock := []byte("lockfile_version: 1\n")
	sum := sha256.Sum256(lock)
	commit := strings.Repeat("d", 40)
	for _, test := range []struct {
		name   string
		format string
		commit string
		lock   string
		want   string
	}{
		{"source package", "", commit, hex.EncodeToString(sum[:]), "must deliver a prepared"},
		{"wrong commit", agentPackageFormat, strings.Repeat("e", 40), hex.EncodeToString(sum[:]), "commit differs"},
		{"wrong lock", agentPackageFormat, commit, "wrong-lock-digest", "lock digest differs"},
	} {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(AgentPackage{Format: test.format, Project: "deployment", Commit: test.commit, Files: map[string][]byte{"deployment/apm.lock.yaml": lock}})
			}))
			defer upstream.Close()
			_, err := NewHybridflowStore(upstream.URL, "").PrepareAgentPackage(t.TempDir(), "node", "http://127.0.0.1", &ManagedAgentVersion{AgentID: "agent", Commit: commit, LockDigest: test.lock})
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("invalid publication: %v; want %q", err, test.want)
			}
		})
	}
}
