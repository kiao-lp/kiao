package apm

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFrozenInstallUsesSeedForLockedCommitOnly(t *testing.T) {
	t.Setenv("GIT_ALLOW_PROTOCOL", "file")
	seeds := t.TempDir()
	repo := filepath.Join(seeds, "test-package")
	git := func(args ...string) string {
		t.Helper()
		output, err := exec.Command("git", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %s", err, output)
		}
		return strings.TrimSpace(string(output))
	}
	git("init", "--quiet", repo)
	git("-C", repo, "-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "--allow-empty", "-qm", "Package")
	commit := git("-C", repo, "rev-parse", "HEAD")
	catalogue := `{"resources":[{"name":"test-package","remote":"git@github.com:example/test-package.git"}]}`
	if err := os.WriteFile(filepath.Join(seeds, "catalogue.json"), []byte(catalogue), 0600); err != nil {
		t.Fatal(err)
	}
	source := t.TempDir()
	binary := filepath.Join(source, "apm")
	script := `#!/bin/sh
set -e
git ls-remote https://github.com/example/test-package HEAD
git ls-remote git@github.com:example/test-package.git HEAD
git ls-remote ssh://git@github.com/example/test-package HEAD
`
	if err := os.WriteFile(binary, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	writeLock := func(commit, additionalDependencies string) {
		t.Helper()
		data := fmt.Sprintf("dependencies:\n- repo_url: example/test-package\n  host: github.com\n  resolved_commit: %s\n%s", commit, additionalDependencies)
		if err := os.WriteFile(filepath.Join(source, "apm.lock.yaml"), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	compiler := Compiler{Binary: binary, GitSeeds: []string{seeds}}
	writeLock(commit, "")
	output, err := compiler.Run(context.Background(), source, "install", "--frozen")
	if err != nil || string(output) != strings.Repeat(commit+"\tHEAD\n", 3) {
		t.Fatalf("frozen install could not fetch the locked object: %q, %v", output, err)
	}
	missing := strings.Repeat("a", 40)
	writeLock(missing, "")
	env, err := compiler.frozenGitEnvironment(context.Background(), source)
	if err != nil || len(env) != 0 {
		t.Fatalf("frozen install rewrote the remote for a missing commit: %v", err)
	}

	writeLock(commit, "- repo_url: example/test-package-other\n  host: github.com\n  resolved_commit: "+missing+"\n")
	env, err = compiler.frozenGitEnvironment(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	remote := "https://github.com/example/test-package-other"
	cmd := exec.Command("git", "ls-remote", "--get-url", remote)
	cmd.Env = append(os.Environ(), env...)
	if output, err := cmd.CombinedOutput(); err != nil || strings.TrimSpace(string(output)) != remote {
		t.Fatalf("frozen install rewrote a different dependency: %q, %v", output, err)
	}
}
