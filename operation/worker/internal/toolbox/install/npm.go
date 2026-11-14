package install

import (
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/filesystem"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// npmCommand prefers toolbox Node, then falls back to npm on the machine's PATH.
// Running node npm-cli.js directly avoids a shebang resolving a different Node runtime.
// If neither is available, the error instructs the operator to install Node.
func (in *installer) npmCommand() ([]string, error) {
	node := filepath.Join(in.cfg.NodeDir(), "bin", "node")
	cli := filepath.Join(in.cfg.NodeDir(), "lib", "node_modules", "npm", "bin", "npm-cli.js")
	if filesystem.FileExists(node) && filesystem.FileExists(cli) {
		return []string{node, cli}, nil
	}
	if bin := filepath.Join(in.cfg.NodeDir(), "bin", "npm"); filesystem.FileExists(bin) {
		return []string{bin}, nil
	}
	if path, err := exec.LookPath("npm"); err == nil {
		return []string{path}, nil
	}
	return nil, fmt.Errorf("there is no npm here: neither in %s nor on this service's PATH — install the node runtime first", in.cfg.NodeDir())
}

// installNPM installs one package into the private prefix and answers the command a turn runs it
// with — `<node> <script>` rather than the shebang'd wrapper, because a wrapper resolves `node`
// through the PATH of whoever spawned it and a turn's PATH is not this process's to arrange.
func (in *installer) installNPM(recipe toolcatalog.Recipe) (string, []string, string, error) {
	npm, err := in.npmCommand()
	if err != nil {
		return "", nil, "", err
	}
	if err := in.run(append(npm, "install", "-g", recipe.Package), in.cfg.Prefix); err != nil {
		return "", nil, "", err
	}

	// The package says what it ships and where; reading its manifest beats guessing the name.
	manifestPath := filepath.Join(in.cfg.NpmModulesDir(), filepath.FromSlash(recipe.Package), "package.json")
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

// runPostInstall runs a command out of the installed package's **own** dependency tree — the
// `node_modules/.bin` npm just wrote beside it, or the hoisted one at the top of the global tree.
//
// Not `npm exec`, which is what this first tried: with the package's CLI not on the exec path, npm
// helpfully downloads whatever that name currently publishes — a different version, fetched into a
// cache nothing here owns, printing advice about a project that does not exist. A browser fetched
// by one Playwright for another is a mismatch that surfaces only when a turn opens a page.
func (in *installer) runPostInstall(recipe toolcatalog.Recipe, packageDir string) error {
	candidates := []string{
		filepath.Join(packageDir, "node_modules", ".bin", recipe.PostInstall.Bin),
		filepath.Join(in.cfg.NpmModulesDir(), ".bin", recipe.PostInstall.Bin),
	}
	bin := ""
	for _, candidate := range candidates {
		if filesystem.FileExists(candidate) {
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
