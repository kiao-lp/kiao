package core

import (
	"os"
	"path/filepath"
	"testing"
)

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	mustWriteBytes(t, path, []byte(content))
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	return string(mustReadBytes(t, path))
}

// mustWriteBytes writes raw bytes (used for binary fixtures), creating parent dirs.
func mustWriteBytes(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// mustReadBytes reads raw bytes from path.
func mustReadBytes(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// mustMkdir creates a folder of the store.
func mustMkdir(t *testing.T, root, virtual string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(root, virtual), 0o755); err != nil {
		t.Fatal(err)
	}
}
