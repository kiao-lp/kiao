// Package gitidentity shares the store's Git identity with KIAO subprocesses.
package gitidentity

import (
	"os"
	"path/filepath"
	"strings"
)

func Path(statePath string) string {
	return filepath.Join(statePath, "git.conf")
}

// Install adds a command-scope include to the service environment before it starts
// any children. Git reads the file on each invocation, including during a harness turn.
// An absent include is ignored. Move inherited identity variables to the same
// scope first so they still work as fallbacks and the saved identity can win.
func Install(statePath string) error {
	path, err := filepath.Abs(Path(statePath))
	if err != nil {
		return err
	}
	const envKey = "GIT_CONFIG_PARAMETERS"
	parameters := []string{strings.TrimSpace(os.Getenv(envKey))}
	inherited := []struct{ env, config string }{
		{"GIT_AUTHOR_NAME", "author.name"},
		{"GIT_AUTHOR_EMAIL", "author.email"},
		{"GIT_COMMITTER_NAME", "committer.name"},
		{"GIT_COMMITTER_EMAIL", "committer.email"},
	}
	for _, entry := range inherited {
		if value, ok := os.LookupEnv(entry.env); ok {
			parameters = append(parameters, quote(entry.config)+"="+quote(value))
		}
	}
	parameters = append(parameters, quote("include.path")+"="+quote(path))
	if err := os.Setenv(envKey, strings.TrimSpace(strings.Join(parameters, " "))); err != nil {
		return err
	}
	for _, entry := range inherited {
		if err := os.Unsetenv(entry.env); err != nil {
			return err
		}
	}
	return nil
}

// Use Git's own -c propagation variable. Agent shells can filter names containing
// KEY, which would leave GIT_CONFIG_COUNT set with missing GIT_CONFIG_KEY_* entries.
func quote(value string) string {
	return "'" + strings.NewReplacer("'", "'\\''", "!", "'\\!'").Replace(value) + "'"
}
