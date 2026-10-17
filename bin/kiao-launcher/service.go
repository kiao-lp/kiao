package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

const shutdownEnv = "KIAO_WORKER_SHUTDOWN_COMMAND"

// Toolbox installs are shared across instances and require no root privileges.
const toolboxEnv = "KIAO_WORKER_TOOLBOX_PATH"

// Without a home, leave the panel read-only instead of guessing a writable path.
func defaultToolboxPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".local", "share", "kiao", "toolbox")
}

const mcpPathEnv = "KIAO_WORKER_MCP_PATH"

// Older installs without a bundle can still start, with those servers unavailable.
func defaultMCPPath(installDir string) string {
	bundle := filepath.Join(installDir, "kiao-mcp")
	if _, err := os.Stat(bundle); err != nil {
		return ""
	}
	return bundle
}

const catalogPathEnv = "KIAO_WORKER_TOOLBOX_CATALOG_PATH"

// Without an installed catalogue, the worker uses its embedded pub.json.
func defaultCatalogPath(installDir string) string {
	catalog := filepath.Join(installDir, "catalog")
	if _, err := os.Stat(catalog); err != nil {
		return ""
	}
	return catalog
}

const mcpServersEnv = "KIAO_WORKER_MCP_SERVERS"

// Pin the offered servers independently of changes to the service default.
func defaultMCPServers() string { return "files,hybridflow" }

// Read err only after done closes; the Wait goroutine publishes it through the channel.
type childProcess struct {
	name string
	cmd  *exec.Cmd
	done chan struct{}
	err  error
}

// Use a process group so shutdown also reaches the service's descendants.
func startChild(name string, cmd *exec.Cmd) (*childProcess, error) {
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("cannot start the %s: %w", name, err)
	}
	child := &childProcess{name: name, cmd: cmd, done: make(chan struct{})}
	go func() {
		child.err = cmd.Wait()
		close(child.done)
	}()
	return child, nil
}

// Debug auth relies on the launcher's loopback-only proxy.
// Migrations are opt-in because root may be a source repository, not a document store.
func startWorker(bin, installDir, root string, port int, migrations bool, boards hybridflowAccess) (*childProcess, error) {
	migrationsPath := ""
	if migrations {
		migrationsPath = filepath.Join(installDir, "migrations")
		if _, err := os.Stat(migrationsPath); err != nil {
			return nil, fmt.Errorf("--migrations: no migrations in %s", installDir)
		}
	}

	// A logged-in user can power off through systemd/polkit. An explicit empty override disables it.
	shutdown := "systemctl poweroff"
	if own, set := os.LookupEnv(shutdownEnv); set {
		shutdown = own
	}

	toolbox := defaultToolboxPath()
	if own, set := os.LookupEnv(toolboxEnv); set {
		toolbox = own
	}

	// Environment overrides below win even when empty, withdrawing the bundled servers or catalogue.
	mcpPath := defaultMCPPath(installDir)
	if own, set := os.LookupEnv(mcpPathEnv); set {
		mcpPath = own
	}

	mcpServers := defaultMCPServers()
	if own, set := os.LookupEnv(mcpServersEnv); set {
		mcpServers = own
	}

	catalogPath := defaultCatalogPath(installDir)
	if own, set := os.LookupEnv(catalogPathEnv); set {
		catalogPath = own
	}

	cmd := exec.Command(bin)
	// Preserve HOME and PATH for CLI credentials and tools. Override boards access even when
	// empty: it must describe this instance and its dynamically selected port.
	cmd.Env = append(os.Environ(),
		"KIAO_WORKER_ROOT_PATH="+root,
		"SERVER_PORT="+fmt.Sprint(port),
		"KIAO_WORKER_AUTH_MODE=debug",
		"KIAO_WORKER_MIGRATIONS_PATH="+migrationsPath,
		"KIAO_WORKER_HYBRIDFLOW_URL="+boards.url,
		"KIAO_WORKER_HYBRIDFLOW_TOKEN="+boards.token,
		shutdownEnv+"="+shutdown,
		toolboxEnv+"="+toolbox,
		mcpPathEnv+"="+mcpPath,
		mcpServersEnv+"="+mcpServers,
		catalogPathEnv+"="+catalogPath,
		"PATH="+pathWithToolbox(toolbox),
	)
	return startChild("worker", cmd)
}

// Prepend the panel's install directory so agent discovery and execution use its CLIs.
// An empty toolbox leaves PATH untouched.
func pathWithToolbox(toolbox string) string {
	path := os.Getenv("PATH")
	if toolbox == "" {
		return path
	}
	bin := filepath.Join(toolbox, "bin")
	if path == "" {
		return bin
	}
	return bin + string(os.PathListSeparator) + path
}

// exitError requires done to be closed.
func (s *childProcess) exitError() error {
	if s.err != nil {
		return s.err
	}
	return errors.New("it exited")
}

func (s *childProcess) stop() {
	select {
	case <-s.done:
		return
	default:
	}
	// A negative PID signals the whole process group, including CLI and git descendants.
	pgid := -s.cmd.Process.Pid
	syscall.Kill(pgid, syscall.SIGTERM)
	select {
	case <-s.done:
	case <-time.After(10 * time.Second):
		syscall.Kill(pgid, syscall.SIGKILL)
		<-s.done
	}
}
