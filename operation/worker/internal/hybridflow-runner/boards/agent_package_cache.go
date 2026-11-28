package boards

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"kiao/worker/internal/core/config"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/logging"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
)

const (
	maxPackageFileBytes  = 8 << 20
	maxAgentPackageBytes = 64 << 20
)

var (
	packageInstall  sync.Mutex
	immutableCommit = regexp.MustCompile(`^[0-9a-f]{40}$`)
	draftPackageID  = regexp.MustCompile(`^[A-Z2-7]{26}$`)
	packageSHA256   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	logPackage      = logging.Component("agent-package")
)

type packageManifest struct {
	Digest string
}

type draftPackageSource struct {
	packageManifest
	Package AgentPackage
}

func prepareAgentPackage(state, nodeBinary, workerURL string, version *ManagedAgentVersion, load func() (*AgentPackage, error)) (*PreparedAgentPackage, error) {
	var ref string
	switch {
	case version != nil && version.DraftID == "" && immutableCommit.MatchString(version.Commit):
		ref = version.Commit
	case version != nil && version.Commit == "" && draftPackageID.MatchString(version.DraftID):
		ref = version.DraftID
	default:
		return nil, fmt.Errorf("agent publication requires a complete Git commit")
	}

	packageInstall.Lock()
	defer packageInstall.Unlock()
	key := strings.Join([]string{agentPackageFormat, state, version.AgentID, ref, version.LockDigest, nodeBinary, workerURL}, "\x00")
	id := sha256.Sum256([]byte(key))
	cache := filepath.Join(state, config.AgentPackagesDirName)
	base := filepath.Join(cache, ref+"-"+hex.EncodeToString(id[:8]))
	draftSource := ""
	if version.DraftID != "" {
		draftSource = filepath.Join(cache, ref+".draft.json")
	}

	var manifest packageManifest
	err := readPackageJSON(base+".json", &manifest)
	if err != nil || !packageSHA256.MatchString(manifest.Digest) {
		manifest.Digest = ""
	}
	digest := manifest.Digest
	if err := verifyCachedPackage(base, digest, version.LockDigest); err != nil {
		digest, err = installAgentPackage(base, draftSource, digest, version, load)
		if err != nil {
			return nil, fmt.Errorf("install agent package %s: %w", ref, err)
		}
	} else {
		// Adopt verified drafts written before the worker retained a recovery source.
		if draftSource != "" {
			if err := saveLegacyDraftSource(base, draftSource, digest, version); err != nil {
				return nil, err
			}
		}
		if err := sealPackageTree(base); err != nil {
			return nil, err
		}
	}

	logDir := filepath.Join(state, "logs", "kiao-mcp", filepath.Base(base))
	prepared, err := bindAgentPackage(base, digest, nodeBinary, workerURL, logDir, version)
	if err != nil {
		return nil, err
	}
	prepared.restore = func() error {
		_, err := installAgentPackage(base, draftSource, digest, version, load)
		return err
	}
	return prepared, nil
}

// EnsureIntact pins the package used to bind the turn, including after MCP probes have run.
func (p *PreparedAgentPackage) EnsureIntact() error {
	packageInstall.Lock()
	defer packageInstall.Unlock()
	err := verifyPackageDigest(p.base, p.digest)
	if err == nil || p.restore == nil {
		return err
	}
	if err := p.restore(); err != nil {
		return fmt.Errorf("restore the verified agent package: %w", err)
	}
	return nil
}

func installAgentPackage(base, draftSource, pinnedDigest string, version *ManagedAgentVersion, load func() (*AgentPackage, error)) (string, error) {
	var bundle *AgentPackage
	var sourceDigest string
	var err error
	saveDraft := draftSource != "" && load != nil
	if load == nil {
		var source draftPackageSource
		if err := readPackageJSON(draftSource, &source); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return "", fmt.Errorf("the saved draft package has no recovery source; start a new conversation with the draft")
			}
			return "", fmt.Errorf("read the saved draft package: %w", err)
		}
		if !packageSHA256.MatchString(source.Digest) {
			return "", fmt.Errorf("the saved draft package has an invalid digest")
		}
		bundle, sourceDigest = &source.Package, source.Digest
	} else {
		bundle, err = load()
		if err != nil {
			return "", err
		}
	}
	digest, err := verifiedBundleDigest(version, bundle)
	if err != nil {
		return "", err
	}
	if (pinnedDigest != "" && digest != pinnedDigest) || (sourceDigest != "" && digest != sourceDigest) {
		return "", fmt.Errorf("agent package source digest differs from the recorded digest")
	}

	parent := filepath.Dir(base)
	if err := filesystem.EnsureStateDir(filepath.Dir(parent), parent); err != nil {
		return "", err
	}
	staging, err := os.MkdirTemp(parent, ".install-")
	if err != nil {
		return "", err
	}
	defer removeStagedPackage(staging)
	if err := writeAgentPackage(staging, bundle, digest); err != nil {
		return "", err
	}
	if saveDraft {
		if err := saveDraftSource(draftSource, digest, bundle); err != nil {
			return "", err
		}
	}
	if err := writePackageJSON(base+".json", packageManifest{Digest: digest}); err != nil {
		return "", err
	}
	quarantined, err := replacePackageTree(base, staging)
	if err != nil {
		return "", err
	}
	if err := verifyPackageDigest(base, digest); err != nil {
		return "", err
	}
	if quarantined != "" {
		logPackage.Info("reinstalled verified agent package", "path", base, "quarantine", quarantined, "digest", digest)
	}
	return digest, nil
}

func readPackageJSON(path string, target any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("expected a regular file at %s", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func writePackageJSON(path string, data any) error {
	encoded, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return filesystem.WriteFileAtomic(path, encoded, 0400)
}

func saveDraftSource(path, digest string, bundle *AgentPackage) error {
	return writePackageJSON(path, draftPackageSource{packageManifest: packageManifest{Digest: digest}, Package: *bundle})
}

func saveLegacyDraftSource(base, path, expected string, version *ManagedAgentVersion) error {
	if _, err := os.Lstat(path); !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	bundle := &AgentPackage{Format: agentPackageFormat, Project: "deployment", DraftID: version.DraftID, Files: map[string][]byte{}}
	if err := walkPackageFiles(base, func(name string, content []byte) { bundle.Files[name] = content }); err != nil {
		return err
	}
	digest, err := verifiedBundleDigest(version, bundle)
	if err != nil {
		return err
	}
	if digest != expected {
		return fmt.Errorf("agent package digest differs from the recorded digest")
	}
	return saveDraftSource(path, digest, bundle)
}

func verifiedBundleDigest(version *ManagedAgentVersion, bundle *AgentPackage) (string, error) {
	if bundle.Format != agentPackageFormat || bundle.Project != "deployment" {
		return "", fmt.Errorf("agentic-resource-manager must deliver a prepared %s package", agentPackageFormat)
	}
	if bundle.Commit != version.Commit {
		return "", fmt.Errorf("agent package commit differs from selected publication")
	}
	if bundle.DraftID != version.DraftID {
		return "", fmt.Errorf("agent package draft differs from selected draft")
	}
	total := 0
	for name, content := range bundle.Files {
		if !fs.ValidPath(name) || !strings.HasPrefix(name, "deployment/") || strings.ContainsAny(name, "\\\x00") {
			return "", fmt.Errorf("invalid package path %q", name)
		}
		total += len(content)
		if len(content) > maxPackageFileBytes || total > maxAgentPackageBytes {
			return "", fmt.Errorf("agent package exceeds delivery limit")
		}
	}
	lock, ok := bundle.Files["deployment/apm.lock.yaml"]
	sum := sha256.Sum256(lock)
	if !ok || hex.EncodeToString(sum[:]) != version.LockDigest {
		return "", fmt.Errorf("agent package lock digest differs from selection")
	}
	names := slices.Collect(maps.Keys(bundle.Files))
	// Match WalkDir's component order to preserve existing installed digests.
	slices.SortFunc(names, func(a, b string) int {
		return slices.Compare(strings.Split(a, "/"), strings.Split(b, "/"))
	})
	hash := sha256.New()
	for _, name := range names {
		writeFileDigest(hash, name, bundle.Files[name])
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func writeAgentPackage(base string, bundle *AgentPackage, digest string) error {
	for name, content := range bundle.Files {
		target := filepath.Join(base, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		if err := os.WriteFile(target, content, 0400); err != nil {
			return err
		}
	}
	if err := verifyPackageDigest(base, digest); err != nil {
		return err
	}
	return sealPackageTree(base)
}

func sealPackageTree(base string) error {
	return filepath.WalkDir(base, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		mode := fs.FileMode(0400)
		switch {
		case info.IsDir():
			mode = 0500
		case !info.Mode().IsRegular():
			return fmt.Errorf("non-regular file in agent package: %s", path)
		}
		if info.Mode().Perm() != mode {
			return os.Chmod(path, mode)
		}
		return nil
	})
}

func removeStagedPackage(base string) {
	_ = filepath.WalkDir(base, func(path string, entry fs.DirEntry, err error) error {
		if err == nil && entry.IsDir() {
			return os.Chmod(path, 0700)
		}
		return err
	})
	_ = os.RemoveAll(base)
}

// Move the displaced tree intact so state such as legacy logs is still available for inspection.
func replacePackageTree(base, staging string) (string, error) {
	if _, err := os.Lstat(base); errors.Is(err, fs.ErrNotExist) {
		return "", os.Rename(staging, base)
	} else if err != nil {
		return "", err
	}
	old, err := os.MkdirTemp(filepath.Dir(base), ".quarantine-"+filepath.Base(base)+"-")
	if err != nil {
		return "", err
	}
	if err := os.Remove(old); err != nil {
		return "", err
	}
	if err := os.Rename(base, old); err != nil {
		return "", err
	}
	if err := os.Rename(staging, base); err != nil {
		return "", errors.Join(err, os.Rename(old, base))
	}
	return old, nil
}

func verifyPackageDigest(base, expected string) error {
	if expected == "" {
		return fmt.Errorf("agent package has no recorded digest")
	}
	actual, err := packageTreeDigest(base)
	if err != nil {
		return err
	}
	if actual != expected {
		return fmt.Errorf("agent package digest differs from the recorded digest")
	}
	return nil
}

func verifyCachedPackage(base, expected, lockDigest string) error {
	if err := verifyPackageDigest(base, expected); err != nil {
		return err
	}
	lock, err := os.ReadFile(filepath.Join(base, "deployment", "apm.lock.yaml"))
	if err != nil {
		return err
	}
	if sum := sha256.Sum256(lock); hex.EncodeToString(sum[:]) != lockDigest {
		return fmt.Errorf("agent package lock digest differs from selection")
	}
	return nil
}

func packageTreeDigest(base string) (string, error) {
	hash := sha256.New()
	err := walkPackageFiles(base, func(name string, content []byte) { writeFileDigest(hash, name, content) })
	return hex.EncodeToString(hash.Sum(nil)), err
}

func writeFileDigest(hash io.Writer, name string, content []byte) {
	fmt.Fprintf(hash, "%s\x00%x\n", name, sha256.Sum256(content))
}

func walkPackageFiles(base string, visit func(string, []byte)) error {
	var total int64
	return filepath.WalkDir(base, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if path == base || !info.Mode().IsRegular() {
			return fmt.Errorf("non-regular file in agent package: %s", path)
		}
		if info.Size() > maxPackageFileBytes || total+info.Size() > maxAgentPackageBytes {
			return fmt.Errorf("agent package exceeds delivery limit")
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(base, path)
		if err != nil {
			return err
		}
		total += int64(len(content))
		visit(filepath.ToSlash(relative), content)
		return nil
	})
}
