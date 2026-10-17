package toolbox

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"sort"
	"strings"
	"time"

	"kiao/worker/internal/core"
)

// The channel drivers: the one place in DCMS that puts software on the machine.
//
// Every one of them obeys the same three rules, and they are the whole of what makes this safe to
// expose over HTTP. **Nothing is interpreted by a shell** — every command is argv through
// core.RunProc, the way git and the migrations already run. **Nothing is written outside the
// prefix** — each tool is handed an environment pointing its own idea of "global" at the toolbox
// (see Config.installEnv), so an npm `-g` lands in <prefix>/npm rather than in /usr or in someone's
// home. And **nothing downloaded is trusted unverified**: a tarball is checked against a checksum
// published by the same server, which is the discipline bin/install-go-toolchain.sh already applies
// to the Go toolchain.
//
// What none of them do is ask for root. The user's decision, and the one that shapes the driver
// list: on a machine somebody owns and on a server the service user is not root and installing
// through apt would mean a sudoers rule, so a JDK is a Temurin tarball, Node is the official LTS
// tarball, and Python is uv's. The `system` channel exists for exactly one place — inside the
// `kiao` image, where the process already is root, there is no sudo to ask, and an install
// that skips the image's own mechanism does not survive the container being recreated.
//
// commandTimeout bounds one driver command. Generous on purpose: the Chromium @playwright/mcp
// needs is 150 MB, and a uv tool install that has to build a wheel is minutes rather than seconds.
const commandTimeout = 30 * time.Minute

// downloadTimeout bounds one HTTP download, which is a Go-side io.Copy rather than a process.
const downloadTimeout = 20 * time.Minute

// installer carries what every driver needs: where it may write, what it logs to, and the resolved
// recipe. One per job step, so a driver never reaches for process-wide state.
type installer struct {
	cfg    *Config
	log    *jobLog
	client *http.Client
}

func newInstaller(cfg *Config, log *jobLog) *installer {
	return &installer{cfg: cfg, log: log, client: &http.Client{Timeout: downloadTimeout}}
}

// run executes one command, logging the command line before it and its output after. The log is
// what the panel shows, so a failure has to explain itself there and not only in the journal.
func (in *installer) run(command []string, workDir string) error {
	in.log.printf("$ %s", strings.Join(command, " "))
	res := core.RunProc(command, workDir, commandTimeout, in.cfg.installEnv())
	if out := strings.TrimSpace(res.Combined()); out != "" {
		in.log.print(out)
	}
	if !res.OK() {
		return fmt.Errorf("%s exited %d: %s", filepath.Base(command[0]), res.Exit, firstLines(res.Combined(), 3))
	}
	return nil
}

// output is run for a command whose stdout is the answer rather than a trace.
func (in *installer) output(command []string) (string, error) {
	in.log.printf("$ %s", strings.Join(command, " "))
	res := core.RunProc(command, in.cfg.Prefix, commandTimeout, in.cfg.installEnv())
	if !res.OK() {
		return "", fmt.Errorf("%s exited %d: %s", filepath.Base(command[0]), res.Exit, firstLines(res.Combined(), 3))
	}
	return res.Stdout, nil
}

// ── the driver table ──────────────────────────────────────────────────────────

// install performs one component and answers the ledger entry to record. It is called with the
// dependency closure already resolved and already installed, so a driver may assume `uv` is there
// when its recipe says `uv`.
func (in *installer) install(comp Component, recipe Recipe) (Entry, error) {
	entry := Entry{Installed: true, InstalledAt: stamp()}

	switch recipe.Channel {
	case channelUVBootstrap:
		version, err := in.installUV()
		entry.Version = version
		return entry, err

	case channelUV:
		command, version, err := in.installUVTool(recipe)
		entry.Command, entry.Version = command, version
		return entry, err

	case channelUVPython:
		version, err := in.installUVPython(recipe)
		entry.Version = version
		return entry, err

	case channelNodeTarball:
		version, err := in.installNode(recipe)
		entry.Version = version
		return entry, err

	case channelTemurin:
		version, err := in.installTemurin(recipe)
		entry.Version = version
		return entry, err

	case channelNPM:
		command, args, version, err := in.installNPM(recipe)
		entry.Command, entry.Args, entry.Version = command, args, version
		return entry, err

	case channelSystem:
		version, err := in.installSystem(recipe)
		entry.Version = version
		return entry, err

	case channelClaudeRelease:
		version, err := in.installClaudeCLI(recipe)
		entry.Version = version
		return entry, err

	case channelCodexRelease:
		version, err := in.installCodexCLI(recipe)
		entry.Version = version
		return entry, err

	case channelMuseRelease:
		version, err := in.installMuseCLI(recipe)
		entry.Version = version
		return entry, err

	case channelOpenCodeRelease:
		version, err := in.installOpenCodeCLI(recipe)
		entry.Version = version
		return entry, err

	case channelFFmpegRelease:
		version, err := in.installFFmpeg(recipe)
		entry.Version = version
		return entry, err

	case channelDetect:
		// Reached through `toolbox preinstall`, which names ids straight at the drivers: there is
		// nothing to stage, so this names the command rather than failing as an unknown channel.
		return entry, fmt.Errorf("not installed by this panel — `%s`",
			detectInstallCommand(in.cfg.platform(), recipe.Packages))

	case channelRemote, channelBundled:
		// Nothing to install: these exist as a registration. The job still runs so that asking to
		// install one has the effect the panel promised — the entry appears, enabled.
		entry.Installed = false
		return entry, nil

	default:
		return entry, fmt.Errorf("component %s: unknown channel %q", comp.ID, recipe.Channel)
	}
}

// uninstall reverses one component. It is only ever called for something the ledger says this
// service installed — the caller checks, because that check is the whole of what keeps the panel
// from deleting a tool somebody else put on the machine.
func (in *installer) uninstall(comp Component, recipe Recipe, entry Entry) error {
	switch recipe.Channel {
	case channelUVBootstrap:
		// uv's own installer writes two binaries and one store; there is no `uv uninstall self`
		// that leaves the store behind, so this removes what the bootstrap created.
		in.log.printf("removing %s, %s and %s", filepath.Join(in.cfg.binDir(), "uv"),
			filepath.Join(in.cfg.binDir(), "uvx"), in.cfg.uvDir())
		return firstError(
			os.Remove(filepath.Join(in.cfg.binDir(), "uv")),
			os.Remove(filepath.Join(in.cfg.binDir(), "uvx")),
			os.RemoveAll(in.cfg.uvDir()),
		)

	case channelUV:
		return in.run([]string{in.uvBin(), "tool", "uninstall", recipe.Package}, in.cfg.Prefix)

	case channelUVPython:
		return in.run([]string{in.uvBin(), "python", "uninstall", recipe.Version}, in.cfg.Prefix)

	case channelNodeTarball:
		in.log.printf("removing %s", in.cfg.nodeDir())
		return os.RemoveAll(in.cfg.nodeDir())

	case channelTemurin:
		in.log.printf("removing %s", in.cfg.javaDir())
		return os.RemoveAll(in.cfg.javaDir())

	case channelNPM:
		npm, err := in.npmCommand()
		if err != nil {
			return err
		}
		if err := in.run(append(npm, "rm", "-g", recipe.Package), in.cfg.Prefix); err != nil {
			return err
		}
		// The browsers a post-install fetched are not the package's to remove and npm does not know
		// about them, so the driver that put them there takes them away.
		if recipe.PostInstall != nil {
			in.log.printf("removing %s", in.cfg.browsersDir())
			return os.RemoveAll(in.cfg.browsersDir())
		}
		return nil

	case channelClaudeRelease:
		// One file, written by the driver and named by it: nothing else in the prefix belongs to
		// this component.
		bin := filepath.Join(in.cfg.binDir(), "claude")
		in.log.printf("removing %s", bin)
		return firstError(os.Remove(bin))

	case channelCodexRelease:
		// The tree and the link into it, in that order — a link left pointing at nothing is the one
		// arrangement that reads as installed and is not.
		in.log.printf("removing %s and %s", filepath.Join(in.cfg.binDir(), "codex"), in.cfg.codexDir())
		return firstError(
			os.Remove(filepath.Join(in.cfg.binDir(), "codex")),
			os.RemoveAll(in.cfg.codexDir()),
		)

	case channelMuseRelease:
		// The link and the launcher's directory, in that order, for the codex channel's reason.
		in.log.printf("removing %s and %s", filepath.Join(in.cfg.binDir(), "muse"), in.cfg.museDir())
		return firstError(
			os.Remove(filepath.Join(in.cfg.binDir(), "muse")),
			os.RemoveAll(in.cfg.museDir()),
		)

	case channelOpenCodeRelease:
		// The link and the unpacked directory, in that order, for the codex channel's reason.
		in.log.printf("removing %s and %s", filepath.Join(in.cfg.binDir(), "opencode"), in.cfg.opencodeDir())
		return firstError(
			os.Remove(filepath.Join(in.cfg.binDir(), "opencode")),
			os.RemoveAll(in.cfg.opencodeDir()),
		)

	case channelFFmpegRelease:
		// The two files the driver took out of the archive, and nothing else: the rest of it was
		// never unpacked.
		var errs []error
		for _, name := range ffmpegExecutables {
			bin := filepath.Join(in.cfg.binDir(), name)
			in.log.printf("removing %s", bin)
			errs = append(errs, os.Remove(bin))
		}
		return firstError(errs...)

	case channelSystem:
		_, del, ok := systemInstaller(in.cfg.platform())
		if !ok {
			return fmt.Errorf("this system has no package manager this service may use")
		}
		return in.run(append(del, recipe.Packages...), in.cfg.Prefix)

	case channelDetect:
		// The ledger never claims one — there was never anything to record — so this is the
		// backstop behind Uninstall's own refusal, with the truthful message.
		return fmt.Errorf("%w: %s", errNotInstalled, comp.ID)

	case channelRemote, channelBundled:
		return nil

	default:
		return fmt.Errorf("component %s: unknown channel %q", comp.ID, recipe.Channel)
	}
}

// ── uv ────────────────────────────────────────────────────────────────────────

// uvBin is the uv this service runs: the prefix's if the panel installed one, the machine's
// otherwise. The fallback is not a convenience — a machine that already has uv is one where the
// closure skips installing it, so without this every uv-channel install on such a machine would
// fail on a path that was never going to exist. Either way the tool lands in the prefix, because
// that is what UV_TOOL_DIR and UV_TOOL_BIN_DIR say (see Config.installEnv), not what uv it is.
//
// Absolute in both cases, resolved here rather than left as "uv" on a PATH, so what ran is what the
// job log names.
func (in *installer) uvBin() string {
	if bin := filepath.Join(in.cfg.binDir(), "uv"); fileExists(bin) {
		return bin
	}
	if path, err := exec.LookPath("uv"); err == nil {
		return path
	}
	// Nothing found: name the prefix's path anyway, so the failure reads as the missing install it
	// is rather than as a bare "uv: not found".
	return filepath.Join(in.cfg.binDir(), "uv")
}

// installUV bootstraps uv with the installer Astral publishes, told to write into the prefix and
// to leave the user's shell profile alone. It is the one component with no channel of its own —
// everything else on the uv channel needs it to already be there.
func (in *installer) installUV() (string, error) {
	script := filepath.Join(in.cfg.downloadDir(), "uv-install.sh")
	if err := in.download("https://astral.sh/uv/install.sh", script, ""); err != nil {
		return "", err
	}
	defer os.Remove(script)

	in.log.printf("$ sh %s", script)
	res := core.RunProc([]string{"sh", script}, in.cfg.Prefix, commandTimeout, mergeEnv(in.cfg.installEnv(), map[string]string{
		// Where uv puts itself, and the promise not to touch a .bashrc this service does not own.
		"UV_INSTALL_DIR":           in.cfg.binDir(),
		"INSTALLER_NO_MODIFY_PATH": "1",
	}))
	if out := strings.TrimSpace(res.Combined()); out != "" {
		in.log.print(out)
	}
	if !res.OK() {
		return "", fmt.Errorf("the uv installer exited %d: %s", res.Exit, firstLines(res.Combined(), 3))
	}
	return in.versionOf(in.uvBin(), "--version")
}

// executablesLine is how `uv tool install` reports what it put on PATH. It is read for two
// different questions: what to run when the catalogue names nothing, and whether the name it does
// give still exists — because which console scripts a package ships is the package's business and
// changes between releases, while *which of them speaks MCP* is something only the catalogue knows.
var executablesLine = regexp.MustCompile(`Installed \d+ executables?: (.+)`)

// uvExecutables reads the line `uv tool install` ends on — "Installed 2 executables: a, b". An
// upgrade that installed nothing new prints none, which is why an empty list is not a failure here.
func uvExecutables(output string) []string {
	m := executablesLine.FindStringSubmatch(output)
	if m == nil {
		return nil
	}
	var names []string
	for _, name := range strings.Split(m[1], ",") {
		if name = strings.TrimSpace(name); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// pickExecutable chooses which of a package's console scripts is the one to run, and says whether
// the catalogue's answer had to be overruled. Empty when neither side names anything.
func pickExecutable(want string, shipped []string) (string, bool) {
	if want == "" {
		if len(shipped) == 0 {
			return "", false
		}
		return shipped[0], false
	}
	// An upgrade that installed nothing new prints no list at all, so an empty one is not a
	// contradiction of the catalogue — it is silence, and the catalogue is what breaks it.
	if len(shipped) == 0 || slices.Contains(shipped, want) {
		return want, false
	}
	return shipped[0], true
}

// installUVTool installs one Python tool and answers the executable a turn will run.
func (in *installer) installUVTool(recipe Recipe) (string, string, error) {
	command := []string{in.uvBin(), "tool", "install", "--upgrade"}
	for _, with := range recipe.With {
		command = append(command, "--with", with)
	}
	command = append(command, recipe.Package)

	in.log.printf("$ %s", strings.Join(command, " "))
	res := core.RunProc(command, in.cfg.Prefix, commandTimeout, in.cfg.installEnv())
	combined := res.Combined()
	if out := strings.TrimSpace(combined); out != "" {
		in.log.print(out)
	}
	if !res.OK() {
		return "", "", fmt.Errorf("uv tool install %s exited %d: %s", recipe.Package, res.Exit, firstLines(combined, 4))
	}

	// Which of them is the server. A package may ship several console scripts and only one of them
	// speaks MCP: `paper-search-mcp` installs `paper-search`, a command-line search tool, beside
	// `paper-search-mcp`, the stdio server — and taking uv's first name started the CLI, which
	// exits at once complaining about a missing argument. So the catalogue's name wins whenever the
	// package still ships it. uv's list stays the answer for a recipe that names none, and the
	// check that catches a catalogue whose name has gone stale, which is the case the reversed rule
	// was there for in the first place.
	shipped := uvExecutables(combined)
	name, stale := pickExecutable(recipe.Bin, shipped)
	if stale {
		in.log.printf("the catalogue expects %s to install %s; it installed %s, taking the first",
			recipe.Package, recipe.Bin, strings.Join(shipped, ", "))
	}
	if name == "" {
		return "", "", fmt.Errorf("uv installed %s but named no executable", recipe.Package)
	}
	bin := filepath.Join(in.cfg.binDir(), name)
	if _, err := os.Stat(bin); err != nil {
		return "", "", fmt.Errorf("uv installed %s but %s is not there", recipe.Package, bin)
	}
	return bin, in.uvToolVersion(recipe.Package), nil
}

// uvToolVersion reads the installed version out of `uv tool list`, which prints "name vX.Y.Z".
// A version is decoration on a panel row, so a failure here is worth nothing more than an empty
// string.
func (in *installer) uvToolVersion(pkg string) string {
	out, err := in.output([]string{in.uvBin(), "tool", "list"})
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == pkg {
			return strings.TrimPrefix(fields[1], "v")
		}
	}
	return ""
}

// installUVPython installs a managed interpreter and puts `python3` in the prefix's bin directory.
// `--default` is what creates that unversioned shim; older uv does not know the flag, and the
// interpreter is still worth having without it.
func (in *installer) installUVPython(recipe Recipe) (string, error) {
	if err := in.run([]string{in.uvBin(), "python", "install", "--default", recipe.Version}, in.cfg.Prefix); err != nil {
		in.log.print("retrying without --default, which this uv does not know")
		if err := in.run([]string{in.uvBin(), "python", "install", recipe.Version}, in.cfg.Prefix); err != nil {
			return "", err
		}
	}
	return recipe.Version, nil
}

// ── the tarball channels ──────────────────────────────────────────────────────

// nodeDistIndex is the manifest nodejs.org publishes of every release it has, newest first, each
// saying whether it is an LTS line. "the latest LTS" is a question with a moving answer, so it is
// asked at install time rather than pinned in the catalogue.
const nodeDistIndex = "https://nodejs.org/dist/index.json"

// installNode fetches the official Node build, verified against the SHASUMS256.txt published
// beside it, and unpacks it as <prefix>/node.
func (in *installer) installNode(recipe Recipe) (string, error) {
	arch, ok := hostArch()
	if !ok {
		return "", fmt.Errorf("no Node build is published for this machine's architecture")
	}

	version := recipe.Version
	if version == "" || version == "lts" {
		resolved, err := in.latestNodeLTS()
		if err != nil {
			return "", err
		}
		version = resolved
		in.log.printf("the current Node LTS is %s", version)
	}

	name := fmt.Sprintf("node-%s-linux-%s.tar.gz", version, arch)
	base := "https://nodejs.org/dist/" + version + "/"

	sum, err := in.checksumFromSHASUMS(base+"SHASUMS256.txt", name)
	if err != nil {
		return "", err
	}
	archive := filepath.Join(in.cfg.downloadDir(), name)
	if err := in.download(base+name, archive, sum); err != nil {
		return "", err
	}
	defer os.Remove(archive)

	if err := in.unpackInto(archive, in.cfg.nodeDir()); err != nil {
		return "", err
	}
	return in.versionOf(filepath.Join(in.cfg.nodeDir(), "bin", "node"), "--version")
}

// latestNodeLTS answers the newest release on an LTS line. The index is newest first, so the first
// entry whose `lts` field is not false is the one.
func (in *installer) latestNodeLTS() (string, error) {
	var releases []struct {
		Version string          `json:"version"`
		LTS     json.RawMessage `json:"lts"`
	}
	if err := in.getJSON(nodeDistIndex, &releases); err != nil {
		return "", err
	}
	for _, r := range releases {
		// `lts` is either the codename string or the literal false, which is why it is read raw.
		if len(r.LTS) > 0 && string(r.LTS) != "false" {
			return r.Version, nil
		}
	}
	return "", fmt.Errorf("nodejs.org lists no LTS release")
}

// adoptiumLatest is the API that answers, for a feature release, the current GA binary and its
// checksum. Asking it is what makes "the JDK" a moving target the panel keeps up with rather than
// a URL that rots in the catalogue.
const adoptiumLatest = "https://api.adoptium.net/v3/assets/latest/%s/hotspot?os=linux&architecture=%s&image_type=jdk"

// installTemurin fetches the Eclipse Temurin JDK and unpacks it as <prefix>/java.
func (in *installer) installTemurin(recipe Recipe) (string, error) {
	arch, ok := hostArch()
	if !ok {
		return "", fmt.Errorf("no Temurin build is published for this machine's architecture")
	}

	var assets []struct {
		ReleaseName string `json:"release_name"`
		Binary      struct {
			Package struct {
				Link     string `json:"link"`
				Name     string `json:"name"`
				Checksum string `json:"checksum"`
			} `json:"package"`
		} `json:"binary"`
	}
	if err := in.getJSON(fmt.Sprintf(adoptiumLatest, recipe.Version, arch), &assets); err != nil {
		return "", err
	}
	if len(assets) == 0 || assets[0].Binary.Package.Link == "" {
		return "", fmt.Errorf("Adoptium publishes no JDK %s for linux/%s", recipe.Version, arch)
	}
	pkg := assets[0].Binary.Package
	in.log.printf("Adoptium's current JDK %s is %s", recipe.Version, assets[0].ReleaseName)

	archive := filepath.Join(in.cfg.downloadDir(), pkg.Name)
	if err := in.download(pkg.Link, archive, pkg.Checksum); err != nil {
		return "", err
	}
	defer os.Remove(archive)

	if err := in.unpackInto(archive, in.cfg.javaDir()); err != nil {
		return "", err
	}
	return in.versionOf(filepath.Join(in.cfg.javaDir(), "bin", "java"), "--version")
}

// ── npm ───────────────────────────────────────────────────────────────────────

// npmCommand answers how to run npm here: the one in the prefix if this panel installed Node, the
// machine's otherwise. The prefix's is run as `node npm-cli.js` rather than through the `npm`
// symlink, whose shebang would resolve `node` through the environment rather than through the
// Node this service just unpacked.
//
// What it will not do is answer a bare "npm" and let exec look it up. Go resolves a bare name
// against the *service's* PATH, not against the one installEnv builds, so that fallback could only
// ever find an npm the deployment already had — and on a server it found none, because Ubuntu's
// `nodejs` package ships no npm at all. The failure read "exec: npm: executable file not found in
// $PATH" from inside a driver whose whole job is to install what is missing. Now it says what to
// install instead.
func (in *installer) npmCommand() ([]string, error) {
	node := filepath.Join(in.cfg.nodeDir(), "bin", "node")
	cli := filepath.Join(in.cfg.nodeDir(), "lib", "node_modules", "npm", "bin", "npm-cli.js")
	if fileExists(node) && fileExists(cli) {
		return []string{node, cli}, nil
	}
	if bin := filepath.Join(in.cfg.nodeDir(), "bin", "npm"); fileExists(bin) {
		return []string{bin}, nil
	}
	if path, err := exec.LookPath("npm"); err == nil {
		return []string{path}, nil
	}
	return nil, fmt.Errorf("there is no npm here: neither in %s nor on this service's PATH — install the node runtime first", in.cfg.nodeDir())
}

// installNPM installs one package into the private prefix and answers the command a turn runs it
// with — `<node> <script>` rather than the shebang'd wrapper, because a wrapper resolves `node`
// through the PATH of whoever spawned it and a turn's PATH is not this process's to arrange.
func (in *installer) installNPM(recipe Recipe) (string, []string, string, error) {
	npm, err := in.npmCommand()
	if err != nil {
		return "", nil, "", err
	}
	if err := in.run(append(npm, "install", "-g", recipe.Package), in.cfg.Prefix); err != nil {
		return "", nil, "", err
	}

	// The package says what it ships and where; reading its manifest beats guessing the name.
	manifestPath := filepath.Join(in.cfg.npmModulesDir(), filepath.FromSlash(recipe.Package), "package.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", nil, "", fmt.Errorf("npm installed %s but %s is not readable: %w", recipe.Package, manifestPath, err)
	}
	var manifest struct {
		Version string          `json:"version"`
		Bin     json.RawMessage `json:"bin"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return "", nil, "", fmt.Errorf("cannot read %s: %w", manifestPath, err)
	}
	script, err := firstBinScript(manifest.Bin, filepath.Dir(manifestPath))
	if err != nil {
		return "", nil, "", fmt.Errorf("%s: %w", recipe.Package, err)
	}

	if recipe.PostInstall != nil {
		if err := in.runPostInstall(recipe, filepath.Dir(manifestPath)); err != nil {
			return "", nil, "", err
		}
	}

	return in.nodeBin(), []string{script}, manifest.Version, nil
}

// nodeBin is the node this service runs a server with: the prefix's if it installed one, the
// deployment's configured one otherwise (the same value the migrations and the kiao-mcp bundle
// use). Resolved to an absolute path at install time and written into the ledger, so a turn is
// never handed a command whose meaning depends on a PATH this service does not control.
func (in *installer) nodeBin() string {
	if bin := filepath.Join(in.cfg.nodeDir(), "bin", "node"); fileExists(bin) {
		return bin
	}
	if path, err := exec.LookPath(in.cfg.NodeBinary); err == nil {
		return path
	}
	return in.cfg.NodeBinary
}

// runPostInstall runs a command out of the installed package's **own** dependency tree — the
// `node_modules/.bin` npm just wrote beside it, or the hoisted one at the top of the global tree.
//
// Not `npm exec`, which is what this first tried: with the package's CLI not on the exec path, npm
// helpfully downloads whatever that name currently publishes — a different version, fetched into a
// cache nothing here owns, printing advice about a project that does not exist. A browser fetched
// by one Playwright for another is a mismatch that surfaces only when a turn opens a page.
func (in *installer) runPostInstall(recipe Recipe, packageDir string) error {
	candidates := []string{
		filepath.Join(packageDir, "node_modules", ".bin", recipe.PostInstall.Bin),
		filepath.Join(in.cfg.npmModulesDir(), ".bin", recipe.PostInstall.Bin),
	}
	bin := ""
	for _, candidate := range candidates {
		if fileExists(candidate) {
			bin = candidate
			break
		}
	}
	if bin == "" {
		return fmt.Errorf("%s installed, but it ships no %s to run %s with",
			recipe.Package, recipe.PostInstall.Bin, strings.Join(recipe.PostInstall.Args, " "))
	}
	in.log.printf("running %s %s, which %s needs",
		recipe.PostInstall.Bin, strings.Join(recipe.PostInstall.Args, " "), recipe.Package)
	return in.run(append([]string{bin}, recipe.PostInstall.Args...), in.cfg.Prefix)
}

// firstBinScript resolves npm's `bin` field, which is either a string (the package's own name is
// the command) or an object of name → path, to one absolute script path.
func firstBinScript(raw json.RawMessage, packageDir string) (string, error) {
	if len(raw) == 0 {
		return "", fmt.Errorf("the package declares no executable")
	}
	var single string
	if err := json.Unmarshal(raw, &single); err == nil {
		return filepath.Join(packageDir, filepath.FromSlash(single)), nil
	}
	var many map[string]string
	if err := json.Unmarshal(raw, &many); err != nil {
		return "", fmt.Errorf("the package's bin field is neither a path nor a map")
	}
	// Sorted, so the same package always resolves to the same command rather than to whichever
	// key the map iteration happened to yield.
	names := make([]string, 0, len(many))
	for name := range many {
		names = append(names, name)
	}
	if len(names) == 0 {
		return "", fmt.Errorf("the package declares no executable")
	}
	sort.Strings(names)
	return filepath.Join(packageDir, filepath.FromSlash(many[names[0]])), nil
}

// ── the image's own package manager ───────────────────────────────────────────

// installSystem hands the packages to apk, through kiao-dev when it is there so that the install
// is written to the declaration the container replays at every start. Reachable only where the
// process is root and the platform has a recipe for it, which today is the `kiao` image alone.
func (in *installer) installSystem(recipe Recipe) (string, error) {
	add, _, ok := systemInstaller(in.cfg.platform())
	if !ok {
		return "", fmt.Errorf("this system has no package manager this service may use")
	}
	if err := in.run(append(add, recipe.Packages...), in.cfg.Prefix); err != nil {
		return "", err
	}
	if recipe.Bin != "" {
		return in.versionOf(recipe.Bin, "--version")
	}
	return "", nil
}

// ── the agent CLIs ────────────────────────────────────────────────────────────
//
// The two CLIs a turn actually runs in. They are here for the reason the JDK is: a build script
// that fetches one holds a pin, a digest, a cache directory and a skip flag of its own, and the
// second CLI is what turns that from one block of bash into two. What the catalogue already knew
// how to do — resolve the current version, read the publisher's checksum, download, verify, unpack
// — is what both of these are, so they are two channels rather than a second mechanism.
//
// Neither is a dependency of anything the catalogue can install, and both are a dependency of
// nearly everything KIAO delivers: the agent tab, the board's playback, and every skill.
//
// One thing these two share with nothing else in the catalogue, and it is a limitation rather than
// a design: the process that runs them is not this one. The hybridflow-runner half spawns a bare `claude` or
// `codex` and lets the process PATH resolve it, where everything else here is reached at the
// absolute path the ledger recorded. So an install lands where a turn will find it only when the
// prefix's `bin` is on PATH — which the image arranges and a laptop does not. See §5 of
// docs/architecture/kiao-delivered-resources.md; the answer is a lookup that half asks this one.

// claudeReleases is Anthropic's release service. Under it, `latest` is a bare version string and
// `<version>/manifest.json` is that release's own record of what each platform's binary is — which
// is why no digest is pinned here. A copy in this file could only go stale; what pinning means is
// choosing *which* record is consulted, and that is Recipe.Version.
const claudeReleases = "https://downloads.claude.ai/claude-code-releases"

// installClaudeCLI puts the Claude Code binary at <prefix>/bin/claude.
func (in *installer) installClaudeCLI(recipe Recipe) (string, error) {
	target, ok := claudeTarget(in.cfg.platform())
	if !ok {
		return "", fmt.Errorf("no Claude Code build is published for this machine")
	}

	version := recipe.Version
	if version == "" || version == "latest" {
		resolved, err := in.text(claudeReleases + "/latest")
		if err != nil {
			return "", fmt.Errorf("%w; the release service is either unreachable or not available "+
				"in this region (https://www.anthropic.com/supported-countries)", err)
		}
		version = resolved
		in.log.printf("the current Claude Code release is %s", version)
	}
	if !releaseVersion.MatchString(version) {
		return "", fmt.Errorf("%q is not a Claude Code version", version)
	}

	var manifest struct {
		Platforms map[string]struct {
			Binary   string `json:"binary"`
			Checksum string `json:"checksum"`
		} `json:"platforms"`
	}
	if err := in.getJSON(claudeReleases+"/"+version+"/manifest.json", &manifest); err != nil {
		return "", err
	}
	build, ok := manifest.Platforms[target]
	if !ok {
		return "", fmt.Errorf("the manifest for Claude Code %s has no %s entry", version, target)
	}
	name := build.Binary
	if name == "" {
		name = "claude"
	}

	// Downloaded beside its destination and moved onto it, so a failed or interrupted fetch never
	// leaves half a binary where the agent half will find one and spawn it.
	dest := filepath.Join(in.cfg.binDir(), "claude")
	staged := filepath.Join(in.cfg.downloadDir(), "claude-"+version+"-"+target)
	if err := in.download(claudeReleases+"/"+version+"/"+target+"/"+name, staged, build.Checksum); err != nil {
		return "", err
	}
	defer os.Remove(staged)
	if err := os.Chmod(staged, 0o755); err != nil {
		return "", fmt.Errorf("cannot make %s executable: %w", staged, err)
	}
	if err := os.Rename(staged, dest); err != nil {
		return "", fmt.Errorf("cannot move %s into place: %w", dest, err)
	}
	in.log.printf("installed %s (%s)", dest, target)

	// The version is what the manifest said, not what the binary answers: a cross-built binary — the
	// image's musl one, staged from a glibc build host — cannot be run here to be asked.
	if in.cfg.Target != "" {
		return version, nil
	}
	return in.versionOf(dest, "--version")
}

// claudeTarget names the build for a platform, in the spelling the release service uses. The libc
// comes from the *target* platform rather than from this machine, which is the whole of what
// Config.Target is for: the image is Alpine and is staged from a glibc host.
func claudeTarget(platform string) (string, bool) {
	arch, ok := hostArch()
	if !ok {
		return "", false
	}
	switch runtime.GOOS {
	case "darwin":
		return "darwin-" + arch, true
	case "linux":
		if platform == platformAlpine {
			return "linux-" + arch + "-musl", true
		}
		return "linux-" + arch, true
	}
	return "", false
}

// codexReleases is where OpenAI publishes the CLI. `latest` redirects to the current tag, and every
// release carries a codex-package_SHA256SUMS listing a digest per asset — the same arrangement
// nodejs.org's SHASUMS256.txt has, and read by the same helper.
const codexReleases = "https://github.com/openai/codex/releases"

// codexChecksums is the asset that lists the others' digests.
const codexChecksums = "codex-package_SHA256SUMS"

// installCodexCLI unpacks the Codex package as <prefix>/codex and links <prefix>/bin/codex into it.
func (in *installer) installCodexCLI(recipe Recipe) (string, error) {
	target, ok := codexTarget()
	if !ok {
		return "", fmt.Errorf("no Codex build is published for this machine")
	}

	tag := recipe.Version
	if tag == "" || tag == "latest" {
		resolved, err := in.latestCodexTag()
		if err != nil {
			return "", err
		}
		tag = resolved
		in.log.printf("the current Codex release is %s", tag)
	} else if !strings.HasPrefix(tag, "rust-v") {
		// Preinstall pins are ordinary versions (codex-cli@0.162.1); release URLs use rust-v.
		tag = "rust-v" + strings.TrimPrefix(tag, "v")
	}

	base := codexReleases + "/download/" + tag + "/"
	asset := "codex-package-" + target + ".tar.gz"
	sum, err := in.checksumFromSHASUMS(base+codexChecksums, asset)
	if err != nil {
		return "", err
	}
	archive := filepath.Join(in.cfg.downloadDir(), asset)
	if err := in.download(base+asset, archive, sum); err != nil {
		return "", err
	}
	defer os.Remove(archive)

	if err := in.unpackTreeInto(archive, in.cfg.codexDir()); err != nil {
		return "", err
	}
	// Relative, and to the real binary rather than to a copy of it: codex resolves its ripgrep and
	// its sandbox helper from where the executable actually is, so bin/codex has to stay inside the
	// tree — and a relative link is what lets that whole prefix be copied somewhere else, which is
	// exactly what the image build does with it.
	link := filepath.Join(in.cfg.binDir(), "codex")
	if err := os.Remove(link); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("cannot replace %s: %w", link, err)
	}
	if err := os.Symlink(filepath.Join("..", filepath.Base(in.cfg.codexDir()), "bin", "codex"), link); err != nil {
		return "", fmt.Errorf("cannot link %s: %w", link, err)
	}
	in.log.printf("installed %s -> %s", link, filepath.Join(in.cfg.codexDir(), "bin", "codex"))

	if in.cfg.Target != "" {
		return strings.TrimPrefix(tag, "rust-v"), nil
	}
	return in.versionOf(link, "--version")
}

// codexTarget names the build for this machine, in the spelling the release assets use. Linux is
// always the musl build — statically linked, so it runs on Alpine and on a glibc distribution
// alike, which is the choice OpenAI's own installer makes and the reason this channel needs no
// libc of its own.
func codexTarget() (string, bool) {
	var arch string
	switch runtime.GOARCH {
	case "amd64":
		arch = "x86_64"
	case "arm64":
		arch = "aarch64"
	default:
		return "", false
	}
	switch runtime.GOOS {
	case "linux":
		return arch + "-unknown-linux-musl", true
	case "darwin":
		return arch + "-apple-darwin", true
	}
	return "", false
}

// museChannelURL is the stable channel document: the current version and the manifest that lists
// its artifacts. museLauncherURL is the launcher script itself — `muse` as the user runs it —
// which manages the versioned binary beside it. Variables rather than constants so tests can point
// the channel at a local server; production never changes them.
var (
	museChannelURL  = "https://api.meta.ai/muse-code/channels/muse-stable"
	museLauncherURL = "https://api.meta.ai/muse-launcher.sh"
)

// museChannelDoc is the channel document: the current release and where its manifest lives.
type museChannelDoc struct {
	Channel     string `json:"channel"`
	Version     string `json:"version"`
	ManifestURL string `json:"manifest_url"`
}

// museManifest is one release's manifest: the version it is of, and one artifact per platform.
type museManifest struct {
	Version   string `json:"version"`
	Artifacts map[string]struct {
		URL      string `json:"url"`
		Checksum string `json:"checksum"`
		Size     int64  `json:"size"`
	} `json:"artifacts"`
}

// installMuseCLI lays out <prefix>/muse as the launcher expects it — the launcher script, the
// versioned binary beside it, and the version file that says the binary is that version — and links
// <prefix>/bin/muse at it.
//
// The layout is the launcher's own doing, reproduced rather than invented: a hand-installed `muse`
// is a directory holding `muse`, `muse-bin-<version>` and `.muse-version`, and the binary the
// driver spawns is the launcher, which resolves the link to find its own directory. Reproducing it
// keeps what the launcher does — update checks, release notices — working as documented, and the
// version file written here is what keeps the first run from downloading the binary this install
// already fetched.
func (in *installer) installMuseCLI(recipe Recipe) (string, error) {
	target, ok := museTarget()
	if !ok {
		return "", fmt.Errorf("no Muse build is published for this machine")
	}

	var channel museChannelDoc
	if err := in.getJSON(museChannelURL, &channel); err != nil {
		return "", err
	}
	version := recipe.Version
	if version == "" || version == "latest" {
		version = channel.Version
		in.log.printf("the current Muse release is %s", version)
	}
	manifestURL, err := museManifestURL(channel.ManifestURL, version)
	if err != nil {
		return "", err
	}
	var manifest museManifest
	if err := in.getJSON(manifestURL, &manifest); err != nil {
		return "", err
	}
	// The manifest names the version it is of, which is what a pinned install is checked against:
	// the URL for an older release is the channel's with the version rewritten, and a rewrite that
	// landed anywhere else is refused here rather than installed under the wrong name.
	if manifest.Version != version {
		return "", fmt.Errorf("the manifest at %s is for Muse %s rather than %s", manifestURL, manifest.Version, version)
	}
	artifact, ok := manifest.Artifacts[target]
	if !ok {
		return "", fmt.Errorf("the manifest for Muse %s has no %s entry", version, target)
	}

	dir := in.cfg.museDir()
	staged := filepath.Join(in.cfg.downloadDir(), "muse-bin-"+version+"-"+target)
	if err := in.download(artifact.URL, staged, artifact.Checksum); err != nil {
		return "", err
	}
	defer os.Remove(staged)
	if artifact.Size > 0 {
		info, err := os.Stat(staged)
		if err != nil {
			os.Remove(staged)
			return "", fmt.Errorf("cannot stat %s: %w", staged, err)
		}
		if info.Size() != artifact.Size {
			os.Remove(staged)
			return "", fmt.Errorf("%s downloaded %d bytes rather than the published %d", artifact.URL, info.Size(), artifact.Size)
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("cannot create %s: %w", dir, err)
	}
	// Downloaded beside its destination and moved onto it, so a failed or interrupted fetch never
	// leaves half a binary where the agent half will find one and spawn it.
	dest := filepath.Join(dir, "muse-bin-"+version)
	if err := os.Chmod(staged, 0o755); err != nil {
		return "", fmt.Errorf("cannot make %s executable: %w", staged, err)
	}
	if err := os.Rename(staged, dest); err != nil {
		return "", fmt.Errorf("cannot move %s into place: %w", dest, err)
	}

	launcher := filepath.Join(dir, "muse")
	if err := in.downloadLauncher(museLauncherURL, launcher); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, ".muse-version"), []byte(version+"\n"), 0o644); err != nil {
		return "", fmt.Errorf("cannot write the Muse version file: %w", err)
	}

	// Relative, for the codex channel's reason: the launcher resolves the link to find the
	// directory it manages, and a relative link is what lets the whole prefix be copied somewhere
	// else, which is exactly what the image build does with it.
	link := filepath.Join(in.cfg.binDir(), "muse")
	if err := os.Remove(link); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("cannot replace %s: %w", link, err)
	}
	if err := os.Symlink(filepath.Join("..", filepath.Base(dir), "muse"), link); err != nil {
		return "", fmt.Errorf("cannot link %s: %w", link, err)
	}
	in.log.printf("installed %s -> %s", link, launcher)

	if in.cfg.Target != "" {
		return version, nil
	}
	return in.versionOf(link, "--version")
}

// museManifestURL is the manifest to read for one version: the channel's own for the current
// release, and the channel's with the version rewritten for a pin. The manifest names the version
// it is of, so a rewrite the server answered with anything else is refused by the caller.
func museManifestURL(channelURL, version string) (string, error) {
	parsed, err := url.Parse(channelURL)
	if err != nil || channelURL == "" {
		return "", fmt.Errorf("the Muse channel points at no manifest (%q)", channelURL)
	}
	query := parsed.Query()
	if query.Get("version") != "" {
		query.Set("version", version)
		parsed.RawQuery = query.Encode()
	}
	return parsed.String(), nil
}

// downloadLauncher fetches the launcher script and checks it against the checksum the server
// advertises for it in the x-content-sha256 header — the same verification the launcher applies to
// itself when it updates, and the only one this script's publisher offers.
func (in *installer) downloadLauncher(source, dest string) error {
	in.log.printf("downloading %s", source)
	resp, err := in.client.Get(source)
	if err != nil {
		return fmt.Errorf("downloading %s: %w", source, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("downloading %s: the server answered %s", source, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return fmt.Errorf("downloading %s: %w", source, err)
	}
	if advertised := strings.TrimSpace(resp.Header.Get("x-content-sha256")); advertised != "" {
		if got := sha256.Sum256(body); !strings.EqualFold(hex.EncodeToString(got[:]), advertised) {
			return fmt.Errorf("%s does not match its advertised checksum", source)
		}
		in.log.printf("checksum verified (%d bytes)", len(body))
	} else {
		in.log.printf("downloaded %d bytes unverified: the server advertised no checksum", len(body))
	}
	if err := os.WriteFile(dest, body, 0o755); err != nil {
		return fmt.Errorf("cannot write %s: %w", dest, err)
	}
	return nil
}

// museTarget names the build for this machine, in the spelling the release manifest uses. The
// binary is statically linked, so there is no libc to take from anywhere — Linux is one entry for
// every distribution, which is why staging it for the image needs nothing said.
func museTarget() (string, bool) {
	var arch string
	switch runtime.GOARCH {
	case "amd64":
		arch = "x86"
	case "arm64":
		arch = "aarch64"
	default:
		return "", false
	}
	switch runtime.GOOS {
	case "linux":
		return arch + "_linux", true
	case "darwin":
		return arch + "_macos", true
	}
	return "", false
}

// latestCodexTag asks GitHub which release is current, by following the redirect it publishes for
// exactly that question. The API would answer it too, and rate-limits an unauthenticated caller to
// sixty questions an hour — which a build host behind one address shares with everything else on it.
func (in *installer) latestCodexTag() (string, error) {
	url := codexReleases + "/latest"
	in.log.printf("asking %s", url)
	resp, err := in.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("reading %s: the server answered %s", url, resp.Status)
	}
	landed := resp.Request.URL.Path
	tag, ok := strings.CutPrefix(landed, "/openai/codex/releases/tag/")
	if !ok || tag == "" {
		return "", fmt.Errorf("%s led to %s, which names no release", url, landed)
	}
	return tag, nil
}

// opencodeReleases is where OpenCode publishes the CLI. `latest` redirects to the current tag, and
// every release carries one tarball per platform holding the single `opencode` binary. No checksum
// is published beside them — the project's own installer downloads them unverified too — so this
// channel is verified by TLS alone, and says so in the log.
const opencodeReleases = "https://github.com/anomalyco/opencode/releases"

// installOpenCodeCLI unpacks the OpenCode tarball as <prefix>/opencode and links
// <prefix>/bin/opencode into it.
func (in *installer) installOpenCodeCLI(recipe Recipe) (string, error) {
	asset, ok := opencodeTarget(in.cfg.platform())
	if !ok {
		return "", fmt.Errorf("no OpenCode build is published for this machine")
	}

	tag := recipe.Version
	if tag == "" || tag == "latest" {
		resolved, err := in.latestOpenCodeTag()
		if err != nil {
			return "", err
		}
		tag = resolved
		in.log.printf("the current OpenCode release is %s", tag)
	}

	base := opencodeReleases + "/download/" + tag + "/"
	archive := filepath.Join(in.cfg.downloadDir(), asset)
	in.log.printf("no checksum is published for %s; the download is verified by TLS alone", asset)
	if err := in.download(base+asset, archive, ""); err != nil {
		return "", err
	}
	defer os.Remove(archive)

	if err := in.unpackTreeInto(archive, in.cfg.opencodeDir()); err != nil {
		return "", err
	}
	// Relative, and to the real binary rather than to a copy of it: a relative link is what lets
	// the whole prefix be copied somewhere else, which is exactly what the image build does with
	// it.
	link := filepath.Join(in.cfg.binDir(), "opencode")
	if err := os.Remove(link); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("cannot replace %s: %w", link, err)
	}
	if err := os.Symlink(filepath.Join("..", filepath.Base(in.cfg.opencodeDir()), "opencode"), link); err != nil {
		return "", fmt.Errorf("cannot link %s: %w", link, err)
	}
	in.log.printf("installed %s -> %s", link, filepath.Join(in.cfg.opencodeDir(), "opencode"))

	if in.cfg.Target != "" {
		return strings.TrimPrefix(tag, "v"), nil
	}
	return in.versionOf(link, "--version")
}

// opencodeTarget names the release asset for a platform, in the spelling the releases use. The
// libc comes from the *target* platform rather than from this machine, for the reason claudeTarget
// gives: the image is Alpine and is staged from a glibc host. macOS builds are zips, which the
// tarball unpack path does not read, and the `-baseline` builds for CPUs without AVX2 are not
// offered either — both are a host the panel reports as having no published build, where an
// `opencode` on PATH is still honoured.
func opencodeTarget(platform string) (string, bool) {
	var arch string
	switch runtime.GOARCH {
	case "amd64":
		arch = "x64"
	case "arm64":
		arch = "arm64"
	default:
		return "", false
	}
	if runtime.GOOS != "linux" {
		return "", false
	}
	target := "linux-" + arch
	if platform == platformAlpine {
		target += "-musl"
	}
	return "opencode-" + target + ".tar.gz", true
}

// latestOpenCodeTag asks GitHub which release is current, by following the redirect it publishes
// for exactly that question — the API would rate-limit an unauthenticated caller, for
// latestCodexTag's reason.
func (in *installer) latestOpenCodeTag() (string, error) {
	url := opencodeReleases + "/latest"
	in.log.printf("asking %s", url)
	resp, err := in.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("reading %s: the server answered %s", url, resp.Status)
	}
	landed := resp.Request.URL.Path
	tag, ok := strings.CutPrefix(landed, "/anomalyco/opencode/releases/tag/")
	if !ok || tag == "" {
		return "", fmt.Errorf("%s led to %s, which names no release", url, landed)
	}
	return tag, nil
}

// releaseVersion is the shape a version has to have before it is put in a URL. It is a guard against
// a release service that answered something other than a version — an error page, a redirect to a
// sign-in — rather than a validation of the number itself.
var releaseVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+`)

// ── ffmpeg ────────────────────────────────────────────────────────────────────

// ffmpegBuilds is where the static FFmpeg builds are published: the `latest` release of
// BtbN/FFmpeg-Builds, which is where FFmpeg's own download page sends Linux. It is rebuilt every
// day, and each rebuild replaces its `checksums.sha256` along with the archives — so the digest read
// first is the one published with the archive fetched straight after it, and the rare install that
// straddles a rebuild fails on the mismatch rather than keeping a file nobody vouched for.
const ffmpegBuilds = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/"

// ffmpegExecutables are what the driver takes out of the archive: the one a save runs, and the
// prober that comes with it wherever else FFmpeg is installed.
var ffmpegExecutables = []string{"ffmpeg", "ffprobe"}

// installFFmpeg puts ffmpeg and ffprobe at <prefix>/bin.
func (in *installer) installFFmpeg(recipe Recipe) (string, error) {
	target, ok := ffmpegTarget()
	if !ok {
		return "", fmt.Errorf("no FFmpeg build is published for this machine")
	}
	// **A release branch, and never `master`.** There is no build of a tag to pin: every build is of
	// a branch's newest commit, so `9.0` means 9.0 and its fixes, and master would mean whatever was
	// merged the day before.
	if !ffmpegBranch.MatchString(recipe.Version) {
		return "", fmt.Errorf("%q is not an FFmpeg release branch", recipe.Version)
	}

	asset := ffmpegAsset(recipe.Version, target)
	sum, err := in.checksumFromSHASUMS(ffmpegBuilds+"checksums.sha256", asset)
	if err != nil {
		return "", err
	}
	archive := filepath.Join(in.cfg.downloadDir(), asset)
	if err := in.download(ffmpegBuilds+asset, archive, sum); err != nil {
		return "", err
	}
	defer os.Remove(archive)

	// The archive unpacks to half a gigabyte, of which ffplay and the manuals are for somebody else
	// — so tar is asked for the two files by name, into a directory of the download area that goes
	// when they have been moved out of it.
	top := strings.TrimSuffix(asset, ".tar.xz")
	staging := filepath.Join(in.cfg.downloadDir(), top)
	if err := os.RemoveAll(staging); err != nil {
		return "", fmt.Errorf("cannot clear %s: %w", staging, err)
	}
	defer os.RemoveAll(staging)
	command := []string{"tar", "-xJf", archive, "-C", in.cfg.downloadDir()}
	for _, name := range ffmpegExecutables {
		command = append(command, top+"/bin/"+name)
	}
	if err := in.run(command, in.cfg.Prefix); err != nil {
		return "", err
	}
	for _, name := range ffmpegExecutables {
		dest := filepath.Join(in.cfg.binDir(), name)
		if err := os.Rename(filepath.Join(staging, "bin", name), dest); err != nil {
			return "", fmt.Errorf("cannot move %s into place: %w", dest, err)
		}
		in.log.printf("installed %s (%s)", dest, target)
	}

	if in.cfg.Target != "" {
		return recipe.Version, nil
	}
	version, err := in.versionOf(filepath.Join(in.cfg.binDir(), "ffmpeg"), "-version")
	return versionLine(version), err
}

// ffmpegAsset is the archive a release branch is published as, for one target:
// `ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz`. The GPL build, because that is the one carrying the
// encoders a save uses — libsvtav1 is in both, libx264 and its kind only in this one, and a turn
// handed this ffmpeg may well want them.
func ffmpegAsset(branch, target string) string {
	return "ffmpeg-n" + branch + "-latest-" + target + "-gpl-" + branch + ".tar.xz"
}

// ffmpegTarget names the build for this machine, in the spelling the archives use. Linux on glibc
// only: that is what the builds link against, and it is why Alpine has a recipe of its own.
func ffmpegTarget() (string, bool) {
	if runtime.GOOS != "linux" {
		return "", false
	}
	switch runtime.GOARCH {
	case "amd64":
		return "linux64", true
	case "arm64":
		return "linuxarm64", true
	}
	return "", false
}

// ffmpegBranch is the shape a release branch has — `9.0`, `8.1` — before it is put in a file name.
var ffmpegBranch = regexp.MustCompile(`^[0-9]+\.[0-9]+$`)

// ── shared plumbing ───────────────────────────────────────────────────────────

// download fetches url to dest, verifying sha256 when one is given. The digest is computed while
// the body streams, so a 200 MB JDK is never held in memory and a mismatch throws the file away
// rather than leaving a half-trusted archive on disk.
func (in *installer) download(url, dest, sha string) error {
	in.log.printf("downloading %s", url)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("cannot create %s: %w", filepath.Dir(dest), err)
	}

	resp, err := in.client.Get(url)
	if err != nil {
		return fmt.Errorf("downloading %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("downloading %s: the server answered %s", url, resp.Status)
	}

	file, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("cannot write %s: %w", dest, err)
	}
	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, digest), resp.Body)
	closeErr := file.Close()
	if err != nil {
		os.Remove(dest)
		return fmt.Errorf("downloading %s: %w", url, err)
	}
	if closeErr != nil {
		os.Remove(dest)
		return fmt.Errorf("cannot write %s: %w", dest, closeErr)
	}

	if sha != "" {
		got := hex.EncodeToString(digest.Sum(nil))
		if !strings.EqualFold(got, sha) {
			os.Remove(dest)
			return fmt.Errorf("%s does not match its published checksum (expected %s, got %s)", url, sha, got)
		}
		in.log.printf("checksum verified (%d bytes)", written)
	} else {
		in.log.printf("downloaded %d bytes", written)
	}
	return nil
}

// getJSON reads one small JSON document — a release index, an asset list.
func (in *installer) getJSON(url string, into any) error {
	in.log.printf("asking %s", url)
	resp, err := in.client.Get(url)
	if err != nil {
		return fmt.Errorf("reading %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("reading %s: the server answered %s", url, resp.Status)
	}
	// Bounded: these are catalogues of releases, and an unbounded decode of whatever a redirect
	// landed on is not something to do inside a service.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return fmt.Errorf("reading %s: %w", url, err)
	}
	if err := json.Unmarshal(body, into); err != nil {
		return fmt.Errorf("parsing %s: %w", url, err)
	}
	return nil
}

// text reads one short plain-text answer — a release service's idea of "latest", which is a version
// and nothing else. Bounded like getJSON, and trimmed, because what is on the other end is one line.
func (in *installer) text(url string) (string, error) {
	in.log.printf("asking %s", url)
	resp, err := in.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("reading %s: the server answered %s", url, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	return strings.TrimSpace(string(body)), nil
}

// checksumFromSHASUMS reads the digest of one file out of a `sha256  name` listing.
func (in *installer) checksumFromSHASUMS(url, name string) (string, error) {
	in.log.printf("asking %s", url)
	resp, err := in.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("reading %s: the server answered %s", url, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == name {
			return fields[0], nil
		}
	}
	return "", fmt.Errorf("%s lists no checksum for %s", url, name)
}

// unpackInto extracts a tarball whose single top-level directory becomes dest. Extraction is `tar`
// rather than a decoder written here: every one of the three systems has it, it handles the symlinks
// and the modes a JDK is full of, and a tar implementation is not a thing to maintain in a file
// service.
func (in *installer) unpackInto(archive, dest string) error {
	staging := dest + ".unpacking"
	if err := os.RemoveAll(staging); err != nil {
		return fmt.Errorf("cannot clear %s: %w", staging, err)
	}
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return fmt.Errorf("cannot create %s: %w", staging, err)
	}
	defer os.RemoveAll(staging)

	if err := in.run([]string{"tar", "-xzf", archive, "-C", staging}, in.cfg.Prefix); err != nil {
		return err
	}

	entries, err := os.ReadDir(staging)
	if err != nil {
		return fmt.Errorf("reading %s: %w", staging, err)
	}
	var top string
	for _, entry := range entries {
		if entry.IsDir() {
			if top != "" {
				return fmt.Errorf("%s unpacks to more than one directory", filepath.Base(archive))
			}
			top = filepath.Join(staging, entry.Name())
		}
	}
	if top == "" {
		return fmt.Errorf("%s unpacks to no directory", filepath.Base(archive))
	}

	// Replace rather than merge: an upgrade over a previous install would otherwise leave the old
	// release's files behind, and a JDK half of one version and half of another is worse than none.
	if err := os.RemoveAll(dest); err != nil {
		return fmt.Errorf("cannot clear %s: %w", dest, err)
	}
	if err := os.Rename(top, dest); err != nil {
		return fmt.Errorf("cannot move %s into place: %w", dest, err)
	}
	in.log.printf("unpacked into %s", dest)
	return nil
}

// unpackTreeInto extracts a tarball that *is* the tree: several top-level entries, none of them a
// wrapper directory to step through. The Codex package is one — `bin/`, `codex-path/` and
// `codex-resources/` side by side, and the binary resolves the last two relative to itself — so
// hoisting a single directory the way unpackInto does would be wrong rather than merely unnecessary.
func (in *installer) unpackTreeInto(archive, dest string) error {
	staging := dest + ".unpacking"
	if err := os.RemoveAll(staging); err != nil {
		return fmt.Errorf("cannot clear %s: %w", staging, err)
	}
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return fmt.Errorf("cannot create %s: %w", staging, err)
	}
	defer os.RemoveAll(staging)

	if err := in.run([]string{"tar", "-xzf", archive, "-C", staging}, in.cfg.Prefix); err != nil {
		return err
	}

	// Replace rather than merge, for unpackInto's reason: a release half of one version and half of
	// another is worse than none.
	if err := os.RemoveAll(dest); err != nil {
		return fmt.Errorf("cannot clear %s: %w", dest, err)
	}
	if err := os.Rename(staging, dest); err != nil {
		return fmt.Errorf("cannot move %s into place: %w", dest, err)
	}
	in.log.printf("unpacked into %s", dest)
	return nil
}

// versionOf asks a binary what it is. A version is decoration on a panel row: a binary that refuses
// to answer is not a failed install, so this reports an empty string rather than an error.
func (in *installer) versionOf(bin string, arg string) (string, error) {
	res := core.RunProc([]string{bin, arg}, in.cfg.Prefix, 30*time.Second, in.cfg.installEnv())
	if !res.OK() {
		return "", nil
	}
	return firstLine(res.Combined()), nil
}

func mergeEnv(base, extra map[string]string) map[string]string {
	merged := make(map[string]string, len(base)+len(extra))
	for k, v := range base {
		merged[k] = v
	}
	for k, v := range extra {
		merged[k] = v
	}
	return merged
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func firstError(errs ...error) error {
	for _, err := range errs {
		if err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(line)
}

// errorLine matches the line a tool states its actual complaint on. Looked for before falling back
// to the tail, because a helpful tool follows its error with paragraphs of advice — and the tail of
// `playwright install` is the bottom edge of an ASCII box, which is what the panel was showing where
// the reason should have been.
var errorLine = regexp.MustCompile(`(?i)\b(error|fatal|cannot|failed|no such|not found|refused)\b`)

// firstLines is what a failure carries into an HTTP error and a log line: enough of the tool's own
// complaint to act on, without the hundred lines of a pip resolution behind it. The whole output is
// in the job log either way.
func firstLines(s string, n int) string {
	var lines []string
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		// Box drawing and rules carry nothing and crowd out what does.
		if trimmed := strings.Trim(line, " \t║╔╗╚╝═─│┌┐└┘*#=-"); trimmed != "" {
			lines = append(lines, strings.TrimSpace(line))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	var complaints []string
	for _, line := range lines {
		if errorLine.MatchString(line) {
			complaints = append(complaints, line)
		}
	}
	if len(complaints) > 0 {
		lines = complaints
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.TrimSpace(strings.Join(lines, "; "))
}
