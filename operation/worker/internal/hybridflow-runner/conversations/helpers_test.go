package conversations

import (
	"os"
	"path/filepath"
	"testing"
)

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
