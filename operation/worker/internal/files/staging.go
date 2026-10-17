package files

import (
	"fmt"
	"kiao/worker/internal/core"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// Uploads are reviewed and converted in ordinary store directories before import via moveBatch.
// Staging is hidden from listings and git; abandoned uploads are swept on creation.

// Only prefixed staging directories belong to the sweep and discard endpoint; leave other entries alone.
const stagingIDPrefix = "u-"

const stagingMaxAge = 24 * time.Hour

const stagingGitignore = "*\n"

// ErrNotStaging bounds recursive DELETE /staging to areas created by POST /staging.
var ErrNotStaging = core.Invalid("path is not an upload staging area")

func (svc *FileService) createStaging() (StagingDto, error) {
	rootAbs, err := svc.storage.Resolve(core.StagingDirName)
	if err != nil {
		return StagingDto{}, err
	}
	if err := os.MkdirAll(rootAbs, 0o755); err != nil {
		return StagingDto{}, fmt.Errorf("cannot create the staging directory: %w", err)
	}
	hideStagingFromGit(rootAbs)
	svc.sweepStaging(rootAbs)

	rel := path.Join(core.StagingDirName, stagingIDPrefix+core.NowMillisStr()+"-"+core.RandID())
	if err := svc.storage.CreateFolder(rel); err != nil {
		return StagingDto{}, err
	}
	logStaging.Info("staging area opened", "path", rel)
	return StagingDto{Path: rel}, nil
}

// discardStaging deletes leftovers without link fixing: staging paths were never exposed as references.
// The bounds check limits recursive deletion to a directory minted by this service.
func (svc *FileService) discardStaging(rel string) error {
	abs, err := svc.storage.Resolve(rel)
	if err != nil {
		return err
	}
	if !isInsideStaging(svc.storage.Root, abs) {
		return fmt.Errorf("%w: %s", ErrNotStaging, rel)
	}
	if err := os.RemoveAll(abs); err != nil {
		return err
	}
	logStaging.Info("staging area discarded", "path", rel)
	return nil
}

// Only direct staging children qualify; use /delete for individual files within an upload.
func isInsideStaging(root, abs string) bool {
	rel, err := filepath.Rel(filepath.Clean(root), abs)
	if err != nil {
		return false
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	return len(parts) == 2 && parts[0] == core.StagingDirName && strings.HasPrefix(parts[1], stagingIDPrefix)
}

// sweepStaging runs when an upload opens. Directory mtime, rather than the name's timestamp,
// keeps recent writes from being swept as stale.
func (svc *FileService) sweepStaging(rootAbs string) {
	entries, err := os.ReadDir(rootAbs)
	if err != nil {
		return
	}
	deadline := time.Now().Add(-stagingMaxAge)
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), stagingIDPrefix) {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.ModTime().After(deadline) {
			continue
		}
		stale := filepath.Join(rootAbs, entry.Name())
		if err := os.RemoveAll(stale); err != nil {
			logStaging.Warn("failed to sweep a stale staging area", "path", stale, "error", err)
			continue
		}
		logStaging.Info("stale staging area swept", "path", stale, "age", time.Since(info.ModTime()).Truncate(time.Minute))
	}
}

// Git exclusion is best-effort; failure only exposes pending uploads in Source Control.
func hideStagingFromGit(rootAbs string) {
	gitignore := filepath.Join(rootAbs, ".gitignore")
	if _, err := os.Stat(gitignore); err == nil {
		return
	}
	if err := core.WriteFileAtomic(gitignore, []byte(stagingGitignore), 0o644); err != nil {
		logStaging.Warn("cannot hide the staging directory from git", "path", rootAbs, "error", err)
	}
}
