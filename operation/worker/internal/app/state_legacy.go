package app

import (
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/logging"
	fileconfig "kiao/worker/internal/files/configuration"
	"kiao/worker/internal/hybridflow-runner/conversations"
	"os"
	"path/filepath"
	"slices"
)

type legacyStateEntry struct {
	from string // relative to the data root
	to   string // relative to the state directory
}

var legacyStateEntries = []legacyStateEntry{
	{from: filepath.Join(".kiao", conversations.ConversationsDirName), to: conversations.ConversationsDirName},
	// Legacy source names are frozen; destinations use current names.
	{from: filepath.Join("config", "quickcms.json"), to: fileconfig.ConfigDocDashboard},
	{from: filepath.Join("config", "quickcms-view-state.json"), to: fileconfig.ConfigDocViewState},
}

// Both names are relative to the state directory.
type renamedStateDoc struct {
	oldName string
	newName string
}

// State may live outside the store. Adopt under its lock before reading config documents.
var renamedStateDocs = []renamedStateDoc{
	{oldName: "quickcms.json", newName: fileconfig.ConfigDocDashboard},
	{oldName: "quickcms-view-state.json", newName: fileconfig.ConfigDocViewState},
	{oldName: "quickcms-view-state-small.json", newName: fileconfig.ConfigDocViewStateSmall},
}

// Only generated leftovers may be removed from the old directory.
// The trust registry is obsolete because Claude can access the whole store.
var legacyStateLeftovers = []string{
	"migrations.lock", retiredTrustStoreFile, filesystem.StateLockFile, filesystem.StateGitignoreFile,
}

// These are generated service state, hidden from the file API and git, never user content.
var retiredStateFiles = []string{retiredTrustStoreFile}

const retiredTrustStoreFile = "claude-trust.json"

func removeRetiredState(statePath string) {
	for _, name := range retiredStateFiles {
		file := filepath.Join(statePath, name)
		if _, err := os.Stat(file); err != nil {
			continue
		}
		if err := os.Remove(file); err != nil {
			logging.LogMain.Warn("cannot remove a state file this version no longer uses; delete it by hand",
				"file", file, "error", err)
			continue
		}
		logging.LogMain.Info("removed a state file this version no longer uses", "file", file)
	}
}

// adoptLegacyState returns the number of entries moved.
func adoptLegacyState(cfg *coreconfig.Config) int {
	moved := 0
	for _, entry := range legacyStateEntries {
		src := filepath.Join(cfg.RootPath, entry.from)
		dst := filepath.Join(cfg.StatePath, entry.to)
		if src == dst {
			continue // a deployment that pointed its state path at the old directory
		}
		if _, err := os.Stat(src); err != nil {
			continue
		}
		// Existing state wins; startup must not guess which copy is newer.
		if _, err := os.Stat(dst); err == nil {
			logging.LogMain.Warn("a file from the previous layout is still in the data root, but this "+
				"service already has its own; delete the old one",
				"old", src, "current", dst)
			continue
		}
		if err := moveLegacyState(src, dst); err != nil {
			logging.LogMain.Warn("cannot move a file from the previous layout into the state directory; "+
				"move it by hand", "from", src, "to", dst, "error", err)
			continue
		}
		logging.LogMain.Info("adopted a file from the previous layout", "from", src, "to", dst)
		moved++
	}
	removeRetiredState(cfg.StatePath)
	pruneLegacyStateDir(filepath.Join(cfg.RootPath, ".kiao"), cfg.StatePath)
	return moved
}

// adoptRenamedStateDocs returns the number renamed. Existing destinations win;
// leave conflicting old files for the operator rather than risking a lost layout.
func adoptRenamedStateDocs(statePath string) int {
	renamed := 0
	for _, doc := range renamedStateDocs {
		src := filepath.Join(statePath, doc.oldName)
		if _, err := os.Stat(src); err != nil {
			continue
		}
		dst := filepath.Join(statePath, doc.newName)
		if _, err := os.Stat(dst); err == nil {
			logging.LogMain.Warn("a state file still carries its pre-rename name, but this "+
				"service already has its own; delete the old one",
				"old", src, "current", dst)
			continue
		}
		if err := moveLegacyState(src, dst); err != nil {
			logging.LogMain.Warn("cannot rename a state file to its current name; "+
				"rename it by hand", "from", src, "to", dst, "error", err)
			continue
		}
		logging.LogMain.Info("renamed a state file to its current name", "from", src, "to", dst)
		renamed++
	}
	return renamed
}

// Fall back to copying across filesystems. Restore permissions because transcripts contain
// verbatim prompts and CopyTree creates directories at 0755.
func moveLegacyState(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if err := filesystem.CopyTree(src, dst); err != nil {
		return err
	}
	if err := os.Chmod(dst, info.Mode().Perm()); err != nil {
		return err
	}
	return os.RemoveAll(src)
}

// Remove the old directory only if all remaining entries are known generated files.
// Unrecognised entries in the user’s content tree must be left untouched.
func pruneLegacyStateDir(dir, statePath string) {
	if dir == statePath {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !slices.Contains(legacyStateLeftovers, e.Name()) {
			return
		}
	}
	for _, name := range legacyStateLeftovers {
		_ = os.Remove(filepath.Join(dir, name))
	}
	if err := os.Remove(dir); err == nil {
		logging.LogMain.Info("removed the empty state directory of the previous layout", "path", dir)
	}
}
