package toolbox

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"kiao/worker/internal/core"
)

// The toolbox as a command, for the one caller that needs it before there is a service.
//
// A build script that has to put the Claude Code CLI into an image used to do it itself: resolve
// the current version, read the release manifest, download 300 MB, check a SHA-256, cache the
// result somewhere of its own, and take a `--skip-claude` and a `--claude-version` for the two
// decisions that leaves. Adding a second CLI would have doubled every one of those. So the script
// keeps the decision — *which* components this image ships — and this keeps the mechanism, which is
// the same catalogue, the same channel drivers and the same verified download the panel uses.
//
// It is not a general command runner any more than the panel is: it names ids from the catalogue,
// resolves their dependency closure, and refuses anything else. What it does that the panel cannot
// is write into a prefix that is not this deployment's and fetch a build for a platform that is not
// this machine's — a staging directory, for Alpine, from a glibc build host — which is why it is a
// command and not an endpoint.

// usage is what a mistyped invocation is answered with.
const usage = `usage: worker toolbox preinstall --prefix DIR [--target NAME] [--catalog-dir DIR] [--force] id[@version]...

Installs catalogue components, and everything they require, into DIR — a toolbox prefix, laid out
exactly as a running deployment's is, so that a build can stage it wherever it belongs.

  --prefix DIR     where to install; created if it is not there
  --target NAME    the platform to fetch a build for (alpine, debian, generic), when it is not
                   this machine's. Only the release channels read it, and only for the libc
  --catalog-dir DIR
                   merge every *.json in DIR into the catalogue, as a running deployment does
                   with KIAO_WORKER_TOOLBOX_CATALOG_PATH; empty is the embedded pub.json alone
  --force          install again even when the component is already in the prefix
  id[@version]     a catalogue id, optionally pinned — claude-cli@2.1.259

Without --force this is idempotent: a component already in the prefix is left alone, which is what
makes the prefix usable as a build cache.
`

// RunCLI is `worker toolbox …`. It returns the process exit code rather than exiting, so the
// one place this program stops is main.
func RunCLI(args []string) int {
	if len(args) == 0 || args[0] != "preinstall" {
		fmt.Fprint(os.Stderr, usage)
		return 2
	}

	flags := flag.NewFlagSet("toolbox preinstall", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	flags.Usage = func() { fmt.Fprint(os.Stderr, usage) }
	prefix := flags.String("prefix", "", "")
	target := flags.String("target", "", "")
	catalogDir := flags.String("catalog-dir", "", "")
	force := flags.Bool("force", false, "")
	if err := flags.Parse(args[1:]); err != nil {
		return 2
	}
	if strings.TrimSpace(*prefix) == "" || flags.NArg() == 0 {
		flags.Usage()
		return 2
	}
	abs, err := filepath.Abs(*prefix)
	if err != nil {
		fmt.Fprintf(os.Stderr, "toolbox: %v\n", err)
		return 1
	}

	// The socle's configuration is not read: nothing here needs a store, a port or a state
	// directory, and reading a deployment's environment would be the wrong prefix by definition.
	cfg := &Config{Config: &core.Config{}, Prefix: abs, Target: *target, CatalogDir: *catalogDir}
	if err := preinstall(cfg, flags.Args(), *force, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "toolbox: %v\n", err)
		return 1
	}
	return 0
}

// wanted is one id from the command line, with the version it was pinned to.
type wanted struct {
	id      string
	version string
}

// parseWanted splits `id@version`. A version is optional and, where it is given, overrides whatever
// the catalogue's recipe says — which is what `--claude-version` used to mean, said once for every
// component rather than once per component in every build script.
func parseWanted(arg string) wanted {
	id, version, ok := strings.Cut(arg, "@")
	if !ok {
		return wanted{id: arg}
	}
	return wanted{id: id, version: version}
}

// preinstall installs each named component and its dependencies into the prefix.
func preinstall(cfg *Config, args []string, force bool, out io.Writer) error {
	catalog, err := LoadCatalog(cfg.CatalogDir)
	if err != nil {
		return err
	}

	ids := make([]string, 0, len(args))
	pinned := map[string]string{}
	for _, arg := range args {
		w := parseWanted(arg)
		if _, ok := catalog.Get(w.id); !ok {
			return fmt.Errorf("%s is not a catalogue component; known: %s", w.id, catalog.knownIDs())
		}
		ids = append(ids, w.id)
		if w.version != "" {
			pinned[w.id] = w.version
		}
	}

	closure, err := catalog.closure(ids)
	if err != nil {
		return err
	}
	if err := cfg.ensureLayout(); err != nil {
		return err
	}

	platform := cfg.platform()
	log := &jobLog{echo: out}
	in := newInstaller(cfg, log)

	for _, id := range closure {
		comp, _ := catalog.Get(id)
		recipe, ok := comp.RecipeFor(platform)
		if !ok {
			return fmt.Errorf("the catalogue has no recipe for %s on %s", id, platform)
		}
		if version, isPinned := pinned[id]; isPinned {
			recipe.Version = version
		}
		// The prefix is the cache. A build that has already staged this CLI is not asked to fetch
		// three hundred megabytes again to prove it, and `--force` is how a stale one is replaced.
		//
		// *In the prefix*, and not present() — which answers "on this machine, whoever put it
		// there" and would find the build host's own `claude` on PATH, then stage an empty
		// directory into an image on the strength of it.
		if !force && recipe.Bin != "" && fileExists(filepath.Join(cfg.binDir(), recipe.Bin)) {
			log.printf("== %s is already in %s", id, cfg.Prefix)
			continue
		}
		log.printf("== %s (%s, %s)", id, recipe.Channel, platform)
		entry, err := in.install(comp, recipe)
		if err != nil {
			return fmt.Errorf("installing %s: %w", id, err)
		}
		log.printf("== %s installed%s", id, versionSuffix(entry.Version))
	}
	return nil
}

// versionSuffix is the parenthesised version, or nothing at all when the driver had none to report.
func versionSuffix(version string) string {
	if strings.TrimSpace(version) == "" {
		return ""
	}
	return " (" + version + ")"
}
