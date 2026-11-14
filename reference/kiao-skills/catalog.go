package skills

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// CatalogManifest declares an assembly's additional skills, relative to its directory.
const CatalogManifest = "skills.json"

type catalogEntry struct {
	Name   string `json:"name"`
	Plugin string `json:"plugin"`
	Source string `json:"source"`
}

var skillName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// Load composes the embedded catalogue with one optional assembly directory.
// An empty path selects only embedded skills. A configured directory must contain
// skills.json with an explicit skills array ([] deliberately removes all additions).
// Names cannot override an embedded or additional skill. Any invalid or unreadable
// source rejects the whole catalogue, so callers must keep the previous install.
func Load(dir string) ([]Skill, error) {
	found := All()
	if dir == "" {
		return found, nil
	}
	if !filepath.IsAbs(dir) {
		return nil, fmt.Errorf("skills source directory %q must be absolute", dir)
	}
	manifest := filepath.Join(dir, CatalogManifest)
	data, err := os.ReadFile(manifest)
	if err != nil {
		return nil, fmt.Errorf("reading skills catalogue %s: %w", manifest, err)
	}
	var doc struct {
		Skills *[]catalogEntry `json:"skills"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&doc); err != nil {
		return nil, fmt.Errorf("parsing skills catalogue %s: %w", manifest, err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("skills catalogue %s must contain one JSON document", manifest)
	}
	if doc.Skills == nil {
		return nil, fmt.Errorf("skills catalogue %s must declare a skills array", manifest)
	}
	known := make(map[string]string, len(found))
	for _, skill := range found {
		known[skill.Name] = "embedded catalogue"
	}
	for _, entry := range *doc.Skills {
		if !skillName.MatchString(entry.Name) {
			return nil, fmt.Errorf("skills catalogue %s: invalid name %q", manifest, entry.Name)
		}
		if first, exists := known[entry.Name]; exists {
			return nil, fmt.Errorf("skill %q declared twice (%s and %s)", entry.Name, first, manifest)
		}
		known[entry.Name] = manifest
		if strings.TrimSpace(entry.Plugin) == "" || entry.Plugin != strings.TrimSpace(entry.Plugin) {
			return nil, fmt.Errorf("skill %q in %s must name a plugin", entry.Name, manifest)
		}
		if strings.TrimSpace(entry.Source) == "" || entry.Source != strings.TrimSpace(entry.Source) || strings.ContainsAny(entry.Source, "\r\n") {
			return nil, fmt.Errorf("skill %q in %s must name its master source on one line", entry.Name, manifest)
		}
		path := filepath.Join(dir, entry.Name)
		info, err := os.Lstat(path)
		if err != nil {
			return nil, fmt.Errorf("reading skill %s: %w", path, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("skill %s must be a directory, not a symlink or file", path)
		}
		tree := os.DirFS(path)
		// Check every file before any installation or pruning, including companions.
		// Symlinks and special files are not a portable skill resource tree.
		if err := fs.WalkDir(tree, ".", func(name string, file fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if name == ".kiao-skill" {
				return fmt.Errorf("%s is reserved for the installation marker", name)
			}
			if file.IsDir() {
				return nil
			}
			if !file.Type().IsRegular() {
				return fmt.Errorf("%s is not a regular source file", name)
			}
			_, err = fs.ReadFile(tree, name)
			return err
		}); err != nil {
			return nil, fmt.Errorf("reading skill %s: %w", path, err)
		}
		content, err := fs.ReadFile(tree, Manifest)
		if err != nil {
			return nil, fmt.Errorf("reading skill %s/%s: %w", path, Manifest, err)
		}
		if manifestName(content) != entry.Name {
			return nil, fmt.Errorf("skill %s/%s: front matter name must be %q", path, Manifest, entry.Name)
		}
		found = append(found, Skill{
			Name: entry.Name, Plugin: entry.Plugin, Source: entry.Source, Files: tree,
		})
	}
	sort.Slice(found, func(i, j int) bool { return found[i].Name < found[j].Name })
	return found, nil
}

// Only the flat name field is needed; the CLI owns the rest of the skill front matter.
func manifestName(content []byte) string {
	text := strings.ReplaceAll(string(content), "\r\n", "\n")
	body, ok := strings.CutPrefix(text, "---\n")
	if !ok {
		return ""
	}
	front, _, ok := strings.Cut(body, "\n---\n")
	if !ok {
		return ""
	}
	for _, line := range strings.Split(front, "\n") {
		if name, ok := strings.CutPrefix(line, "name:"); ok {
			return strings.Trim(strings.TrimSpace(name), `"'`)
		}
	}
	return ""
}
