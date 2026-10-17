// kiao runs KIAO — DCMS (Dashboard + worker) and hybridflow (the boards UI + the store) —
// over one folder, on the machine itself.
//
// It is the no-Docker counterpart of the kiao image: the same halves, plus a PlantUML
// renderer, but started as ordinary processes of the person who typed the command, on ports nobody
// has to choose. One folder per instance, several instances at a time, the way an editor is opened
// on a project — which is what this is for.
//
// The parts it starts are not in this binary. bin/install-kiao-executable.sh builds the SPA, the
// worker and this launcher, and lays all three out in one directory; everything below finds
// them through home(). Running it from a source tree is a matter of pointing KIAO_HOME at
// such a directory.
package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Stamped in at build time by the install script: the version it built from, and the directory it
// installed into. The latter is a fallback for a binary that was copied somewhere rather than
// symlinked from the install directory, in which case the path next to the executable says nothing.
var (
	version       = "dev"
	installedHome = ""
)

const (
	// The port scan. Deliberately below 49152: 49152–65535 is the Windows ephemeral pool, and on
	// WSL2 with mirrored networking anything up there is intermittently re-reserved out from under
	// a listener (see config/local/.env-local). 48400 starts above the fixed local-start ports
	// (482xx–483xx) so a kiao instance and bin/local-start-kiao.sh never contend.
	portBase = 48400
	portMax  = 49150

	// Set on the re-executed child of --detach, so it knows not to detach again.
	detachedEnv = "KIAO_DETACHED"

	// homeEnv is where the installed parts are when the binary cannot tell from its own
	// path. homeEnvLegacy is the name it had when the executable was still called kiao-dcms;
	// honoured so an export in a profile keeps working after the rename.
	homeEnv       = "KIAO_HOME"
	homeEnvLegacy = "KIAO_DCMS_HOME"
)

type options struct {
	root        string
	webPort     int // 0 = take the next free one
	detach      bool
	openBrowser bool
	migrations  bool   // run the file-store migrations at startup — off unless asked for
	plantuml    string // explicit renderer: a plantuml.jar, or a command that takes -tsvg -pipe
	plantumlURL string // an existing PlantUML server to proxy to, instead of rendering here
}

// errInterrupted is a Ctrl+C, which is how an instance is meant to end and not a failure.
var errInterrupted = errors.New("interrupted")

func main() {
	err := dispatch(os.Args[1:])
	switch {
	case errors.Is(err, errInterrupted):
		fmt.Println("stopping...")
	case err != nil:
		fmt.Fprintln(os.Stderr, "kiao: "+err.Error())
		os.Exit(1)
	}
}

const usage = `kiao — run KIAO (DCMS + hybridflow) on a folder

Usage:
  kiao [options] [folder]     start an instance on folder (default: .)
  kiao --list                 list the running instances
  kiao --stop [folder|all]    stop one instance, or all of them

Options:
  -d, --detach            start in the background and return to the shell
      --port N            serve Dashboard on this port (default: the next free one)
      --no-browser        do not open a browser
      --migrations        run the file-store migrations on this folder at startup
      --plantuml PATH     plantuml.jar, or a command taking -tsvg -pipe (default: the shipped jar)
      --plantuml-server U proxy diagrams to an existing PlantUML server instead of rendering here
  -h, --help              this text
  -V, --version           version of this build

Starting a folder that already has an instance opens its browser tab instead of a second one.
`

func dispatch(args []string) error {
	opts := options{openBrowser: true}
	mode, stopTarget := "start", ""

	for i := 0; i < len(args); i++ {
		arg := args[i]
		name, inline, hasInline := strings.Cut(arg, "=")
		// A flag's value is either glued on with = or the next argument. Reading it here rather
		// than in every branch keeps both forms working for all of them.
		value := func() (string, error) {
			if hasInline {
				return inline, nil
			}
			if i+1 >= len(args) {
				return "", fmt.Errorf("%s needs a value", name)
			}
			i++
			return args[i], nil
		}

		var err error
		switch name {
		case "-h", "--help":
			fmt.Print(usage)
			return nil
		case "-V", "--version":
			fmt.Printf("kiao %s\n", version)
			return nil
		case "-l", "--list":
			mode = "list"
		case "--stop":
			mode = "stop"
			// The target is optional, and a bare --stop means "this folder". Anything that looks
			// like a flag is the next option, not the target.
			if hasInline {
				stopTarget = inline
			} else if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				i++
				stopTarget = args[i]
			}
		case "-d", "--detach":
			opts.detach = true
		case "--no-browser":
			opts.openBrowser = false
		case "--migrations":
			opts.migrations = true
		case "--port":
			var v string
			if v, err = value(); err == nil {
				if opts.webPort, err = strconv.Atoi(v); err != nil || opts.webPort < 1 || opts.webPort > 65535 {
					err = fmt.Errorf("--port wants a port number, not %q", v)
				}
			}
		case "--plantuml":
			opts.plantuml, err = value()
		case "--plantuml-server":
			opts.plantumlURL, err = value()
		default:
			if strings.HasPrefix(arg, "-") {
				return fmt.Errorf("unknown option %s (try --help)", arg)
			}
			if opts.root != "" {
				return fmt.Errorf("one folder at a time; got %q and %q", opts.root, arg)
			}
			opts.root = arg
		}
		if err != nil {
			return err
		}
	}

	switch mode {
	case "list":
		return list()
	case "stop":
		// `kiao /path --stop` puts the folder where a start would want it; the flag's own
		// argument wins when both are given.
		if stopTarget == "" {
			stopTarget = opts.root
		}
		return stop(stopTarget)
	default:
		return start(opts)
	}
}

// home is the directory the install script laid the parts out in: web/ (the built SPA),
// migrations/ (the file-store migration machinery), lib/plantuml.jar (the diagram renderer) and
// bin/worker.
func home() (string, error) {
	candidates := []string{os.Getenv(homeEnv), os.Getenv(homeEnvLegacy), installedHome}
	if exe, err := os.Executable(); err == nil {
		// Through the symlink in ~/.local/bin, so <home>/bin/kiao resolves to <home>.
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
		candidates = append(candidates, filepath.Dir(filepath.Dir(exe)))
	}
	for _, dir := range candidates {
		if dir == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, "web", "index.html")); err == nil {
			return dir, nil
		}
	}
	return "", errors.New("cannot find the installed kiao parts; reinstall with " +
		"bin/install-kiao-executable.sh, or set KIAO_HOME to an install directory")
}

func start(opts options) error {
	root, err := resolveRoot(opts.root)
	if err != nil {
		return err
	}
	installDir, err := home()
	if err != nil {
		return err
	}
	service := filepath.Join(installDir, "bin", "worker")
	if _, err := os.Stat(service); err != nil {
		return fmt.Errorf("no worker in %s; reinstall with bin/install-kiao-executable.sh", installDir)
	}

	// The machine's standing answers, before anything reads the environment: ~/.config/kiao/
	// config.env is what keeps starting an instance down to `kiao .`. What is already exported
	// wins over it, so trying something out for one run is still one export.
	configRead, err := loadConfig()
	if err != nil {
		return err
	}

	// Where this instance's boards are, read before anything is started: a configuration that
	// cannot work is a refusal to start, not a proxy answering 502 ten minutes later.
	cfg, err := boardsFromEnv()
	if err != nil {
		return err
	}
	hybridflowBin := ""
	if cfg.ownBoards() {
		if hybridflowBin, err = hybridflowBinary(installDir); err != nil {
			return err
		}
		// The two children of an instance serving its own database share a token nobody else ever
		// sees. One talking to a remote service uses that deployment's, which it was given.
		if cfg.token, err = newServiceToken(); err != nil {
			return err
		}
	}

	// An instance already on this folder is the answer to the command, not an obstacle to it: two
	// of them could not run anyway — the worker locks the store's state directory — and
	// what was wanted was the folder open in a browser.
	if inst, ok := liveInstance(root); ok {
		fmt.Printf("already running on %s\n  Dashboard  %s\n", root, inst.url())
		if opts.openBrowser {
			openBrowser(inst.url())
		}
		return nil
	}

	if opts.detach && os.Getenv(detachedEnv) == "" {
		return spawnDetached(root, opts)
	}

	// The web listener is opened before anything is started, so the port it reports is one it
	// actually holds; the worker port is only probed, since that one is bound by a child.
	webPort := opts.webPort
	var webListener net.Listener
	if webPort != 0 {
		webListener, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", webPort))
		if err != nil {
			return fmt.Errorf("port %d is taken: %w", webPort, err)
		}
	} else {
		webListener, webPort, err = listenFreePort(portBase)
		if err != nil {
			return err
		}
	}
	defer webListener.Close()

	workerPort, err := freePort(webPort + 1)
	if err != nil {
		return err
	}

	// One address for the boards, and everything that touches them is given it: the proxy in front
	// of the SPA, and the worker child whose runner claims a card and files an answer. They
	// must agree — a person dragging a card and the run answering it writing to two different
	// places is the kind of thing nobody notices until the board disagrees with itself.
	//
	// A remote service is used as it stands. A database of our own gets a port beside the
	// worker, and the service that will listen on it is started further down. Neither, on a
	// folder that is not a store with boards, and then the proxy says so.
	hybridflowPort := 0
	target := boardsBackend{token: cfg.token, actor: cfg.actor, remote: cfg.remoteBoards()}
	var access hybridflowAccess
	switch {
	case cfg.remoteBoards():
		if target.base, err = url.Parse(cfg.remote); err != nil {
			return err
		}
		access = hybridflowAccess{url: cfg.remote, token: cfg.token}
	case cfg.ownBoards():
		if hybridflowPort, err = freePort(workerPort + 1); err != nil {
			return err
		}
		own := fmt.Sprintf("http://127.0.0.1:%d", hybridflowPort)
		if target.base, err = url.Parse(own); err != nil {
			return err
		}
		access = hybridflowAccess{url: own, token: cfg.token}
	}

	renderer := newPlantUML(installDir, opts.plantuml, opts.plantumlURL)
	server := newFrontServer(installDir, root, webPort, workerPort, target, renderer)

	// Listened for before the child exists rather than after it is serving: a Ctrl+C during the
	// startup would otherwise take the default action — this process dies, its deferred cleanup
	// never runs, and the worker it just started is orphaned onto the store lock.
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)

	// The boards first, so that a database that cannot be reached is reported before a store is
	// opened over it — and because its startup is where the schema is created and migrated.
	// A nil channel is never ready, so an instance without one waits on nothing in the select at
	// the end of this function.
	var hybridflowDone <-chan struct{}
	var hybridflow *childProcess
	if cfg.ownBoards() {
		hybridflow, err = startHybridflowStore(hybridflowBin, cfg.database, cfg.token, hybridflowPort)
		if err != nil {
			return err
		}
		defer hybridflow.stop()
		hybridflowDone = hybridflow.done
		health := fmt.Sprintf("http://127.0.0.1:%d/healthz", hybridflowPort)
		if err := waitForHealth(health, 60*time.Second, hybridflow, signals); err != nil {
			return err
		}
	}

	svc, err := startWorker(service, installDir, root, workerPort, opts.migrations, access)
	if err != nil {
		return err
	}
	// Every path out of here goes through this: a worker left behind would hold both its
	// port and the store's state lock, and the next start on this folder would be refused.
	defer svc.stop()

	inst := instance{
		Root: root, WebPort: webPort, WorkerPort: workerPort,
		PID: os.Getpid(), WorkerPID: svc.cmd.Process.Pid,
		Started: time.Now(), Version: version, LogFile: os.Getenv("KIAO_LOGFILE"),
	}
	if err := inst.save(); err != nil {
		return err
	}
	defer inst.remove()

	web := &http.Server{
		Handler: server,
		// Bound slow-header attacks, and nothing else: a read or write timeout would abort a large
		// upload, a folder download or the /api/ws/hybridflow-runner socket, which is what the worker
		// says about its own listener for the same reasons.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- web.Serve(webListener) }()

	if err := waitForHealth(fmt.Sprintf("http://127.0.0.1:%d/healthz", workerPort), 30*time.Second, svc, signals); err != nil {
		return err
	}

	fmt.Printf("kiao on %s\n", root)
	fmt.Printf("  Dashboard       %s\n", inst.url())
	fmt.Printf("  worker         http://127.0.0.1:%d  (auth: debug)\n", workerPort)
	switch {
	case cfg.remoteBoards():
		fmt.Printf("  boards         %s\n", cfg.describe())
	case cfg.ownBoards():
		fmt.Printf("  boards         http://127.0.0.1:%d  (%s)\n", hybridflowPort, describeDatabase(cfg.database))
	}
	fmt.Printf("  diagrams       %s\n", renderer.describe())
	if configRead != "" {
		fmt.Printf("  config         %s\n", configRead)
	}
	if inst.LogFile != "" {
		fmt.Printf("  log            %s\n", inst.LogFile)
		fmt.Printf("Stop it with: kiao --stop %s\n", root)
	} else {
		fmt.Println("Press Ctrl+C to stop.")
	}
	if opts.openBrowser {
		openBrowser(inst.url())
	}

	select {
	case <-signals:
		return errInterrupted
	case err := <-serveErr:
		return fmt.Errorf("the web server stopped: %w", err)
	case <-svc.done:
		return fmt.Errorf("the worker stopped: %w", svc.exitError())
	case <-hybridflowDone:
		return fmt.Errorf("the hybridflow-store stopped: %w", hybridflow.exitError())
	}
}

func resolveRoot(arg string) (string, error) {
	if arg == "" {
		arg = "."
	}
	root, err := filepath.Abs(arg)
	if err != nil {
		return "", err
	}
	// Through symlinks, so that a folder reached by two names is one instance and not two — the
	// second of which would die on the store lock the first holds.
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	info, err := os.Stat(root)
	if err != nil {
		return "", fmt.Errorf("no such folder: %s", root)
	}
	if !info.IsDir() {
		// A folder is the whole contract of a store; being handed a file is a typo, not a store
		// of one document.
		return "", fmt.Errorf("%s is a file; kiao runs on a folder", root)
	}
	return root, nil
}

// spawnDetached re-runs this executable in its own session with its output on a log file, then waits
// for the instance it registers. The wait is what makes --detach usable: the shell gets the URL
// back, not just a prompt, and a start that fails is reported here rather than only in the log.
func spawnDetached(root string, opts options) error {
	logFile, err := instanceLogPath(root)
	if err != nil {
		return err
	}
	out, err := os.Create(logFile)
	if err != nil {
		return fmt.Errorf("cannot write %s: %w", logFile, err)
	}
	defer out.Close()

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	args := []string{root, "--no-browser"}
	if opts.webPort != 0 {
		args = append(args, "--port", strconv.Itoa(opts.webPort))
	}
	if opts.migrations {
		args = append(args, "--migrations")
	}
	if opts.plantuml != "" {
		args = append(args, "--plantuml", opts.plantuml)
	}
	if opts.plantumlURL != "" {
		args = append(args, "--plantuml-server", opts.plantumlURL)
	}

	cmd := exec.Command(exe, args...)
	cmd.Env = append(os.Environ(), detachedEnv+"=1", "KIAO_LOGFILE="+logFile)
	cmd.Stdout, cmd.Stderr = out, out
	cmd.Stdin = nil
	// Its own session: the instance outlives the terminal it was started from, and a Ctrl+C there
	// reaches the shell alone.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	// Nothing waits on this process again — releasing it hands the reaping to init.
	defer cmd.Process.Release()

	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if inst, ok := liveInstance(root); ok {
			fmt.Printf("kiao on %s\n  Dashboard  %s\n  log       %s\n", root, inst.url(), logFile)
			fmt.Printf("Stop it with: kiao --stop %s\n", root)
			if opts.openBrowser {
				openBrowser(inst.url())
			}
			return nil
		}
		if !alive(cmd.Process.Pid) {
			return fmt.Errorf("it did not start; see %s", logFile)
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("it did not come up within 60s; see %s", logFile)
}

// listenFreePort walks up from a starting port and returns the first listener it can open.
func listenFreePort(from int) (net.Listener, int, error) {
	for port := from; port <= portMax; port++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			return ln, port, nil
		}
	}
	return nil, 0, fmt.Errorf("no free port between %d and %d", from, portMax)
}

// freePort reports a port nothing is listening on. Unlike listenFreePort it cannot hold what it
// finds — the port is for a child process to bind — so a race is possible in principle; the
// caller learns of it as a worker that fails to start.
func freePort(from int) (int, error) {
	ln, port, err := listenFreePort(from)
	if err != nil {
		return 0, err
	}
	return port, ln.Close()
}

func waitForHealth(url string, timeout time.Duration, svc *childProcess, signals <-chan os.Signal) error {
	client := &http.Client{Timeout: 2 * time.Second, Transport: loopbackTransport}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case <-svc.done:
			// Migrations abort startup on purpose, and so does a store another instance is
			// already holding — or, for the boards service, a database it cannot reach or a schema
			// migration that would not apply. All of them land here, with the reason on the
			// service's own output.
			return fmt.Errorf("the %s failed to start: %w", svc.name, svc.exitError())
		case <-signals:
			return errInterrupted
		default:
		}
		if resp, err := client.Get(url); err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("the %s did not answer %s within %s", svc.name, url, timeout)
}

// openBrowser hands the URL to the desktop, and says nothing if there is no desktop to hand it to:
// the URL has just been printed, and a missing xdg-open is not a reason to fail a start.
func openBrowser(url string) {
	if runtime.GOOS != "linux" {
		return
	}
	// wslview first: under WSL it opens the Windows browser, where xdg-open would look for a
	// Linux one that is usually not installed.
	for _, opener := range []string{"wslview", "xdg-open"} {
		path, err := exec.LookPath(opener)
		if err != nil {
			continue
		}
		cmd := exec.Command(path, url)
		cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		if err := cmd.Start(); err == nil {
			go cmd.Wait() // reap it; some openers linger for the whole browser session
			return
		}
	}
}
