package skills

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRetireLegacyCopies(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("KIAO_WORKER_LEGACY_SKILLS_HOME", filepath.Join(root, "shell-home"))
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(root, "claude-config"))
	t.Setenv("CODEX_HOME", filepath.Join(root, "codex-config"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "xdg-config"))

	const catalogue = "# Installed by kiao (worker) from its skills catalogue,"
	const bundle = "# Installed by kiao (worker) from the skills bundled into it,"
	const oldWorker = "# Installed by kiao-dcms (worker) from the skills bundled into it,"
	const oldFilesService = "# Installed by kiao-dcms (files-service) from the skills bundled into it,"
	managed := map[string]string{
		"store/.agent/skills/graph":       catalogue,
		"store/.agents/skills/graph":      catalogue,
		"store/.claude/skills/graph":      oldWorker,
		"home/.agent/skills/graph":        bundle,
		"home/.agents/skills/graph":       oldFilesService,
		"home/.claude/skills/graph":       oldFilesService,
		"home/.codex/skills/graph":        oldWorker,
		"home/.config/muse/skills/graph":  bundle,
		"shell-home/.agents/skills/graph": bundle,
		"shell-home/.claude/skills/graph": oldFilesService,
		"claude-config/skills/graph":      oldFilesService,
		"codex-config/skills/graph":       oldWorker,
		"xdg-config/muse/skills/graph":    bundle,
	}
	for dir, header := range managed {
		writeSkillFile(t, root, dir+"/SKILL.md", "Installed skill")
		writeSkillFile(t, root, dir+"/.kiao-skill", skillMarker(header, "graph"))
	}
	marker := skillMarker(catalogue, "graph")
	kept := map[string]string{
		"store/.agents/skills/verify/SKILL.md":                                                    "Project skill",
		"store/.agents/skills/unrelated/.kiao-skill":                                              marker,
		"store/.claude/skills/invalid/.kiao-skill":                                                catalogue + "\nskill=invalid\ndigest=invalid\n",
		"store/.kiao-config/agentic-packages/release/deployment/.agents/skills/graph/SKILL.md":    "Published skill",
		"store/.kiao-config/agentic-packages/release/deployment/.agents/skills/graph/.kiao-skill": marker,
		"store/agentic-resource-management/dependencies/skill-graph/SKILL.md":                     "Editable skill",
		"store/agentic-resource-management/dependencies/skill-graph/.git/config":                  "[core]\n",
		"home/.codex/skills/.system/example/SKILL.md":                                             "System skill",
		"home/.agents/skills/custom/SKILL.md":                                                     "User skill",
		"home/.agents/skills/checkout/.git":                                                       "gitdir: /example",
		"home/.agents/skills/checkout/.kiao-skill":                                                skillMarker(catalogue, "checkout"),
		"home/.claude/settings.json":                                                              "{}",
	}
	for file, content := range kept {
		writeSkillFile(t, root, file, content)
	}

	store := filepath.Join(root, "store")
	RetireLegacyCopies(store)
	RetireLegacyCopies(store)

	for dir := range managed {
		if _, err := os.Lstat(filepath.Join(root, dir)); !errors.Is(err, fs.ErrNotExist) {
			t.Errorf("managed skill %s still present or inaccessible: %v", dir, err)
		}
	}
	for file, want := range kept {
		if got := string(mustReadBytes(t, filepath.Join(root, file))); got != want {
			t.Errorf("%s: got %q, want %q", file, got, want)
		}
	}
}

func TestRetireLegacyManifestCopies(t *testing.T) {
	const manifest = `---
name: hexarch
description: This skill should be used when the user asks to "create a hexagonal architecture", "scaffold a hex project", "add an adapter", "add a port", "add an entity", "add a service", "check hexagonal rules", "write hexarch", "edit hexarch", or works with hexagonal architecture structure, ports and adapters pattern, or domain-driven project layout.
---

# HexArch — Hexagonal Architecture

Claude reads only this directory, so this copy exists — but the skill lives in
[.agents/skills](../../../.agents/skills/hexarch/SKILL.md). Read that file; this one is
only its discovery entry.
`
	root := t.TempDir()
	writeSkillFile(t, root, ".claude/skills/hexarch/SKILL.md", manifest)
	writeSkillFile(t, root, ".agents/skills/hexarch/SKILL.md", strings.ReplaceAll(manifest, "\n", "\r\n"))

	kept := map[string]string{
		".agent/skills/hexarch/SKILL.md":                                  manifest + "\nLocal edits\n",
		".agents/skills/renamed/SKILL.md":                                 manifest,
		"home/.claude/skills/hexarch/SKILL.md":                            manifest,
		"home/.claude/skills/hexarch/notes.md":                            "Local notes",
		"agentic-resource-management/dependencies/skill-hexarch/SKILL.md": manifest,
	}
	for file, contents := range kept {
		writeSkillFile(t, root, file, contents)
	}

	retireCopiesUnder(root, ".claude/skills", ".agents/skills", ".agent/skills", "home/.claude/skills")

	for _, dir := range []string{".claude/skills/hexarch", ".agents/skills/hexarch"} {
		if _, err := os.Lstat(filepath.Join(root, dir)); !errors.Is(err, fs.ErrNotExist) {
			t.Errorf("historical copy %s still present or inaccessible: %v", dir, err)
		}
	}
	for file, want := range kept {
		if got := string(mustReadBytes(t, filepath.Join(root, file))); got != want {
			t.Errorf("%s: got %q, want %q", file, got, want)
		}
	}
}

func TestRetireCopiesUnderLeavesLinkedDirectories(t *testing.T) {
	root, target := t.TempDir(), t.TempDir()
	marker := skillMarker("# Installed by kiao (worker) from its skills catalogue,", "graph")
	writeSkillFile(t, target, "skills/graph/.kiao-skill", marker)
	if err := os.Symlink(target, filepath.Join(root, ".agents")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".claude", "skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(target, "skills", "graph"), filepath.Join(root, ".claude", "skills", "graph")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, ".config")); err != nil {
		t.Fatal(err)
	}
	writeSkillFile(t, target, "muse/skills/graph/.kiao-skill", marker)

	retireCopiesUnder(root, ".agents/skills", ".claude/skills", ".config/muse/skills")

	for _, file := range []string{"skills/graph/.kiao-skill", "muse/skills/graph/.kiao-skill"} {
		if _, err := os.Stat(filepath.Join(target, file)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Readlink(filepath.Join(root, ".claude", "skills", "graph")); err != nil {
		t.Fatal(err)
	}
}

func skillMarker(header, name string) string {
	return header + "\nskill=" + name + "\ndigest=" + strings.Repeat("ab", 32) + "\n"
}

func writeSkillFile(t *testing.T, root, relative, content string) {
	t.Helper()
	mustWriteBytes(t, filepath.Join(root, filepath.FromSlash(relative)), []byte(content))
}
