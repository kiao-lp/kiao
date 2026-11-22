package filesystem

import (
	"context"
	"net/url"
	"strings"

	"kiao/agentic-resource-manager/core/entities"
)

func (s *Store) dependencyRemote(ctx context.Context, dir string) (string, error) {
	name, _, err := s.remote(ctx, dir)
	if err != nil || name == "" {
		return "", err
	}
	// Keep machine-specific Git URL rewrites out of the manifest.
	data, err := s.git(ctx, dir, "config", "--get", "remote."+name+".url")
	if err != nil {
		return "", err
	}
	remote := strings.TrimSpace(string(data))
	if u, err := url.Parse(remote); err == nil && u.User != nil {
		_, password := u.User.Password()
		if password || u.Scheme == "https" || u.Scheme == "http" {
			return "", entities.Invalidf("remove credentials from the dependency Git remote URL")
		}
	}
	return remote, nil
}

func (s *Store) remote(ctx context.Context, dir string) (string, string, error) {
	output, err := s.git(ctx, dir, "remote")
	if err != nil {
		return "", "", err
	}
	names := strings.Fields(string(output))
	if len(names) == 0 {
		return "", "", nil
	}
	branch, _ := s.git(ctx, dir, "symbolic-ref", "--quiet", "--short", "HEAD")
	keys := []string{"branch." + strings.TrimSpace(string(branch)) + ".pushRemote", "remote.pushDefault", "branch." + strings.TrimSpace(string(branch)) + ".remote"}

	for _, key := range keys {
		if value, e := s.git(ctx, dir, "config", "--get", key); e == nil {
			candidate := strings.TrimSpace(string(value))
			if candidate == "." || candidate == "" {
				continue
			}
			for _, name := range names {
				if name == candidate {
					url, err := s.git(ctx, dir, "remote", "get-url", name)
					return name, strings.TrimSpace(string(url)), err
				}
			}
			return "", "", entities.Conflictf("Git remote %q configured by %s is unavailable", candidate, key)
		}
	}
	preferred := []string{}
	preferred = append(preferred, "origin")
	if len(names) == 1 {
		preferred = append(preferred, names[0])
	}
	for _, candidate := range preferred {
		for _, name := range names {
			if name == candidate {
				value, err := s.git(ctx, dir, "remote", "get-url", name)
				return name, strings.TrimSpace(string(value)), err
			}
		}
	}
	return "", "", entities.Conflictf("configure remote.pushDefault before publishing a repository with several remotes")
}
