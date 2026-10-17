package toolbox

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"kiao/worker/internal/core"
)

// The outfitting of the machine, wired.
//
// `files` is the document store and `hybridflow-runner` is the hybridflow runner; this is the third thing a
// DCMS is made of — **what is installed on the machine so that a turn can use it**. A JDK, a Node
// LTS, a Python, and the MCP servers that give a turn a web fetcher, a search engine, a PDF
// converter or a paper index. It depends on the socle and on nothing else: it does not know a
// conversation exists, and the hybridflow runner reaches it through a port (see MCPServers).
//
// Two things it deliberately is not. It is not a general command runner: everything it can install
// is written in the catalogue — pub.json, embedded, plus whatever the deployment staged beside
// it — and a caller names an id from it: a request carries no command, no package name and no
// version. And it is not a way around the deployment: with no KIAO_WORKER_TOOLBOX_PATH it
// installs nothing at all, and the panel says so rather than pretending.

// Service is this library, wired. One per process.
type Service struct {
	cfg     *Config
	catalog *Catalog
	ledger  *Ledger
	runner  *runner

	// bundled is what the deployment staged rather than what this panel installed: the kiao-mcp
	// servers, handed over by the program because their path is the hybridflow runner's own
	// configuration. They appear in the panel as rows that can be switched on and off and never
	// installed, which is the truth about them.
	bundled map[string]core.MCPServer

	// equipped is called after an install that put an agent's CLI on the machine, so the half that
	// equips an agent can do it again. This library does not know what that means and must not: the
	// bundled skills are the hybridflow runner's business, and all that is said here is *a CLI
	// arrived*. The program sets it, after both halves exist; nil is a deployment where nothing
	// listens, which is every test and every service assembled without the hybridflow runner.
	equipped func()
}

// OnAgentInstalled registers what to do when an agent's CLI lands on the machine. One listener,
// set by the program at wiring time — this is not an event bus, it is the one edge that could not
// be a return value because the install happens on a goroutine minutes after the request.
func (s *Service) OnAgentInstalled(equipped func()) { s.equipped = equipped }

// Start assembles the library and returns it ready to mount. The ledger is read before anything is
// served, and seeded on a store that has none from the MCP servers the deployment already
// configured — without that, this build would silently take those servers away from every turn,
// because the env variable stops being the authority the moment the ledger exists.
//
// bundled is the staged kiao-mcp servers, keyed by the short name the catalogue's `bundled` recipes
// name (`files`, `hybridflow`, and any overlaid one). An empty map is a deployment that staged no
// bundle, and those rows then read as unavailable.
func Start(cfg *Config, bundled map[string]core.MCPServer, seed []string) (*Service, error) {
	catalog, err := LoadCatalog(cfg.CatalogDir)
	if err != nil {
		return nil, err
	}
	ledger, err := openLedger(cfg.ledgerPath())
	if err != nil {
		return nil, err
	}
	logToolbox.Info("toolbox catalog", "sources", catalog.Sources(), "components", len(catalog.All()))

	// Seeded with the *catalogue* ids of the bundled servers the deployment named, which is what
	// the panel and the ledger speak; `files` on the wire of the old env variable is `kiao-files`
	// here.
	var seedIDs []string
	for _, short := range seed {
		if id, ok := bundledIDFor(catalog, short); ok {
			seedIDs = append(seedIDs, id)
		}
	}
	if err := ledger.seed(seedIDs); err != nil {
		return nil, err
	}

	svc := &Service{cfg: cfg, catalog: catalog, ledger: ledger, runner: &runner{}, bundled: bundled}
	if strings.TrimSpace(cfg.Prefix) == "" {
		logToolbox.Info("toolbox installs nothing in this deployment; set KIAO_WORKER_TOOLBOX_PATH to enable it")
	} else {
		logToolbox.Info("toolbox ready", "prefix", cfg.Prefix, "platform", cfg.platform())
	}
	// A component dropped from the catalogue leaves its ledger entry behind, and its files in the
	// prefix. Nothing reads either — MCPServers skips an id the catalogue does not declare and the
	// panel has no row to show — so the only way anyone learns the bytes are still there is if the
	// service says so once, at the moment it notices.
	if orphans := ledger.orphans(catalog); len(orphans) > 0 {
		logToolbox.Warn("the ledger records components this catalogue no longer declares; their files are still in the prefix",
			"components", orphans, "prefix", cfg.Prefix)
	}
	if servers := svc.MCPServers(); len(servers) > 0 {
		names := make([]string, 0, len(servers))
		for _, s := range servers {
			names = append(names, s.Name)
		}
		logToolbox.Info("MCP servers registered for turns", "servers", names)
	}
	return svc, nil
}

// bundledIDFor answers the catalogue id whose bundled recipe names this short name.
func bundledIDFor(catalog *Catalog, short string) (string, bool) {
	for _, comp := range catalog.All() {
		recipe, ok := comp.RecipeFor(platformGeneric)
		if ok && recipe.Channel == channelBundled && recipe.Package == short {
			return comp.ID, true
		}
	}
	return "", false
}

// ── the port the hybridflow runner reads ────────────────────────────────────

// MCPServers is the whole of what this library offers the rest of the service: the servers a turn
// should be handed, right now. It is read at every turn rather than once at startup, which is what
// makes an install take effect on the next prompt instead of at the next restart.
//
// A server that is switched on but whose files have gone — a prefix deleted by hand, a bundle that
// was never staged — is left out rather than named: a turn spawned against a command that does not
// exist gets a server that fails to start, on the CLI's own stderr, which is not where anyone looks.
func (s *Service) MCPServers() []core.MCPServer {
	var servers []core.MCPServer
	for _, id := range s.ledger.enabledServers() {
		comp, ok := s.catalog.Get(id)
		if !ok || comp.Kind != KindMCP {
			continue
		}
		server, ok := s.serverFor(comp)
		if !ok {
			continue
		}
		servers = append(servers, server)
	}
	return servers
}

// serverFor resolves one component to the declaration a turn is handed, or answers false when it
// cannot be run here.
func (s *Service) serverFor(comp Component) (core.MCPServer, bool) {
	recipe, ok := comp.RecipeFor(s.cfg.platform())
	if !ok {
		return core.MCPServer{}, false
	}

	switch recipe.Channel {
	case channelBundled:
		server, ok := s.bundled[recipe.Package]
		if !ok {
			return core.MCPServer{}, false
		}
		server.Name = comp.Server
		return server, true

	case channelRemote:
		token, ok := firstSetEnv(comp.RequiresEnv)
		if len(comp.RequiresEnv) > 0 && !ok {
			return core.MCPServer{}, false
		}
		server := core.MCPServer{
			Name: comp.Server,
			Type: core.MCPHTTP,
			URL:  recipe.URL,
		}
		if ok {
			// `${VAR}` rather than the value: the CLI expands it from its own environment, so the
			// credential is never written to the file and never appears in `ps` — the same trick
			// the per-turn kiao-mcp token already uses.
			server.Headers = map[string]string{"Authorization": "Bearer ${" + token + "}"}
		}
		return server, true

	default:
		entry, ok := s.ledger.get(comp.ID)
		if !ok || !entry.Installed || entry.Command == "" || !fileExists(entry.Command) {
			return core.MCPServer{}, false
		}
		server := core.MCPServer{
			Name:    comp.Server,
			Type:    core.MCPStdio,
			Command: entry.Command,
			Args:    append(append([]string{}, entry.Args...), comp.ServerArgs...),
		}
		if len(comp.ServerEnv) > 0 {
			server.Env = map[string]string{}
			for k, v := range comp.ServerEnv {
				// Resolved here rather than written into the catalogue, because where the prefix is
				// belongs to the deployment: the same entry serves a server, a container and a laptop.
				server.Env[k] = s.cfg.expandTokens(v)
			}
		}
		return server, true
	}
}

// ── the port the document store reads ─────────────────────────────────────────

// RuntimeBinary answers where a catalogue runtime's executable is, by its catalogue id — the
// toolbox's copy first, the machine's after, exactly as a dependency check resolves it.
//
// It exists for the runtime the service spawns itself: `ffmpeg`, asked at every save of a video's
// segments. Asked each time rather than once at startup, which is the point: installing it from
// this panel has to make the click that needed it work on the next try and not at the next
// restart. Nothing about cutting is known here, and nothing about installing is known there; this
// is the whole of what passes between them.
func (s *Service) RuntimeBinary(id string) (string, bool) {
	comp, ok := s.catalog.Get(id)
	if !ok || comp.Kind != KindRuntime {
		return "", false
	}
	recipe, ok := comp.RecipeFor(s.cfg.platform())
	if !ok || recipe.Bin == "" {
		return "", false
	}
	return locate(s.cfg, recipe.Bin)
}

// ── the other port the hybridflow runner reads ──────────────────────────────

// AgentOffered answers whether an agent should be offered in the agent tab, by the name the
// hybridflow runner knows it by. It is the counterpart of MCPServers and is read the same way —
// at every ask rather than once at startup — so that switching an agent off is a click rather than
// an env file and a restart.
//
// **Offered is the answer to everything this does not know about.** An agent with no row in the
// catalogue, and a row nobody has ever touched, are both yes: the panel speaks only where somebody
// has actually said something, and whether the CLI is on the machine at all is the other half's
// question. Only an explicit switch-off says no.
func (s *Service) AgentOffered(name string) bool {
	comp, ok := s.catalog.forAgent(name)
	if !ok {
		return true
	}
	entry, recorded := s.ledger.get(comp.ID)
	return !recorded || entry.Enabled
}

// firstSetEnv answers the first of names that is set and non-empty. The list is an any-of: GitHub
// is reached with either of the two variable names its own tooling uses, and a deployment that set
// one has said everything it needs to.
func firstSetEnv(names []string) (string, bool) {
	for _, name := range names {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return name, true
		}
	}
	return "", false
}

// ── the panel ─────────────────────────────────────────────────────────────────

// State builds the whole panel in one answer: what this deployment can do, and every row with the
// one thing it is waiting for.
func (s *Service) State() ToolboxDto {
	platform := s.cfg.platform()
	enabled := strings.TrimSpace(s.cfg.Prefix) != ""

	dto := ToolboxDto{
		Enabled:  enabled,
		Platform: platform,
		Strict:   len(s.MCPServers()) > 0,
	}
	if enabled {
		dto.Prefix = s.cfg.Prefix
	}
	if j := s.runner.latest(); j != nil {
		dto.Job = j.dto()
	}

	// Installed-ness of the dependencies is computed once for the whole list, so a row can say
	// which of its requirements are actually missing rather than repeating the catalogue.
	installed := map[string]bool{}
	for _, comp := range s.catalog.All() {
		installed[comp.ID] = s.isPresent(comp, platform)
	}

	for _, comp := range s.catalog.All() {
		dto.Components = append(dto.Components, s.rowFor(comp, platform, installed))
	}
	return dto
}

// rowFor is one component as the panel reads it.
func (s *Service) rowFor(comp Component, platform string, installed map[string]bool) ToolboxComponentDto {
	entry, hasEntry := s.ledger.get(comp.ID)

	row := ToolboxComponentDto{
		ID:          comp.ID,
		Kind:        comp.Kind,
		Agent:       comp.Agent,
		Title:       comp.Title,
		Role:        comp.Role,
		Requires:    comp.Requires,
		Version:     entry.Version,
		InstalledAt: entry.InstalledAt,
		Registered:  hasEntry && entry.Enabled,
		Tools:       entry.Tools,
		ToolBytes:   entry.ToolBytes,
		ProbedAt:    entry.ProbedAt,
	}
	// An agent row reads the same field the other way round: a server nobody registered is not
	// handed to a turn, while an agent nobody has said anything about is offered — it is a CLI on
	// the machine, and the panel's silence is not a reason to hide it from the dropdown.
	if comp.Agent != "" {
		row.Registered = !hasEntry || entry.Enabled
	}
	for _, dep := range comp.Requires {
		if !installed[dep] {
			row.MissingRequires = append(row.MissingRequires, dep)
		}
	}

	recipe, ok := comp.RecipeFor(platform)
	if !ok {
		row.State = StateUnavailable
		row.Reason = fmt.Sprintf("the catalogue has no recipe for %s", platform)
		return row
	}
	row.Channel = recipe.Channel

	if reason, blocked := s.blocked(comp, recipe, platform); blocked {
		row.State = StateBlocked
		row.Reason = reason
		return row
	}

	switch {
	case recipe.Channel == channelBundled:
		if _, staged := s.bundled[recipe.Package]; !staged {
			row.State = StateUnavailable
			row.Reason = "this deployment stages no kiao-mcp bundle"
			return row
		}
		row.State = StateInstalled

	case recipe.Channel == channelRemote:
		row.State = StateInstalled

	case hasEntry && entry.Installed:
		row.State = StateInstalled
		// The ledger is a record, not a guarantee: a prefix cleared by hand leaves it claiming an
		// install that is not there. Saying so is the difference between a broken turn and a row
		// with a button that fixes it.
		switch {
		case entry.Command != "" && !fileExists(entry.Command):
			row.State = StateMissing
			row.Reason = "recorded as installed, but " + entry.Command + " is gone; install it again"
		// Installed and dead is its own state, and the one the panel used to hide: the files are
		// there, so "installed" is true, and the server nevertheless answers nothing. A green row
		// for that is how somebody ends up with a turn quietly missing the tools they just added.
		case entry.ProbeError != "":
			row.State = StateUnresponsive
			row.Reason = "installed, but it did not answer when it was started: " + entry.ProbeError
		}

	default:
		version, missing, here := s.presentOutside(comp, recipe)
		if here {
			row.State = StatePresent
			row.Version = version
			row.Reason = "already on this machine; this panel did not install it and will not remove it"
			if comp.Agent != "" {
				row.Reason += ". The switch withdraws it from the agent tab"
			}
			break
		}
		row.State = StateAvailable
		// A runtime the machine half has is the confusing row: `node` is right there and the panel
		// offers to install one anyway. Saying which piece is missing is the difference between a
		// button that looks redundant and one that looks necessary.
		if missing != "" && missing != recipe.Bin {
			row.Reason = fmt.Sprintf("this machine has %s but no %s; installing puts a complete one in the toolbox",
				recipe.Bin, missing)
		}
	}

	return row
}

// blocked answers the preconditions that make a component not worth offering at all: a remote
// server with no credential, a channel this system has no way of running.
func (s *Service) blocked(comp Component, recipe Recipe, platform string) (string, bool) {
	if len(comp.RequiresEnv) > 0 {
		if _, ok := firstSetEnv(comp.RequiresEnv); !ok {
			return comp.PreconditionHint, true
		}
	}
	switch recipe.Channel {
	case channelNodeTarball, channelTemurin:
		if _, ok := hostArch(); !ok {
			return "no build is published for this machine's architecture", true
		}
	case channelFFmpegRelease:
		if _, ok := ffmpegTarget(); !ok {
			return "no FFmpeg build is published for this machine", true
		}
		// The archive is a `.tar.xz`, and tar hands the `J` to an `xz` of the machine's. Every Debian
		// and Ubuntu has one, and a machine without it has to be told before a 150 MB download rather
		// than after it — installing it is root's act, so the row says the command.
		if _, err := exec.LookPath("xz"); err != nil {
			return "this machine has no xz to open the FFmpeg archive with — `sudo apt-get install -y xz-utils`", true
		}
	case channelSystem:
		if _, _, ok := systemInstaller(platform); !ok {
			return "this system has no package manager this service may use", true
		}
	case channelDetect:
		// Detect-only: presence is the whole answer, and a missing one is a system package to
		// install rather than an install to offer — this panel never writes outside its prefix,
		// and a package manager is root's to run.
		if _, _, here := s.presentOutside(comp, recipe); !here {
			return fmt.Sprintf("this machine has no %s, which PlantUML needs to lay out its diagrams — `%s`",
				recipe.Bin, detectInstallCommand(platform, recipe.Packages)), true
		}
	}
	return "", false
}

// detectInstallCommand is the line a detect-only row suggests for what it cannot install itself.
// Generic answers apt-get: an unknown system is likelier a Debian the release file did not place
// than anything else, and a wrong guess here names a command rather than running one.
func detectInstallCommand(platform string, packages []string) string {
	if platform == platformAlpine {
		return "apk add " + strings.Join(packages, " ")
	}
	return "sudo apt-get install -y " + strings.Join(packages, " ")
}

// isPresent answers the question a dependency asks: is this on the machine, whoever put it there.
func (s *Service) isPresent(comp Component, platform string) bool {
	if entry, ok := s.ledger.get(comp.ID); ok && entry.Installed {
		return true
	}
	recipe, ok := comp.RecipeFor(platform)
	if !ok {
		return false
	}
	_, _, here := s.presentOutside(comp, recipe)
	return here
}

// presentOutside answers whether a runtime is on the machine without this service having put it
// there — a JDK the operator installed, the node the image ships. Only runtimes are looked for:
// an MCP server is only ever "present" if this panel installed it, since nothing else on the machine
// would put one where a turn could reach it. The middle answer is the first executable the runtime
// owes its dependents that this machine does not have.
func (s *Service) presentOutside(comp Component, recipe Recipe) (string, string, bool) {
	if comp.Kind != KindRuntime || recipe.Bin == "" {
		return "", "", false
	}
	return present(s.cfg, recipe)
}

// ── what the panel asks for ───────────────────────────────────────────────────

// Install runs the dependency closure of ids and registers every MCP server among them. It answers
// the job to poll, not the outcome: the work happens on a goroutine and takes minutes.
func (s *Service) Install(ids []string) (*ToolboxJobDto, error) {
	if strings.TrimSpace(s.cfg.Prefix) == "" {
		return nil, errToolboxDisabled
	}
	closure, err := s.resolve(ids)
	if err != nil {
		return nil, err
	}
	platform := s.cfg.platform()
	for _, id := range closure {
		comp, _ := s.catalog.Get(id)
		recipe, ok := comp.RecipeFor(platform)
		if !ok {
			return nil, fmt.Errorf("%w: %s", errNotHere, id)
		}
		// A detect-only row has no Install button, but the endpoint is still reachable: asking
		// for one names the command instead of starting a job that could only fail.
		if recipe.Channel == channelDetect {
			return nil, fmt.Errorf("%w: %s is reported by this panel but installed with `%s`",
				errNotHere, id, detectInstallCommand(platform, recipe.Packages))
		}
	}
	if err := s.cfg.ensureLayout(); err != nil {
		return nil, err
	}

	job, err := s.runner.start("install", closure, func(log *jobLog) error {
		return s.doInstall(closure, platform, log)
	})
	if err != nil {
		return nil, err
	}
	return job.dto(), nil
}

// resolve turns what was asked into what will be done: the transitive closure, dependencies first,
// with anything already installed dropped. The asked-for ids stay in even when installed, so
// "install" on a row that is already there means "install it again", which is how a StateMissing
// row is repaired.
func (s *Service) resolve(ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, fmt.Errorf("%w: no component named", errUnknownComponent)
	}
	for _, id := range ids {
		if _, ok := s.catalog.Get(id); !ok {
			return nil, fmt.Errorf("%w: %s; known: %s", errUnknownComponent, id, s.catalog.knownIDs())
		}
	}
	closure, err := s.catalog.closure(ids)
	if err != nil {
		return nil, err
	}
	asked := map[string]bool{}
	for _, id := range ids {
		asked[id] = true
	}
	platform := s.cfg.platform()
	var todo []string
	for _, id := range closure {
		comp, _ := s.catalog.Get(id)
		if !asked[id] && s.isPresent(comp, platform) {
			continue
		}
		todo = append(todo, id)
	}
	return todo, nil
}

// doInstall is the job body: each component in dependency order, then its probe, then the ledger.
// The ledger is written per component rather than at the end, so a run that fails on the fifth of
// six leaves the four that worked recorded as installed — which is what they are.
func (s *Service) doInstall(closure []string, platform string, log *jobLog) error {
	in := newInstaller(s.cfg, log)
	for _, id := range closure {
		comp, _ := s.catalog.Get(id)
		recipe, _ := comp.RecipeFor(platform)
		log.printf("── %s (%s, %s) ──", comp.Title, comp.ID, recipe.Channel)

		entry, err := in.install(comp, recipe)
		if err != nil {
			return fmt.Errorf("%s: %w", comp.ID, err)
		}
		if err := s.record(id, entry, log); err != nil {
			return err
		}
		if comp.Agent != "" {
			// The one thing an agent CLI's install can succeed at and still not deliver. The two
			// halves find a binary by different routes: this one looks in the prefix first, while
			// the hybridflow runner spawns a bare `claude` and lets the process PATH resolve it.
			// In the image they agree — the Dockerfile puts the prefix's bin on PATH — and on a
			// machine whose prefix is under ~/.local they do not, which reads as a green row and an
			// agent tab with nothing in it. Said in the log of the install that caused it, which is
			// the one place somebody is already looking.
			s.warnOffPath(comp, log)
			// And a CLI that has just arrived has an empty skills directory, the pass that fills it
			// having run at startup, before this. Said here rather than at the end of the job so
			// that a closure installing two things equips each as it lands.
			if s.equipped != nil {
				log.printf("installing the bundled skills for %s", comp.Agent)
				s.equipped()
			}
		}
	}
	return nil
}

// warnOffPath says so when the agent CLI just installed is somewhere the half that spawns it will
// not look. It is a warning and not a failure: the install worked, the file is where the ledger
// says, and the deployment can put that directory on the service's PATH and restart.
func (s *Service) warnOffPath(comp Component, log *jobLog) {
	recipe, ok := comp.RecipeFor(s.cfg.platform())
	if !ok || recipe.Bin == "" || s.cfg.Target != "" {
		return
	}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		if dir != "" && filepath.Clean(dir) == filepath.Clean(s.cfg.binDir()) {
			return
		}
	}
	log.printf("WARNING: %s is installed at %s, which is not on this service's PATH — "+
		"the agent tab will not offer %s until it is, and the service is restarted",
		recipe.Bin, filepath.Join(s.cfg.binDir(), recipe.Bin), comp.Agent)
}

// record puts one component the driver has just installed into the ledger, and — for an MCP server
// — proves it starts before leaving it switched on. Separate from the loop above so a test can
// reach the part that matters without a real install behind it.
//
// An MCP server is registered by installing it, which is what the button says. It is probed first,
// so a server that will not start is a failed install here rather than a turn with quietly missing
// tools later. The entry has to be written *before* the probe, because the probe resolves its
// command out of it — so a probe that fails has to un-register what it just wrote, or the server it
// has proved does not start would be handed to every turn from then on.
//
// What the failure leaves behind is the point of the record: the files are on the machine and the
// ledger says so, *and* it says the handshake failed and why. The row then reads "installed, but it
// did not answer: …" instead of a green "installed", which is the whole difference between a person
// who knows to look and a person who does not.
func (s *Service) record(id string, entry Entry, log *jobLog) error {
	comp, _ := s.catalog.Get(id)

	// Installing an agent's CLI switches that agent on, for the reason installing a server
	// registers it: the button was pressed by somebody who wants the thing. It matters because the
	// switch and the install write the same field — without this, installing a CLI that had been
	// switched off would put the bytes back and leave the dropdown empty.
	if comp.Agent != "" {
		entry.Enabled = true
	}

	if comp.Kind == KindMCP {
		entry.Enabled = true
		entry.ProbedAt, entry.ProbeError = "", ""
		if err := s.ledger.put(id, entry); err != nil {
			return err
		}
		server, resolved := s.serverFor(comp)
		switch {
		case resolved && server.Type == core.MCPStdio:
			log.printf("starting %s to check it answers", comp.Server)
			result, err := probeServer(s.cfg, server.Command, server.Args, server.Env)
			if err != nil {
				entry.Enabled, entry.ProbedAt, entry.ProbeError = false, stamp(), err.Error()
				if writeErr := s.ledger.put(id, entry); writeErr != nil {
					return writeErr
				}
				log.printf("%s is installed but was not switched on: %v", comp.Server, err)
				return fmt.Errorf("%s: %w", comp.ID, err)
			}
			entry.Tools, entry.ToolBytes, entry.ProbedAt = result.Tools, result.ToolBytes, stamp()
			log.printf("%s declares %d tools, %d bytes of definitions on every request",
				comp.Server, result.Tools, result.ToolBytes)

		// Installed, and there is nothing to start: an installed server that resolves to no command
		// is a driver that reported success over an empty result, and registering it would hand
		// every turn a name with no process behind it. Bundled and remote servers are the two that
		// legitimately have nothing of their own to run.
		case !resolved && entry.Installed:
			entry.Enabled = false
			if writeErr := s.ledger.put(id, entry); writeErr != nil {
				return writeErr
			}
			return fmt.Errorf("%s: installed, but nothing to run it with", comp.ID)
		}
	}

	if err := s.ledger.put(id, entry); err != nil {
		return err
	}
	log.printf("%s installed", comp.ID)
	return nil
}

// Uninstall removes what this service installed, refusing anything else. Two refusals, and both are
// the same principle: the ledger is the boundary of what this panel owns. Something it did not
// install is not its to remove, and something another installed component still needs is not either.
func (s *Service) Uninstall(ids []string) (*ToolboxJobDto, error) {
	if strings.TrimSpace(s.cfg.Prefix) == "" {
		return nil, errToolboxDisabled
	}
	platform := s.cfg.platform()
	for _, id := range ids {
		comp, ok := s.catalog.Get(id)
		if !ok {
			return nil, fmt.Errorf("%w: %s; known: %s", errUnknownComponent, id, s.catalog.knownIDs())
		}
		recipe, ok := comp.RecipeFor(platform)
		if !ok {
			return nil, fmt.Errorf("%w: %s", errNotHere, id)
		}
		entry, recorded := s.ledger.get(id)
		if recipe.Channel != channelBundled && recipe.Channel != channelRemote && (!recorded || !entry.Installed) {
			return nil, fmt.Errorf("%w: %s", errNotInstalled, id)
		}
		for _, dependent := range s.catalog.dependents(id) {
			if going(ids, dependent) {
				continue
			}
			if e, ok := s.ledger.get(dependent); ok && e.Installed {
				return nil, fmt.Errorf("%w: %s is required by %s", errStillRequired, id, dependent)
			}
		}
	}

	// Dependents first, so removing uv and fetch together removes fetch with uv still there to do
	// it. The closure is dependencies-first, so it is walked backwards.
	ordered, err := s.catalog.closure(ids)
	if err != nil {
		return nil, err
	}
	var plan []string
	for i := len(ordered) - 1; i >= 0; i-- {
		if going(ids, ordered[i]) {
			plan = append(plan, ordered[i])
		}
	}

	job, err := s.runner.start("uninstall", plan, func(log *jobLog) error {
		in := newInstaller(s.cfg, log)
		for _, id := range plan {
			comp, _ := s.catalog.Get(id)
			recipe, _ := comp.RecipeFor(platform)
			entry, _ := s.ledger.get(id)
			log.printf("── removing %s (%s) ──", comp.Title, comp.ID)
			if err := in.uninstall(comp, recipe, entry); err != nil {
				return fmt.Errorf("%s: %w", comp.ID, err)
			}
			if err := s.ledger.remove(id); err != nil {
				return err
			}
			log.printf("%s removed", comp.ID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return job.dto(), nil
}

func going(ids []string, id string) bool {
	for _, candidate := range ids {
		if candidate == id {
			return true
		}
	}
	return false
}

// SetRegistered switches a row on or off for turns, without touching what is on disk. On an MCP
// server it is the whole of what a bundled or remote row offers, and on an installed one it is how
// a server is kept but taken out of the bill every request pays.
//
// **On an agent's CLI it is the answer to a question uninstall cannot always give.** A `claude` or
// a `codex` that this panel did not install — one baked into the image, one the operator put on
// the machine themselves — is not the panel's to remove, and until this switch existed the row for
// it said "on this machine" and offered nothing at all. Withdrawing the agent is a different act
// from deleting the binary, and it is the one that is always available.
func (s *Service) SetRegistered(ids []string, enabled bool) error {
	platform := s.cfg.platform()
	for _, id := range ids {
		comp, ok := s.catalog.Get(id)
		if !ok {
			return fmt.Errorf("%w: %s; known: %s", errUnknownComponent, id, s.catalog.knownIDs())
		}
		if comp.Kind != KindMCP && comp.Agent == "" {
			return fmt.Errorf("%w: %s is neither an MCP server nor an agent", errUnknownComponent, id)
		}
		if _, ok := comp.RecipeFor(platform); !ok {
			return fmt.Errorf("%w: %s", errNotHere, id)
		}
		// The switch is the other way into the failure the probe exists to catch. A row that says
		// "it did not answer" and a switch that turns it on anyway would be a panel arguing with
		// itself; installing again is what re-asks the question.
		if enabled {
			if entry, ok := s.ledger.get(id); ok && entry.ProbeError != "" {
				return fmt.Errorf("%w: %s — %s", errNotAnswering, id, entry.ProbeError)
			}
		}
	}
	for _, id := range ids {
		if err := s.ledger.setEnabled(id, enabled); err != nil {
			return err
		}
	}
	sorted := append([]string{}, ids...)
	sort.Strings(sorted)
	logToolbox.Info("registration changed", "components", sorted, "registered", enabled)
	return nil
}

// Job answers one job by id, for the panel's poll.
func (s *Service) Job(id string) (*ToolboxJobDto, error) {
	j, ok := s.runner.get(id)
	if !ok {
		return nil, fmt.Errorf("%w: %s", errNoJob, id)
	}
	return j.dto(), nil
}
