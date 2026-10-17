package hybridflowrunner

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"kiao/worker/internal/core"
)

// Model the npm CLI: Node launches an agent, which launches a tool. Both descendants
// keep working without their parent and ignore SIGTERM. No model or network is used.
const codexProcessFixture = `#!/usr/bin/env node
const fs = require('node:fs');
const {spawn} = require('node:child_process');
if (process.argv.includes('--version')) {
  console.log('codex-lifecycle-fixture');
  process.exit(0);
}
const role = process.argv[2] === '--agent' ? 'agent' :
             process.argv[2] === '--tool' ? 'tool' :
             process.argv[2] === '--bridge' ? 'bridge' : 'launcher';
fs.writeFileSync(role + '.pid', String(process.pid));
if (role === 'bridge') {
  spawn(process.execPath, [__filename, '--tool'], {stdio: 'ignore', detached: true}).unref();
  process.exit(0);
} else if (role === 'launcher') {
  const rejectPrompt = fs.existsSync('reject-prompt');
  if (!rejectPrompt) fs.readFileSync(0);
  fs.writeFileSync('launcher.args', JSON.stringify(process.argv.slice(2)));
  const stdio = fs.existsSync('close-pipes') ? 'ignore' : ['ignore', 1, 2];
  spawn(process.execPath, [__filename, '--agent'], {stdio});
  process.stdout.write('{"type":"thread.started","thread_id":"lifecycle-session"}\n');
  let rejected = false;
  setInterval(() => {
    if (fs.existsSync('exit-launcher')) process.exit(0);
    if (rejectPrompt && !rejected && fs.existsSync('tool.pid')) {
      const pid = fs.readFileSync('tool.pid', 'utf8');
      if (fs.existsSync('tool.' + pid + '.tools')) {
        fs.closeSync(0);
        rejected = true;
      }
    }
  }, 10);
} else {
  process.on('SIGTERM', () => {});
  if (role === 'agent') {
    const childRole = fs.existsSync('orphan-tool') ? '--bridge' : '--tool';
    spawn(process.execPath, [__filename, childRole], {
      stdio: 'ignore', detached: fs.existsSync('separate-tool-group')
    });
  }
  setInterval(() => fs.appendFileSync(role + '.' + process.pid + '.tools', 'work\n'), 10);
}
`

func codexProcessBinary(t *testing.T, dir string) string {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("Node is required to reproduce the Codex npm launcher")
	}
	binary := stubHostBinary(t, dir, "codex-launcher.cjs", codexProcessFixture)
	// Also clean up the broken implementation when running the regression before its fix.
	t.Cleanup(func() {
		for _, role := range []string{"tool", "agent", "launcher"} {
			if raw, err := os.ReadFile(filepath.Join(dir, role+".pid")); err == nil {
				if pid, err := strconv.Atoi(string(raw)); err == nil {
					_ = syscall.Kill(pid, syscall.SIGKILL)
				}
			}
		}
	})
	return binary
}

func waitLifecycle(t *testing.T, message string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal(message)
}

func fixturePIDs(t *testing.T, dir string) []int {
	t.Helper()
	var pids []int
	for _, role := range []string{"launcher", "agent", "tool"} {
		path := filepath.Join(dir, role+".pid")
		waitLifecycle(t, "missing "+role+" PID", func() bool {
			pid, _ := os.ReadFile(path)
			return len(pid) > 0
		})
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		pid, err := strconv.Atoi(string(raw))
		if err != nil {
			t.Fatal(err)
		}
		pids = append(pids, pid)
	}
	waitLifecycle(t, "the descendant never executed its tool", func() bool {
		raw, _ := os.ReadFile(filepath.Join(dir, fmt.Sprintf("tool.%d.tools", pids[2])))
		return len(raw) > 0
	})
	return pids
}

// A zombie cannot execute tools; PID 1 may not have reaped an orphan yet.
func processCanRun(pid int) bool {
	raw, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if os.IsNotExist(err) {
		return false
	}
	if err != nil {
		return true
	}
	fields := strings.Fields(string(raw)[strings.LastIndexByte(string(raw), ')')+1:])
	return len(fields) == 0 || (fields[0] != "Z" && fields[0] != "X")
}

func assertFixtureStopped(t *testing.T, dir string, pids []int) {
	t.Helper()
	for _, pid := range pids {
		waitLifecycle(t, fmt.Sprintf("process %d survived and can still execute tools", pid), func() bool {
			return !processCanRun(pid)
		})
	}
	path := filepath.Join(dir, fmt.Sprintf("tool.%d.tools", pids[2]))
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(75 * time.Millisecond)
	after, err := os.ReadFile(path)
	if err != nil || string(before) != string(after) {
		t.Fatal("the orphaned descendant is still executing tools")
	}
}

func TestCodexFailedPromptStopsDescendants(t *testing.T) {
	dir := t.TempDir()
	binary := codexProcessBinary(t, dir)
	if err := os.WriteFile(filepath.Join(dir, "reject-prompt"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	driver := &codexDriver{binary: binary, events: make(chan AgentEvent)}
	t.Cleanup(driver.Stop)
	// Exceed the pipe buffer so the launcher can start its descendants before
	// closing stdin. Spawn's failure must clean them up before releasing the turn.
	err := driver.Spawn(AgentRun{Prompt: strings.Repeat("prompt", 256*1024), WorkDir: dir,
		PermissionMode: permissionModeBypass, AllowBypass: true})
	if err == nil || !strings.Contains(err.Error(), "prompt could not be sent") {
		t.Fatalf("Spawn = %v, want a failed prompt write", err)
	}
	assertFixtureStopped(t, dir, fixturePIDs(t, dir))
}

func TestCodexStopBeforeSpawn(t *testing.T) {
	dir := t.TempDir()
	driver := &codexDriver{binary: codexProcessBinary(t, dir), events: make(chan AgentEvent)}
	driver.Stop()
	err := driver.Spawn(AgentRun{Prompt: "work", WorkDir: dir,
		PermissionMode: permissionModeBypass, AllowBypass: true})
	if err == nil {
		events := drainDriverEvents(t, driver, 3*time.Second)
		if len(events) == 0 || events[len(events)-1].ExitCode != -1 {
			t.Fatalf("events = %+v, want the pre-cancelled process to end", events)
		}
	} else if !strings.Contains(err.Error(), "prompt could not be sent") {
		t.Fatalf("Spawn = %v", err)
	}
	if driver.process == nil {
		t.Fatal("the early cancellation did not exercise supervisor publication")
	}
	awaitLifecycleSignal(t, driver.process.done, "the pre-cancelled supervisor survived")
	if processCanRun(driver.process.pid) || processCanRun(driver.process.cmd.Process.Pid) {
		t.Fatal("the early cancellation left a process alive")
	}
}

func TestCodexInterruptedConversationResumesAfterProcessesExit(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	binary := codexProcessBinary(t, cfg.RootPath)
	hub := newClaudeHub(cfg, store)
	t.Cleanup(hub.shutdown)
	hub.agents = &agentRegistry{entries: []agentEntry{
		{name: agentCodex, agent: codexAgentAt(cfg, binary), allowed: true},
	}}
	conversation, err := store.create(conversationMeta{Agent: agentCodex, Owner: "tester",
		PermissionMode: permissionModeBypass})
	if err != nil {
		t.Fatal(err)
	}
	start := func(prompt string) (*claudeJob, *turnRefusal) {
		return hub.startTurnFor(nil, core.Identity{User: "tester"}, turnRequest{
			conversationID: conversation.ID, prompt: prompt})
	}
	first, refusal := start("first")
	if refusal != nil || first == nil {
		t.Fatalf("start = %+v", refusal)
	}
	pids := fixturePIDs(t, cfg.RootPath)
	waitLifecycle(t, "the session was not recorded", func() bool {
		meta, err := store.get(conversation.ID)
		return err == nil && meta.SessionID == "lifecycle-session"
	})
	if !hub.stopProcess(conversation.ID, "tester") {
		t.Fatal("the real process turn was not interrupted")
	}
	awaitLifecycleSignal(t, first.settled, "the interrupted turn was not recorded")
	assertFixtureStopped(t, cfg.RootPath, pids)
	waitLifecycle(t, "the interrupted process stream never closed", func() bool {
		first.mu.Lock()
		defer first.mu.Unlock()
		return !first.processPending
	})
	second, refusal := start("second")
	if refusal != nil || second == nil {
		t.Fatalf("resume = %+v", refusal)
	}
	waitLifecycle(t, "the resumed turn never started a new agent", func() bool {
		raw, _ := os.ReadFile(filepath.Join(cfg.RootPath, "tool.pid"))
		pid, _ := strconv.Atoi(string(raw))
		return pid > 0 && pid != pids[2]
	})
	resumed := fixturePIDs(t, cfg.RootPath)
	args := mustRead(t, filepath.Join(cfg.RootPath, "launcher.args"))
	if !strings.Contains(args, `"resume"`) || !strings.Contains(args, `"lifecycle-session"`) {
		t.Fatalf("resumed argv = %s, want the interrupted session", args)
	}
	assertFixtureStopped(t, cfg.RootPath, pids)
	if !hub.stopProcess(conversation.ID, "tester") {
		t.Fatal("the resumed turn was not interrupted")
	}
	assertFixtureStopped(t, cfg.RootPath, resumed)
}

func TestCodexStopPreservesIndependentlyOwnedWork(t *testing.T) {
	dir := t.TempDir()
	binary := codexProcessBinary(t, dir)
	// Stand in for a systemd manager on a remote host: the operation belongs to
	// its manager, rather than to the agent's local process group.
	managedDir := t.TempDir()
	managed := exec.Command("node", binary, "--tool")
	managed.Dir = managedDir
	managed.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := managed.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = managed.Process.Kill()
		_ = managed.Wait()
	})
	heartbeat := filepath.Join(managedDir, fmt.Sprintf("tool.%d.tools", managed.Process.Pid))
	waitLifecycle(t, "the independently owned operation never started", func() bool {
		raw, _ := os.ReadFile(heartbeat)
		return len(raw) > 0
	})
	driver := &codexDriver{binary: binary, events: make(chan AgentEvent)}
	t.Cleanup(driver.Stop)
	if err := driver.Spawn(AgentRun{Prompt: "work", WorkDir: dir,
		PermissionMode: permissionModeBypass, AllowBypass: true}); err != nil {
		t.Fatal(err)
	}
	pids := fixturePIDs(t, dir)
	driver.Stop()
	assertFixtureStopped(t, dir, pids)
	drainDriverEvents(t, driver, 3*time.Second)
	before, err := os.ReadFile(heartbeat)
	if err != nil {
		t.Fatal(err)
	}
	waitLifecycle(t, "stopping Codex also stopped independently owned work", func() bool {
		after, _ := os.ReadFile(heartbeat)
		return len(after) > len(before) && processCanRun(managed.Process.Pid)
	})
}

func TestCodexProcessLifecycle(t *testing.T) {
	for _, ending := range []string{"interrupt", "launcher-exit-inherited-pipes", "launcher-exit-closed-pipes",
		"launcher-killed", "interrupt-separate-tool-group", "launcher-exit-separate-tool-group",
		"interrupt-adopted-tool", "launcher-exit-adopted-tool"} {
		t.Run(ending, func(t *testing.T) {
			dir := t.TempDir()
			binary := codexProcessBinary(t, dir)
			if strings.HasSuffix(ending, "separate-tool-group") {
				if err := os.WriteFile(filepath.Join(dir, "separate-tool-group"), nil, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if strings.HasSuffix(ending, "adopted-tool") {
				if err := os.WriteFile(filepath.Join(dir, "orphan-tool"), nil, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if ending == "launcher-exit-closed-pipes" {
				if err := os.WriteFile(filepath.Join(dir, "close-pipes"), nil, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			driver := &codexDriver{binary: binary, events: make(chan AgentEvent)}
			t.Cleanup(driver.Stop)
			if err := driver.Spawn(AgentRun{Prompt: "work", WorkDir: dir,
				PermissionMode: permissionModeBypass, AllowBypass: true}); err != nil {
				t.Fatal(err)
			}
			pids := fixturePIDs(t, dir)
			if strings.HasSuffix(ending, "adopted-tool") {
				waitLifecycle(t, "the tool was not adopted by the turn supervisor", func() bool {
					raw, _ := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pids[2]))
					fields := strings.Fields(string(raw)[strings.LastIndexByte(string(raw), ')')+1:])
					return len(fields) > 1 && fields[1] == strconv.Itoa(driver.process.cmd.Process.Pid)
				})
			}
			if strings.HasPrefix(ending, "interrupt") {
				driver.Stop()
				driver.Stop() // idempotent, including after the launcher exits
			} else if ending == "launcher-killed" {
				if err := syscall.Kill(pids[0], syscall.SIGKILL); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(filepath.Join(dir, "exit-launcher"), nil, 0o600); err != nil {
				t.Fatal(err)
			}
			// Cleanup must not depend on draining the unbuffered event channel first.
			assertFixtureStopped(t, dir, pids)
			events := drainDriverEvents(t, driver, 3*time.Second)
			for _, pid := range pids {
				if _, err := os.Stat(fmt.Sprintf("/proc/%d", pid)); !os.IsNotExist(err) {
					t.Errorf("process %d was stopped but not reaped: %v", pid, err)
				}
			}
			if len(events) == 0 || events[len(events)-1].Kind != agentDone {
				t.Fatalf("events = %+v, want a final done", events)
			}
			wantExit := 0
			if strings.HasPrefix(ending, "interrupt") || ending == "launcher-killed" {
				wantExit = -1
			}
			if last := events[len(events)-1]; last.ExitCode != wantExit {
				t.Fatalf("done = %+v, want launcher exit %d", last, wantExit)
			}
		})
	}
}

// Used only by TestMain's worker stand-in. The supervisor mode is dispatched
// first, so its inherited test environment cannot start another owner.
func codexOwnerMain(dir string) int {
	driver := &codexDriver{binary: filepath.Join(dir, "codex-launcher.cjs"), events: make(chan AgentEvent)}
	if err := driver.Spawn(AgentRun{Prompt: "work", WorkDir: dir,
		PermissionMode: permissionModeBypass, AllowBypass: true}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if err := os.WriteFile(filepath.Join(dir, "supervisor.pid"),
		[]byte(strconv.Itoa(driver.process.cmd.Process.Pid)), 0o600); err != nil {
		return 1
	}
	for range driver.Events() {
	}
	return 0
}

func TestCodexWorkerDisappearanceStopsDescendants(t *testing.T) {
	for _, scope := range []string{"worker", "worker-process-group"} {
		t.Run(scope, func(t *testing.T) {
			dir := t.TempDir()
			codexProcessBinary(t, dir)
			if err := os.WriteFile(filepath.Join(dir, "orphan-tool"), nil, 0o600); err != nil {
				t.Fatal(err)
			}
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			owner := exec.Command(executable)
			owner.Env = append(os.Environ(), "GO_WANT_CODEX_OWNER="+dir)
			owner.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
			if err := owner.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				_ = owner.Process.Kill()
				_ = owner.Wait()
			})
			pids := fixturePIDs(t, dir)
			waitLifecycle(t, "the worker never recorded its supervisor", func() bool {
				raw, _ := os.ReadFile(filepath.Join(dir, "supervisor.pid"))
				return len(raw) > 0
			})
			supervisorPID, err := strconv.Atoi(mustRead(t, filepath.Join(dir, "supervisor.pid")))
			if err != nil {
				t.Fatal(err)
			}
			if scope == "worker-process-group" {
				err = syscall.Kill(-owner.Process.Pid, syscall.SIGKILL)
			} else {
				err = owner.Process.Kill()
			}
			if err != nil {
				t.Fatal(err)
			}
			_ = owner.Wait()
			assertFixtureStopped(t, dir, append(pids, supervisorPID))
		})
	}
}
