package catalog

import (
	_ "embed"
	"encoding/json"
	"fmt"
	toolfaults "kiao/worker/internal/toolbox/faults"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed pub.json
var pubCatalogJSON []byte

// Runtimes include software used by the service itself (e.g. ffmpeg), not just turns.
// MCP components also declare a server for turns. Kind controls panel grouping and
// external-runtime detection; Role describes the component's purpose.
const (
	KindRuntime = "runtime"
	KindMCP     = "mcp"
)

const (
	ChannelUV          = "uv"           // uv tool install <package>, binaries in <prefix>/bin
	ChannelNPM         = "npm"          // npm -g in the private prefix at <prefix>/npm
	ChannelNodeTarball = "node-tarball" // the official nodejs.org build, checksum-verified
	ChannelTemurin     = "temurin"      // the Adoptium JDK, checksum from their API
	ChannelUVPython    = "uv-python"    // uv python install --default
	ChannelUVBootstrap = "uv-bootstrap" // uv bootstrap
	ChannelSystem      = "system"       // the image's own package manager, where the process is root
	ChannelDetect      = "detect"       // detection and suggested system command only; never installed
	ChannelRemote      = "remote"       // MCP over HTTP; no installation
	ChannelBundled     = "bundled"      // shipped kiao-mcp server; no installation

	// Separate CLI channels reflect publisher-specific manifests. Claude, Codex and Muse
	// use pinned versions and publisher checksums; OpenCode has no checksum and relies on TLS.
	ChannelClaudeRelease   = "claude-release"   // the single binary from downloads.claude.ai
	ChannelCodexRelease    = "codex-release"    // the package tarball from the openai/codex releases
	ChannelMuseRelease     = "muse-release"     // the launcher and the binary from the muse channel
	ChannelOpenCodeRelease = "opencode-release" // the binary tarball from the opencode releases

	// FFmpeg uses a release-branch pin (the newest commit), a published digest,
	// and two files from a .tar.xz archive.
	ChannelFFmpegRelease = "ffmpeg-release" // a release branch's static build, from BtbN/FFmpeg-Builds
)

// Recipe selects how to obtain a component on one platform. The catalogue test
// checks that each channel supplies the fields its driver reads.
type Recipe struct {
	Channel string `json:"channel"`
	Package string `json:"package"`
	// With pins extra requirements in the uv tool's environment, not the tool version.
	With     []string `json:"with"`
	Packages []string `json:"packages"` // system packages or detect-channel install suggestions
	Version  string   `json:"version"`  // "lts" for node, a feature release for the JDK and Python
	// Bin identifies a runtime for detection and version checks, searching the toolbox
	// before PATH. For MCP packages with multiple executables, it selects the server;
	// otherwise the executable can be discovered from the installation.
	Bin string `json:"bin"`
	// AlsoProvides must all be present for a runtime to count as installed. For example,
	// system node without npm cannot satisfy dependents that use the npm channel.
	AlsoProvides []string `json:"alsoProvides"`

	URL string `json:"url"`
	// PostInstall uses the installed package's dependency tree to keep tools such as
	// Playwright and its downloaded browser on compatible versions; npm exec may fetch
	// a different version.
	PostInstall *PostInstall `json:"postInstall"`
}

// PostInstall is one command run out of an installed package's own node_modules/.bin.
type PostInstall struct {
	Bin  string   `json:"bin"`
	Args []string `json:"args"`
}

// Component is one entry in a catalogue file.
type Component struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Role  string `json:"role"`

	// Server is the MCP configuration name handed to turns; empty for runtimes.
	Server string `json:"server"`

	// Agent is the CLI's hybridflow runner name; empty for other components. It enables
	// the panel/ledger switch controlling whether the agent is offered to turns.
	Agent string `json:"agent"`
	// ServerArgs and ServerEnv extend the driver-resolved configuration. Values may use
	// ${toolbox:…} prefix paths (see Config.expandTokens). ServerEnv must never set PATH:
	// the CLI merges it into a shared environment, so replacing PATH breaks other servers.
	ServerArgs []string          `json:"serverArgs"`
	ServerEnv  map[string]string `json:"serverEnv"`

	// Requires supplies dependencies for the panel's install closure.
	Requires []string `json:"requires"`

	// RequiresEnv is an any-of environment-variable precondition, not an installable
	// dependency. If unmet, the row shows PreconditionHint instead of an install button.
	RequiresEnv      []string `json:"requiresEnv"`
	PreconditionHint string   `json:"preconditionHint"`

	Recipes map[string]Recipe `json:"recipes"`
}

// RecipeFor prefers the platform recipe over the generic one; false means unsupported.
func (c Component) RecipeFor(platform string) (Recipe, bool) {
	if r, ok := c.Recipes[platform]; ok {
		return r, true
	}
	r, ok := c.Recipes[PlatformGeneric]
	return r, ok
}

// Catalog preserves source and entry order for panel display.
type Catalog struct {
	components []Component
	ByID       map[string]Component
	sources    []string
}

type catalogDoc struct {
	Components []Component `json:"components"`
}

// LoadCatalog uses embedded pub.json unless dir supplies a replacement, allowing
// catalogue updates without rebuilding the binary. It merges directory *.json files
// in name order, preserving entry order and rejecting duplicate IDs. An empty dir
// uses only the embedded catalogue. Startup reports errors rather than panicking.
func LoadCatalog(dir string) (*Catalog, error) {
	type source struct {
		name string
		doc  catalogDoc
	}
	parse := func(name string, data []byte) (catalogDoc, error) {
		var doc catalogDoc
		if err := json.Unmarshal(data, &doc); err != nil {
			return doc, fmt.Errorf("parsing the toolbox catalogue %s: %w", name, err)
		}
		return doc, nil
	}

	var overlay []source
	if d := strings.TrimSpace(dir); d != "" {
		// ReadDir keeps directory sources in deterministic name order.
		entries, err := os.ReadDir(d)
		if err != nil {
			return nil, fmt.Errorf("reading the toolbox catalogue directory %s: %w", d, err)
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			path := filepath.Join(d, entry.Name())
			data, err := os.ReadFile(path)
			if err != nil {
				return nil, fmt.Errorf("reading the toolbox catalogue %s: %w", path, err)
			}
			doc, err := parse(path, data)
			if err != nil {
				return nil, err
			}
			overlay = append(overlay, source{name: path, doc: doc})
		}
	}

	var sources []source
	embedded := true
	for _, s := range overlay {
		if filepath.Base(s.name) == "pub.json" {
			embedded = false
		}
	}
	if embedded {
		doc, err := parse("pub.json (embedded)", pubCatalogJSON)
		if err != nil {
			return nil, err
		}
		sources = append(sources, source{name: "pub.json (embedded)", doc: doc})
	}
	sources = append(sources, overlay...)

	cat := &Catalog{ByID: map[string]Component{}}
	declaredIn := map[string]string{}
	for _, s := range sources {
		for _, c := range s.doc.Components {
			if first, dup := declaredIn[c.ID]; dup {
				return nil, fmt.Errorf("the toolbox catalogue declares %q twice (in %s and %s)", c.ID, first, s.name)
			}
			declaredIn[c.ID] = s.name
			cat.components = append(cat.components, c)
			cat.ByID[c.ID] = c
		}
	}
	for _, c := range cat.components {
		for _, dep := range c.Requires {
			if _, ok := cat.ByID[dep]; !ok {
				return nil, fmt.Errorf("component %q requires %q, which the catalogue does not declare (in %s)", c.ID, dep, declaredIn[c.ID])
			}
		}
	}
	for _, s := range sources {
		cat.sources = append(cat.sources, s.name)
	}
	return cat, nil
}

// All returns the components in catalogue order.
func (c *Catalog) All() []Component { return c.components }

// Sources names the documents the catalogue was assembled from, in merge order.
func (c *Catalog) Sources() []string { return append([]string{}, c.sources...) }

func (c *Catalog) Get(id string) (Component, bool) {
	comp, ok := c.ByID[id]
	return comp, ok
}

// forAgent matches the runner's agent name. A missing row leaves an agent offered,
// since the panel cannot control it.
func (c *Catalog) ForAgent(name string) (Component, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Component{}, false
	}
	for _, comp := range c.components {
		if comp.Agent == name {
			return comp, true
		}
	}
	return Component{}, false
}

// closure returns unique IDs with dependencies first, rejecting cycles.
func (c *Catalog) Closure(ids []string) ([]string, error) {
	var order []string
	seen := map[string]bool{}   // already in order
	onPath := map[string]bool{} // current descent

	var visit func(id string) error
	visit = func(id string) error {
		if seen[id] {
			return nil
		}
		if onPath[id] {
			return fmt.Errorf("%w: %s requires itself", toolfaults.ErrCatalogCycle, id)
		}
		comp, ok := c.ByID[id]
		if !ok {
			return fmt.Errorf("%w: %s", toolfaults.ErrUnknownComponent, id)
		}
		onPath[id] = true
		for _, dep := range comp.Requires {
			if err := visit(dep); err != nil {
				return err
			}
		}
		onPath[id] = false
		seen[id] = true
		order = append(order, id)
		return nil
	}
	for _, id := range ids {
		if err := visit(id); err != nil {
			return nil, err
		}
	}
	return order, nil
}

// dependents supports refusing uninstall while an installed component requires id.
func (c *Catalog) Dependents(id string) []string {
	var found []string
	for _, comp := range c.components {
		for _, dep := range comp.Requires {
			if dep == id {
				found = append(found, comp.ID)
			}
		}
	}
	sort.Strings(found)
	return found
}

func (c *Catalog) KnownIDs() string {
	ids := make([]string, 0, len(c.components))
	for _, comp := range c.components {
		ids = append(ids, comp.ID)
	}
	sort.Strings(ids)
	return strings.Join(ids, ", ")
}
