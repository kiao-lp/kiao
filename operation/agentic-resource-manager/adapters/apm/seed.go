package apm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

var gitCommit = regexp.MustCompile("^[0-9a-f]{40}$")

func seedRemoteKey(remote string) string {
	if parsed, err := url.Parse(remote); err == nil && parsed.Host != "" {
		return strings.ToLower(parsed.Host) + "/" + strings.TrimSuffix(strings.TrimPrefix(parsed.Path, "/"), ".git")
	}
	_, address, scp := strings.Cut(remote, "@")
	host, path, hasPath := strings.Cut(address, ":")
	if scp && hasPath {
		return strings.ToLower(host) + "/" + strings.TrimSuffix(path, ".git")
	}
	return ""
}

// Frozen installs can fetch from a seed supplying the same Git object as the
// remote. The rewrite is scoped to this APM process and its Git subprocesses.
func (c Compiler) frozenGitEnvironment(ctx context.Context, directory string) ([]string, error) {
	data, err := os.ReadFile(filepath.Join(directory, "apm.lock.yaml"))
	if err != nil {
		return nil, nil // APM reports the lockfile error.
	}
	var lock struct {
		Dependencies []struct {
			Repo   string `yaml:"repo_url"`
			Host   string `yaml:"host"`
			Commit string `yaml:"resolved_commit"`
		} `yaml:"dependencies"`
	}
	if yaml.Unmarshal(data, &lock) != nil {
		return nil, nil
	}
	commits := map[string][]string{}
	for _, dep := range lock.Dependencies {
		if dep.Host != "" && dep.Repo != "" {
			key := strings.ToLower(dep.Host) + "/" + strings.TrimSuffix(dep.Repo, ".git")
			commits[key] = append(commits[key], dep.Commit)
		}
	}
	n, _ := strconv.Atoi(os.Getenv("GIT_CONFIG_COUNT"))
	used := map[string]bool{}
	var env []string
	for _, root := range c.GitSeeds {
		data, err := os.ReadFile(filepath.Join(root, "catalogue.json"))
		if err != nil {
			return nil, err
		}
		var catalogue struct {
			Resources []struct {
				Name   string `json:"name"`
				Remote string `json:"remote"`
			} `json:"resources"`
		}
		if err = json.Unmarshal(data, &catalogue); err != nil {
			return nil, fmt.Errorf("read APM seed catalogue %s: %w", root, err)
		}
		for _, resource := range catalogue.Resources {
			key := seedRemoteKey(resource.Remote)
			if used[key] || len(commits[key]) == 0 || !filepath.IsLocal(resource.Name) || filepath.Base(resource.Name) != resource.Name {
				continue
			}
			path, err := filepath.Abs(filepath.Join(root, resource.Name))
			if err != nil {
				return nil, err
			}
			if !seedHasCommits(ctx, path, commits[key]) {
				continue
			}
			used[key] = true
			local := (&url.URL{Scheme: "file", Path: filepath.ToSlash(path)}).String()
			for _, remote := range seedRemotePrefixes(key, commits) {
				env = append(env,
					fmt.Sprintf("GIT_CONFIG_KEY_%d=url.%s.insteadOf", n, local),
					fmt.Sprintf("GIT_CONFIG_VALUE_%d=%s", n, remote),
				)
				n++
			}
		}
	}
	if len(env) > 0 {
		env = append(env, fmt.Sprintf("GIT_CONFIG_COUNT=%d", n))
	}
	return env, nil
}

func seedRemotePrefixes(key string, commits map[string][]string) []string {
	var prefixes []string
	// APM can omit .git. Git's prefix matching must preserve other locked remotes.
suffixes:
	for _, suffix := range []string{"", ".git"} {
		prefix := key + suffix
		for other := range commits {
			if other != key && strings.HasPrefix(other, prefix) {
				continue suffixes
			}
		}
		host, repo, _ := strings.Cut(prefix, "/")
		prefixes = append(prefixes, "https://"+prefix, "git@"+host+":"+repo, "ssh://git@"+prefix)
	}
	return prefixes
}

func seedHasCommits(ctx context.Context, path string, commits []string) bool {
	if _, err := os.Stat(filepath.Join(path, ".git")); err != nil {
		return false
	}
	for _, commit := range commits {
		if !gitCommit.MatchString(commit) || exec.CommandContext(ctx, "git", "-C", path, "cat-file", "-e", commit+"^{commit}").Run() != nil {
			return false
		}
	}
	return true
}
