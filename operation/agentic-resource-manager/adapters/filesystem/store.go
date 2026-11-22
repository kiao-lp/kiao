package filesystem

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
	"kiao/agentic-resource-manager/core/entities"
	"kiao/agentic-resource-manager/core/ports"
)

const configurationFile = "agent.json"

func definitionFile(dir string) string {
	matches, _ := agentDefinitions(filepath.Join(dir, definitionsDirectory))
	if len(matches) == 1 {
		return definitionsDirectory + "/" + matches[0]
	}
	return definitionsDirectory + "/" + filepath.Base(dir) + definitionSuffix
}

type agentMetadata struct {
	ID         string             `json:"id"`
	Name       string             `json:"name"`
	Harness    entities.Harness   `json:"harness"`
	Harnesses  []entities.Harness `json:"harnesses,omitempty"`
	Supersedes []string           `json:"supersedes,omitempty"`
	ProfileID  string             `json:"profileId,omitempty"`
	CreatedAt  time.Time          `json:"createdAt"`
	UpdatedAt  time.Time          `json:"updatedAt"`
	Revision   int64              `json:"revision"`
}
type nativeAgent struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	Model       string `yaml:"model,omitempty"`
	Effort      string `yaml:"model_reasoning_effort,omitempty"`
}

func validRepositoryName(name string) bool {
	return name != "" && name != "." && name != ".." && name != ".cache" && !strings.HasPrefix(name, ".clone-") && !strings.ContainsAny(name, "/\\\x00") && filepath.VolumeName(name) == ""
}

// Store keeps drafts in working trees and publications in Git tags.
type Store struct {
	AgentRoot      string
	DependencyRoot string
	gitController  ports.GitController
	compiler       ports.Compiler
	cache          ports.PackageCache
	mu             sync.Mutex
}

var _ ports.AgentRepository = (*Store)(nil)

func New(agentRoot string, git ports.GitController, compiler ports.Compiler, cache ports.PackageCache) *Store {
	return &Store{AgentRoot: agentRoot, gitController: git, compiler: compiler, cache: cache}
}

func (s *Store) git(ctx context.Context, dir string, args ...string) ([]byte, error) {
	return s.gitController.Run(ctx, dir, args...)
}

func (s *Store) read(ctx context.Context, dir, ref, versionOf string) (*entities.Agent, error) {
	load := func(name string) ([]byte, error) {
		if ref == "" {
			return os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
		}
		return s.git(ctx, dir, "show", ref+":"+name)
	}
	data, err := load(configurationFile)
	if err != nil {
		return nil, err
	}
	var a entities.Agent
	err = json.Unmarshal(data, &a)
	if versionOf != "" && a.ID != versionOf {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", dir, err)
	}
	definition := definitionFile(dir)
	if ref != "" {
		files, e := s.git(ctx, dir, "ls-tree", "-r", "--name-only", ref, "--", definitionsDirectory)
		if e != nil {
			return nil, e
		}
		var matches []string
		for _, name := range strings.Split(strings.TrimSpace(string(files)), "\n") {
			if strings.HasSuffix(name, definitionSuffix) {
				matches = append(matches, name)
			}
		}
		if len(matches) == 1 {
			definition = matches[0]
		}
	}
	data, err = load(definition)
	var native nativeAgent
	var body string
	if err == nil {
		var front string
		var ok bool
		front, body, ok = strings.Cut(strings.TrimPrefix(string(data), "---\n"), "\n---\n")
		if !ok {
			err = fmt.Errorf("agent definition requires YAML front matter")
		} else {
			err = yaml.Unmarshal([]byte(front), &native)
		}
	}
	if err != nil {
		if ref != "" {
			return nil, err
		}
		a.DraftError = err.Error()
	} else {
		a.Model, a.Effort, a.Description, a.Instructions = native.Model, native.Effort, native.Description, strings.TrimSpace(body)
	}
	a.Project = filepath.Base(dir)
	if _, remote, err := s.remote(ctx, dir); err == nil {
		a.Repository = remote
	}
	if a.ID == "" || a.Name == "" {
		return nil, fmt.Errorf("%s: agent id and name are required", dir)
	}
	if _, ok := entities.ReadHarness(string(a.Harness)); !ok {
		return nil, fmt.Errorf("%s: unsupported harness %q", dir, a.Harness)
	}
	if len(a.Harnesses) != 0 {
		seen := map[entities.Harness]bool{}
		for _, harness := range a.Harnesses {
			if name, ok := entities.ReadHarness(string(harness)); !ok || name != harness || seen[harness] {
				return nil, fmt.Errorf("%s: invalid or repeated harness %q", dir, harness)
			}
			seen[harness] = true
		}
		if !slices.Contains(a.Harnesses, a.Harness) {
			return nil, fmt.Errorf("%s: the default harness must be in harnesses", dir)
		}
		if a.DraftError == "" && (a.Model != "" || a.ProfileID != "") {
			err := fmt.Errorf("%s: agents with multiple harnesses use the selected harness model and profile", dir)
			if ref != "" {
				return nil, err
			}
			a.DraftError = err.Error()
		}
	}
	return &a, nil
}

func write(dir, definition string, a *entities.Agent) error {
	path := filepath.Join(dir, filepath.FromSlash(definition))
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	metadata := agentMetadata{ID: a.ID, Name: a.Name, Harness: a.Harness, Harnesses: a.Harnesses, Supersedes: a.Supersedes,
		ProfileID: a.ProfileID, CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt, Revision: a.Revision}
	data, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	if err = atomicWrite(filepath.Join(dir, configurationFile), append(data, '\n')); err != nil {
		return err
	}
	front, err := yaml.Marshal(nativeAgent{Name: strings.TrimSuffix(filepath.Base(definition), definitionSuffix), Description: a.Description, Model: a.Model, Effort: a.Effort})
	if err != nil {
		return err
	}
	return atomicWrite(path, []byte("---\n"+string(front)+"---\n"+a.Instructions+"\n"))
}

func atomicWrite(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".draft-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Chmod(0644)
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), path)
}

func (s *Store) directories() ([]string, error) {
	entries, err := os.ReadDir(s.AgentRoot)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var dirs []string
	for _, entry := range entries {
		if !entry.IsDir() || !validRepositoryName(entry.Name()) {
			continue
		}
		dir := filepath.Join(s.AgentRoot, entry.Name())
		if _, err := os.Stat(filepath.Join(dir, configurationFile)); err != nil {
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
			continue
		}
		dirs = append(dirs, dir)
	}
	return dirs, nil
}

func (s *Store) list(ctx context.Context) ([]entities.Agent, error) {
	dirs, err := s.directories()
	if err != nil {
		return nil, err
	}
	out := []entities.Agent{}
	ids := map[string]bool{}
	names := map[string]bool{}
	for _, dir := range dirs {
		a, err := s.read(ctx, dir, "", "")
		if err != nil {
			return nil, err
		}
		if ids[a.ID] || names[strings.ToLower(a.Name)] {
			return nil, fmt.Errorf("duplicate agent identity or name in %s", dir)
		}
		ids[a.ID] = true
		names[strings.ToLower(a.Name)] = true
		if err := s.loadPublication(ctx, dir, a); err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

func (s *Store) find(ctx context.Context, id string) (string, *entities.Agent, error) {
	dirs, err := s.directories()
	if err != nil {
		return "", nil, err
	}
	for _, dir := range dirs {
		a, err := s.read(ctx, dir, "", "")
		if err != nil {
			return "", nil, err
		}
		if a.ID == id {
			if err := s.loadPublication(ctx, dir, a); err != nil {
				return "", nil, err
			}
			return dir, a, nil
		}
	}
	return "", nil, entities.NotFoundf("agent %s", id)
}

func (s *Store) ListAgents(ctx context.Context) ([]entities.Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.list(ctx)
}
func (s *Store) FindAgent(ctx context.Context, id string) (*entities.Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, a, err := s.find(ctx, id)
	return a, err
}

func (s *Store) CreateAgent(ctx context.Context, a *entities.Agent, actor string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.AgentRoot == "" {
		return errors.New("no agentic resource directory configured")
	}
	list, err := s.list(ctx)
	if err != nil {
		return err
	}
	for _, one := range list {
		if strings.EqualFold(one.Name, a.Name) {
			return entities.ErrAgentNameTaken
		}
	}
	slug := agentSlug(a.Name, a.ID)
	dir := filepath.Join(s.AgentRoot, slug)
	if err := os.MkdirAll(filepath.Dir(dir), 0755); err != nil {
		return err
	}
	if err = os.Mkdir(dir, 0755); err != nil {
		return err
	}
	if _, err = s.git(ctx, dir, "init", "-b", "main"); err != nil {
		return err
	}
	if _, err = initializeAgentFiles(dir, slug, a); err != nil {
		return err
	}
	a.Repository = slug
	a.Version = initialDraftVersion
	a.HasUnpublishedChanges = true
	return nil
}

func (s *Store) PatchAgent(ctx context.Context, id string, p entities.AgentPatch, expected *int64, actor string) (*entities.Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, a, err := s.find(ctx, id)
	if err != nil {
		return nil, err
	}
	if expected != nil && *expected != a.Revision {
		return nil, entities.Conflictf("agent %s is at revision %d", id, a.Revision)
	}
	if len(a.Harnesses) != 0 && ((p.Harness != nil && !slices.Contains(a.Harnesses, *p.Harness)) ||
		(p.Model != nil && *p.Model != "") || (p.ProfileID != nil && *p.ProfileID != "")) {
		return nil, entities.Invalidf("select a model and profile on the worker for agents with multiple harnesses")
	}
	if a.DraftError != "" {
		return nil, entities.Invalidf("repair the APM source before editing this draft: %s", a.DraftError)
	}
	original := *a
	if p.Name != nil {
		list, err := s.list(ctx)
		if err != nil {
			return nil, err
		}
		for _, one := range list {
			if one.ID != id && strings.EqualFold(one.Name, *p.Name) {
				return nil, entities.ErrAgentNameTaken
			}
		}
		a.Name = *p.Name
	}
	if p.Harness != nil {
		a.Harness = *p.Harness
	}
	if p.Model != nil {
		a.Model = *p.Model
	}
	if p.Effort != nil {
		a.Effort = *p.Effort
	}
	if p.ProfileID != nil {
		a.ProfileID = *p.ProfileID
	}
	if p.Description != nil {
		a.Description = *p.Description
	}
	if p.Instructions != nil {
		a.Instructions = *p.Instructions
	}
	if reflect.DeepEqual(*a, original) {
		return a, nil
	}
	a.Revision++
	a.UpdatedAt = time.Now().UTC()
	if err = write(dir, definitionFile(dir), a); err != nil {
		return nil, err
	}
	a.HasUnpublishedChanges = true
	return a, nil
}

func (s *Store) PublishAgent(ctx context.Context, id string, expected *int64, at time.Time, actor, confirmation string, bump entities.ReleaseBump) (*entities.Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, a, err := s.find(ctx, id)
	if err != nil {
		return nil, err
	}
	if expected != nil && *expected != a.Revision {
		return nil, entities.Conflictf("agent %s is at revision %d", id, a.Revision)
	}
	if a.DraftError != "" {
		return nil, entities.Invalidf("invalid APM draft: %s", a.DraftError)
	}
	if !a.HasUnpublishedChanges {
		return nil, entities.Conflictf("the agent repository has no changes since %s", a.Published.Tag)
	}
	if len(a.Harnesses) == 0 && a.Harness != entities.HarnessPi && (strings.TrimSpace(a.Model) == "" || strings.TrimSpace(a.Effort) == "") {
		return nil, entities.Invalidf("publication requires an explicit model and default effort")
	}
	tags, err := s.releaseTags(ctx, dir)
	if err != nil {
		return nil, err
	}
	manifest, err := readReleaseManifest(dir)
	if err != nil {
		return nil, err
	}
	version, err := manifest.base(tags).Bump(bump)
	if err != nil {
		return nil, err
	}
	tag := "v" + version.String()
	remoteName, remoteURL, err := s.remote(ctx, dir)
	if err != nil {
		return nil, err
	}
	if err = s.checkDraftPublication(ctx, dir, remoteURL, tag, confirmation); err != nil {
		return nil, err
	}
	err = s.commitRelease(ctx, dir, manifest, version, "", func() error {
		if err := s.lockLocalDependencies(ctx, dir); err != nil {
			return err
		}
		if err := clearManagedSkillProjections(dir); err != nil {
			return err
		}
		if _, err := s.compiler.Run(ctx, dir, "install", "--trust-transitive-mcp"); err != nil {
			return err
		}
		if _, err := installedAPMLock(dir); err != nil {
			return err
		}
		if err := s.compileAgent(ctx, dir, a); err != nil {
			return err
		}
		if err := s.keepSkillProjectionsLocal(ctx, dir); err != nil {
			return err
		}
		a.Revision++
		a.UpdatedAt = at
		return write(dir, definitionFile(dir), a)
	})
	if err != nil {
		return nil, err
	}
	if remoteName != "" {
		if _, err = s.git(ctx, dir, "push", "--atomic", remoteName, "HEAD", "refs/tags/"+tag); err != nil {
			return nil, entities.Conflictf("release %s exists locally; Git push failed: %s", tag, err)
		}
	}
	_, a, err = s.find(ctx, id)
	return a, err
}

func (s *Store) loadPublication(ctx context.Context, dir string, a *entities.Agent) error {
	tags, err := s.releaseTags(ctx, dir)
	if err != nil {
		return err
	}
	if manifest, err := readReleaseManifest(dir); err == nil {
		a.Version = manifest.base(tags).String()
	} else if a.DraftError == "" {
		a.DraftError = err.Error()
	}
	versions, err := s.versionsFromTags(ctx, dir, a.ID, tags)
	if err != nil {
		return err
	}
	if len(versions) == 0 {
		a.Published = nil
		a.HasUnpublishedChanges = true
		return nil
	}
	a.Published = &versions[len(versions)-1]
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
	return s.versionsFromTags(ctx, dir, id, tags)
}

func (s *Store) versionsFromTags(ctx context.Context, dir, id string, tags []entities.ReleaseVersion) ([]entities.AgentVersion, error) {
	out := []entities.AgentVersion{}
	for _, version := range tags {
		tag := "v" + version.String()
		ref := "refs/tags/" + tag
		files, err := s.git(ctx, dir, "ls-tree", "--name-only", ref, "--", configurationFile)
		if err != nil {
			return nil, err
		}
		if len(files) == 0 {
			continue
		}
		a, err := s.read(ctx, dir, ref, id)
		if err != nil {
			return nil, err
		}
		if a == nil {
			continue
		}
		commit, err := s.git(ctx, dir, "rev-parse", ref+"^{commit}")
		if err != nil {
			return nil, err
		}
		stamp, err := s.git(ctx, dir, "show", "-s", "--format=%cI", ref+"^{commit}")
		if err != nil {
			return nil, err
		}
		at, err := time.Parse(time.RFC3339, strings.TrimSpace(string(stamp)))
		if err != nil {
			return nil, err
		}
		v := a.Publish(version.String(), at)
		v.Repository = a.Repository
		v.Commit = strings.TrimSpace(string(commit))
		v.Tag = tag
		lock, err := s.git(ctx, dir, "show", ref+":apm.lock.yaml")
		if err == nil {
			sum := sha256.Sum256(lock)
			v.LockDigest = hex.EncodeToString(sum[:])
		}
		if data, e := s.git(ctx, dir, "show", ref+":kiao.lock.json"); e == nil {
			var dependencies localLock
			if e = json.Unmarshal(data, &dependencies); e != nil {
				return nil, e
			}
			v.Resources = map[string]string{}
			for _, resource := range dependencies.Resources {
				v.Resources[resource.Name] = resource.Commit
			}
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *Store) AgentVersions(ctx context.Context, id string) ([]entities.AgentVersion, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, _, err := s.find(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.versions(ctx, dir, id)
}
func (s *Store) DeleteAgent(ctx context.Context, id, confirmation, actor string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, _, err := s.find(ctx, id)
	if err != nil {
		return err
	}
	status, err := s.deletionStatus(ctx, dir)
	if err != nil {
		return err
	}
	if confirmation == "" || confirmation != status.Confirmation {
		return entities.Conflictf("confirm deletion using the current repository status")
	}
	return os.RemoveAll(dir)
}
