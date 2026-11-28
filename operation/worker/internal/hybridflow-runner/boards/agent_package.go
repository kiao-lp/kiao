package boards

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
	"kiao/worker/internal/core/equipment"
)

const agentPackageFormat = "apm-deployment-v1"

type AgentPackage struct {
	Format  string            `json:"format"`
	Project string            `json:"project"`
	Commit  string            `json:"commit"`
	DraftID string            `json:"draftId"`
	Files   map[string][]byte `json:"files"`
}

type DraftAgentPackage struct {
	Agent   ManagedAgentVersion `json:"agent"`
	Package AgentPackage        `json:"package"`
}

type PreparedAgentPackage struct {
	Root           string
	Instructions   string
	Servers        []equipment.MCPServer
	MCPDiagnostics []equipment.MCPDiagnostic `json:"-"`
	base           string
	digest         string
	restore        func() error
}

func (s *HybridflowStore) packageRequest(ctx context.Context, method, id, ref string) ([]byte, error) {
	// Preparing a package may require resolving dependencies on the manager.
	client := *s.Client
	client.Timeout = 4 * time.Minute
	upstream := *s
	upstream.Client = &client
	return upstream.requestContext(ctx, method, "/agents/"+url.PathEscape(id)+"/packages/"+url.PathEscape(ref), "", nil)
}

func (s *HybridflowStore) agentPackage(ctx context.Context, id, commit string) (*AgentPackage, error) {
	body, err := s.packageRequest(ctx, http.MethodGet, id, commit)
	if err != nil {
		return nil, err
	}
	var result AgentPackage
	if err = json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (s *HybridflowStore) DraftAgentPackage(ctx context.Context, id string) (*DraftAgentPackage, error) {
	body, err := s.packageRequest(ctx, http.MethodPost, id, "draft")
	if err != nil {
		return nil, err
	}
	var result DraftAgentPackage
	if err = json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	if result.Agent.AgentID != id || !draftPackageID.MatchString(result.Agent.DraftID) || result.Agent.Commit != "" {
		return nil, fmt.Errorf("invalid draft configuration from the agentic resource manager")
	}
	return &result, nil
}

// PrepareAgentPackage caches a deployment prepared by the resource manager.
func (s *HybridflowStore) PrepareAgentPackage(state, nodeBinary, workerURL string, version *ManagedAgentVersion) (*PreparedAgentPackage, error) {
	return s.PrepareAgentPackageContext(context.Background(), state, nodeBinary, workerURL, version)
}

func (s *HybridflowStore) PrepareAgentPackageContext(ctx context.Context, state, nodeBinary, workerURL string, version *ManagedAgentVersion) (*PreparedAgentPackage, error) {
	if version != nil && version.DraftID != "" {
		return prepareAgentPackage(state, nodeBinary, workerURL, version, nil)
	}
	return prepareAgentPackage(state, nodeBinary, workerURL, version, func() (*AgentPackage, error) {
		return s.agentPackage(ctx, version.AgentID, version.Commit)
	})
}

func (s *HybridflowStore) AgentVersions(ctx context.Context, id string) ([]ManagedAgentVersion, error) {
	body, err := s.requestContext(ctx, http.MethodGet, "/agents/"+url.PathEscape(id)+"/versions", "", nil)
	if err != nil {
		return nil, err
	}
	var result struct {
		Versions []ManagedAgentVersion `json:"versions"`
	}
	err = json.Unmarshal(body, &result)
	return result.Versions, err
}

func InstallDraftAgentPackage(state, nodeBinary, workerURL string, draft *DraftAgentPackage) error {
	_, err := prepareAgentPackage(state, nodeBinary, workerURL, &draft.Agent, func() (*AgentPackage, error) {
		return &draft.Package, nil
	})
	return err
}

// StageDraftAgentPackage gives a diagnostic request disposable access to the current draft.
func StageDraftAgentPackage(state, nodeBinary, workerURL string, draft *DraftAgentPackage) (*PreparedAgentPackage, func(), error) {
	scratch, err := os.MkdirTemp(state, ".mcp-draft-")
	if err != nil {
		return nil, nil, err
	}
	base := filepath.Join(scratch, "package")
	cleanup := func() {
		removeStagedPackage(base)
		_ = os.RemoveAll(scratch)
	}
	digest, err := verifiedBundleDigest(&draft.Agent, &draft.Package)
	if err == nil {
		err = writeAgentPackage(base, &draft.Package, digest)
	}
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	prepared, err := bindAgentPackage(base, digest, nodeBinary, workerURL, filepath.Join(scratch, "logs"), &draft.Agent)
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	return prepared, cleanup, nil
}

func bindAgentPackage(base, digest, nodeBinary, workerURL, logDir string, version *ManagedAgentVersion) (*PreparedAgentPackage, error) {
	project := filepath.Join(base, "deployment")
	instructions, err := publishedSkillInstructions(project, version.Instructions)
	if err != nil {
		return nil, err
	}
	prepared := &PreparedAgentPackage{Root: project, Instructions: instructions, base: base, digest: digest}
	prepared.bindMCP(nodeBinary, workerURL, logDir)
	return prepared, nil
}

// Resolve the bindings each time so installing a missing command takes effect on the next turn.
func (p *PreparedAgentPackage) bindMCP(nodeBinary, workerURL, logDir string) {
	report := func(server, stage string, err error) {
		p.MCPDiagnostics = append(p.MCPDiagnostics, equipment.MCPDiagnostic{
			Server: server, Stage: stage, Message: err.Error(),
		})
	}
	// APM's Claude projection keeps environment references until execution.
	data, err := os.ReadFile(filepath.Join(p.Root, ".mcp.json"))
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		report(".mcp.json", "configuration", err)
		return
	}
	var config struct {
		Servers map[string]json.RawMessage `json:"mcpServers"`
	}
	if err = json.Unmarshal(data, &config); err != nil {
		report(".mcp.json", "configuration", err)
		return
	}
	names := make([]string, 0, len(config.Servers))
	for name := range config.Servers {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		server := equipment.MCPServer{Name: name}
		if err := json.Unmarshal(config.Servers[name], &server); err != nil {
			report(name, "configuration", err)
			continue
		}
		server.Name = name
		if err := p.resolveMCP(&server, nodeBinary, workerURL); err != nil {
			report(name, "runtime", err)
			continue
		}
		if server.Type == equipment.MCPStdio {
			if server.Env == nil {
				server.Env = map[string]string{}
			}
			server.Env["KIAO_MCP_LOG_DIR"] = logDir
		}
		p.Servers = append(p.Servers, server)
	}
}

func (p *PreparedAgentPackage) resolveMCP(server *equipment.MCPServer, nodeBinary, workerURL string) error {
	if server.Type == "" {
		if server.URL != "" {
			server.Type = equipment.MCPHTTP
		} else {
			server.Type = equipment.MCPStdio
		}
	}
	switch server.Type {
	case equipment.MCPHTTP, "streamable-http":
		server.Type = equipment.MCPHTTP
		if server.URL == "" {
			return fmt.Errorf("no URL configured")
		}
		return nil
	case equipment.MCPStdio:
		// Resolve below.
	default:
		return fmt.Errorf("unsupported MCP transport %q", server.Type)
	}
	if server.Command == "" {
		return fmt.Errorf("no command configured")
	}
	if resource, packaged := strings.CutPrefix(server.Command, "kiao-mcp-"); packaged {
		script, err := installedPackageRuntime(p.Root, "mcp-"+resource)
		if err != nil {
			return err
		}
		server.Command, err = exec.LookPath(nodeBinary)
		if err != nil {
			return fmt.Errorf("Node runtime %q is unavailable on the runner: %w", nodeBinary, err)
		}
		server.Args = []string{script}
		if server.Env == nil {
			server.Env = map[string]string{}
		}
		server.Env["WORKER_URL"] = workerURL
		server.Env["KIAO_MCP_ACCESS_TOKEN"] = equipment.MCPTokenPlaceholder
		return nil
	}
	command := server.Command
	var err error
	server.Command, err = publishedCommand(command, nodeBinary)
	if err != nil {
		return fmt.Errorf("command %q is unavailable on the runner: %w", command, err)
	}
	if command == "npx" || command == "npm" {
		if server.Env == nil {
			server.Env = map[string]string{}
		}
		server.Env["PATH"] = filepath.Dir(server.Command) + string(os.PathListSeparator) + os.Getenv("PATH")
	}
	return nil
}

func publishedSkillInstructions(project, instructions string) (string, error) {
	var result strings.Builder
	result.WriteString(instructions)
	seen := map[string]bool{}
	for _, projection := range []string{".agents", ".claude"} {
		dir := filepath.Join(project, projection, "skills")
		skills, err := os.ReadDir(dir)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		for _, skill := range skills {
			name := skill.Name()
			if !skill.IsDir() || seen[name] {
				continue
			}
			manifest := filepath.Join(dir, name, "SKILL.md")
			data, err := os.ReadFile(manifest)
			if err != nil {
				return "", err
			}
			if len(seen) == 0 {
				result.WriteString("\n\nUse this published skill catalogue. Read the listed SKILL.md when its description matches the task. The installed package is read-only. Write generated files in the working directory or a temporary directory.\n")
			}
			fmt.Fprintf(&result, "\nSkill %s: %s\n%s\n", name, manifest, skillDescription(string(data)))
			seen[name] = true
		}
	}
	return result.String(), nil
}

func installedPackageRuntime(project, name string) (string, error) {
	var selected string
	var digest [sha256.Size]byte
	err := filepath.WalkDir(filepath.Join(project, "apm_modules"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == ".git" || entry.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Name() != "server.mjs" || filepath.Base(filepath.Dir(path)) != "runtime" {
			return nil
		}
		manifest, err := os.ReadFile(filepath.Join(filepath.Dir(filepath.Dir(path)), "apm.yml"))
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		var metadata struct {
			Name string `yaml:"name"`
		}
		if err = yaml.Unmarshal(manifest, &metadata); err != nil {
			return err
		}
		if metadata.Name != name {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(content)
		if selected != "" && sum != digest {
			return fmt.Errorf("installed APM dependencies contain conflicting runtimes for %s", name)
		}
		selected, digest = path, sum
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	if selected == "" {
		return "", fmt.Errorf("installed APM dependencies omit runtime for %s (expected runtime/server.mjs)", name)
	}
	return selected, nil
}

func publishedCommand(name, nodeBinary string) (string, error) {
	var directories []string
	if prefix := strings.TrimSpace(os.Getenv("KIAO_WORKER_TOOLBOX_PATH")); prefix != "" {
		directories = append(directories, filepath.Join(prefix, "bin"), filepath.Join(prefix, "node", "bin"), filepath.Join(prefix, "npm", "bin"))
	}
	if name == "npx" || name == "npm" {
		if node, err := exec.LookPath(nodeBinary); err == nil {
			directories = append(directories, filepath.Dir(node))
		}
	}
	if filepath.Base(name) == name {
		for _, directory := range directories {
			if path, err := exec.LookPath(filepath.Join(directory, name)); err == nil {
				return path, nil
			}
		}
	}
	return exec.LookPath(name)
}

func skillDescription(text string) string {
	if !strings.HasPrefix(text, "---\n") {
		return ""
	}
	front, _, _ := strings.Cut(strings.TrimPrefix(text, "---\n"), "\n---")
	lines := strings.Split(front, "\n")
	for i, line := range lines {
		value, ok := strings.CutPrefix(line, "description:")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if value != "|" && value != ">" && value != "|-" && value != ">-" {
			return value
		}
		var parts []string
		for _, next := range lines[i+1:] {
			if !strings.HasPrefix(next, " ") {
				break
			}
			parts = append(parts, strings.TrimSpace(next))
		}
		return strings.Join(parts, " ")
	}
	return ""
}

type TaskExecution struct {
	ID             string               `json:"id"`
	FlowNodeID     string               `json:"flowNodeId"`
	ConversationID string               `json:"conversationId"`
	TurnID         string               `json:"turnId"`
	RunnerID       string               `json:"runnerId,omitempty"`
	RunID          string               `json:"runId,omitempty"`
	Harness        string               `json:"harness"`
	Model          string               `json:"model"`
	Effort         string               `json:"effort"`
	Agent          *ManagedAgentVersion `json:"agent"`
	At             time.Time            `json:"at"`
}

func (s *HybridflowStore) RecordExecution(board string, execution TaskExecution) error {
	_, err := s.request(http.MethodPost, s.FlowNodePath(board, execution.FlowNodeID)+"/executions", execution.RunID, execution)
	return err
}
