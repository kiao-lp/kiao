package toolbox

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	"kiao/worker/internal/core"
)

// newTestService assembles the library over temporary directories, with whichever kiao-mcp servers
// the test wants to pretend the deployment staged.
func newTestService(t *testing.T, bundled map[string]core.MCPServer, seed []string) *Service {
	t.Helper()
	return newTestServiceWithCatalog(t, bundled, seed, nil)
}

// newTestServiceWithCatalog is newTestService with catalogue files staged beside the embedded
// pub.json — a deployment overlay, as a test fixture.
func newTestServiceWithCatalog(t *testing.T, bundled map[string]core.MCPServer, seed []string, files map[string]string) *Service {
	t.Helper()
	cfg := &Config{
		Config: &core.Config{StatePath: t.TempDir(), NodeBinary: "node"},
		Prefix: filepath.Join(t.TempDir(), "toolbox"),
	}
	if len(files) > 0 {
		dir := t.TempDir()
		for name, body := range files {
			if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
				t.Fatalf("cannot stage %s: %v", name, err)
			}
		}
		cfg.CatalogDir = dir
	}
	svc, err := Start(cfg, bundled, seed)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	return svc
}

// TestSeedAdoptsTheConfiguredServers is the upgrade path, and it is the one that would be silent if
// it broke: a deployment that has run two bundled servers from an env variable for months must
// keep them the first time it starts a build that has a ledger. Those two ids ship in a staged
// overlay file rather than embedded, so the test stages that overlay the way a deployment does.
func TestSeedAdoptsTheConfiguredServers(t *testing.T) {
	bundled := map[string]core.MCPServer{
		"alpha": {Name: "kiao-alpha", Type: core.MCPStdio, Command: "node", Args: []string{"/bundle/alpha-entry.js"}},
		"beta":  {Name: "kiao-beta", Type: core.MCPStdio, Command: "node", Args: []string{"/bundle/beta-entry.js"}},
	}
	overlay := map[string]string{"site.json": `{"components": [
		{"id": "kiao-alpha", "kind": "mcp", "title": "kiao-alpha", "role": "alpha", "server": "kiao-alpha",
		 "recipes": {"generic": {"channel": "bundled", "package": "alpha"}}},
		{"id": "kiao-beta", "kind": "mcp", "title": "kiao-beta", "role": "beta", "server": "kiao-beta",
		 "recipes": {"generic": {"channel": "bundled", "package": "beta"}}}
	]}`}
	svc := newTestServiceWithCatalog(t, bundled, []string{"alpha", "beta"}, overlay)

	names := serverNames(svc.MCPServers())
	if len(names) != 2 || !names["kiao-alpha"] || !names["kiao-beta"] {
		t.Fatalf("registered servers = %v, want the two the env variable named", names)
	}

	// And the ledger is the authority from then on: switching one off has to survive a restart,
	// which is exactly what the env variable would otherwise undo.
	if err := svc.SetRegistered([]string{"kiao-beta"}, false); err != nil {
		t.Fatalf("SetRegistered: %v", err)
	}
	restarted, err := Start(svc.cfg, bundled, []string{"alpha", "beta"})
	if err != nil {
		t.Fatalf("Start again: %v", err)
	}
	if names := serverNames(restarted.MCPServers()); names["kiao-beta"] {
		t.Errorf("registered servers = %v; the env variable must not resurrect what the panel switched off", names)
	}
}

// TestBundledServerNeedsItsBundle: a server switched on in a deployment that stages no bundle is
// left out rather than named. A turn handed a command that does not exist gets a server failing on
// the CLI's own stderr, which is not where anyone looks.
func TestBundledServerNeedsItsBundle(t *testing.T) {
	svc := newTestService(t, nil, []string{"files"})
	if servers := svc.MCPServers(); len(servers) != 0 {
		t.Errorf("MCPServers = %v, want nothing: no bundle is staged", servers)
	}

	row := rowByID(t, svc.State(), "kiao-files")
	if row.State != StateUnavailable {
		t.Errorf("kiao-files state = %q, want %q with no bundle staged", row.State, StateUnavailable)
	}
}

// TestRemoteServerCarriesTheTokenByReference: the GitHub row is blocked without a token, and with
// one it declares `${VAR}` rather than the value. A secret written into the generated document
// would be a secret at rest in the state directory.
func TestRemoteServerCarriesTheTokenByReference(t *testing.T) {
	svc := newTestService(t, nil, nil)

	if row := rowByID(t, svc.State(), "github"); row.State != StateBlocked {
		t.Errorf("github state = %q with no token, want %q", row.State, StateBlocked)
	}

	t.Setenv("GITHUB_TOKEN", "ghp-not-a-real-one")
	if err := svc.SetRegistered([]string{"github"}, true); err != nil {
		t.Fatalf("SetRegistered: %v", err)
	}
	servers := svc.MCPServers()
	if len(servers) != 1 {
		t.Fatalf("MCPServers = %v, want github", servers)
	}
	if servers[0].Type != core.MCPHTTP || servers[0].URL == "" {
		t.Errorf("github = %+v, want an HTTP endpoint", servers[0])
	}
	if got := servers[0].Headers["Authorization"]; got != "Bearer ${GITHUB_TOKEN}" {
		t.Errorf("Authorization = %q, want the env reference the CLI expands", got)
	}
	if row := rowByID(t, svc.State(), "github"); row.State != StateInstalled {
		t.Errorf("github state = %q with a token set, want %q", row.State, StateInstalled)
	}
}

// TestInstalledServerNeedsItsFiles: the ledger is a record, not a guarantee. A prefix cleared by
// hand leaves it claiming an install that is not there, and the panel has to say so rather than
// hand a turn a command that is gone.
func TestInstalledServerNeedsItsFiles(t *testing.T) {
	svc := newTestService(t, nil, nil)

	command := filepath.Join(svc.cfg.binDir(), "mcp-server-fetch")
	if err := os.MkdirAll(svc.cfg.binDir(), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(command, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := svc.ledger.put("fetch", Entry{Installed: true, Enabled: true, Command: command}); err != nil {
		t.Fatalf("put: %v", err)
	}
	if names := serverNames(svc.MCPServers()); !names["fetch"] {
		t.Fatalf("fetch is installed and switched on but was not handed to a turn")
	}
	if row := rowByID(t, svc.State(), "fetch"); row.State != StateInstalled {
		t.Errorf("fetch state = %q, want %q", row.State, StateInstalled)
	}

	if err := os.Remove(command); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if servers := svc.MCPServers(); len(servers) != 0 {
		t.Errorf("MCPServers = %v; a command that is gone must not be handed to a turn", servers)
	}
	row := rowByID(t, svc.State(), "fetch")
	if row.State != StateMissing || row.Reason == "" {
		t.Errorf("fetch = %+v, want %q with a reason a person can act on", row, StateMissing)
	}
}

// TestAServerIsToldWhereTheToolboxPutThings is the playwright failure. The Chromium its post-install
// fetches goes into the prefix, and the server that a turn spawns looked in the home directory
// instead, because the environment the install ran in is not the environment a turn runs in. The
// catalogue cannot write the path — it belongs to the deployment — so it writes a reference and this
// resolves it on the way out.
func TestAServerIsToldWhereTheToolboxPutThings(t *testing.T) {
	svc := newTestService(t, nil, nil)
	if err := os.MkdirAll(svc.cfg.binDir(), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	command := filepath.Join(svc.cfg.binDir(), "node")
	if err := os.WriteFile(command, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := svc.ledger.put("playwright", Entry{Installed: true, Enabled: true, Command: command}); err != nil {
		t.Fatalf("put: %v", err)
	}

	comp, _ := svc.catalog.Get("playwright")
	server, ok := svc.serverFor(comp)
	if !ok {
		t.Fatal("playwright is installed and did not resolve to a server")
	}
	if got := server.Env["PLAYWRIGHT_BROWSERS_PATH"]; got != svc.cfg.browsersDir() {
		t.Errorf("PLAYWRIGHT_BROWSERS_PATH = %q, want the prefix's own %q", got, svc.cfg.browsersDir())
	}
	// And the browser it is told to use has to be the one the post-install downloads. The default
	// is the `chrome` channel, which means Google Chrome installed system-wide — root, apt, and a
	// thing this panel is not allowed to do.
	if !slices.Contains(server.Args, "chromium") {
		t.Errorf("args = %v; the server must be told to use the Chromium the toolbox installed", server.Args)
	}
}

// TestUnknownTokensSurvive: a reference this service does not know stays visible rather than
// becoming an empty string a server would fail on for no stated reason.
func TestUnknownTokensSurvive(t *testing.T) {
	cfg := &Config{Config: &core.Config{StatePath: t.TempDir()}, Prefix: "/tools"}
	if got := cfg.expandTokens("${toolbox:browsers}/x"); got != "/tools/browsers/x" {
		t.Errorf("expand = %q, want the prefix's browsers directory", got)
	}
	if got := cfg.expandTokens("${toolbox:nowhere}"); got != "${toolbox:nowhere}" {
		t.Errorf("expand = %q, want the reference left alone", got)
	}
	// The CLI's own form means something else entirely and is not this service's to touch.
	if got := cfg.expandTokens("Bearer ${GITHUB_TOKEN}"); got != "Bearer ${GITHUB_TOKEN}" {
		t.Errorf("expand = %q; ${VAR} is expanded by the CLI, from its own environment", got)
	}
}

// TestUninstallOwnership is the boundary of what this panel owns, in both directions: it will not
// remove what it did not install, and it will not pull the ground out from under something that is
// still installed.
func TestUninstallOwnership(t *testing.T) {
	svc := newTestService(t, nil, nil)

	if _, err := svc.Uninstall([]string{"fetch"}); err == nil {
		t.Errorf("uninstalling something this service never installed must be refused")
	}
	if _, err := svc.Uninstall([]string{"not-a-component"}); err == nil {
		t.Errorf("an unknown id must be refused")
	}

	if err := svc.ledger.put("uv", Entry{Installed: true}); err != nil {
		t.Fatalf("put: %v", err)
	}
	if err := svc.ledger.put("fetch", Entry{Installed: true, Enabled: true}); err != nil {
		t.Fatalf("put: %v", err)
	}
	if _, err := svc.Uninstall([]string{"uv"}); err == nil {
		t.Errorf("removing uv while fetch still needs it must be refused")
	}
	// Both together is allowed, and fetch has to go first so that uv is still there to do it.
	job, err := svc.Uninstall([]string{"uv", "fetch"})
	if err != nil {
		t.Fatalf("Uninstall(both): %v", err)
	}
	if len(job.IDs) < 2 || job.IDs[0] != "fetch" {
		t.Errorf("plan = %v, want fetch removed before uv", job.IDs)
	}
}

// TestResolveSkipsWhatIsAlreadyThere: a dependency already installed is not reinstalled, but a row
// asked for explicitly is — which is how a component reported as missing is repaired.
func TestResolveSkipsWhatIsAlreadyThere(t *testing.T) {
	svc := newTestService(t, nil, nil)
	if err := svc.ledger.put("uv", Entry{Installed: true}); err != nil {
		t.Fatalf("put: %v", err)
	}

	plan, err := svc.resolve([]string{"fetch"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(plan) != 1 || plan[0] != "fetch" {
		t.Errorf("plan = %v, want fetch alone: uv is already installed", plan)
	}

	if err := svc.ledger.put("fetch", Entry{Installed: true}); err != nil {
		t.Fatalf("put: %v", err)
	}
	plan, err = svc.resolve([]string{"fetch"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(plan) != 1 || plan[0] != "fetch" {
		t.Errorf("plan = %v; asking for an installed component again must reinstall it", plan)
	}
}

// TestDisabledDeploymentInstallsNothing: with no prefix the panel is read-only, and says so, rather
// than answering an empty list or installing into a directory nobody chose.
func TestDisabledDeploymentInstallsNothing(t *testing.T) {
	cfg := &Config{Config: &core.Config{StatePath: t.TempDir()}}
	svc, err := Start(cfg, nil, nil)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	state := svc.State()
	if state.Enabled {
		t.Errorf("a deployment with no toolbox path must report the panel disabled")
	}
	if len(state.Components) == 0 {
		t.Errorf("the catalogue is still worth showing, read-only")
	}
	if _, err := svc.Install([]string{"fetch"}); err == nil {
		t.Errorf("installing with no prefix configured must be refused")
	}
}

// TestSetRegisteredRefusesARuntime: switching a JDK "on for turns" is meaningless, and a panel bug
// that asked for it should be a 400 rather than a ledger entry nothing reads. An agent's CLI is the
// one runtime that is not meaningless — see the tests below.
func TestSetRegisteredRefusesARuntime(t *testing.T) {
	svc := newTestService(t, nil, nil)
	if err := svc.SetRegistered([]string{"jdk"}, true); err == nil {
		t.Errorf("a runtime is not an MCP server and cannot be registered")
	}
}

// An agent's CLI is offered until somebody says otherwise, and the switch is the answer for a
// binary this panel did not install — one baked into an image, one already on the machine. That
// row used to read "on this machine" and offer nothing at all, which left no way to take an agent
// out of the tab short of deleting a file the panel does not own.
func TestAnAgentIsOfferedUntilTheSwitchSaysOtherwise(t *testing.T) {
	svc := newTestService(t, nil, nil)

	for _, agent := range []string{"claude", "codex"} {
		if !svc.AgentOffered(agent) {
			t.Errorf("%s: an agent nobody has said anything about must be offered", agent)
		}
	}
	// An agent this catalogue has no row for is not this panel's to withhold.
	if !svc.AgentOffered("gemini") {
		t.Error("an agent with no catalogue row must be offered rather than silently withheld")
	}

	if err := svc.SetRegistered([]string{"codex-cli"}, false); err != nil {
		t.Fatalf("SetRegistered: %v", err)
	}
	if svc.AgentOffered("codex") {
		t.Error("Codex must be withdrawn once its row is switched off")
	}
	if !svc.AgentOffered("claude") {
		t.Error("switching Codex off must not withdraw Claude")
	}

	// The row says so too, and the other way round from an MCP server's: an untouched agent reads
	// as registered where an untouched server reads as not.
	rows := map[string]ToolboxComponentDto{}
	for _, row := range svc.State().Components {
		rows[row.ID] = row
	}
	if !rows["claude-cli"].Registered || rows["codex-cli"].Registered {
		t.Errorf("rows = claude %v / codex %v, want the switch reflected",
			rows["claude-cli"].Registered, rows["codex-cli"].Registered)
	}
	if rows["claude-cli"].Agent != "claude" {
		t.Errorf("claude-cli.agent = %q, want the name the agent tab knows it by", rows["claude-cli"].Agent)
	}

	// And it survives a restart, which is the whole reason it is in the ledger and not in a flag.
	restarted, err := Start(svc.cfg, nil, nil)
	if err != nil {
		t.Fatalf("Start again: %v", err)
	}
	if restarted.AgentOffered("codex") {
		t.Error("a switched-off agent must stay switched off across a restart")
	}
}

// Installing an agent's CLI switches that agent on: the button was pressed by somebody who wants
// it, and the install and the switch write the same field — so an install that left the field alone
// would put the bytes back and leave the tab empty.
func TestInstallingAnAgentCLISwitchesItOn(t *testing.T) {
	svc := newTestService(t, nil, nil)
	if err := svc.SetRegistered([]string{"claude-cli"}, false); err != nil {
		t.Fatalf("SetRegistered: %v", err)
	}

	if err := svc.record("claude-cli", Entry{Installed: true, Version: "1.0.0"}, &jobLog{}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if !svc.AgentOffered("claude") {
		t.Error("installing an agent's CLI must switch that agent on")
	}
}

// TestOneJobAtATime: a package manager is serial, and a second request is told so rather than
// queued somewhere nobody can inspect.
func TestOneJobAtATime(t *testing.T) {
	r := &runner{}
	block := make(chan struct{})
	if _, err := r.start("install", []string{"a"}, func(*jobLog) error {
		<-block
		return nil
	}); err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := r.start("install", []string{"b"}, func(*jobLog) error { return nil }); err == nil {
		t.Errorf("a second job while one runs must be refused")
	}
	close(block)
}

// TestLedgerSurvivesARestart: the document is what the next process reads, so its shape is a
// contract with itself.
func TestLedgerSurvivesARestart(t *testing.T) {
	state := t.TempDir()
	path := filepath.Join(state, "toolbox.json")

	ledger, err := openLedger(path)
	if err != nil {
		t.Fatalf("openLedger: %v", err)
	}
	if err := ledger.put("fetch", Entry{Installed: true, Enabled: true, Command: "/bin/fetch", Tools: 2, ToolBytes: 900}); err != nil {
		t.Fatalf("put: %v", err)
	}

	reopened, err := openLedger(path)
	if err != nil {
		t.Fatalf("openLedger again: %v", err)
	}
	entry, ok := reopened.get("fetch")
	if !ok || !entry.Installed || entry.Command != "/bin/fetch" || entry.Tools != 2 {
		t.Errorf("entry = %+v, %v; want what was written", entry, ok)
	}

	// A document that will not parse is a stop, not an empty start: continuing would report every
	// installed component as absent and the next install would write over the record of the others.
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := openLedger(path); err == nil {
		t.Errorf("an unreadable ledger must be reported, not silently emptied")
	}
}

// TestFirstBinScript covers both shapes npm's `bin` field takes.
func TestFirstBinScript(t *testing.T) {
	if got, err := firstBinScript(json.RawMessage(`"dist/cli.js"`), "/pkg"); err != nil || got != filepath.Join("/pkg", "dist", "cli.js") {
		t.Errorf("string bin = %q, %v", got, err)
	}
	if got, err := firstBinScript(json.RawMessage(`{"b":"dist/b.js","a":"dist/a.js"}`), "/pkg"); err != nil || got != filepath.Join("/pkg", "dist", "a.js") {
		t.Errorf("map bin = %q, %v; want the same answer every time, so sorted", got, err)
	}
	if _, err := firstBinScript(nil, "/pkg"); err == nil {
		t.Errorf("a package with no executable must be reported")
	}
}

// TestOSReleaseIDs: a derivative names the family it belongs to, and either answer places it.
func TestOSReleaseIDs(t *testing.T) {
	ids := osReleaseIDs("NAME=\"Linux Mint\"\nID=linuxmint\nID_LIKE=\"ubuntu debian\"\n")
	if len(ids) < 3 || ids[0] != "linuxmint" {
		t.Fatalf("ids = %v, want the id first then the family", ids)
	}
	if detectPlatformFrom(ids) != platformDebian {
		t.Errorf("Mint must be placed on the debian recipes")
	}
	if detectPlatformFrom(osReleaseIDs("ID=alpine\n")) != platformAlpine {
		t.Errorf("Alpine must be placed on its own recipes")
	}
	if detectPlatformFrom(osReleaseIDs("ID=something-else\n")) != platformGeneric {
		t.Errorf("an unplaced system falls back to the generic recipes")
	}
}

// TestConfigValidate: the two ways a prefix is wrong, both of which would only show up much later.
func TestConfigValidate(t *testing.T) {
	state := t.TempDir()

	if problems := (&Config{Config: &core.Config{StatePath: state}}).Validate(); len(problems) != 0 {
		t.Errorf("no toolbox configured is not a problem, got %v", problems)
	}
	if problems := (&Config{Config: &core.Config{StatePath: state}, Prefix: "toolbox"}).Validate(); len(problems) == 0 {
		t.Errorf("a relative prefix resolves against the working directory and must be refused")
	}
	if problems := (&Config{Config: &core.Config{StatePath: state}, Prefix: filepath.Join(state, "tools")}).Validate(); len(problems) == 0 {
		t.Errorf("a prefix inside the state directory would be swept with it and must be refused")
	}
}

// TestTheCatalogueNamesTheServerExecutable is the `papers` failure. `uv tool install
// paper-search-mcp` reports two console scripts — `paper-search`, a command-line search tool, and
// `paper-search-mcp`, the stdio server — and taking the first started the CLI, which exits at once
// on a missing argument and looks from the outside like a server that answers nothing.
func TestTheCatalogueNamesTheServerExecutable(t *testing.T) {
	shipped := uvExecutables("Installed 2 executables: paper-search, paper-search-mcp\n")
	if len(shipped) != 2 || shipped[0] != "paper-search" {
		t.Fatalf("uvExecutables = %v, want both names uv printed", shipped)
	}

	if got, stale := pickExecutable("paper-search-mcp", shipped); got != "paper-search-mcp" || stale {
		t.Errorf("pick = %q, %v; the catalogue names the one that speaks MCP and the package ships it", got, stale)
	}
	// A recipe that names none takes what the package shipped, which is how every single-entrypoint
	// server in the catalogue was resolved before there was a reason to name one.
	if got, stale := pickExecutable("", shipped); got != "paper-search" || stale {
		t.Errorf("pick = %q, %v; with no name in the catalogue, uv's first is the answer", got, stale)
	}
	// And the catalogue does not get to insist on a name the package has stopped shipping: the
	// install still works, and the log says the entry has gone stale.
	if got, stale := pickExecutable("mcp-server-fetch", []string{"fetch-mcp"}); got != "fetch-mcp" || !stale {
		t.Errorf("pick = %q, %v; a renamed console script must still install, and be reported", got, stale)
	}
	// An upgrade that installed nothing new prints no list. That is silence, not a contradiction.
	if got, stale := pickExecutable("mcp-server-fetch", nil); got != "mcp-server-fetch" || stale {
		t.Errorf("pick = %q, %v; an upgrade that printed nothing leaves the catalogue's name standing", got, stale)
	}
}

// TestARuntimeIsPresentOnlyWhenItIsComplete is the npm-channel failure. Ubuntu's `nodejs` package
// puts node on the machine and no npm at all; a panel that reads that as "Node is here" skips
// installing the one it controls, and the npm driver then fails on a file that was never going to
// be there. A runtime is what its dependents reach for, all of it.
func TestARuntimeIsPresentOnlyWhenItIsComplete(t *testing.T) {
	cfg := &Config{Config: &core.Config{StatePath: t.TempDir()}, Prefix: t.TempDir()}
	if err := os.MkdirAll(cfg.binDir(), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	// Names no machine has, so the answer is about the prefix and not about the machine the test
	// happens to run on.
	recipe := Recipe{Bin: "kiao-test-runtime", AlsoProvides: []string{"kiao-test-companion"}}
	write := func(name string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(cfg.binDir(), name), []byte("#!/bin/sh\necho v1\n"), 0o755); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	if _, missing, ok := present(cfg, recipe); ok || missing != "kiao-test-runtime" {
		t.Errorf("present = %q, %v with nothing installed, want the runtime itself reported missing", missing, ok)
	}
	write("kiao-test-runtime")
	_, missing, ok := present(cfg, recipe)
	if ok {
		t.Errorf("a runtime whose companion is absent is not present: its dependents cannot use it")
	}
	if missing != "kiao-test-companion" {
		t.Errorf("missing = %q, want the companion named, so the row can say why it offers an install", missing)
	}
	write("kiao-test-companion")
	if version, missing, ok := present(cfg, recipe); !ok || missing != "" || version == "" {
		t.Errorf("present = %q, %q, %v; complete, it is present and answers a version", version, missing, ok)
	}
}

// TestNPMComesFromTheToolbox: what npm is run as, when the panel installed Node. `node npm-cli.js`
// rather than the `npm` symlink, whose shebang would resolve `node` through an environment this
// service does not arrange — and never a bare "npm", which Go looks up on the *service's* PATH.
func TestNPMComesFromTheToolbox(t *testing.T) {
	cfg := &Config{Config: &core.Config{StatePath: t.TempDir()}, Prefix: t.TempDir()}
	in := newInstaller(cfg, &jobLog{})

	node := filepath.Join(cfg.nodeDir(), "bin", "node")
	cli := filepath.Join(cfg.nodeDir(), "lib", "node_modules", "npm", "bin", "npm-cli.js")
	for _, path := range []string{node, cli} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	command, err := in.npmCommand()
	if err != nil {
		t.Fatalf("npmCommand: %v", err)
	}
	if len(command) != 2 || command[0] != node || command[1] != cli {
		t.Errorf("npmCommand = %v, want the toolbox's node running its own npm-cli.js", command)
	}
	for _, part := range command {
		if !filepath.IsAbs(part) {
			t.Errorf("npmCommand = %v; a bare name resolves through a PATH this service does not arrange", command)
		}
	}
}
// ── helpers ───────────────────────────────────────────────────────────────────

func serverNames(servers []core.MCPServer) map[string]bool {
	names := map[string]bool{}
	for _, server := range servers {
		names[server.Name] = true
	}
	return names
}

func rowByID(t *testing.T, state ToolboxDto, id string) ToolboxComponentDto {
	t.Helper()
	for _, row := range state.Components {
		if row.ID == id {
			return row
		}
	}
	t.Fatalf("the panel has no row for %q", id)
	return ToolboxComponentDto{}
}

// TestUVBinFallsBackToTheMachine is the bug this test exists for: a machine that already has uv is
// one where the closure *skips* installing it, so a driver that only ever looked in the prefix
// failed every uv-channel install on exactly the machines best equipped to run one.
func TestUVBinFallsBackToTheMachine(t *testing.T) {
	cfg := &Config{Config: &core.Config{StatePath: t.TempDir()}, Prefix: t.TempDir()}
	in := newInstaller(cfg, &jobLog{})

	// Nothing in the prefix: whatever is answered must not be the path that is known to be absent,
	// unless the machine has no uv either — in which case naming it is the honest failure.
	if _, err := exec.LookPath("uv"); err == nil {
		if got := in.uvBin(); got == filepath.Join(cfg.binDir(), "uv") {
			t.Errorf("uvBin = %q; the machine has a uv and the prefix does not", got)
		}
	}

	// Installed here: the prefix's wins, because that is the one this panel maintains.
	if err := os.MkdirAll(cfg.binDir(), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	own := filepath.Join(cfg.binDir(), "uv")
	if err := os.WriteFile(own, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}
	if got := in.uvBin(); got != own {
		t.Errorf("uvBin = %q, want the prefix's own %q", got, own)
	}
}

// TestNodeBinIsAbsolute: what goes in the ledger becomes a turn's command, and a bare name would
// resolve through a PATH this service does not arrange.
func TestNodeBinIsAbsolute(t *testing.T) {
	cfg := &Config{Config: &core.Config{StatePath: t.TempDir(), NodeBinary: "sh"}, Prefix: t.TempDir()}
	in := newInstaller(cfg, &jobLog{})
	if got := in.nodeBin(); !filepath.IsAbs(got) {
		t.Errorf("nodeBin = %q, want an absolute path", got)
	}
}

// TestAProbeFailureLeavesTheServerOff: the entry has to be written before the probe, because the
// probe resolves its command out of it — so a probe that fails must undo that registration.
// Otherwise the server the probe just proved does not start would be handed to every turn, which is
// the one failure the probe exists to prevent.
func TestAProbeFailureLeavesTheServerOff(t *testing.T) {
	svc := newTestService(t, nil, nil)
	if err := os.MkdirAll(svc.cfg.binDir(), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	// An executable that starts and says nothing: the shape of a server that will not handshake.
	command := filepath.Join(svc.cfg.binDir(), "mcp-server-fetch")
	if err := os.WriteFile(command, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}

	if err := svc.record("fetch", Entry{Installed: true, Command: command}, &jobLog{}); err == nil {
		t.Fatal("a server that answers nothing must fail its install")
	}
	entry, ok := svc.ledger.get("fetch")
	if !ok || !entry.Installed {
		t.Errorf("entry = %+v; the bytes are on the machine and the ledger should say so", entry)
	}
	if entry.Enabled {
		t.Errorf("entry = %+v; a server that failed its probe must not be registered", entry)
	}
	if servers := svc.MCPServers(); len(servers) != 0 {
		t.Errorf("MCPServers = %v; a server that failed its probe must not reach a turn", servers)
	}

	// And the panel has to say so. "installed" in green over a server that answers nothing is the
	// one report this whole probe exists to avoid, and it is what the row used to show.
	row := rowByID(t, svc.State(), "fetch")
	if row.State != StateUnresponsive || row.Reason == "" {
		t.Errorf("fetch = %+v, want %q with a reason", row, StateUnresponsive)
	}

	// The switch is the other way in. A row that says "it did not answer" and a switch that hands
	// it to every turn anyway would be the panel disagreeing with itself.
	if err := svc.SetRegistered([]string{"fetch"}, true); err == nil {
		t.Errorf("switching on a server known not to answer must be refused")
	}
	if entry, _ := svc.ledger.get("fetch"); entry.Enabled {
		t.Errorf("entry = %+v; the refusal must not have registered it anyway", entry)
	}
}

// TestAFailedProbeQuotesWhatTheServerSaid is the papers failure, in miniature: `uv` installed the
// package perfectly and the console script it ran was the package's *CLI*, which exits at once
// complaining about a missing argument. All the panel showed of that was "EOF". What a person needs
// is the sentence the server printed on its way out.
func TestAFailedProbeQuotesWhatTheServerSaid(t *testing.T) {
	svc := newTestService(t, nil, nil)
	if err := os.MkdirAll(svc.cfg.binDir(), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	command := filepath.Join(svc.cfg.binDir(), "mcp-server-fetch")
	script := "#!/bin/sh\necho 'usage: fetch [-h] {search,download}' >&2\necho 'fetch: error: the following arguments are required: command' >&2\nexit 2\n"
	if err := os.WriteFile(command, []byte(script), 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}

	err := svc.record("fetch", Entry{Installed: true, Command: command}, &jobLog{})
	if err == nil {
		t.Fatal("a server that exits on start must fail its install")
	}
	if !strings.Contains(err.Error(), "the following arguments are required") {
		t.Errorf("error = %q; it must carry what the server said, not only \"EOF\"", err)
	}
	if !strings.Contains(err.Error(), "exited without answering") {
		t.Errorf("error = %q; a server that died on start must be reported as that", err)
	}
	if entry, _ := svc.ledger.get("fetch"); entry.ProbeError == "" || entry.ProbedAt == "" {
		t.Errorf("entry = %+v; the verdict has to outlive the job, or the row cannot show it", entry)
	}
}

// TestGraphvizRowSuggestsTheCommand: Graphviz is detect-only — the panel reports dot and names the
// system's own install command when it is absent, and never offers an install. PATH is emptied so
// the row does not depend on the machine the test runs on.
func TestGraphvizRowSuggestsTheCommand(t *testing.T) {
	svc := newTestService(t, nil, nil)
	t.Setenv("PATH", t.TempDir())

	row := rowByID(t, svc.State(), "graphviz")
	if row.State != StateBlocked {
		t.Errorf("graphviz state = %q with no dot, want %q", row.State, StateBlocked)
	}
	if !strings.Contains(row.Reason, "sudo apt-get install -y graphviz") {
		t.Errorf("graphviz reason = %q, want the system's own install command", row.Reason)
	}

	svc.cfg.Target = platformAlpine
	if row := rowByID(t, svc.State(), "graphviz"); !strings.Contains(row.Reason, "apk add graphviz") {
		t.Errorf("graphviz reason on alpine = %q, want the apk line", row.Reason)
	}
}

// TestGraphvizRowReadsDotOnTheMachine: a dot the operator installed reads as present, with the
// version it answers -V with — the only spelling it knows.
func TestGraphvizRowReadsDotOnTheMachine(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in for dot is a shell script")
	}
	dir := t.TempDir()
	script := `#!/bin/sh
[ "$1" = -V ] || { echo "unrecognized option '$1'" >&2; exit 1; }
echo 'dot - graphviz version 2.43.0 (0)' >&2
`
	if err := os.WriteFile(filepath.Join(dir, "dot"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)

	svc := newTestService(t, nil, nil)
	// The version probe runs with the prefix as its working directory, which a deployment has
	// and a fresh test service does not.
	if err := os.MkdirAll(svc.cfg.Prefix, 0o755); err != nil {
		t.Fatal(err)
	}
	row := rowByID(t, svc.State(), "graphviz")
	if row.State != StatePresent {
		t.Errorf("graphviz state = %q with dot on PATH, want %q", row.State, StatePresent)
	}
	if row.Version != "dot - graphviz version 2.43.0 (0)" {
		t.Errorf("graphviz version = %q, want what dot answers -V with", row.Version)
	}
}

// TestInstallRefusesADetectOnlyComponent: a detect-only row has no Install button, but the endpoint
// is still reachable — asking for one names the command instead of starting a job that could only
// fail.
func TestInstallRefusesADetectOnlyComponent(t *testing.T) {
	svc := newTestService(t, nil, nil)
	svc.cfg.Target = platformDebian
	if _, err := svc.Install([]string{"graphviz"}); err == nil {
		t.Fatal("Install(graphviz) succeeded; a detect-only component has nothing to install")
	} else if !strings.Contains(err.Error(), "sudo apt-get install -y graphviz") {
		t.Errorf("Install(graphviz) = %v, want the system's own install command", err)
	}
}
