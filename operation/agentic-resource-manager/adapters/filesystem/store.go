package filesystem

import (
	"context"
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
const concurrentAgentReads = 8

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
	publicationsMu sync.Mutex // Serializes cache map updates among catalogue readers.
	publications   map[string]publicationCache
}

var _ ports.AgentRepository = (*Store)(nil)

func New(agentRoot string, git ports.GitController, compiler ports.Compiler, cache ports.PackageCache) *Store {
	return &Store{AgentRoot: agentRoot, gitController: git, compiler: compiler, cache: cache, publications: make(map[string]publicationCache)}
}

func (s *Store) git(ctx context.Context, dir string, args ...string) ([]byte, error) {
	return s.gitController.Run(ctx, dir, args...)
}

func readAgentMetadata(load func(string) ([]byte, error), source, versionOf string) (*entities.Agent, error) {
	data, err := load(configurationFile)
	if err != nil {
		return nil, &entities.OperationError{Message: "Could not read " + source + ". Check that it exists and is readable.", Cause: err}
	}
	var a entities.Agent
	err = json.Unmarshal(data, &a)
	if versionOf != "" && a.ID != versionOf {
		return nil, nil
	}
	if err != nil {
		return nil, &entities.OperationError{Message: "Fix the JSON in " + source + ".", Cause: err}
	}
	if a.ID == "" || a.Name == "" {
		return nil, entities.Invalidf("Set both id and name in %s.", source)
	}
	if _, ok := entities.ReadHarness(string(a.Harness)); !ok {
		return nil, entities.Invalidf("Set harness in %s to claude, codex, muse or pi.", source)
	}
	if len(a.Harnesses) != 0 {
		seen := map[entities.Harness]bool{}
		for _, harness := range a.Harnesses {
			if name, ok := entities.ReadHarness(string(harness)); !ok || name != harness || seen[harness] {
				return nil, entities.Invalidf("Use distinct supported entries in harnesses in %s.", source)
			}
			seen[harness] = true
		}
		if !slices.Contains(a.Harnesses, a.Harness) {
			return nil, entities.Invalidf("Include the default harness in harnesses in %s.", source)
		}
	}
	return &a, nil
}

func readAgentDefinition(a *entities.Agent, definition string, load func(string) ([]byte, error)) error {
	data, err := load(definition)
	if err != nil {
		return &entities.OperationError{Message: "Check that the repository has a readable .agent.md definition under " + definitionsDirectory + ".", Cause: err}
	}
	front, body, ok := strings.Cut(strings.TrimPrefix(string(data), "---\n"), "\n---\n")
	if !ok {
		return entities.Invalidf("Add YAML front matter to %s.", definition)
	}
	var native nativeAgent
	if err := yaml.Unmarshal([]byte(front), &native); err != nil {
		return &entities.OperationError{Message: "Fix the YAML front matter in " + definition + ".", Cause: err}
	}
	a.Model, a.Effort, a.Description, a.Instructions = native.Model, native.Effort, native.Description, strings.TrimSpace(body)
	if len(a.Harnesses) != 0 && a.DraftError == "" && (a.Model != "" || a.ProfileID != "") {
		return entities.Invalidf("Remove the draft model and profile from agents with multiple harnesses. Set them on the worker.")
	}
	return nil
}

func workingFileReader(dir string) func(string) ([]byte, error) {
	return func(name string) ([]byte, error) {
		return os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
	}
}

func readDraftMetadata(dir string) (*entities.Agent, error) {
	project := filepath.Base(dir)
	source := configurationFile
	if validRepositoryName(project) {
		source += fmt.Sprintf(" in repository %q", project)
	}
	a, err := readAgentMetadata(workingFileReader(dir), source, "")
	if err == nil {
		a.Project = project
	}
	return a, err
}

func loadDraftDefinition(dir, definition string, a *entities.Agent) {
	if err := readAgentDefinition(a, definition, workingFileReader(dir)); err != nil {
		a.DraftError = err.Error()
	}
}

func (s *Store) loadAgent(ctx context.Context, dir string, a *entities.Agent) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	definition := definitionFile(dir)
	loadDraftDefinition(dir, definition, a)
	_, remote, remoteErr := s.remote(ctx, dir)
	if remoteErr == nil {
		a.Repository = remote
	}
	if err := s.loadPublication(ctx, dir, definition, a); err != nil {
		return err
	}
	if a.Published != nil && remoteErr == nil {
		a.Published.Repository = remote
	}
	return nil
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
		clear(s.publications)
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
	for dir := range s.publications {
		if _, found := slices.BinarySearch(dirs, dir); !found {
			delete(s.publications, dir)
		}
	}
	return dirs, nil
}

func (s *Store) list(ctx context.Context) ([]entities.Agent, error) {
	dirs, err := s.directories()
	if err != nil {
		return nil, err
	}
	out := make([]entities.Agent, len(dirs))
	ids := map[string]bool{}
	names := map[string]bool{}
	for i, dir := range dirs {
		a, err := readDraftMetadata(dir)
		if err != nil {
			return nil, err
		}
		name := strings.ToLower(a.Name)
		if ids[a.ID] || names[name] {
			return nil, entities.Conflictf("Agent %q in repository %q has a duplicate ID or name. Check its agent.json.", a.Name, a.Project)
		}
		ids[a.ID] = true
		names[name] = true
		out[i] = *a
	}
	jobs := make(chan int)
	failures := make([]error, len(dirs))
	var readers sync.WaitGroup
	for range min(concurrentAgentReads, len(dirs)) {
		readers.Go(func() {
			for i := range jobs {
				failures[i] = s.loadAgent(ctx, dirs[i], &out[i])
			}
		})
	}
	for i := range dirs {
		jobs <- i
	}
	close(jobs)
	readers.Wait()
	for _, err := range failures {
		if err != nil {
			return nil, err
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

func (s *Store) findMetadata(id string) (string, *entities.Agent, error) {
	dirs, err := s.directories()
	if err != nil {
		return "", nil, err
	}
	for _, dir := range dirs {
		a, err := readDraftMetadata(dir)
		if err != nil {
			return "", nil, err
		}
		if a.ID == id {
			return dir, a, nil
		}
	}
	return "", nil, entities.NotFoundf("agent %s", id)
}

func (s *Store) find(ctx context.Context, id string) (string, *entities.Agent, error) {
	dir, a, err := s.findMetadata(id)
	if err != nil {
		return "", nil, err
	}
	if err := s.loadAgent(ctx, dir, a); err != nil {
		return "", nil, err
	}
	return dir, a, nil
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
		if errors.Is(err, os.ErrExist) {
			return entities.Conflictf("Repository %q already exists. Choose a name that gives the agent a different repository name.", slug)
		}
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
	err = s.commitRelease(ctx, dir, manifest, version, "", func(stage string) error {
		if err := s.lockLocalDependencies(ctx, stage, dir); err != nil {
			return err
		}
		if _, err := s.compiler.Run(ctx, stage, "install", "--trust-transitive-mcp"); err != nil {
			return err
		}
		if _, err := installedAPMLock(stage); err != nil {
			return err
		}
		if err := s.compileAgent(ctx, stage, a); err != nil {
			return err
		}
		if err := s.keepSkillProjectionsLocal(ctx, stage); err != nil {
			return err
		}
		a.Revision++
		a.UpdatedAt = at
		return write(stage, definitionFile(stage), a)
	})
	if err != nil {
		return nil, err
	}
	if remoteName != "" {
		if _, err = s.git(ctx, dir, "push", "--atomic", remoteName, "HEAD", "refs/tags/"+tag); err != nil {
			return nil, entities.Conflictf("Release %s exists locally. %s", tag, err)
		}
	}
	_, a, err = s.find(ctx, id)
	return a, err
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
