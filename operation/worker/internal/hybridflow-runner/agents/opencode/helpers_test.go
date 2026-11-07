package opencode

import (
	"os"
	"testing"
)

func mustRead(t *testing.T, path string) string {
	t.Helper()
	return string(mustReadBytes(t, path))
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
