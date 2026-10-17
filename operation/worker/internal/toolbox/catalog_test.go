package toolbox

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// knownChannels is the driver table, spelled once here so that a catalogue entry naming a channel
// nobody implemented fails the build rather than one install, at run time, on somebody's machine.
var knownChannels = map[string]bool{
	channelUV: true, channelNPM: true, channelNodeTarball: true, channelTemurin: true,
	channelUVPython: true, channelUVBootstrap: true, channelSystem: true,
	channelDetect: true,
	channelRemote: true, channelBundled: true,
	channelClaudeRelease: true, channelCodexRelease: true,
	channelFFmpegRelease: true, channelMuseRelease: true, channelOpenCodeRelease: true,
}

// TestCatalogIsSound walks the embedded pub catalogue and checks every invariant the drivers and
// the panel rely on. It is the test that matters most in this package: the catalogue is the only
// thing a caller can name, so a mistake in it is the one way a request can ask for something
// incoherent.
func TestCatalogIsSound(t *testing.T) {
	catalog, err := LoadCatalog("")
	if err != nil {
		t.Fatalf("the shipped catalogue does not load: %v", err)
	}
	if len(catalog.All()) == 0 {
		t.Fatal("the catalogue is empty")
	}

	for _, comp := range catalog.All() {
		if comp.ID == "" || comp.Title == "" || comp.Role == "" {
			t.Errorf("%q: id, title and role are what the panel shows; none may be empty", comp.ID)
		}
		switch comp.Kind {
		case KindRuntime:
			if comp.Server != "" {
				t.Errorf("%s: a runtime declares no MCP server name", comp.ID)
			}
		case KindMCP:
			if comp.Server == "" {
				t.Errorf("%s: an MCP component must name the server a turn sees it as", comp.ID)
			}
			// Only a runtime is an agent's CLI: the field is what gives a row the switch that says
			// "offered in the agent tab", and an MCP server's switch already means something else.
			if comp.Agent != "" {
				t.Errorf("%s: only a runtime is an agent's CLI", comp.ID)
			}
		default:
			t.Errorf("%s: kind %q is neither %q nor %q", comp.ID, comp.Kind, KindRuntime, KindMCP)
		}
		if len(comp.Recipes) == 0 {
			t.Errorf("%s: no recipe on any platform, so it can never be anything but unavailable", comp.ID)
		}
		if len(comp.RequiresEnv) > 0 && comp.PreconditionHint == "" {
			t.Errorf("%s: a blocked row has to say what to go and do", comp.ID)
		}
		// ServerEnv is merged onto the environment the CLI already has, so a PATH here would not
		// extend it, it would replace it — and break every other server at once.
		if _, ok := comp.ServerEnv["PATH"]; ok {
			t.Errorf("%s: serverEnv must never carry PATH", comp.ID)
		}

		for platform, recipe := range comp.Recipes {
			if !knownChannels[recipe.Channel] {
				t.Errorf("%s/%s: channel %q has no driver", comp.ID, platform, recipe.Channel)
			}
			switch recipe.Channel {
			case channelUV, channelNPM:
				if recipe.Package == "" {
					t.Errorf("%s/%s: the %s channel installs a named package", comp.ID, platform, recipe.Channel)
				}
			case channelSystem:
				if len(recipe.Packages) == 0 {
					t.Errorf("%s/%s: the system channel hands packages to a package manager", comp.ID, platform)
				}
			case channelDetect:
				// Reported, never installed: the binary it is recognised by, and the system
				// packages the row names when it is absent.
				if recipe.Bin == "" {
					t.Errorf("%s/%s: a runtime is recognised on the machine by its binary", comp.ID, platform)
				}
				if len(recipe.Packages) == 0 {
					t.Errorf("%s/%s: a detect-only row has to name what to install", comp.ID, platform)
				}
			case channelNodeTarball, channelTemurin, channelUVPython:
				if recipe.Version == "" {
					t.Errorf("%s/%s: %s needs a version, even if it is \"lts\"", comp.ID, platform, recipe.Channel)
				}
				if recipe.Bin == "" {
					t.Errorf("%s/%s: a runtime is recognised on the machine by its binary", comp.ID, platform)
				}
			case channelClaudeRelease, channelCodexRelease, channelOpenCodeRelease:
				// No version: these resolve the current release the way node-tarball resolves the
				// current LTS, and a pin here would be a pin nobody remembers to move. What they
				// do need is the binary they are recognised by, since that is what says the agent
				// tab has something to spawn.
				if recipe.Bin == "" {
					t.Errorf("%s/%s: a runtime is recognised on the machine by its binary", comp.ID, platform)
				}
			case channelFFmpegRelease:
				if recipe.Bin == "" {
					t.Errorf("%s/%s: a runtime is recognised on the machine by its binary", comp.ID, platform)
				}
				// A branch and not `master`: see installFFmpeg.
				if !ffmpegBranch.MatchString(recipe.Version) {
					t.Errorf("%s/%s: the ffmpeg channel is pinned to a release branch, got %q",
						comp.ID, platform, recipe.Version)
				}
			case channelRemote:
				if recipe.URL == "" {
					t.Errorf("%s/%s: a remote server is an endpoint", comp.ID, platform)
				}
			case channelBundled:
				if recipe.Package == "" {
					t.Errorf("%s/%s: a bundled server names the kiao-mcp short name it is", comp.ID, platform)
				}
			}
		}
	}
}

// TestServerEnvNamesOnlyKnownPlaces: a `${toolbox:…}` reference the expander does not know would
// reach a turn as literal text and fail a server on a path that reads like a bug in the package.
func TestServerEnvNamesOnlyKnownPlaces(t *testing.T) {
	catalog, err := LoadCatalog("")
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	known := (&Config{}).toolboxPaths()
	for _, comp := range catalog.All() {
		for key, value := range comp.ServerEnv {
			for _, match := range toolboxToken.FindAllStringSubmatch(value, -1) {
				if _, ok := known[match[1]]; !ok {
					t.Errorf("%s/%s names %s, which the toolbox cannot resolve", comp.ID, key, match[0])
				}
			}
		}
	}
}

// TestTheNPMChannelIsPromisedAnNPM is an npm-channel install failure written as a rule about the
// catalogue.
// A recipe that runs `npm install -g` is only installable if something in its dependency closure
// actually puts an npm on the machine — and the node it names has to promise one, because a runtime
// counts as present when everything it promises is there. Ubuntu's `nodejs` package ships no npm,
// and without this the panel would again read a half-Node as a Node, skip the install, and fail on
// a missing file.
func TestTheNPMChannelIsPromisedAnNPM(t *testing.T) {
	catalog, err := LoadCatalog("")
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	for _, comp := range catalog.All() {
		for platform, recipe := range comp.Recipes {
			if recipe.Channel != channelNPM {
				continue
			}
			closure, err := catalog.closure([]string{comp.ID})
			if err != nil {
				t.Fatalf("%s: closure: %v", comp.ID, err)
			}
			promised := false
			for _, id := range closure {
				dep, _ := catalog.Get(id)
				r, ok := dep.RecipeFor(platform)
				if ok && (r.Bin == "npm" || slices.Contains(r.AlsoProvides, "npm")) {
					promised = true
				}
			}
			if !promised {
				t.Errorf("%s/%s installs with npm, and nothing in %v promises one", comp.ID, platform, closure)
			}
		}
	}
}

// TestCatalogHasTheServersTheTableNames pins the seven third-party servers, the two kiao ones
// this half ships, and the runtimes against the table this panel was asked for. A row silently
// missing from a shipped catalogue is not something a running service would ever complain about.
//
// A deployment with servers of its own stages them in a file beside pub.json; the embedded
// catalogue carries only the rows above, and that merge is covered by the directory tests below.
func TestCatalogHasTheServersTheTableNames(t *testing.T) {
	catalog, err := LoadCatalog("")
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	for _, id := range []string{
		"fetch", "duckduckgo", "markitdown", "git", "papers", "playwright", "github",
		"kiao-files", "kiao-hybridflow",
		"uv", "node", "jdk", "python", "ffmpeg", "graphviz",
	} {
		if _, ok := catalog.Get(id); !ok {
			t.Errorf("the catalogue no longer offers %q", id)
		}
	}

	// The two pins the table calls for are pins on the environment the tool runs in, and dropping
	// one silently gives a server an SDK it was never tested against.
	for _, id := range []string{"fetch", "git"} {
		comp, _ := catalog.Get(id)
		recipe, _ := comp.RecipeFor(platformGeneric)
		if len(recipe.With) == 0 || !strings.Contains(strings.Join(recipe.With, ","), "mcp<2") {
			t.Errorf("%s: the mcp<2 pin is gone (with = %v)", id, recipe.With)
		}
	}
}

// TestFFmpegAssetIsThePublishedName: the archive is found by name in the release's checksum list, so
// a name spelled differently from the publisher's is an install that fails on "lists no checksum".
func TestFFmpegAssetIsThePublishedName(t *testing.T) {
	if got := ffmpegAsset("9.0", "linux64"); got != "ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz" {
		t.Errorf("ffmpegAsset = %q", got)
	}
	if got := ffmpegAsset("8.1", "linuxarm64"); got != "ffmpeg-n8.1-latest-linuxarm64-gpl-8.1.tar.xz" {
		t.Errorf("ffmpegAsset = %q", got)
	}
}

// TestClosure: dependencies come first, each id once, and a component asked for twice is done once.
func TestClosure(t *testing.T) {
	catalog, err := LoadCatalog("")
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}

	order, err := catalog.closure([]string{"markitdown", "fetch"})
	if err != nil {
		t.Fatalf("closure: %v", err)
	}
	position := map[string]int{}
	for i, id := range order {
		if _, dup := position[id]; dup {
			t.Errorf("closure = %v, want each component once", order)
		}
		position[id] = i
	}
	for _, pair := range [][2]string{{"uv", "python"}, {"python", "markitdown"}, {"uv", "fetch"}} {
		if position[pair[0]] > position[pair[1]] {
			t.Errorf("closure = %v, want %s before %s", order, pair[0], pair[1])
		}
	}

	if _, err := catalog.closure([]string{"nothing-like-this"}); err == nil {
		t.Errorf("an id the catalogue does not declare must be refused")
	}
}

// TestClosureRefusesACycle: a catalogue written by hand can grow a loop, and a visited-set alone
// would silently produce a plan missing one of the two. Refusing names the mistake instead.
func TestClosureRefusesACycle(t *testing.T) {
	catalog := &Catalog{byID: map[string]Component{
		"a": {ID: "a", Requires: []string{"b"}},
		"b": {ID: "b", Requires: []string{"a"}},
	}}
	if _, err := catalog.closure([]string{"a"}); err == nil {
		t.Errorf("a dependency cycle must be refused")
	}
}

// TestDependents is what an uninstall consults before it removes something.
func TestDependents(t *testing.T) {
	catalog, err := LoadCatalog("")
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	found := map[string]bool{}
	for _, id := range catalog.dependents("uv") {
		found[id] = true
	}
	for _, id := range []string{"fetch", "duckduckgo", "markitdown", "git", "papers", "python"} {
		if !found[id] {
			t.Errorf("dependents(uv) does not include %s, so removing uv would break it silently", id)
		}
	}
}

// TestRecipeForPrefersThePlatform: an alpine recipe wins over the generic one, and a component with
// only a generic recipe still resolves everywhere.
func TestRecipeForPrefersThePlatform(t *testing.T) {
	comp := Component{Recipes: map[string]Recipe{
		platformGeneric: {Channel: channelNodeTarball},
		platformAlpine:  {Channel: channelSystem},
	}}
	if r, _ := comp.RecipeFor(platformAlpine); r.Channel != channelSystem {
		t.Errorf("alpine got %q, want its own recipe", r.Channel)
	}
	if r, _ := comp.RecipeFor(platformDebian); r.Channel != channelNodeTarball {
		t.Errorf("debian got %q, want the generic recipe", r.Channel)
	}

	only := Component{Recipes: map[string]Recipe{platformAlpine: {Channel: channelSystem}}}
	if _, ok := only.RecipeFor(platformDebian); ok {
		t.Errorf("a component with no generic recipe must be unavailable off its platform")
	}
}

// TestPostInstallIsACommand: a post-install runs out of the installed package's own dependency
// tree, so the catalogue has to name an executable and its arguments rather than a package name.
// It named `playwright-chromium` once, which `playwright install` rejects as a browser.
func TestPostInstallIsACommand(t *testing.T) {
	catalog, err := LoadCatalog("")
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	for _, comp := range catalog.All() {
		for platform, recipe := range comp.Recipes {
			if recipe.PostInstall == nil {
				continue
			}
			if recipe.Channel != channelNPM {
				t.Errorf("%s/%s: only the npm driver runs a post-install", comp.ID, platform)
			}
			if recipe.PostInstall.Bin == "" || len(recipe.PostInstall.Args) == 0 {
				t.Errorf("%s/%s: a post-install is an executable and its arguments, got %+v",
					comp.ID, platform, recipe.PostInstall)
			}
		}
	}
}

// TestFirstLines: the reason a row shows has to be the tool's complaint, not the bottom edge of the
// ASCII box it printed its advice in — which is exactly what `playwright install` put there.
func TestFirstLines(t *testing.T) {
	noisy := `Failed to install browsers
Error: Invalid installation targets: 'playwright-chromium'.
╔════════════════════════════════════╗
║ WARNING: run npm install first     ║
╚════════════════════════════════════╝`
	got := firstLines(noisy, 3)
	if !strings.Contains(got, "Invalid installation targets") {
		t.Errorf("firstLines = %q, want the tool's actual complaint", got)
	}
	if strings.ContainsAny(got, "║╔╝") {
		t.Errorf("firstLines = %q, want no box drawing", got)
	}

	// With nothing error-shaped in it, the tail is still the best guess.
	if got := firstLines("step one\nstep two\nstep three", 1); got != "step three" {
		t.Errorf("firstLines = %q, want the last line", got)
	}
}

// ── the catalogue as a directory ──────────────────────────────────────────────

// writeCatalog stages one catalogue file. The fixtures are detect-only runtimes: the cheapest
// component shape that is still a component.
func writeCatalog(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatalf("cannot stage %s: %v", name, err)
	}
}

func catalogComponent(id, extra string) string {
	return `{"id": "` + id + `", "kind": "runtime", "title": "` + id + `", "role": "a fixture", ` +
		extra + `"recipes": {"generic": {"channel": "detect", "bin": "` + id + `", "packages": ["` + id + `"]}}}`
}

// TestCatalogMergesDirectoryFilesAfterPub: every *.json of the directory lands after the embedded
// catalogue, in name order, and a dependency on an embedded component resolves across the merge.
func TestCatalogMergesDirectoryFilesAfterPub(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, "b.json", `{"components": [`+catalogComponent("from-b", `"requires": ["uv"], `)+`]}`)
	writeCatalog(t, dir, "a.json", `{"components": [`+catalogComponent("from-a", "")+`]}`)

	catalog, err := LoadCatalog(dir)
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	position := map[string]int{}
	for i, comp := range catalog.All() {
		position[comp.ID] = i
	}
	if position["from-a"] > position["from-b"] {
		t.Errorf("a.json must merge before b.json")
	}
	if position["uv"] > position["from-a"] {
		t.Errorf("the embedded catalogue must come first")
	}
	if _, err := catalog.closure([]string{"from-b"}); err != nil {
		t.Errorf("a dependency on an embedded component must resolve across the merge: %v", err)
	}
	if got := catalog.Sources(); len(got) != 3 || !strings.HasSuffix(got[1], "a.json") || !strings.HasSuffix(got[2], "b.json") {
		t.Errorf("Sources = %v, want the embedded catalogue then a.json, b.json", got)
	}
}

// TestCatalogDirPubJSONReplacesEmbedded: a deployed pub.json is a newer catalogue than the binary
// was built with, not a second one to merge — the embedded entries are gone.
func TestCatalogDirPubJSONReplacesEmbedded(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, "pub.json", `{"components": [`+catalogComponent("only-here", "")+`]}`)

	catalog, err := LoadCatalog(dir)
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	if _, ok := catalog.Get("uv"); ok {
		t.Errorf("a deployed pub.json replaces the embedded one; uv must be gone")
	}
	if _, ok := catalog.Get("only-here"); !ok {
		t.Errorf("the deployed pub.json is not read")
	}
	for _, s := range catalog.Sources() {
		if strings.Contains(s, "embedded") {
			t.Errorf("Sources = %v, want no embedded catalogue", catalog.Sources())
		}
	}
}

// TestCatalogRefusesADuplicateAcrossFiles: an id declared in two files names both, rather than one
// silently winning.
func TestCatalogRefusesADuplicateAcrossFiles(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, "zz.json", `{"components": [`+catalogComponent("uv", "")+`]}`)

	_, err := LoadCatalog(dir)
	if err == nil {
		t.Fatalf("an id the embedded catalogue declares must be refused from a file")
	}
	if !strings.Contains(err.Error(), "zz.json") || !strings.Contains(err.Error(), `"uv"`) {
		t.Errorf("error = %q, want the id and both files named", err)
	}
}

// TestCatalogRefusesAnUnknownDependencyAcrossFiles: a file may require an embedded component, but
// not one nothing declares.
func TestCatalogRefusesAnUnknownDependencyAcrossFiles(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, "zz.json", `{"components": [`+catalogComponent("lonely", `"requires": ["nothing-like-this"], `)+`]}`)

	_, err := LoadCatalog(dir)
	if err == nil {
		t.Fatalf("a dependency nothing declares must be refused")
	}
	if !strings.Contains(err.Error(), "zz.json") {
		t.Errorf("error = %q, want the file named", err)
	}
}

// TestCatalogReadsNothingButTopLevelJSON: anything else in the directory — notes, an empty file,
// a subdirectory — is left alone, even when it is not JSON at all.
func TestCatalogReadsNothingButTopLevelJSON(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, "notes.txt", "{ this is not json")
	writeCatalog(t, dir, "empty.json", "{}")
	if err := os.Mkdir(filepath.Join(dir, "inner"), 0o755); err != nil {
		t.Fatalf("cannot stage a subdirectory: %v", err)
	}
	writeCatalog(t, dir, "inner/nested.json", "{ this is not json either")

	catalog, err := LoadCatalog(dir)
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	if _, ok := catalog.Get("uv"); !ok {
		t.Errorf("the embedded catalogue must still be there")
	}
	for _, s := range catalog.Sources() {
		if strings.Contains(s, "notes.txt") || strings.Contains(s, "nested.json") {
			t.Errorf("Sources = %v, want top-level *.json only", catalog.Sources())
		}
	}
}

// TestCatalogEmptyDirectoryIsTheEmbeddedCatalogue: a directory with nothing to merge changes
// nothing.
func TestCatalogEmptyDirectoryIsTheEmbeddedCatalogue(t *testing.T) {
	catalog, err := LoadCatalog(t.TempDir())
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	if _, ok := catalog.Get("uv"); !ok {
		t.Errorf("an empty directory must leave the embedded catalogue alone")
	}
	if got := catalog.Sources(); len(got) != 1 {
		t.Errorf("Sources = %v, want the embedded catalogue alone", got)
	}
}

// TestCatalogMissingDirectoryIsAnError: a named directory that is not there is a deployment
// mistake, and failing at startup names it rather than silently running a smaller catalogue.
func TestCatalogMissingDirectoryIsAnError(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-dir")
	if _, err := LoadCatalog(missing); err == nil {
		t.Errorf("a missing catalogue directory must be refused")
	} else if !strings.Contains(err.Error(), "no-such-dir") {
		t.Errorf("error = %q, want the directory named", err)
	}
}

// TestCatalogNamesTheFileItCannotParse: a broken file fails the load with its own name on the
// error, so the fix starts at the right file.
func TestCatalogNamesTheFileItCannotParse(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, "broken.json", "{oops")

	_, err := LoadCatalog(dir)
	if err == nil {
		t.Fatalf("a file that is not JSON must be refused")
	}
	if !strings.Contains(err.Error(), "broken.json") {
		t.Errorf("error = %q, want the file named", err)
	}
}
