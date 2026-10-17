// Package skills embeds plugin-gated agent skills for installation into each store.
// Embedding keeps skills with the binary across all launch modes.
package skills

import (
	"embed"
	"io/fs"
)

// all: includes dotfiles; All filters out directories without SKILL.md.
//go:embed all:*
var embedded embed.FS

// Manifest identifies a skill directory and supplies CLI front matter.
const Manifest = "SKILL.md"

// Skill is a bundled skill directory.
type Skill struct {
	// Name is both the directory and invocation name.
	Name string
	// Plugin is the Dashboard catalogue id; empty means ungated.
	Plugin string
	// Files is rooted at the skill directory, with Manifest at its top.
	Files fs.FS
}

// Missing mappings are ungated; tests require each skill to map to a known plugin.
// Multiple skills may share a plugin.
var pluginOf = map[string]string{
	"actlog":        "activity-log",
	"archdia":       "archdia-edit",
	"template-lang": "template-edit",
	"featmat":       "featmat-view",
	"graph":         "graph-edit",
	"mindmap":       "mindmap-edit",
	"mlunit":        "unit-edit",
	"passage-link":  "markdown-edit",
	"strategy":      "graph-edit",
	"hybridflow":    "hybridflow-ui",
}

// All returns skills sorted by name, excluding directories without Manifest.
func All() []Skill {
	entries, err := fs.ReadDir(embedded, ".")
	if err != nil {
		// The embedded root cannot fail to open at runtime.
		return nil
	}
	var found []Skill
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		sub, err := fs.Sub(embedded, entry.Name())
		if err != nil {
			continue
		}
		if _, err := fs.Stat(sub, Manifest); err != nil {
			continue
		}
		found = append(found, Skill{Name: entry.Name(), Plugin: pluginOf[entry.Name()], Files: sub})
	}
	return found
}
