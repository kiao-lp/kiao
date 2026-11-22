package boards

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
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
	Root         string
	Instructions string
	Servers      []equipment.MCPServer
	base         string
	digest       string
}

var packageInstall sync.Mutex
var preparedPackages = map[string]*PreparedAgentPackage{}
var immutableCommit = regexp.MustCompile(`^[0-9a-f]{40}$`)
var draftPackageID = regexp.MustCompile(`^[A-Z2-7]{26}$`)
var mcpDailyLog = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}\.jsonl$`)

func (s *HybridflowStore) packageRequest(ctx context.Context, method, id, ref string) ([]byte, error) {
	// Preparing a package may require resolving dependencies on the manager.
	client := *s.Client
	client.Timeout = 4 * time.Minute
	upstream := *s
	upstream.Client = &client
	return upstream.requestContext(ctx, method, "/agents/"+url.PathEscape(id)+"/packages/"+url.PathEscape(ref), "", nil)
}

func (s *HybridflowStore) AgentPackage(id, commit string) (*AgentPackage, error) {
	body, err := s.packageRequest(context.Background(), http.MethodGet, id, commit)
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
	return prepareAgentPackage(state, nodeBinary, workerURL, version, func() (*AgentPackage, error) {
		if version.DraftID != "" {
			return nil, fmt.Errorf("the local draft package is missing; start a new conversation with the draft")
		}
		return s.AgentPackage(version.AgentID, version.Commit)
	})
}

func InstallDraftAgentPackage(state, nodeBinary, workerURL string, draft *DraftAgentPackage) error {
	_, err := prepareAgentPackage(state, nodeBinary, workerURL, &draft.Agent, func() (*AgentPackage, error) {
		return &draft.Package, nil
	})
	return err
}

func prepareAgentPackage(state, nodeBinary, workerURL string, version *ManagedAgentVersion, load func() (*AgentPackage, error)) (*PreparedAgentPackage, error) {
	ref := ""
	switch {
	case version != nil && version.DraftID == "" && immutableCommit.MatchString(version.Commit):
		ref = version.Commit
	case version != nil && version.Commit == "" && draftPackageID.MatchString(version.DraftID):
		ref = version.DraftID
	default:
		return nil, fmt.Errorf("agent publication requires a complete Git commit")
	}
	packageInstall.Lock()
	defer packageInstall.Unlock()
	cacheKey := agentPackageFormat + "\x00" + state + "\x00" + version.AgentID + "\x00" + ref + "\x00" + version.LockDigest + "\x00" + nodeBinary + "\x00" + workerURL
	if prepared := preparedPackages[cacheKey]; prepared != nil {
		digest, err := packageTreeDigest(prepared.base, nil)
		if err != nil || digest != prepared.digest {
			return nil, fmt.Errorf("agent package cache was modified")
		}
		return prepared, nil
	}

	cacheID := sha256.Sum256([]byte(cacheKey))
	base := filepath.Join(state, "agentic-packages", ref+"-"+hex.EncodeToString(cacheID[:8]))
	metadata := base + ".json"
	logDir := filepath.Join(state, "logs", "kiao-mcp", filepath.Base(base))
	if data, e := os.ReadFile(metadata); e == nil {
		var held struct {
			Prepared PreparedAgentPackage
			Digest   string
		}
		if e = json.Unmarshal(data, &held); e != nil {
			return nil, e
		}
		if held.Prepared.Root != filepath.Join(base, "deployment") {
			return nil, fmt.Errorf("invalid package cache root")
		}
		actual, e := packageTreeDigest(base, nil)
		if e != nil {
			return nil, fmt.Errorf("agent package cache was modified")
		}
		legacyLogDirs := held.Prepared.configureMCPLogs(logDir)
		if actual != held.Digest {
			if e = recoverPackageMCPLogs(base, held.Digest, logDir, legacyLogDirs); e != nil {
				return nil, e
			}
		}
		held.Prepared.Instructions, e = publishedSkillInstructions(held.Prepared.Root, version.Instructions)
		if e != nil {
			return nil, e
		}
		held.Prepared.base, held.Prepared.digest = base, held.Digest
		preparedPackages[cacheKey] = &held.Prepared
		return &held.Prepared, nil
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	bundle, err := load()
	if err != nil {
		return nil, err
	}
	if bundle.Format != agentPackageFormat || bundle.Project != "deployment" {
		return nil, fmt.Errorf("agentic-resource-manager must deliver a prepared %s package", agentPackageFormat)
	}
	if bundle.Commit != version.Commit {
		return nil, fmt.Errorf("agent package commit differs from selected publication")
	}
	if bundle.DraftID != version.DraftID {
		return nil, fmt.Errorf("agent package draft differs from selected draft")
	}
	if err = os.RemoveAll(base); err != nil {
		return nil, err
	}
	if err = os.MkdirAll(base, 0700); err != nil {
		return nil, err
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.RemoveAll(base)
		}
	}()
	safe := func(name string) (string, error) {
		if name == "" || filepath.IsAbs(name) || strings.Contains(name, "\\") {
			return "", fmt.Errorf("invalid package path")
		}
		clean := filepath.Clean(name)
		if clean != "deployment" && !strings.HasPrefix(clean, "deployment"+string(filepath.Separator)) {
			return "", fmt.Errorf("package path leaves deployment")
		}
		return filepath.Join(base, clean), nil
	}
	var total int64
	for name, content := range bundle.Files {
		target, err := safe(name)
		if err != nil {
			return nil, err
		}
		total += int64(len(content))
		if len(content) > 8<<20 || total > 64<<20 {
			return nil, fmt.Errorf("agent package exceeds delivery limit")
		}
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return nil, err
		}
		if err = os.WriteFile(target, content, 0600); err != nil {
			return nil, err
		}
	}
	project, err := safe(bundle.Project)
	if err != nil {
		return nil, err
	}
	lock, err := os.ReadFile(filepath.Join(project, "apm.lock.yaml"))
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(lock)
	if version.LockDigest == "" || hex.EncodeToString(sum[:]) != version.LockDigest {
		return nil, fmt.Errorf("agent package lock digest differs from selection")
	}
	instructions, err := publishedSkillInstructions(project, version.Instructions)
	if err != nil {
		return nil, err
	}
	prepared := &PreparedAgentPackage{Root: project, Instructions: instructions}
	// APM's Claude projection keeps environment references until execution.
	mcpPath := filepath.Join(project, ".mcp.json")
	data, err := os.ReadFile(mcpPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		var config struct {
			Servers map[string]struct {
				Type    string            `json:"type"`
				Command string            `json:"command"`
				Args    []string          `json:"args"`
				URL     string            `json:"url"`
				Env     map[string]string `json:"env"`
				Headers map[string]string `json:"headers"`
			} `json:"mcpServers"`
		}
		if err = json.Unmarshal(data, &config); err != nil {
			return nil, err
		}
		names := make([]string, 0, len(config.Servers))
		for name := range config.Servers {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			entry := config.Servers[name]
			server := equipment.MCPServer{Name: name, Type: entry.Type, Command: entry.Command, Args: entry.Args, URL: entry.URL, Env: entry.Env, Headers: entry.Headers}
			if strings.HasPrefix(entry.Command, "kiao-mcp-") {
				resourceName := "mcp-" + strings.TrimPrefix(entry.Command, "kiao-mcp-")
				script, err := installedPackageRuntime(project, resourceName)
				if err != nil {
					return nil, err
				}
				server.Type = equipment.MCPStdio
				server.Command, err = exec.LookPath(nodeBinary)
				if err != nil {
					return nil, err
				}
				server.Args = []string{script}
				if server.Env == nil {
					server.Env = map[string]string{}
				}
				server.Env["WORKER_URL"] = workerURL
				server.Env["KIAO_MCP_ACCESS_TOKEN"] = equipment.MCPTokenPlaceholder
			} else if server.Command != "" {
				server.Command, err = publishedCommand(server.Command, nodeBinary)
				if err != nil {
					return nil, fmt.Errorf("MCP %s: %w", name, err)
				}
				if entry.Command == "npx" || entry.Command == "npm" {
					if server.Env == nil {
						server.Env = map[string]string{}
					}
					server.Env["PATH"] = filepath.Dir(server.Command) + string(os.PathListSeparator) + os.Getenv("PATH")
				}
				if server.Type == "" {
					server.Type = equipment.MCPStdio
				}
			}
			prepared.Servers = append(prepared.Servers, server)
		}
	}
	prepared.configureMCPLogs(logDir)
	prepared.base = base
	prepared.digest, err = packageTreeDigest(base, nil)
	if err != nil {
		return nil, err
	}

	persisted, err := json.Marshal(struct {
		Prepared *PreparedAgentPackage
		Digest   string
	}{prepared, prepared.digest})
	if err != nil {
		return nil, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(metadata), ".prepared-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(temporary.Name())
	_, writeErr := temporary.Write(persisted)
	closeErr := temporary.Close()
	if writeErr != nil {
		return nil, writeErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if err = os.Rename(temporary.Name(), metadata); err != nil {
		return nil, err
	}
	preparedPackages[cacheKey] = prepared
	complete = true
	return prepared, nil
}

func (p *PreparedAgentPackage) configureMCPLogs(logDir string) map[string]struct{} {
	legacyLogDirs := map[string]struct{}{}
	modules := filepath.Join(p.Root, "apm_modules")
	for _, server := range p.Servers {
		if server.Type != equipment.MCPStdio || server.Env["KIAO_MCP_ACCESS_TOKEN"] != equipment.MCPTokenPlaceholder || len(server.Args) != 1 {
			continue
		}
		script := server.Args[0]
		runtimeDir := filepath.Dir(script)
		if filepath.Base(script) != "server.mjs" || filepath.Base(runtimeDir) != "runtime" {
			continue
		}
		module := filepath.Dir(runtimeDir)
		relative, err := filepath.Rel(modules, module)
		if err != nil || !filepath.IsLocal(relative) {
			continue
		}
		server.Env["KIAO_MCP_LOG_DIR"] = logDir
		legacyLogDirs[filepath.Join(module, "logs", "kiao-mcp")] = struct{}{}
	}
	return legacyLogDirs
}

func recoverPackageMCPLogs(base, expectedDigest, logDir string, legacyLogDirs map[string]struct{}) error {
	// Establish that only generated logs differ before moving any files.
	var logs []string
	actual, err := packageTreeDigest(base, func(path string) bool {
		if _, ok := legacyLogDirs[filepath.Dir(path)]; !ok || !mcpDailyLog.MatchString(filepath.Base(path)) {
			return false
		}
		logs = append(logs, path)
		return true
	})
	if err != nil || actual != expectedDigest || len(logs) == 0 {
		return fmt.Errorf("agent package cache was modified")
	}
	if err = os.MkdirAll(logDir, 0700); err != nil {
		return fmt.Errorf("archive agent package MCP logs: %w", err)
	}
	archive, err := os.MkdirTemp(logDir, "legacy-")
	if err != nil {
		return fmt.Errorf("archive agent package MCP logs: %w", err)
	}
	for _, path := range logs {
		relative, err := filepath.Rel(base, path)
		if err != nil {
			return err
		}
		target := filepath.Join(archive, relative)
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return fmt.Errorf("archive agent package MCP logs: %w", err)
		}
		if err = os.Rename(path, target); err != nil {
			return fmt.Errorf("archive agent package MCP logs: %w", err)
		}
	}
	actual, err = packageTreeDigest(base, nil)
	if err != nil || actual != expectedDigest {
		return fmt.Errorf("agent package cache was modified")
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
				result.WriteString("\n\nUse this published skill catalogue. Read the listed SKILL.md when its description matches the task.\n")
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
		return "", fmt.Errorf("installed APM dependencies omit runtime for %s", name)
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

func packageTreeDigest(root string, skip func(path string) bool) (string, error) {
	hash := sha256.New()
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("non-regular file in published package")
		}
		if skip != nil && skip(path) {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(content)
		fmt.Fprintf(hash, "%s\x00%x\n", filepath.ToSlash(relative), sum)
		return nil
	})
	return hex.EncodeToString(hash.Sum(nil)), err
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
