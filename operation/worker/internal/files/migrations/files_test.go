package migrations

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func execLookNode() (string, error) {
	for _, c := range []string{"node", "nodejs"} {
		if p, err := lookPath(c); err == nil {
			return p, nil
		}
	}
	return "", os.ErrNotExist
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func lookPath(cmd string) (string, error) {
	paths := strings.Split(os.Getenv("PATH"), string(os.PathListSeparator))
	for _, dir := range paths {
		full := filepath.Join(dir, cmd)
		if IsExecutable(full) {
			return full, nil
		}
	}
	return "", os.ErrNotExist
}
