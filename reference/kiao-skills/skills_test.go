package skills

import (
	"bufio"
	"encoding/json"
	"io/fs"
	"os"
	"strings"
	"testing"
)

// The bundle is embedded with `all:*`, so a skill added to this directory is picked up with no
// code change — and a directory that only looks like one is picked up too. This is the guard on
// that: what All returns has to be a real skill.
func TestAllReturnsTheSkillDirectories(t *testing.T) {
	found := All()
	if len(found) == 0 {
		t.Fatal("no skills embedded; the go:embed pattern is not matching this directory")
	}
	for _, skill := range found {
		if _, err := fs.Stat(skill.Files, Manifest); err != nil {
			t.Errorf("%s: no %s at the root of the skill: %v", skill.Name, Manifest, err)
		}
	}
}

// This package's own files are not skills, and neither is anything else that is not a directory
// with a SKILL.md in it.
func TestAllLeavesOutTheModuleItself(t *testing.T) {
	for _, skill := range All() {
		switch skill.Name {
		case "skills.go", "skills_test.go", "go.mod", "README.md":
			t.Errorf("%s is a file of this module, not a skill", skill.Name)
		}
	}
}

// The installer writes each skill to a directory named after Skill.Name, while Claude Code invokes
// it by the `name:` in its front matter. The two are only the same string because nobody has
// renamed one without the other — which is what this checks.
func TestSkillNameMatchesItsDirectory(t *testing.T) {
	for _, skill := range All() {
		declared := frontMatterName(t, skill)
		if declared == "" {
			t.Errorf("%s: no `name:` in the %s front matter", skill.Name, Manifest)
			continue
		}
		if declared != skill.Name {
			t.Errorf("%s: front matter says name: %q; a skill is invoked by that name but installed "+
				"under its directory name, so the two have to agree", skill.Name, declared)
		}
	}
}

// frontMatterName reads `name:` out of the leading `---` block of a SKILL.md.
func frontMatterName(t *testing.T, skill Skill) string {
	t.Helper()
	content, err := fs.ReadFile(skill.Files, Manifest)
	if err != nil {
		t.Fatalf("%s: cannot read %s: %v", skill.Name, Manifest, err)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(content)))
	open := false
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "---" {
			if open {
				return ""
			}
			open = true
			continue
		}
		if !open {
			return "" // content before the front matter: there is none
		}
		if rest, ok := strings.CutPrefix(line, "name:"); ok {
			return strings.TrimSpace(rest)
		}
	}
	return ""
}

// ── the plugin each skill belongs to ──────────────────────────────────────────

// pluginCataloguePath is the Dashboard plugin catalogue, from this package's directory. The two
// files are in one repository and the ids in pluginOf are ids of that list, so the coupling is
// real and checking it is cheaper than a store that silently stops getting a skill.
const pluginCataloguePath = "../../exchange/dashboard/src/plugins/catalogue.json"

// A skill is installed only where its plugin is on, so a skill that names no plugin is installed
// everywhere — which is the right way round for an oversight and the wrong one for a rule. This is
// what makes adding a directory here also a decision about which plugin it belongs to.
func TestEverySkillNamesItsPlugin(t *testing.T) {
	for _, skill := range All() {
		if skill.Plugin == "" {
			t.Errorf("%s names no plugin, so it is installed in every store; add it to pluginOf "+
				"in skills.go — a skill is the agent half of a plugin", skill.Name)
		}
	}
}

// And the other direction: an entry for a skill this bundle does not carry is a rename that was
// only half done, and it would sit here saying nothing.
func TestPluginOfNamesOnlySkillsThatExist(t *testing.T) {
	bundled := map[string]bool{}
	for _, skill := range All() {
		bundled[skill.Name] = true
	}
	for name := range pluginOf {
		if !bundled[name] {
			t.Errorf("pluginOf names %q, which is not a skill directory here", name)
		}
	}
}

// The id has to be one Dashboard actually carries — in the lot, or in a plugin project dropped
// into an assembly. A skill naming a plugin that has been renamed or dropped is not an error
// anywhere at run time — it is simply never installed again, in any store, silently. This is the
// one place that can say so.
func TestEveryPluginNamedIsInTheCatalogue(t *testing.T) {
	content, err := os.ReadFile(pluginCataloguePath)
	if err != nil {
		t.Fatalf("cannot read the plugin catalogue at %s: %v", pluginCataloguePath, err)
	}
	var catalogue []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(content, &catalogue); err != nil {
		t.Fatalf("cannot parse %s: %v", pluginCataloguePath, err)
	}
	known := map[string]bool{}
	for _, entry := range catalogue {
		known[entry.ID] = true
	}
	if len(known) == 0 {
		t.Fatalf("%s lists no plugin", pluginCataloguePath)
	}
	// Plugin ids delivered outside the lot, by dropped-in projects: the installer reads the
	// store's own list rather than the catalogue, so a skill naming one of these is installed
	// wherever the assembly carries that project. Listed here by hand because this package
	// cannot see those projects — a rename there has to be renamed here too, by the author.
	for _, id := range []string{"unit-edit"} {
		known[id] = true
	}
	for skill, plugin := range pluginOf {
		if !known[plugin] {
			t.Errorf("%s names the plugin %q, which %s does not carry; a renamed plugin has to be "+
				"renamed here too, or the skill is never installed again", skill, plugin, pluginCataloguePath)
		}
	}
}
