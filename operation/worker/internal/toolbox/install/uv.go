package install

import (
	"fmt"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/process"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// uvBin is the uv this service runs: the prefix's if the panel installed one, the machine's
// otherwise. The fallback is not a convenience — a machine that already has uv is one where the
// closure skips installing it, so without this every uv-channel install on such a machine would
// fail on a path that was never going to exist. Either way the tool lands in the prefix, because
// that is what UV_TOOL_DIR and UV_TOOL_BIN_DIR say (see Config.installEnv), not what uv it is.
//
// Absolute in both cases, resolved here rather than left as "uv" on a PATH, so what ran is what the
// job log names.
func (in *installer) uvBin() string {
	if bin := filepath.Join(in.cfg.BinDir(), "uv"); filesystem.FileExists(bin) {
		return bin
	}
	if path, err := exec.LookPath("uv"); err == nil {
		return path
	}
	// Nothing found: name the prefix's path anyway, so the failure reads as the missing install it
	// is rather than as a bare "uv: not found".
	return filepath.Join(in.cfg.BinDir(), "uv")
}

// installUV bootstraps uv with the installer Astral publishes, told to write into the prefix and
// to leave the user's shell profile alone. It is the one component with no channel of its own —
// everything else on the uv channel needs it to already be there.
func (in *installer) installUV() (string, error) {
	script := filepath.Join(in.cfg.DownloadDir(), "uv-install.sh")
	if err := in.download("https://astral.sh/uv/install.sh", script, ""); err != nil {
		return "", err
	}
	defer os.Remove(script)

	in.log.printf("$ sh %s", script)
	res := process.RunProc([]string{"sh", script}, in.cfg.Prefix, commandTimeout, mergeEnv(in.cfg.InstallEnv(), map[string]string{
		// Where uv puts itself, and the promise not to touch a .bashrc this service does not own.
		"UV_INSTALL_DIR":           in.cfg.BinDir(),
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
func (in *installer) installUVTool(recipe toolcatalog.Recipe) (string, string, error) {
	command := []string{in.uvBin(), "tool", "install", "--upgrade"}
	for _, with := range recipe.With {
		command = append(command, "--with", with)
	}
	command = append(command, recipe.Package)

	in.log.printf("$ %s", strings.Join(command, " "))
	res := process.RunProc(command, in.cfg.Prefix, commandTimeout, in.cfg.InstallEnv())
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
	bin := filepath.Join(in.cfg.BinDir(), name)
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
func (in *installer) installUVPython(recipe toolcatalog.Recipe) (string, error) {
	if err := in.run([]string{in.uvBin(), "python", "install", "--default", recipe.Version}, in.cfg.Prefix); err != nil {
		in.log.print("retrying without --default, which this uv does not know")
		if err := in.run([]string{in.uvBin(), "python", "install", recipe.Version}, in.cfg.Prefix); err != nil {
			return "", err
		}
	}
	return recipe.Version, nil
}
