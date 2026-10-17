package toolbox

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"kiao/worker/internal/core"
)

// What an installed MCP server actually is, asked of the server itself.
//
// Two questions with one answer. *Did the install work?* — a package that resolved, downloaded and
// wrote its files can still fail to start, and the only place that would otherwise show up is a
// turn whose tools are quietly missing, which is not where anyone looks. bin/stage-kiao-mcp.sh
// already smoke-starts every kiao-mcp entrypoint at build time for exactly this reason; this is the
// same check, run where the install happened. *And what will it cost?* — every tool a server
// declares is sent with every single request a turn makes. Two domain servers alone are tens of
// thousands of characters. A panel that offers seven more servers and does not say what they weigh
// is offering a bill nobody can read.

// probeTimeout bounds one handshake. A stdio server that has not answered `initialize` and
// `tools/list` in this long is not one a turn should wait on either.
const probeTimeout = 60 * time.Second

// stderrKept bounds what is remembered of what a server printed while failing. Enough for an
// argparse usage line or the last frames of a Python traceback, and small enough that a chatty
// server does not fill the panel with its own warnings.
const stderrKept = 4 << 10

// probeResult is what the handshake learned.
type probeResult struct {
	Tools     int
	ToolBytes int
}

// probeServer starts the server the way a turn would, completes the MCP initialize handshake, asks
// for its tool list, and shuts it down. Speaking the protocol directly rather than through an SDK
// keeps this to one file and one dependency-free exchange of three JSON lines — which is all the
// question needs.
func probeServer(cfg *Config, command string, args []string, env map[string]string) (probeResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = cfg.Prefix
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	// The prefix's binaries ahead of PATH, so a server that shells out to node or to a Python it
	// was installed beside finds the one this panel put there.
	cmd.Env = append(cmd.Env, "PATH="+cfg.installEnv()["PATH"])

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return probeResult{}, fmt.Errorf("cannot write to %s: %w", filepath.Base(command), err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return probeResult{}, fmt.Errorf("cannot read from %s: %w", filepath.Base(command), err)
	}
	// Stderr is where a server that will not start says why, and it is the difference between a
	// panel showing "EOF" and one showing "error: the following arguments are required: command".
	// Kept as a bounded tail rather than dropped, and as a writer rather than a pipe — exec drains
	// a writer, where a pipe nobody reads eventually blocks the server on a full buffer.
	said := &stderrTail{}
	cmd.Stderr = said

	if err := cmd.Start(); err != nil {
		return probeResult{}, fmt.Errorf("%s does not start: %w", filepath.Base(command), err)
	}
	// Whatever happens below, the process does not outlive this function. Shutting it down is also
	// what completes its stderr: exec copies that on a goroutine of its own, and Wait is what joins
	// it — so a failure quotes what the server said only if it stops the server first.
	var once sync.Once
	stop := func() {
		once.Do(func() {
			_ = stdin.Close()
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		})
	}
	defer stop()

	// fail is every way this can end badly: stop the server, then report it in its own words.
	fail := func(err error) (probeResult, error) {
		stop()
		return probeResult{}, said.explain(err)
	}

	// **A write that fails is not reported as a write.** A server that died on start — the wrong
	// console script, an import that raises — leaves a pipe with no reader, and the very next write
	// returns EPIPE. Reporting that would name the pipe ("write |1: broken pipe") where the reason
	// is on the server's stderr and one read away; and which of the two happens first is a race
	// between this process and a child that is already exiting, so the same failure was reported
	// two different ways on two runs. So a write is best-effort and the *read* is what diagnoses:
	// it ends in EOF, and the EOF branch below is the one that quotes what the server said.
	send := func(v any) {
		if body, err := json.Marshal(v); err == nil {
			_, _ = stdin.Write(append(body, '\n'))
		}
	}

	// The three lines of an MCP stdio conversation: initialize, the notification that says the
	// client is ready, and the question actually being asked.
	send(map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "initialize",
		"params": map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]any{"name": "kiao-toolbox", "version": "1"},
		},
	})

	reader := bufio.NewReaderSize(stdout, 1<<20)
	if _, err := readResponse(reader, 1); err != nil {
		return fail(fmt.Errorf("%s did not complete the MCP handshake: %s",
			filepath.Base(command), handshakeCause(err)))
	}
	send(map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"})
	send(map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": map[string]any{}})

	body, err := readResponse(reader, 2)
	if err != nil {
		return fail(fmt.Errorf("%s did not answer tools/list: %s",
			filepath.Base(command), handshakeCause(err)))
	}
	var listed struct {
		Result struct {
			Tools []json.RawMessage `json:"tools"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &listed); err != nil {
		return fail(fmt.Errorf("%s answered tools/list with something else: %w",
			filepath.Base(command), err))
	}

	result := probeResult{Tools: len(listed.Result.Tools)}
	for _, tool := range listed.Result.Tools {
		result.ToolBytes += len(tool)
	}
	return result, nil
}

// readResponse reads lines until one carries the id being waited for. A server may interleave
// notifications and log frames with its answers, so the id — not the position — is what identifies
// a reply.
func readResponse(reader *bufio.Reader, id int) ([]byte, error) {
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) == 0 && err != nil {
			return nil, err
		}
		trimmed := strings.TrimSpace(string(line))
		if trimmed == "" {
			if err != nil {
				return nil, err
			}
			continue
		}
		var envelope struct {
			ID    *int `json:"id"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(trimmed), &envelope) == nil && envelope.ID != nil && *envelope.ID == id {
			if envelope.Error != nil {
				return nil, fmt.Errorf("%s", envelope.Error.Message)
			}
			return []byte(trimmed), nil
		}
		if err != nil {
			return nil, err
		}
	}
}

// handshakeCause says what a read that went nowhere actually was. A server that dies on start —
// the wrong console script, an import that raises, a missing key it refuses to run without — ends
// the conversation at the first read, and "EOF" is the least helpful way to report the commonest
// failure there is.
func handshakeCause(err error) string {
	if errors.Is(err, io.EOF) {
		return "it exited without answering"
	}
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "file already closed") {
		return fmt.Sprintf("it answered nothing in %ds", int(probeTimeout.Seconds()))
	}
	return err.Error()
}

// stderrTail keeps the last of what a server wrote to stderr, so that a failure can quote it.
//
// A writer rather than a pipe read at the end: exec drains a writer on a goroutine of its own,
// where an unread pipe would eventually block the very server this is trying to start.
type stderrTail struct {
	mu   sync.Mutex
	kept []byte
}

func (t *stderrTail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.kept = append(t.kept, p...)
	if len(t.kept) > stderrKept {
		t.kept = t.kept[len(t.kept)-stderrKept:]
	}
	return len(p), nil
}

// explain adds what the server said to a failure. The *last* lines, not the first: a Python
// traceback ends with the exception and an argparse refusal ends with the argument it wanted, and
// both are the sentence somebody has to read to know what to do next.
func (t *stderrTail) explain(err error) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	var lines []string
	for _, line := range strings.Split(string(t.kept), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return err
	}
	if len(lines) > 3 {
		lines = lines[len(lines)-3:]
	}
	return fmt.Errorf("%w; it said: %s", err, strings.Join(lines, " / "))
}

// ── presence, for a component this service did not install ────────────────────

// present answers whether a runtime is on this machine at all, and what version — including one
// that was there before the panel existed. The prefix is looked in first, because a machine may
// well have both and the one a turn will use is this service's.
//
// The distinction matters for what the row offers: something the ledger claims is `installed` and
// something merely `present` look the same to a turn and are completely different to an uninstall
// button, which has no business removing a JDK the operator installed themselves.
//
// **All of it, or none of it.** A runtime is what its dependents reach for, not one file with the
// right name: Ubuntu's `nodejs` package is a node with no npm beside it, and calling that Node
// present is what made the panel skip installing a real one and then fail an npm-channel install on
// a missing npm. The second answer names the first thing that was not found, so the row can say why
// it is offering an install for something the machine appears to have.
func present(cfg *Config, recipe Recipe) (version string, missing string, ok bool) {
	if recipe.Bin == "" {
		return "", "", false
	}
	path, found := locate(cfg, recipe.Bin)
	if !found {
		return "", recipe.Bin, false
	}
	for _, also := range recipe.AlsoProvides {
		if _, found := locate(cfg, also); !found {
			return "", also, false
		}
	}
	return probeVersion(cfg, path), "", true
}

// locate finds one executable, the toolbox's copy first and the machine's after. Absolute either
// way: what is answered is asked for a version and named in a reason, and neither wants a bare name.
func locate(cfg *Config, bin string) (string, bool) {
	candidates := []string{
		filepath.Join(cfg.binDir(), bin),
		filepath.Join(cfg.nodeDir(), "bin", bin),
		filepath.Join(cfg.javaDir(), "bin", bin),
	}
	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate, true
		}
	}
	if path, err := exec.LookPath(bin); err == nil {
		return path, true
	}
	return "", false
}

// probeVersion asks a binary what it is: `--version`, which node, uv, python and java 21 all answer,
// then `-version`, the only spelling ffmpeg knows — it exits 8 on the other — and then `-V`, the
// only spelling dot knows, which it prints to stderr. A tool that will not say is still installed,
// so this never fails.
func probeVersion(cfg *Config, bin string) string {
	for _, flag := range []string{"--version", "-version", "-V"} {
		res := core.RunProc([]string{bin, flag}, cfg.Prefix, 15*time.Second, cfg.installEnv())
		if res.OK() {
			return versionLine(res.Combined())
		}
	}
	return ""
}

// versionLine is the first line of what a tool says it is, without the copyright ffmpeg follows its
// version with on that same line.
func versionLine(said string) string {
	line, _, _ := strings.Cut(firstLine(said), " Copyright")
	return strings.TrimSpace(line)
}

