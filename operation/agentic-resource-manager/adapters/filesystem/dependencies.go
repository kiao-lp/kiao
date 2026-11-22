package filesystem

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
	"kiao/agentic-resource-manager/core/entities"
)

type dependencyRepository struct {
	path   string
	remote string
}

func (s *Store) ListAgentDependencies(ctx context.Context, id string, kind entities.AgentDependencyKind) ([]entities.AgentDependency, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, _, err := s.find(ctx, id)
	if err != nil {
		return nil, err
	}
	_, dependencies, err := readDependencyManifest(dir)
	if err != nil {
		return nil, err
	}
	available, err := s.availableDependencies(ctx, kind)
	if err != nil {
		return nil, err
	}
	_, overrides, err := s.dependencyOverrides(ctx, dir)
	if err != nil {
		return nil, err
	}
	links := make(map[string]entities.AgentDependency, len(available))
	for name, repo := range available {
		links[name] = entities.AgentDependency{Name: name, Available: true, HasRemote: repo.remote != ""}
	}
	for _, dependency := range dependencies.Content {
		name := linkedDependencyName(dir, dependency, kind, available)
		if name == "" {
			continue
		}
		link := links[name]
		link.Name, link.Linked = name, true
		link.HasRemote = link.HasRemote || gitDependencyReference(dependency) != ""
		link.Local = link.HasRemote && slices.Contains(overrides, name)
		links[name] = link
	}
	result := make([]entities.AgentDependency, 0, len(links))
	for _, link := range links {
		result = append(result, link)
	}
	slices.SortFunc(result, func(a, b entities.AgentDependency) int { return strings.Compare(a.Name, b.Name) })
	return result, nil
}

func (s *Store) SetAgentDependency(ctx context.Context, id string, kind entities.AgentDependencyKind, name string, linked, local bool) error {
	if !dependencyRepositoryName(name, kind) {
		return entities.Invalidf("invalid %s repository name", kind)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, _, err := s.find(ctx, id)
	if err != nil {
		return err
	}
	document, dependencies, err := readDependencyManifest(dir)
	if err != nil {
		return err
	}
	available, err := s.availableDependencies(ctx, kind)
	if err != nil {
		return err
	}
	overridePath, overrides, err := s.dependencyOverrides(ctx, dir)
	if err != nil {
		return err
	}
	index := slices.IndexFunc(dependencies.Content, func(dep *yaml.Node) bool {
		return linkedDependencyName(dir, dep, kind, available) == name
	})
	changed := false
	if linked {
		repo, ready := available[name]
		if !ready && (index < 0 || local) {
			return entities.NotFoundf("no local clone of %s", name)
		}
		if local && repo.remote == "" {
			return entities.Invalidf("%s has no remote; its link already uses the local repository", name)
		}
		switch {
		case index < 0:
			if repo.remote != "" {
				dependencies.Content = append(dependencies.Content, dependencyWithSource(nil, "git", repo.remote))
			} else {
				relative, err := relativeDependencyPath(dir, repo.path)
				if err != nil {
					return err
				}
				dependencies.Content = append(dependencies.Content, dependencyWithSource(nil, "path", relative))
			}
			changed = true
		case repo.remote != "" && gitDependencyReference(dependencies.Content[index]) == "":
			dependencies.Content[index] = dependencyWithSource(dependencies.Content[index], "git", repo.remote)
			changed = true
		}
	} else if index >= 0 {
		dependencies.Content = slices.DeleteFunc(dependencies.Content, func(dep *yaml.Node) bool {
			return linkedDependencyName(dir, dep, kind, available) == name
		})
		changed = true
	}
	if changed {
		content, err := yaml.Marshal(document)
		if err != nil {
			return err
		}
		if err = yaml.Unmarshal(content, new(map[string]any)); err != nil {
			return entities.Invalidf("the dependency change would invalidate %s: %s", manifestFile, err)
		}
		if err = atomicWrite(filepath.Join(dir, manifestFile), content); err != nil {
			return err
		}
	}
	wasLocal := slices.Contains(overrides, name)
	if local == wasLocal {
		return nil
	}
	if local {
		overrides = append(overrides, name)
		slices.Sort(overrides)
	} else {
		overrides = slices.DeleteFunc(overrides, func(override string) bool { return override == name })
	}
	data, err := json.Marshal(overrides)
	if err != nil {
		return err
	}
	return atomicWrite(overridePath, append(data, '\n'))
}

func (s *Store) dependencyOverrides(ctx context.Context, dir string) (string, []string, error) {
	out, err := s.git(ctx, dir, "rev-parse", "--path-format=absolute", "--git-path", "kiao-local-dependencies.json")
	if err != nil {
		return "", nil, err
	}
	path := strings.TrimSpace(string(out))
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return path, nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	var overrides []string
	if err = json.Unmarshal(data, &overrides); err != nil {
		return "", nil, err
	}
	return path, overrides, nil
}

func (s *Store) activeDependencyOverrides(ctx context.Context, dir string, dependencies *yaml.Node, overrides []string) (map[*yaml.Node]string, error) {
	active := map[*yaml.Node]string{}
	for _, name := range overrides {
		prefix, _, _ := strings.Cut(name, "-")
		kind := entities.AgentDependencyKind(prefix)
		if (kind != entities.AgentSkill && kind != entities.AgentMCP) || !dependencyRepositoryName(name, kind) {
			return nil, entities.Invalidf("invalid local dependency override %q", name)
		}
		available := map[string]dependencyRepository{}
		source, err := s.resource(name)
		if err == nil {
			remote, err := s.dependencyRemote(ctx, source)
			if err != nil {
				return nil, err
			}
			if remote == "" {
				continue
			}
			available[name] = dependencyRepository{path: source, remote: remote}
		} else if !errors.Is(err, entities.ErrNotFound) {
			return nil, err
		}
		for _, dep := range dependencies.Content {
			if linkedDependencyName(dir, dep, kind, available) == name {
				active[dep] = name
			}
		}
	}
	return active, nil
}

func relativeDependencyPath(project, source string) (string, error) {
	project, err := filepath.Abs(project)
	if err != nil {
		return "", err
	}
	source, err = filepath.Abs(source)
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(project, source)
	if err != nil {
		return "", err
	}
	relative = filepath.ToSlash(relative)
	if !strings.HasPrefix(relative, "../") {
		relative = "./" + relative
	}
	return relative, nil
}

func dependencyWithSource(node *yaml.Node, key, value string) *yaml.Node {
	scalar := func(value string) *yaml.Node { return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value} }
	newDependency := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map", Content: []*yaml.Node{scalar(key), scalar(value)}}
	if node == nil {
		return newDependency
	}
	if node.Kind == yaml.MappingNode {
		for i := 0; i < len(node.Content); i += 2 {
			switch node.Content[i].Value {
			case "alias", "skills", "targets":
				newDependency.Content = append(newDependency.Content, node.Content[i:i+2]...)
			}
		}
	} else if _, alias := splitGitAlias(gitDependencyReference(node)); alias != "" {
		newDependency.Content = append(newDependency.Content, scalar("alias"), scalar(alias))
	}
	newDependency.HeadComment, newDependency.LineComment, newDependency.FootComment = node.HeadComment, node.LineComment, node.FootComment
	return newDependency
}

func linkedDependencyName(project string, dep *yaml.Node, kind entities.AgentDependencyKind, available map[string]dependencyRepository) string {
	if name := localDependencyName(project, dep, kind); name != "" {
		return name
	}
	identity := gitDependencyIdentity(gitDependencyReference(dep))
	if identity == "" {
		return ""
	}
	for name, repo := range available {
		if gitDependencyIdentity(repo.remote) == identity {
			return name
		}
	}
	name := filepath.Base(identity)
	if _, present := available[name]; !present && dependencyRepositoryName(name, kind) {
		return name
	}
	return ""
}

func gitDependencyReference(node *yaml.Node) string {
	var dependency any
	if node.Decode(&dependency) != nil {
		return ""
	}
	switch value := dependency.(type) {
	case string:
		if localAPMDependencyPath(value) == "" {
			return value
		}
	case map[string]any:
		git, _ := value["git"].(string)
		if value["path"] == nil && git != "parent" {
			return git
		}
	}
	return ""
}

func splitGitAlias(ref string) (string, string) {
	if at := strings.LastIndexByte(ref, '@'); at > strings.LastIndexAny(ref, "/:") {
		return ref[:at], ref[at+1:]
	}
	return ref, ""
}

// APM accepts Git shortcuts as well as HTTPS and SSH URLs for the same repository.
func gitDependencyIdentity(ref string) string {
	ref, _ = splitGitAlias(ref)
	ref, _, _ = strings.Cut(ref, "#")
	if ref == "" || strings.HasPrefix(ref, "registry:") {
		return ""
	}
	switch {
	case strings.Contains(ref, "://"):
		u, err := url.Parse(ref)
		if err != nil {
			return ""
		}
		ref = strings.ToLower(u.Host) + u.Path
	case strings.Contains(ref, ":"):
		host, path, _ := strings.Cut(ref, ":")
		if _, h, ok := strings.Cut(host, "@"); ok {
			host = h
		}
		ref = strings.ToLower(host) + "/" + strings.TrimLeft(path, "/")
	default:
		host, path, ok := strings.Cut(ref, "/")
		if !ok || path == "" {
			return ""
		}
		if !strings.Contains(host, ".") && !filepath.IsAbs(ref) {
			ref = "github.com/" + ref
		}
	}
	return strings.TrimSuffix(strings.TrimRight(ref, "/"), ".git")
}

func dependencyRepositoryName(name string, kind entities.AgentDependencyKind) bool {
	prefix := string(kind) + "-"
	return validRepositoryName(name) && strings.HasPrefix(name, prefix) && len(name) > len(prefix)
}

func hasDependencySources(dir string, kind entities.AgentDependencyKind) bool {
	info, err := os.Lstat(filepath.Join(dir, manifestFile))
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	if kind != entities.AgentSkill {
		return true
	}
	info, err = os.Lstat(filepath.Join(dir, "SKILL.md"))
	return err == nil && info.Mode().IsRegular()
}

func isDependencyRepository(dir string, kind entities.AgentDependencyKind) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil && !isAgentDirectory(dir) && hasDependencySources(dir, kind)
}

func (s *Store) availableDependencies(ctx context.Context, kind entities.AgentDependencyKind) (map[string]dependencyRepository, error) {
	available := map[string]dependencyRepository{}
	for _, root := range s.resourceRoots() {
		entries, err := os.ReadDir(root)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			name := entry.Name()
			if entry.IsDir() && dependencyRepositoryName(name, kind) && isDependencyRepository(filepath.Join(root, name), kind) {
				dir, err := s.resource(name)
				if err != nil {
					return nil, err
				}
				remote, err := s.dependencyRemote(ctx, dir)
				if err != nil {
					return nil, err
				}
				available[name] = dependencyRepository{path: dir, remote: remote}
			}
		}
	}
	return available, nil
}

func localDependencyName(project string, node *yaml.Node, kind entities.AgentDependencyKind) string {
	var dependency any
	if node.Decode(&dependency) != nil {
		return ""
	}
	relative := filepath.Clean(localAPMDependencyPath(dependency))
	name := filepath.Base(relative)
	if filepath.IsAbs(relative) || !dependencyRepositoryName(name, kind) {
		return ""
	}
	if strings.HasPrefix(relative, ".."+string(filepath.Separator)) ||
		relative == filepath.Join(".apm", "resources", name) || hasDependencySources(filepath.Join(project, relative), kind) {
		return name
	}
	return ""
}

func readDependencyManifest(dir string) (*yaml.Node, *yaml.Node, error) {
	path, err := resourceFile(dir, manifestFile)
	if err != nil {
		return nil, nil, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil, entities.NotFoundf("agent draft has no %s", manifestFile)
	}
	if err != nil {
		return nil, nil, err
	}
	return parseDependencyManifest(data)
}

func parseDependencyManifest(data []byte) (*yaml.Node, *yaml.Node, error) {
	document, _, err := parseAPMManifest(data)
	if err != nil {
		return nil, nil, err
	}
	dependencies, err := manifestEntry(document.Content[0], "dependencies", yaml.MappingNode, "!!map")
	if err != nil {
		return nil, nil, err
	}
	apm, err := manifestEntry(dependencies, "apm", yaml.SequenceNode, "!!seq")
	return document, apm, err
}

func parseAPMManifest(data []byte) (*yaml.Node, map[string]any, error) {
	var document yaml.Node
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&document); err != nil || len(document.Content) != 1 || document.Content[0].Kind != yaml.MappingNode {
		return nil, nil, entities.Invalidf("%s must contain an APM manifest", manifestFile)
	}
	if err := decoder.Decode(new(yaml.Node)); err != io.EOF {
		return nil, nil, entities.Invalidf("%s must contain one YAML document", manifestFile)
	}
	var fields map[string]any
	if err := document.Decode(&fields); err != nil {
		return nil, nil, entities.Invalidf("invalid %s: %s", manifestFile, err)
	}
	return &document, fields, nil
}

func manifestEntry(parent *yaml.Node, key string, kind yaml.Kind, tag string) (*yaml.Node, error) {
	merged := false
	for i := 0; i < len(parent.Content); i += 2 {
		name, value := parent.Content[i], parent.Content[i+1]
		if name.ShortTag() == "!!merge" {
			merged = true
		}
		if name.Value == key {
			if value.ShortTag() == "!!null" {
				value.Kind, value.Tag, value.Value = kind, tag, ""
			}
			if value.Kind != kind || value.Anchor != "" {
				return nil, entities.Invalidf("declare %s directly in %s to manage dependencies", key, manifestFile)
			}
			return value, nil
		}
	}
	if merged {
		return nil, entities.Invalidf("declare %s directly in %s to manage dependencies", key, manifestFile)
	}
	value := &yaml.Node{Kind: kind, Tag: tag}
	parent.Content = append(parent.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, value)
	return value, nil
}
