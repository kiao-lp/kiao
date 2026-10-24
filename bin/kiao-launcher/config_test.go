package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeConfig puts a config.env under a temporary XDG_CONFIG_HOME and points the process at it.
func writeConfig(t *testing.T, body string, mode os.FileMode) string {
	t.Helper()
	base := t.TempDir()
	dir := filepath.Join(base, "kiao")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, configName)
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil { // WriteFile is subject to the umask
		t.Fatal(err)
	}
	t.Setenv("XDG_CONFIG_HOME", base)
	return path
}

// A machine upgraded from kiao-dcms keeps its answers: the file under the old directory
// is read when the new one is absent, and the new one wins when both exist.
func TestThePreRenameConfigIsReadWhenTheNewOneIsAbsent(t *testing.T) {
	base := t.TempDir()
	legacy := filepath.Join(base, "kiao-dcms")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, configName), []byte("KIAO_HYBRIDFLOW_ACTOR=alex\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_CONFIG_HOME", base)
	t.Setenv(actorEnv, "")
	os.Unsetenv(actorEnv)

	path, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(legacy, configName) {
		t.Fatalf("read %q, want the pre-rename file", path)
	}
	if os.Getenv(actorEnv) != "alex" {
		t.Error("it was not applied")
	}
}

// What the file is for: the answers stand, so starting an instance is `kiao .`.
func TestTheConfigFileAnswersForEveryService(t *testing.T) {
	writeConfig(t, `# where the boards are
export KIAO_WORKER_HYBRIDFLOW_URL=https://boards.example.com/api/hybridflow
KIAO_WORKER_HYBRIDFLOW_TOKEN="a-token"

KIAO_HYBRIDFLOW_ACTOR = alex
`, 0o600)
	for _, name := range []string{remoteEnv, tokenEnv, actorEnv} {
		t.Setenv(name, "")
		os.Unsetenv(name)
	}

	if _, err := loadConfig(); err != nil {
		t.Fatal(err)
	}
	cfg, err := boardsFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.remote != "https://boards.example.com/api/hybridflow" {
		t.Errorf("the URL did not come through: %q", cfg.remote)
	}
	if cfg.token != "a-token" {
		t.Errorf("the token kept its quotes or did not come through: %q", cfg.token)
	}
	if cfg.actor != "alex" {
		t.Errorf("the actor did not come through: %q", cfg.actor)
	}
}

// An export for one run still wins, so trying something out does not mean editing the file and
// remembering to put it back.
func TestTheEnvironmentWinsOverTheFile(t *testing.T) {
	writeConfig(t, "KIAO_WORKER_HYBRIDFLOW_URL=https://boards.example.com/api/hybridflow\n", 0o600)
	t.Setenv(remoteEnv, "http://localhost:18081")

	if _, err := loadConfig(); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv(remoteEnv); got != "http://localhost:18081" {
		t.Errorf("the file overrode the export: %q", got)
	}
}

// A token in a file anybody can read is a token that has been handed out. `ssh` refuses a private
// key on the same grounds, and the fix is the one line the message gives.
func TestACredentialReadableByOthersIsRefused(t *testing.T) {
	path := writeConfig(t, "KIAO_WORKER_HYBRIDFLOW_TOKEN=a-token\n", 0o644)
	t.Setenv(tokenEnv, "")
	os.Unsetenv(tokenEnv)

	_, err := loadConfig()
	if err == nil {
		t.Fatal("a world-readable token file was accepted")
	}
	if !strings.Contains(err.Error(), "chmod 600 "+path) {
		t.Errorf("the message does not say how to fix it: %v", err)
	}
}

// A file with nothing secret in it is nobody's business but its owner's, and is left alone.
func TestAFileWithNoCredentialIsNotFussedOver(t *testing.T) {
	writeConfig(t, "KIAO_HYBRIDFLOW_ACTOR=alex\n", 0o644)
	t.Setenv(actorEnv, "")
	os.Unsetenv(actorEnv)

	if _, err := loadConfig(); err != nil {
		t.Fatalf("a readable file with no credential in it was refused: %v", err)
	}
	if os.Getenv(actorEnv) != "alex" {
		t.Error("it was not applied")
	}
}

// A mistyped line is a setting somebody believes is in force. It says which line, rather than
// skipping it.
func TestALineThatIsNotASettingIsReported(t *testing.T) {
	writeConfig(t, "KIAO_HYBRIDFLOW_ACTOR=alex\nthis is not a setting\n", 0o600)
	_, err := loadConfig()
	if err == nil || !strings.Contains(err.Error(), "line 2") {
		t.Errorf("want the line named, got %v", err)
	}
}

// No file at all is the ordinary case and not an error.
func TestNoFileIsFine(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	path, err := loadConfig()
	if err != nil || path != "" {
		t.Errorf("got %q, %v; want no file and no error", path, err)
	}
}
