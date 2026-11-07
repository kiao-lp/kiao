package install

import (
	"fmt"
	"kiao/worker/internal/core/process"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	toolfaults "kiao/worker/internal/toolbox/faults"
	"kiao/worker/internal/toolbox/inventory"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
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

// installer carries what every driver needs: where it may write, what it logs to, and the resolved
// recipe. One per job step, so a driver never reaches for process-wide state.
type installer struct {
	cfg    *toolconfig.Config
	log    *jobLog
	client *http.Client
}

func newInstaller(cfg *toolconfig.Config, log *jobLog) *installer {
	return &installer{cfg: cfg, log: log, client: &http.Client{Timeout: downloadTimeout}}
}

// run executes one command, logging the command line before it and its output after. The log is
// what the panel shows, so a failure has to explain itself there and not only in the journal.
func (in *installer) run(command []string, workDir string) error {
	in.log.printf("$ %s", strings.Join(command, " "))
	res := process.RunProc(command, workDir, commandTimeout, in.cfg.InstallEnv())
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
	res := process.RunProc(command, in.cfg.Prefix, commandTimeout, in.cfg.InstallEnv())
	if !res.OK() {
		return "", fmt.Errorf("%s exited %d: %s", filepath.Base(command[0]), res.Exit, firstLines(res.Combined(), 3))
	}
	return res.Stdout, nil
}

// install performs one component and answers the ledger entry to record. It is called with the
// dependency closure already resolved and already installed, so a driver may assume `uv` is there
// when its recipe says `uv`.
func (in *installer) install(comp toolcatalog.Component, recipe toolcatalog.Recipe) (inventory.Entry, error) {
	entry := inventory.Entry{Installed: true, InstalledAt: inventory.Stamp()}

	switch recipe.Channel {
	case toolcatalog.ChannelUVBootstrap:
		version, err := in.installUV()
		entry.Version = version
		return entry, err

	case toolcatalog.ChannelUV:
		command, version, err := in.installUVTool(recipe)
		entry.Command, entry.Version = command, version
		return entry, err

	case toolcatalog.ChannelUVPython:
		version, err := in.installUVPython(recipe)
		entry.Version = version
		return entry, err

	case toolcatalog.ChannelNodeTarball:
		version, err := in.installNode(recipe)
		entry.Version = version
		return entry, err

	case toolcatalog.ChannelTemurin:
		version, err := in.installTemurin(recipe)
		entry.Version = version
		return entry, err

	case toolcatalog.ChannelNPM:
		command, args, version, err := in.installNPM(recipe)
		entry.Command, entry.Args, entry.Version = command, args, version
		return entry, err

	case toolcatalog.ChannelSystem:
		version, err := in.installSystem(recipe)
		entry.Version = version
		return entry, err

	case toolcatalog.ChannelClaudeRelease:
		version, err := in.installClaudeCLI(recipe)
		entry.Version = version
		return entry, err

	case toolcatalog.ChannelCodexRelease:
		version, err := in.installCodexCLI(recipe)
		entry.Version = version
		return entry, err

	case toolcatalog.ChannelMuseRelease:
		version, err := in.installMuseCLI(recipe)
		entry.Version = version
		return entry, err

	case toolcatalog.ChannelPiRelease:
		command, version, err := in.installPiCLI(recipe)
		entry.Command, entry.Version = command, version
		return entry, err
	case toolcatalog.ChannelOpenCodeRelease:
		version, err := in.installOpenCodeCLI(recipe)
		entry.Version = version
		return entry, err

	case toolcatalog.ChannelFFmpegRelease:
		version, err := in.installFFmpeg(recipe)
		entry.Version = version
		return entry, err

	case toolcatalog.ChannelDetect:
		// Reached through `toolbox preinstall`, which names ids straight at the drivers: there is
		// nothing to stage, so this names the command rather than failing as an unknown channel.
		return entry, fmt.Errorf("not installed by this panel — `%s`",
			detectInstallCommand(in.cfg.Platform(), recipe.Packages))

	case toolcatalog.ChannelRemote, toolcatalog.ChannelBundled:
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
func (in *installer) uninstall(comp toolcatalog.Component, recipe toolcatalog.Recipe, entry inventory.Entry) error {
	switch recipe.Channel {
	case toolcatalog.ChannelPiRelease:
		if _, ok := piReleases[recipe.Version]; !ok {
			return fmt.Errorf("unqualified Pi version")
		}
		return os.RemoveAll(filepath.Join(in.cfg.Prefix, "pi", recipe.Version))
	case toolcatalog.ChannelUVBootstrap:
		// uv's own installer writes two binaries and one store; there is no `uv uninstall self`
		// that leaves the store behind, so this removes what the bootstrap created.
		in.log.printf("removing %s, %s and %s", filepath.Join(in.cfg.BinDir(), "uv"),
			filepath.Join(in.cfg.BinDir(), "uvx"), in.cfg.UvDir())
		return firstError(
			os.Remove(filepath.Join(in.cfg.BinDir(), "uv")),
			os.Remove(filepath.Join(in.cfg.BinDir(), "uvx")),
			os.RemoveAll(in.cfg.UvDir()),
		)

	case toolcatalog.ChannelUV:
		return in.run([]string{in.uvBin(), "tool", "uninstall", recipe.Package}, in.cfg.Prefix)

	case toolcatalog.ChannelUVPython:
		return in.run([]string{in.uvBin(), "python", "uninstall", recipe.Version}, in.cfg.Prefix)

	case toolcatalog.ChannelNodeTarball:
		in.log.printf("removing %s", in.cfg.NodeDir())
		return os.RemoveAll(in.cfg.NodeDir())

	case toolcatalog.ChannelTemurin:
		in.log.printf("removing %s", in.cfg.JavaDir())
		return os.RemoveAll(in.cfg.JavaDir())

	case toolcatalog.ChannelNPM:
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
			in.log.printf("removing %s", in.cfg.BrowsersDir())
			return os.RemoveAll(in.cfg.BrowsersDir())
		}
		return nil

	case toolcatalog.ChannelClaudeRelease:
		// One file, written by the driver and named by it: nothing else in the prefix belongs to
		// this component.
		bin := filepath.Join(in.cfg.BinDir(), "claude")
		in.log.printf("removing %s", bin)
		return firstError(os.Remove(bin))

	case toolcatalog.ChannelCodexRelease:
		// The tree and the link into it, in that order — a link left pointing at nothing is the one
		// arrangement that reads as installed and is not.
		in.log.printf("removing %s and %s", filepath.Join(in.cfg.BinDir(), "codex"), in.cfg.CodexDir())
		return firstError(
			os.Remove(filepath.Join(in.cfg.BinDir(), "codex")),
			os.RemoveAll(in.cfg.CodexDir()),
		)

	case toolcatalog.ChannelMuseRelease:
		// The link and the launcher's directory, in that order, for the codex channel's reason.
		in.log.printf("removing %s and %s", filepath.Join(in.cfg.BinDir(), "muse"), in.cfg.MuseDir())
		return firstError(
			os.Remove(filepath.Join(in.cfg.BinDir(), "muse")),
			os.RemoveAll(in.cfg.MuseDir()),
		)

	case toolcatalog.ChannelOpenCodeRelease:
		// The link and the unpacked directory, in that order, for the codex channel's reason.
		in.log.printf("removing %s and %s", filepath.Join(in.cfg.BinDir(), "opencode"), in.cfg.OpencodeDir())
		return firstError(
			os.Remove(filepath.Join(in.cfg.BinDir(), "opencode")),
			os.RemoveAll(in.cfg.OpencodeDir()),
		)

	case toolcatalog.ChannelFFmpegRelease:
		// The two files the driver took out of the archive, and nothing else: the rest of it was
		// never unpacked.
		var errs []error
		for _, name := range ffmpegExecutables {
			bin := filepath.Join(in.cfg.BinDir(), name)
			in.log.printf("removing %s", bin)
			errs = append(errs, os.Remove(bin))
		}
		return firstError(errs...)

	case toolcatalog.ChannelSystem:
		_, del, ok := toolconfig.SystemInstaller(in.cfg.Platform())
		if !ok {
			return fmt.Errorf("this system has no package manager this service may use")
		}
		return in.run(append(del, recipe.Packages...), in.cfg.Prefix)

	case toolcatalog.ChannelDetect:
		// The ledger never claims one — there was never anything to record — so this is the
		// backstop behind Uninstall's own refusal, with the truthful message.
		return fmt.Errorf("%w: %s", toolfaults.ErrNotInstalled, comp.ID)

	case toolcatalog.ChannelRemote, toolcatalog.ChannelBundled:
		return nil

	default:
		return fmt.Errorf("component %s: unknown channel %q", comp.ID, recipe.Channel)
	}
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
