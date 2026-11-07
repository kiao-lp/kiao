package pi

import (
	"bufio"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	pkgProcess "kiao/worker/internal/core/process"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

//go:embed kiao-bridge.ts
var piBridge []byte

const piCommandTimeout = 15 * time.Second

type piCommandRejected struct{ message string }

func (err *piCommandRejected) Error() string { return err.message }

// piRPC separates correlated replies from unsolicited events. The reader splits on LF only,
// and keeps draining while commands are outstanding, including during compaction and cancellation.
type piRPC struct {
	Process        *pkgProcess.SupervisedAgentProcess
	stdin          *os.File
	stdout, stderr *os.File
	events         chan map[string]json.RawMessage
	done, errDone  chan struct{}
	writeMu        sync.Mutex
	mu             sync.Mutex
	next           uint64
	pending        map[string]chan map[string]json.RawMessage
	readErr        error
	stderrTail     string
	trace          *turntrace.TurnTrace
	secrets        []string
	stopOnce       sync.Once
}

func (rpc *piRPC) scrub(s string) string {
	for _, secret := range rpc.secrets {
		if secret != "" {
			s = strings.ReplaceAll(s, secret, "<redacted>")
			encoded, _ := json.Marshal(secret)
			if len(encoded) > 2 {
				s = strings.ReplaceAll(s, string(encoded[1:len(encoded)-1]), "<redacted>")
			}
		}
	}
	return s
}

func startPiRPC(binary string, args, env []string, workDir string, trace *turntrace.TurnTrace, secrets []string) (*piRPC, error) {
	inputR, inputW, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	outputR, outputW, err := os.Pipe()
	if err != nil {
		inputR.Close()
		inputW.Close()
		return nil, err
	}
	errorR, errorW, err := os.Pipe()
	if err != nil {
		inputR.Close()
		inputW.Close()
		outputR.Close()
		outputW.Close()
		return nil, err
	}
	cmd := exec.Command(binary, args...)
	cmd.Dir, cmd.Env = workDir, env
	cmd.Stdin, cmd.Stdout, cmd.Stderr = inputR, outputW, errorW
	process, err := pkgProcess.StartSupervisedAgent(cmd)
	inputR.Close()
	outputW.Close()
	errorW.Close()
	if err != nil {
		inputW.Close()
		outputR.Close()
		errorR.Close()
		return nil, err
	}
	rpc := &piRPC{Process: process, stdin: inputW, stdout: outputR, stderr: errorR,
		events: make(chan map[string]json.RawMessage, 256), done: make(chan struct{}), errDone: make(chan struct{}),
		pending: map[string]chan map[string]json.RawMessage{}, trace: trace, secrets: secrets}
	// Never record inherited environment or the resolved credentials.
	trace.Exec(turntrace.TraceExec{Binary: binary, Path: binary, Argv: append([]string{binary}, args...), Dir: workDir, PID: process.Pid})
	go rpc.read()
	go func() {
		defer close(rpc.errDone)
		defer errorR.Close()
		scanner := bufio.NewScanner(errorR)
		scanner.Buffer(make([]byte, 4096), 1<<20)
		for scanner.Scan() {
			line := rpc.scrub(scanner.Text())
			rpc.mu.Lock()
			rpc.stderrTail += line + "\n"
			if len(rpc.stderrTail) > 8<<10 {
				rpc.stderrTail = strings.ToValidUTF8(rpc.stderrTail[len(rpc.stderrTail)-(8<<10):], "")
			}
			rpc.mu.Unlock()
			trace.StderrLine(line)
		}
	}()
	return rpc, nil
}

func (rpc *piRPC) read() {
	defer close(rpc.done)
	defer close(rpc.events)
	defer rpc.stdout.Close()
	scanner := bufio.NewScanner(rpc.stdout)
	scanner.Buffer(make([]byte, 4096), 16<<20)
	for scanner.Scan() {
		raw := rpc.scrub(scanner.Text())
		rpc.trace.StreamLine(turntrace.TraceOut, raw)
		var record map[string]json.RawMessage
		if err := json.Unmarshal([]byte(raw), &record); err != nil {
			rpc.mu.Lock()
			rpc.readErr = errors.New("Pi emitted invalid JSONL")
			rpc.mu.Unlock()
			rpc.Process.Stop()
			break
		}
		if rawString(record, "type") == "response" {
			id := rawString(record, "id")
			rpc.mu.Lock()
			reply := rpc.pending[id]
			rpc.mu.Unlock()
			if reply != nil {
				select {
				case reply <- record:
				default:
				}
			}
			continue
		}
		// The port consumes completed blocks. Stream capture can retain deltas for diagnostics.
		if rawString(record, "type") == "message_update" || rawString(record, "type") == "tool_execution_update" {
			continue
		}
		select {
		case rpc.events <- record:
		default:
			select {
			case rpc.events <- record:
			case <-rpc.Process.Done:
				return
			}
		}
	}
	rpc.mu.Lock()
	if err := scanner.Err(); err != nil {
		rpc.readErr = err
	}
	rpc.mu.Unlock()
}

func (rpc *piRPC) send(record any) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	rpc.writeMu.Lock()
	defer rpc.writeMu.Unlock()
	rpc.trace.StreamLine(turntrace.TraceIn, rpc.scrub(string(data)))
	_ = rpc.stdin.SetWriteDeadline(time.Now().Add(piCommandTimeout))
	_, err = rpc.stdin.Write(append(data, '\n'))
	return err
}

func (rpc *piRPC) call(kind string, fields map[string]any, timeout time.Duration) (map[string]json.RawMessage, error) {
	rpc.mu.Lock()
	rpc.next++
	id := fmt.Sprintf("kiao-%d", rpc.next)
	response := make(chan map[string]json.RawMessage, 1)
	rpc.pending[id] = response
	rpc.mu.Unlock()
	defer func() { rpc.mu.Lock(); delete(rpc.pending, id); rpc.mu.Unlock() }()
	request := map[string]any{"type": kind, "id": id}
	for k, v := range fields {
		request[k] = v
	}
	if err := rpc.send(request); err != nil {
		return nil, err
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case reply := <-response:
		if string(reply["success"]) != "true" {
			return nil, &piCommandRejected{message: protocol.OrDefault(rawString(reply, "error"), "Pi rejected "+kind)}
		}
		var data map[string]json.RawMessage
		_ = json.Unmarshal(reply["data"], &data)
		return data, nil
	case <-rpc.done:
		return nil, errors.New("Pi RPC process closed")
	case <-timer.C:
		return nil, fmt.Errorf("Pi RPC %s timed out", kind)
	}
}

// close waits for the supervisor's descendant cleanup before releasing a turn.
// The reader is drained even if setup failed before the driver started consuming events.
func (rpc *piRPC) close() {
	rpc.stopOnce.Do(func() {
		_ = rpc.stdin.Close()
		timer := time.NewTimer(3 * time.Second)
		select {
		case <-rpc.Process.Done:
		case <-timer.C:
			rpc.Process.Stop()
			<-rpc.Process.Done
		}
		timer.Stop()
		// A dead process cannot produce more records; permit the reader to drop a full buffer.
		<-rpc.done
		<-rpc.errDone
	})
}

func rawString(record map[string]json.RawMessage, key string) string {
	var out string
	_ = json.Unmarshal(record[key], &out)
	return out
}

func (rpc *piRPC) exitDetails() string {
	rpc.close()
	rpc.mu.Lock()
	defer rpc.mu.Unlock()
	details := []string{fmt.Sprintf("Pi exit status: %d", rpc.Process.ExitCode)}
	if rpc.Process.Err != nil {
		details = append(details, rpc.Process.Err.Error())
	}
	if rpc.readErr != nil {
		details = append(details, rpc.readErr.Error())
	}
	if output := strings.TrimSpace(rpc.stderrTail); output != "" {
		details = append(details, "Pi error output:\n"+output)
	}
	return rpc.scrub(strings.Join(details, "\n"))
}

// materializePi composes only disposable configuration. Durable sessions live elsewhere.
// Isolated auth.json plus private provider aliases prevent host credentials winning precedence.
func materializePi(resolved *agentapi.PiResolvedProfile, root, mcp string) (string, []string, []string, error) {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", nil, nil, err
	}
	dir, err := os.MkdirTemp(root, "turn-")
	if err != nil {
		return "", nil, nil, err
	}
	ok := false
	defer func() {
		if !ok {
			os.RemoveAll(dir)
		}
	}()
	write := func(name string, value any) error {
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dir, name), raw, 0o600)
	}
	providers := map[string]any{}
	env := []string{"PI_CODING_AGENT_DIR=" + dir}
	secrets := []string{}
	// Preserve explicitly referenced toolbox credentials, without restoring ambient model auth.
	for _, match := range regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`).FindAllStringSubmatch(mcp, -1) {
		name := match[1]
		if strings.HasPrefix(name, "PI_") || strings.HasPrefix(name, "KIAO_PI_") || name == "KIAO_MCP_TURN_TOKEN" {
			continue
		}
		if value, ok := os.LookupEnv(name); ok {
			env = append(env, name+"="+value)
			secrets = append(secrets, value)
		}
	}
	for i, c := range resolved.Profile.Connections {
		key, present := resolved.Keys[c.Provider]
		if !present {
			continue
		}
		name := fmt.Sprintf("KIAO_PI_KEY_%d", i)
		env = append(env, name+"="+key)
		secrets = append(secrets, key)
		providers[c.Provider] = map[string]any{"api": c.API, "baseUrl": c.BaseURL, "apiKey": "${" + name + "}", "models": c.Models}
	}
	if err := write("models.json", map[string]any{"providers": providers}); err != nil {
		return "", nil, nil, err
	}
	if err := write("auth.json", map[string]any{}); err != nil {
		return "", nil, nil, err
	}
	if err := write("settings.json", map[string]any{"compaction": map[string]any{"enabled": true}, "updateCheck": false}); err != nil {
		return "", nil, nil, err
	}
	// Always write mcp.json, including an empty selection; --no-approve excludes project overrides.
	if mcp == "" {
		mcp = `{"mcpServers":{}}`
	}
	if err := os.WriteFile(filepath.Join(dir, "mcp.json"), []byte(mcp), 0o600); err != nil {
		return "", nil, nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, "kiao-bridge.ts"), piBridge, 0o600); err != nil {
		return "", nil, nil, err
	}
	ok = true
	return dir, env, secrets, nil
}

func piEnvironment(additions []string) []string {
	// An explicit profile is the only model credential source. Keep system/proxy settings and PATH,
	// discard ambient provider and Pi overrides. Custom connection values use KIAO_PI_KEY_n only.
	var env []string
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(name, "PI_") || strings.HasPrefix(name, "KIAO_PI_") || strings.HasSuffix(name, "_API_KEY") || strings.HasSuffix(name, "_AUTH_TOKEN") || strings.HasPrefix(name, "AWS_") || strings.HasPrefix(name, "GOOGLE_") {
			continue
		}
		env = append(env, entry)
	}
	return append(env, additions...)
}

func piArgs(dir, sessionDir, session string) []string {
	args := []string{"--mode", "rpc", "--no-approve", "--no-extensions", "--extension", "builtin:mcp", "--extension", "builtin:codemode", "--extension", filepath.Join(dir, "kiao-bridge.ts"), "--no-skills", "--no-prompt-templates", "--session-dir", sessionDir}
	if session != "" {
		args = append(args, "--session", session)
	}
	return args
}

func piVerifyResources(resources []agentapi.PiResource) ([]string, error) {
	var paths []string
	for _, r := range resources {
		data, err := os.ReadFile(r.Path)
		if err != nil {
			return nil, errors.New("Pi resource is unavailable: " + filepath.Base(r.Path))
		}
		digest := sha256.Sum256(data)
		if !strings.EqualFold(hex.EncodeToString(digest[:]), r.SHA256) {
			return nil, errors.New("Pi resource integrity mismatch: " + filepath.Base(r.Path))
		}
		paths = append(paths, r.Path)
	}
	return paths, nil
}
