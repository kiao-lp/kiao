package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
)

// instance is what one running kiao writes about itself, so that a second command on the same
// folder finds the first instead of colliding with it, and so that --list and --stop have
// something to work from. It is a cache, never an authority: every reader confirms it against the
// port it names before believing a word of it.
type instance struct {
	Root      string    `json:"root"`
	WebPort   int       `json:"webPort"`
	WorkerPort int       `json:"workerPort"`
	PID       int       `json:"pid"`      // the launcher
	WorkerPID  int       `json:"workerPid"` // the worker it started
	Started   time.Time `json:"started"`
	Version   string    `json:"version,omitempty"`
	LogFile   string    `json:"logFile,omitempty"`
}

func (i instance) url() string {
	// The SPA is built with base /dashboard/, the same path it has in the image and in a server deployment.
	return fmt.Sprintf("http://localhost:%d/dashboard/", i.WebPort)
}

// stateDir holds the registry and the logs of detached instances. Under XDG state rather than
// config: it is entirely derived from what is running, and losing it costs nothing.
func stateDir() (string, error) {
	base, err := stateBase()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "kiao")
	return dir, os.MkdirAll(dir, 0o755)
}

// stateBase is the XDG state directory the registry lives under.
func stateBase() (string, error) {
	if base := os.Getenv("XDG_STATE_HOME"); base != "" {
		return base, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "state"), nil
}

// legacyStateDir is where the registry lived when the executable was still called kiao-dcms.
// Read — never written — so that --list and --stop still see instances an upgrade did not
// restart, and a start on their folder finds them instead of colliding with them.
func legacyStateDir() (string, error) {
	base, err := stateBase()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "kiao-dcms", "instances"), nil
}

// A folder is addressed by the digest of its absolute path: the path itself is not a filename, and
// two different folders with the same basename have to land on two different entries.
func rootKey(root string) string {
	sum := sha256.Sum256([]byte(root))
	return hex.EncodeToString(sum[:8])
}

func instancePath(root string) (string, error) {
	dir, err := stateDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "instances")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, rootKey(root)+".json")
	if fileExists(path) {
		return path, nil
	}
	// An entry the pre-rename executable left behind: read it where it is, so a start on
	// the folder reuses the instance instead of dying on the store lock it holds.
	if legacy, err := legacyStateDir(); err == nil {
		if legacyPath := filepath.Join(legacy, rootKey(root)+".json"); fileExists(legacyPath) {
			return legacyPath, nil
		}
	}
	return path, nil
}

func instanceLogPath(root string) (string, error) {
	dir, err := stateDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, filepath.Base(root)+"-"+rootKey(root)+".log"), nil
}

func (i instance) save() error {
	// Always the new directory: the legacy one is read, never written.
	dir, err := stateDir()
	if err != nil {
		return err
	}
	dir = filepath.Join(dir, "instances")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, rootKey(i.Root)+".json")
	data, err := json.MarshalIndent(i, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

func (i instance) remove() {
	if path, err := instancePath(i.Root); err == nil {
		os.Remove(path)
	}
}

func readInstance(path string) (instance, bool) {
	var i instance
	data, err := os.ReadFile(path)
	if err != nil {
		return i, false
	}
	if err := json.Unmarshal(data, &i); err != nil {
		return i, false
	}
	return i, i.Root != "" && i.WebPort != 0
}

// liveInstance answers whether this folder is already served, by asking the port the registry
// names rather than by trusting the file. A stale entry — a machine that was rebooted, a launcher
// that was killed outright — is cleaned up here, leftover worker included, because that
// process would otherwise still hold the store's state lock and refuse the start about to follow.
func liveInstance(root string) (instance, bool) {
	path, err := instancePath(root)
	if err != nil {
		return instance{}, false
	}
	i, ok := readInstance(path)
	if !ok {
		os.Remove(path)
		return instance{}, false
	}
	if i.serving() {
		return i, true
	}
	i.killLeftovers()
	os.Remove(path)
	return instance{}, false
}

// serving reports whether the recorded web port is answering for the recorded folder. The folder is
// part of the question: ports are recycled, and an answer from something else on that port must not
// pass for this instance.
func (i instance) serving() bool {
	client := &http.Client{Timeout: 2 * time.Second, Transport: loopbackTransport}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/healthz", i.WebPort))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var health struct {
		Service string `json:"service"`
		Root    string `json:"root"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return false
	}
	return (health.Service == "kiao" || health.Service == "kiao-dcms") && health.Root == i.Root
}

func alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// Signal 0 is the portable "does this process exist and may I signal it".
	return proc.Signal(syscall.Signal(0)) == nil
}

// killLeftovers deals with the worker of an instance whose launcher is gone — the only way
// that happens is a SIGKILL or a crash, and what it leaves behind holds the store's state lock.
// The PID is checked against what the process actually is before signalling it: PIDs are reused,
// and a stale registry entry is exactly the case where the number may since have become somebody
// else's.
func (i instance) killLeftovers() {
	if !alive(i.WorkerPID) {
		return
	}
	cmdline, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", i.WorkerPID))
	if err != nil {
		return
	}
	// argv[0] is the binary: it must be the worker itself, not merely a command line
	// mentioning one — "worker" as a substring would match half the machine.
	if argv := strings.Split(string(cmdline), "\x00"); len(argv) == 0 || filepath.Base(argv[0]) != "worker" {
		return
	}
	if proc, err := os.FindProcess(i.WorkerPID); err == nil {
		proc.Signal(syscall.SIGTERM)
	}
}

func allInstances() ([]instance, error) {
	dir, err := stateDir()
	if err != nil {
		return nil, err
	}
	dirs := []string{filepath.Join(dir, "instances")}
	// The pre-rename registry beside it: --list and --stop all still see instances an
	// upgrade did not restart. Stale entries age out here exactly like new ones.
	if legacy, err := legacyStateDir(); err == nil {
		dirs = append(dirs, legacy)
	}
	var live []instance
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			path := filepath.Join(dir, entry.Name())
			i, ok := readInstance(path)
			if !ok || !i.serving() {
				if ok {
					i.killLeftovers()
				}
				os.Remove(path)
				continue
			}
			live = append(live, i)
		}
	}
	sort.Slice(live, func(a, b int) bool { return live[a].Root < live[b].Root })
	return live, nil
}

func list() error {
	live, err := allInstances()
	if err != nil {
		return err
	}
	if len(live) == 0 {
		fmt.Println("no kiao instance is running")
		return nil
	}
	for _, i := range live {
		fmt.Printf("%s\n  %s  (pid %d, up %s)\n", i.Root, i.url(), i.PID, uptime(i.Started))
	}
	return nil
}

func uptime(since time.Time) string {
	d := time.Since(since).Round(time.Minute)
	if d < time.Minute {
		return "less than a minute"
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	return fmt.Sprintf("%dh%02dm", int(d.Hours()), int(d.Minutes())%60)
}

func stop(target string) error {
	var targets []instance
	if target == "all" {
		live, err := allInstances()
		if err != nil {
			return err
		}
		targets = live
		if len(targets) == 0 {
			fmt.Println("no kiao instance is running")
			return nil
		}
	} else {
		root, err := resolveRoot(target)
		if err != nil {
			return err
		}
		i, ok := liveInstance(root)
		if !ok {
			return fmt.Errorf("no kiao instance on %s", root)
		}
		targets = []instance{i}
	}

	for _, i := range targets {
		// SIGTERM to the launcher, which stops its worker and clears its own entry — the
		// same path Ctrl+C takes in a foreground instance.
		if proc, err := os.FindProcess(i.PID); err == nil {
			proc.Signal(syscall.SIGTERM)
		}
		deadline := time.Now().Add(10 * time.Second)
		for alive(i.PID) && time.Now().Before(deadline) {
			time.Sleep(100 * time.Millisecond)
		}
		if alive(i.PID) {
			if proc, err := os.FindProcess(i.PID); err == nil {
				proc.Signal(syscall.SIGKILL)
			}
			i.killLeftovers()
			i.remove()
			fmt.Printf("killed %s\n", i.Root)
			continue
		}
		fmt.Printf("stopped %s\n", i.Root)
	}
	return nil
}
