package git

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"unicode"

	"kiao/gitidentity"
	faults "kiao/worker/internal/core/errors"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/process"
)

type Identity struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

func (g *GitService) Identity() (Identity, error) {
	fallback := Identity{Name: g.gitUserName, Email: g.gitUserEmail}
	if g.statePath == "" {
		return fallback, nil
	}
	path := gitidentity.Path(g.statePath)
	if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
		return fallback, nil
	} else if err != nil {
		return Identity{}, err
	}
	result := process.RunProc([]string{"git", "config", "--no-includes", "--file", path, "--null", "--list"},
		g.dcmsRoot, gitDefaultTimeout, nil)
	if !result.OK() {
		return Identity{}, fmt.Errorf("read Git identity: %s", result.Combined())
	}
	var identity Identity
	for entry := range strings.SplitSeq(result.Stdout, "\x00") {
		key, value, _ := strings.Cut(entry, "\n")
		switch key {
		case "user.name":
			identity.Name = value
		case "user.email":
			identity.Email = value
		}
	}
	return identity, nil
}

func (g *GitService) SaveIdentity(identity Identity) (Identity, error) {
	identity.Name = strings.TrimSpace(identity.Name)
	identity.Email = strings.TrimSpace(identity.Email)
	invalid := func(r rune) bool { return unicode.IsControl(r) || r == '<' || r == '>' }
	if identity.Name == "" || strings.ContainsFunc(identity.Name, invalid) {
		return Identity{}, faults.Invalid("Enter a Git author name without control characters or angle brackets.")
	}
	local, domain, hasAt := strings.Cut(identity.Email, "@")
	if !hasAt || local == "" || domain == "" || strings.ContainsRune(domain, '@') ||
		strings.ContainsFunc(identity.Email, func(r rune) bool { return invalid(r) || unicode.IsSpace(r) }) {
		return Identity{}, faults.Invalid("Enter a valid Git author email address.")
	}
	if g.statePath == "" {
		return Identity{}, filesystem.ErrEmptyStatePath
	}
	escape := strings.NewReplacer(`\`, `\\`, `"`, `\"`)
	values := fmt.Sprintf("\tname = \"%s\"\n\temail = \"%s\"\n", escape.Replace(identity.Name), escape.Replace(identity.Email))
	// The specific roles also override the fallback user.* that some KIAO Git commands pass using -c.
	content := "[user]\n" + values + "[author]\n" + values + "[committer]\n" + values
	if err := filesystem.WriteFileAtomic(gitidentity.Path(g.statePath), []byte(content), 0o600); err != nil {
		return Identity{}, err
	}
	return identity, nil
}
