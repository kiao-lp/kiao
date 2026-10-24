package install

import (
	"fmt"
	"io"
	"kiao/worker/internal/core/filesystem"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	"path/filepath"
	"strings"
)

// wanted is one id from the command line, with the version it was pinned to.
type wanted struct {
	Id      string
	Version string
}

// parseWanted splits `id@version`. A version is optional and, where it is given, overrides whatever
// the catalogue's recipe says — which is what `--claude-version` used to mean, said once for every
// component rather than once per component in every build script.
func ParseWanted(arg string) wanted {
	id, version, ok := strings.Cut(arg, "@")
	if !ok {
		return wanted{Id: arg}
	}
	return wanted{Id: id, Version: version}
}

// preinstall installs each named component and its dependencies into the prefix.
func Preinstall(cfg *toolconfig.Config, args []string, force bool, out io.Writer) error {
	catalog, err := toolcatalog.LoadCatalog(cfg.CatalogDir)
	if err != nil {
		return err
	}

	ids := make([]string, 0, len(args))
	pinned := map[string]string{}
	for _, arg := range args {
		w := ParseWanted(arg)
		if _, ok := catalog.Get(w.Id); !ok {
			return fmt.Errorf("%s is not a catalogue component; known: %s", w.Id, catalog.KnownIDs())
		}
		ids = append(ids, w.Id)
		if w.Version != "" {
			pinned[w.Id] = w.Version
		}
	}

	closure, err := catalog.Closure(ids)
	if err != nil {
		return err
	}
	if err := cfg.EnsureLayout(); err != nil {
		return err
	}

	platform := cfg.Platform()
	log := &jobLog{echo: out}
	in := newInstaller(cfg, log)

	for _, id := range closure {
		comp, _ := catalog.Get(id)
		recipe, ok := comp.RecipeFor(platform)
		if !ok {
			return fmt.Errorf("the catalogue has no recipe for %s on %s", id, platform)
		}
		// Pi's npm payload is portable; target images supply their own musl Node runtime.
		if id == "node" && cfg.Target != "" && cfg.Target != toolconfig.DetectPlatform() {
			neededByPi := false
			for _, asked := range ids {
				if comp, _ := catalog.Get(asked); comp.ID == "pi-cli" || strings.HasPrefix(comp.ID, "pi-cli-") {
					neededByPi = true
				}
			}
			if neededByPi {
				log.print("== target image supplies Node.js; using host npm to stage Pi")
				continue
			}
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
		if !force && recipe.Bin != "" && filesystem.FileExists(filepath.Join(cfg.BinDir(), recipe.Bin)) {
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
