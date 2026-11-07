package cli

import (
	"flag"
	"fmt"
	coreconfig "kiao/worker/internal/core/config"
	toolconfig "kiao/worker/internal/toolbox/config"
	"kiao/worker/internal/toolbox/install"
	"os"
	"path/filepath"
	"strings"
)

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
	cfg := &toolconfig.Config{Config: &coreconfig.Config{}, Prefix: abs, Target: *target, CatalogDir: *catalogDir}
	if err := install.Preinstall(cfg, flags.Args(), *force, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "toolbox: %v\n", err)
		return 1
	}
	return 0
}
