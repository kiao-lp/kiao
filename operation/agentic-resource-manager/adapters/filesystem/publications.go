package filesystem

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"maps"
	"slices"
	"strings"
	"time"

	"kiao/agentic-resource-manager/core/entities"
)

type publicationCache struct {
	agentID    string
	definition string
	tags       []releaseTag
	versions   map[releaseTag]*entities.AgentVersion
}

func (s *Store) cachedPublications(dir, id, definition string, tags []releaseTag) publicationCache {
	s.publicationsMu.Lock()
	defer s.publicationsMu.Unlock()
	previous := s.publications[dir]
	sameAgent := previous.agentID == id && previous.definition == definition
	if sameAgent && slices.Equal(previous.tags, tags) {
		return previous
	}
	cache := publicationCache{
		agentID: id, definition: definition, tags: tags,
		versions: make(map[releaseTag]*entities.AgentVersion),
	}
	if sameAgent {
		for _, tag := range tags {
			if version, ok := previous.versions[tag]; ok {
				cache.versions[tag] = version
			}
		}
	}
	s.publications[dir] = cache
	return cache
}

func (s *Store) publicationFromTag(ctx context.Context, dir string, cache publicationCache, tag releaseTag) (*entities.AgentVersion, error) {
	version, ok := cache.versions[tag]
	if !ok {
		var err error
		version, err = s.readPublication(ctx, dir, cache.agentID, cache.definition, tag)
		if err != nil {
			return nil, err
		}
		cache.versions[tag] = version
	}
	if version == nil {
		return nil, nil
	}
	result := *version
	result.Harnesses = slices.Clone(version.Harnesses)
	result.Supersedes = slices.Clone(version.Supersedes)
	result.Resources = maps.Clone(version.Resources)
	return &result, nil
}

func (s *Store) readPublication(ctx context.Context, dir, id, definition string, tag releaseTag) (*entities.AgentVersion, error) {
	const apmLock, kiaoLock = "apm.lock.yaml", "kiao.lock.json"
	tree, err := s.git(ctx, dir, "ls-tree", "-r", "--name-only", "-z", tag.object, "--", configurationFile, definitionsDirectory, apmLock, kiaoLock)
	if err != nil {
		return nil, err
	}
	files := strings.Split(string(tree), "\x00")
	if !slices.Contains(files, configurationFile) {
		return nil, nil
	}
	tagName := "v" + tag.version.String()
	load := func(name string) ([]byte, error) {
		return s.git(ctx, dir, "show", tag.object+":"+name)
	}
	a, err := readAgentMetadata(load, configurationFile+" at "+tagName, id)
	if err != nil || a == nil {
		return nil, err
	}
	var definitions []string
	for _, file := range files {
		if strings.HasPrefix(file, definitionsDirectory+"/") && strings.HasSuffix(file, definitionSuffix) {
			definitions = append(definitions, file)
		}
	}
	if len(definitions) == 1 {
		definition = definitions[0]
	}
	if err := readAgentDefinition(a, definition, load); err != nil {
		return nil, err
	}
	metadata, err := s.git(ctx, dir, "show", "-s", "--format=%H%x00%cI", tag.object+"^{commit}", "--")
	if err != nil {
		return nil, err
	}
	commit, stamp, _ := strings.Cut(strings.TrimSpace(string(metadata)), "\x00")
	at, err := time.Parse(time.RFC3339, stamp)
	if err != nil {
		return nil, err
	}
	version := a.Publish(tag.version.String(), at)
	version.Repository = a.Repository
	version.Commit = commit
	version.Tag = tagName
	if slices.Contains(files, apmLock) {
		data, err := load(apmLock)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(data)
		version.LockDigest = hex.EncodeToString(sum[:])
	}
	if slices.Contains(files, kiaoLock) {
		data, err := load(kiaoLock)
		if err != nil {
			return nil, err
		}
		var dependencies localLock
		if err := json.Unmarshal(data, &dependencies); err != nil {
			return nil, err
		}
		version.Resources = make(map[string]string)
		for _, resource := range dependencies.Resources {
			version.Resources[resource.Name] = resource.Commit
		}
	}
	return &version, nil
}

func (s *Store) loadPublication(ctx context.Context, dir, definition string, a *entities.Agent) error {
	tags, err := s.releaseTags(ctx, dir)
	if err != nil {
		return err
	}
	if manifest, err := readReleaseManifest(dir); err == nil {
		a.Version = manifest.base(tags).String()
	} else if a.DraftError == "" {
		a.DraftError = err.Error()
	}
	cache := s.cachedPublications(dir, a.ID, definition, tags)
	a.Published = nil
	for _, tag := range slices.Backward(tags) {
		a.Published, err = s.publicationFromTag(ctx, dir, cache, tag)
		if err != nil {
			return err
		}
		if a.Published != nil {
			break
		}
	}
	if a.Published == nil {
		a.HasUnpublishedChanges = true
		return nil
	}
	tracked, err := s.git(ctx, dir, "diff", "--name-only", a.Published.Commit, "--")
	if err != nil {
		return err
	}
	if len(tracked) > 0 {
		a.HasUnpublishedChanges = true
		return nil
	}
	untracked, err := s.git(ctx, dir, "ls-files", "--others", "--exclude-standard")
	a.HasUnpublishedChanges = len(untracked) > 0
	return err
}

func (s *Store) versions(ctx context.Context, dir, id string) ([]entities.AgentVersion, error) {
	tags, err := s.releaseTags(ctx, dir)
	if err != nil {
		return nil, err
	}
	cache := s.cachedPublications(dir, id, definitionFile(dir), tags)
	out := []entities.AgentVersion{}
	for _, tag := range tags {
		version, err := s.publicationFromTag(ctx, dir, cache, tag)
		if err != nil {
			return nil, err
		}
		if version != nil {
			out = append(out, *version)
		}
	}
	return out, nil
}

func (s *Store) AgentVersions(ctx context.Context, id string) ([]entities.AgentVersion, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, _, err := s.findMetadata(id)
	if err != nil {
		return nil, err
	}
	versions, err := s.versions(ctx, dir, id)
	if err != nil || len(versions) == 0 {
		return versions, err
	}
	if _, remote, err := s.remote(ctx, dir); err == nil {
		for i := range versions {
			versions[i].Repository = remote
		}
	}
	return versions, nil
}
