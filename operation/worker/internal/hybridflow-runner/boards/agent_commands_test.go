package boards

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPublishedNpxUsesManagedNodeOutsideServicePath(t *testing.T) {
	prefix := t.TempDir()
	bin := filepath.Join(prefix, "node", "bin")
	if err := os.MkdirAll(bin, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"node", "npx"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", t.TempDir())
	t.Setenv("KIAO_WORKER_TOOLBOX_PATH", prefix)
	got, err := publishedCommand("npx", "node")
	if err != nil || got != filepath.Join(bin, "npx") {
		t.Fatalf("npx: %q %v", got, err)
	}
	if _, err = publishedCommand("missing-tool", "node"); err == nil {
		t.Fatal("accepted a missing command")
	}
}

func TestPublishedUvUsesToolbox(t *testing.T) {
	prefix := t.TempDir()
	bin := filepath.Join(prefix, "bin")
	if err := os.MkdirAll(bin, 0755); err != nil {
		t.Fatal(err)
	}
	uvx := filepath.Join(bin, "uvx")
	if err := os.WriteFile(uvx, []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", t.TempDir())
	t.Setenv("KIAO_WORKER_TOOLBOX_PATH", filepath.Dir(bin))
	got, err := publishedCommand("uvx", "node")
	if err != nil || got != uvx {
		t.Fatalf("uvx: %q %v", got, err)
	}
}
