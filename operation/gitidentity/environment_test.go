package gitidentity

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestGitIdentityFollowsTheStoreFileInExistingChildren(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("requires Git")
	}
	state := filepath.Join(t.TempDir(), "store's Git!")
	if err := os.Mkdir(state, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_CONFIG_COUNT", "0")
	t.Setenv("GIT_CONFIG_PARAMETERS", "'user.email'='ambient@example.com'")
	t.Setenv("GIT_AUTHOR_NAME", "Host Author")
	t.Setenv("GIT_AUTHOR_EMAIL", "host@example.com")
	t.Setenv("GIT_COMMITTER_NAME", "Host Committer")
	t.Setenv("GIT_COMMITTER_EMAIL", "committer@example.com")
	if err := Install(state); err != nil {
		t.Fatal(err)
	}

	fallback, err := exec.CommandContext(t.Context(), "git", "var", "GIT_AUTHOR_IDENT").CombinedOutput()
	if err != nil || !strings.HasPrefix(string(fallback), "Host Author <host@example.com> ") {
		t.Fatalf("author before saving = %q, %v", fallback, err)
	}
	child := exec.CommandContext(t.Context(), "sh", "-ec", `
		read -r ready
		git -c user.name=Fallback -c user.email=fallback@example.com var GIT_AUTHOR_IDENT
		git var GIT_COMMITTER_IDENT
	`)
	stdin, err := child.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	child.Stdout, child.Stderr = &output, &output
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	config := "[author]\nname = Store Author\nemail = store@example.com\n[committer]\nname = Store Author\nemail = store@example.com\n"
	writeErr := os.WriteFile(Path(state), []byte(config), 0o600)
	_, signalErr := stdin.Write([]byte("ready\n"))
	stdin.Close()
	if err := child.Wait(); err != nil {
		t.Fatalf("child failed: %s (%v)", &output, err)
	}
	if writeErr != nil || signalErr != nil {
		t.Fatalf("write config: %v, signal child: %v", writeErr, signalErr)
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 || !strings.HasPrefix(lines[0], "Store Author <store@example.com> ") ||
		!strings.HasPrefix(lines[1], "Store Author <store@example.com> ") {
		t.Fatalf("child author and committer identities: %s", &output)
	}
}
