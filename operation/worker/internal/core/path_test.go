package core

import "testing"

// TestResolvePathBoundary characterizes ResolvePath, the storage security boundary. It pins the
// *current* behavior — including the surprising cases — so prompt 05 can reason about what a
// hardened version must preserve or deliberately change.
//
// NOTE: these expectations describe POSIX behavior (filepath.Separator == '/'). Backslash is a
// literal filename byte on Linux, so it is never treated as a path separator here.
func TestResolvePathBoundary(t *testing.T) {
	const root = "/data/root"
	cases := []struct {
		name    string
		sub     string
		want    string
		wantErr bool
	}{
		// happy paths
		{"empty resolves to root", "", "/data/root", false},
		{"plain file", "foo.md", "/data/root/foo.md", false},
		{"nested file", "a/b/c.md", "/data/root/a/b/c.md", false},
		{"single leading slash is stripped", "/foo.md", "/data/root/foo.md", false},
		{"dot resolves to root", ".", "/data/root", false},
		{"bare slash resolves to root", "/", "/data/root", false},
		{"dot-slash prefix", "./foo.md", "/data/root/foo.md", false},
		{"trailing slash is cleaned away", "foo/", "/data/root/foo", false},
		{"double slash inside is collapsed", "foo//bar", "/data/root/foo/bar", false},
		{"interior dot segment", "a/./b", "/data/root/a/b", false},
		{"trailing dot segment", "a/.", "/data/root/a", false},
		{"interior parent that stays inside", "a/b/../c", "/data/root/a/c", false},
		{"parent that cancels back to root child", "a/../b.md", "/data/root/b.md", false},

		// traversal that escapes -> rejected
		{"bare parent", "..", "", true},
		{"parent prefix", "../escape", "", true},
		{"nested double parent", "a/../../escape", "", true},
		{"parent after single segment", "foo/../..", "", true},

		// NOTE: pinned current behavior — revisit in prompt 05.
		// An absolute-looking subpath does NOT escape: only ONE leading slash is stripped and the
		// remainder is re-anchored under root, so "/etc/passwd" lands inside the store.
		{"absolute path is re-anchored under root", "/etc/passwd", "/data/root/etc/passwd", false},
		{"double leading slash strips one, re-anchors", "//foo", "/data/root/foo", false},
		// ResolvePath does not URL-decode; encoded slashes stay literal, so no traversal happens.
		{"encoded slash stays literal", "a%2Fb", "/data/root/a%2Fb", false},
		{"encoded parent stays literal (no decode)", "..%2f..", "/data/root/..%2f..", false},
		// On Linux a backslash is an ordinary filename byte, not a separator.
		{"backslash is a literal byte on posix", "..\\escape", "/data/root/..\\escape", false},
		// whitespace-only is a real (odd) file name, not empty.
		{"whitespace-only subpath is a literal name", "  ", "/data/root/  ", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ResolvePath(root, c.sub)
			if c.wantErr {
				if err == nil {
					t.Fatalf("resolvePath(%q, %q): expected error, got %q", root, c.sub, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolvePath(%q, %q): unexpected error %v", root, c.sub, err)
			}
			if got != c.want {
				t.Errorf("resolvePath(%q, %q) = %q, want %q", root, c.sub, got, c.want)
			}
		})
	}
}

// TestResolvePathCleansRoot verifies the root itself is cleaned before joining, so a messy root
// (trailing slash, dot segment) still bounds correctly.
func TestResolvePathCleansRoot(t *testing.T) {
	got, err := ResolvePath("/data/root/", "foo.md")
	if err != nil || got != "/data/root/foo.md" {
		t.Errorf("messy root: got %q err=%v, want /data/root/foo.md", got, err)
	}
	got, err = ResolvePath("/data/./root", "..")
	if err == nil {
		t.Errorf("messy root with escape: expected error, got %q", got)
	}
}
