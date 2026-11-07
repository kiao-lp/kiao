package migrations

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/process"
	fileconfig "kiao/worker/internal/files/configuration"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	MigrationLedgerFile   = "files-migrations.json"
	migrationLockFile     = "files-migrations.lock"
	migrationLedgerFormat = 2
)

type ledgerEntry struct {
	Version    int    `json:"version"`
	Name       string `json:"name"`
	Script     string `json:"script"`
	Checksum   string `json:"checksum"`
	AppliedAt  string `json:"appliedAt"`
	DurationMs int64  `json:"durationMs"`
}

type sourceLedger struct {
	Baseline      int           `json:"baseline"`
	SchemaVersion int           `json:"schemaVersion"`
	Applied       []ledgerEntry `json:"applied"`
}

type ledgerData struct {
	FormatVersion int                      `json:"formatVersion"`
	DataRoot      string                   `json:"dataRoot"`
	Sources       map[string]*sourceLedger `json:"sources"`
}

type migrationLedger struct {
	file string
	data ledgerData
}

type migrationStateError struct{ error }

// One lock covers discovery, ledger conversion, validation and every source's scripts.
func RunMigrations(cfg *fileconfig.Config) error {
	if !cfg.MigrationsEnabled {
		logMigrate.Info("file migrations disabled; skipping")
		return nil
	}
	if strings.TrimSpace(cfg.MigrationsPath) == "" && strings.TrimSpace(cfg.MigrationsSources) == "" {
		logMigrate.Info("no migration sources configured; skipping")
		return nil
	}
	if err := os.MkdirAll(cfg.StatePath, 0o700); err != nil {
		return err
	}
	release, locked, err := filesystem.AcquireLock(filepath.Join(cfg.StatePath, migrationLockFile))
	if err != nil {
		return fmt.Errorf("failed to acquire migration lock: %w", err)
	}
	if !locked {
		return fmt.Errorf("another process holds the migration lock; aborting")
	}
	defer release()

	sources, err := fileconfig.MigrationSources(cfg)
	if err != nil {
		return err
	}
	for i := range sources {
		source := &sources[i]
		source.Scripts, err = discoverMigrations(source.Dir)
		if err != nil {
			return fmt.Errorf("source %s: %w", source.ID, err)
		}
		for _, script := range source.Scripts {
			if script.Version <= source.Baseline {
				return fmt.Errorf("source %s: retired migration %s is still discoverable (baseline %d); replace the entire script directory before cutover", source.ID, script.FileName, source.Baseline)
			}
		}
	}
	ledger, err := loadLedger(cfg.StatePath, cfg.RootPath, sources[0])
	if err != nil {
		return err
	}
	for _, source := range sources {
		state := ledger.data.Sources[source.ID]
		if state == nil {
			state = &sourceLedger{Baseline: source.Baseline, SchemaVersion: source.Baseline, Applied: []ledgerEntry{}}
			ledger.data.Sources[source.ID] = state
		}
		if state.Baseline != source.Baseline {
			return fmt.Errorf("source %s: ledger baseline %d differs from delivered baseline %d; use the documented cutover", source.ID, state.Baseline, source.Baseline)
		}
		if err := validateSourceLedger(state); err != nil {
			return fmt.Errorf("source %s: %w", source.ID, err)
		}
		if err := validateAlreadyApplied(source.Scripts, state); err != nil {
			return migrationFailure(cfg, fmt.Errorf("source %s: %w", source.ID, err))
		}
	}
	// Persist even with no pending scripts: retiring history and adding a source are durable.
	if err := ledger.persist(); err != nil {
		return err
	}
	var node string
	for _, source := range sources {
		state := ledger.data.Sources[source.ID]
		logMigrate.Info("file migration source", "source", source.ID, "baseline", state.Baseline,
			"version", state.SchemaVersion, "scripts_on_disk", len(source.Scripts))
		for _, script := range source.Scripts {
			if script.Version <= state.SchemaVersion {
				continue
			}
			if node == "" {
				node, err = resolveNode(cfg)
				if err != nil {
					return migrationFailure(cfg, err)
				}
			}
			if err := applyOne(cfg, node, source.ID, script, sources[0].Dir, ledger); err != nil {
				return migrationFailure(cfg, err)
			}
		}
	}
	return nil
}

// A permissive script/checksum failure stops the whole batch, including later sources.
func migrationFailure(cfg *fileconfig.Config, err error) error {
	var stateError *migrationStateError
	if cfg.MigrationsFailOnErr || errors.As(err, &stateError) {
		return err
	}
	logMigrate.Warn("file migrations halted (failOnError=false)", "error", err)
	return nil
}

func applyOne(cfg *fileconfig.Config, node, sourceID string, script fileconfig.MigrationScript, baseDir string, ledger *migrationLedger) error {
	logMigrate.Info("applying migration", "source", sourceID, "script", script.FileName)
	start := time.Now()
	result := process.RunProc([]string{node, script.Path, cfg.RootPath}, cfg.RootPath, cfg.MigrationsTimeout,
		map[string]string{
			"KIAO_DATA_ROOT":         cfg.RootPath,
			"KIAO_MIGRATION_VERSION": strconv.Itoa(script.Version),
			"KIAO_MIGRATION_SOURCE":  sourceID,
			"KIAO_MIGRATION_LIB":     filepath.Join(baseDir, "lib"),
		})
	duration := time.Since(start).Milliseconds()
	output := result.Combined()
	if !result.OK() {
		return fmt.Errorf("migration %s/%s failed (exit %d):\n%s", sourceID, script.FileName, result.Exit, output)
	}
	if strings.TrimSpace(output) != "" {
		logMigrate.Info("migration output", "source", sourceID, "script", script.FileName, "output", output)
	}
	state := ledger.data.Sources[sourceID]
	state.Applied = append(state.Applied, ledgerEntry{Version: script.Version, Name: script.Name,
		Script: script.FileName, Checksum: script.Checksum, AppliedAt: time.Now().UTC().Format(time.RFC3339), DurationMs: duration})
	state.SchemaVersion = script.Version
	if err := ledger.persist(); err != nil {
		// A persistence failure must abort startup, even under the permissive script policy.
		return &migrationStateError{fmt.Errorf("persist applied migration %s/%s: %w", sourceID, script.FileName, err)}
	}
	logMigrate.Info("applied migration", "source", sourceID, "script", script.FileName, "duration_ms", duration)
	return nil
}

func discoverMigrations(dir string) ([]fileconfig.MigrationScript, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to list migration scripts in %s: %w", dir, err)
	}
	var scripts []fileconfig.MigrationScript
	for _, e := range entries {
		match := fileconfig.MigrationNameRe.FindStringSubmatch(e.Name())
		if e.IsDir() || match == nil {
			continue
		}
		version, err := strconv.Atoi(match[1])
		if err != nil || version <= 0 {
			return nil, fmt.Errorf("invalid migration version: %s", e.Name())
		}
		full := filepath.Join(dir, e.Name())
		info, err := os.Lstat(full)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("migration must be a regular file: %s", full)
		}
		sum, err := fileChecksum(full)
		if err != nil {
			return nil, err
		}
		scripts = append(scripts, fileconfig.MigrationScript{Version: version, Name: match[2], FileName: e.Name(), Path: full, Checksum: sum})
	}
	sort.Slice(scripts, func(i, j int) bool { return scripts[i].Version < scripts[j].Version })
	for i := 1; i < len(scripts); i++ {
		if scripts[i].Version == scripts[i-1].Version {
			return nil, fmt.Errorf("duplicate migration version %d: %s and %s", scripts[i].Version, scripts[i-1].FileName, scripts[i].FileName)
		}
	}
	return scripts, nil
}

func fileChecksum(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read migration script %s: %w", path, err)
	}
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func loadLedger(statePath, dataRoot string, base fileconfig.MigrationSource) (*migrationLedger, error) {
	ledger := &migrationLedger{file: filepath.Join(statePath, MigrationLedgerFile),
		data: ledgerData{FormatVersion: migrationLedgerFormat, DataRoot: dataRoot, Sources: map[string]*sourceLedger{}}}
	data, err := os.ReadFile(ledger.file)
	if os.IsNotExist(err) {
		legacyFile := filepath.Join(dataRoot, ".kiao", "migrations.json")
		if _, legacyErr := os.Stat(legacyFile); legacyErr == nil {
			return nil, fmt.Errorf("older migration ledger at %s requires the pre-cutover upgrade; this is not a fresh store", legacyFile)
		} else if !os.IsNotExist(legacyErr) {
			return nil, legacyErr
		}
		return ledger, nil
	}
	if err != nil {
		return nil, err
	}
	var header struct {
		FormatVersion int `json:"formatVersion"`
	}
	if err := json.Unmarshal(data, &header); err != nil {
		return nil, fmt.Errorf("parse migration ledger: %w", err)
	}
	if header.FormatVersion == 0 {
		var legacy struct {
			SchemaVersion int           `json:"schemaVersion"`
			Applied       []ledgerEntry `json:"applied"`
			DataRoot      string        `json:"dataRoot"`
		}
		if err := json.Unmarshal(data, &legacy); err != nil {
			return nil, err
		}
		if base.LegacyLastScript == "" || legacy.SchemaVersion != base.Baseline || len(legacy.Applied) != base.Baseline {
			return nil, fmt.Errorf("legacy migration ledger is not at the supported baseline (%s, version %d); upgrade with the pre-cutover release first", base.ID, base.Baseline)
		}
		for i, entry := range legacy.Applied {
			match := fileconfig.MigrationNameRe.FindStringSubmatch(entry.Script)
			if match == nil || entry.Version != i+1 {
				return nil, fmt.Errorf("legacy migration ledger has incomplete or ambiguous history; use the pre-cutover release")
			}
			version, _ := strconv.Atoi(match[1])
			if version != entry.Version {
				return nil, fmt.Errorf("legacy migration ledger script/version mismatch")
			}
		}
		if legacy.Applied[len(legacy.Applied)-1].Script != base.LegacyLastScript {
			return nil, fmt.Errorf("legacy migration ledger belongs to a different history; use the pre-cutover release")
		}
		if legacy.DataRoot != "" && legacy.DataRoot != dataRoot {
			return nil, fmt.Errorf("legacy migration ledger belongs to %s, not %s; relocate it explicitly before cutover", legacy.DataRoot, dataRoot)
		}
		logMigrate.Info("retiring legacy applied migration history", "source", base.ID, "baseline", base.Baseline)
		return ledger, nil
	}
	if header.FormatVersion != migrationLedgerFormat {
		return nil, fmt.Errorf("unsupported migration ledger format %d", header.FormatVersion)
	}
	if err := json.Unmarshal(data, &ledger.data); err != nil {
		return nil, err
	}
	if ledger.data.Sources == nil || ledger.data.DataRoot != dataRoot {
		return nil, fmt.Errorf("migration ledger has no sources or belongs to a different data root; relocate it explicitly before startup")
	}
	for id, state := range ledger.data.Sources {
		if !fileconfig.MigrationSourceID.MatchString(id) || state == nil {
			return nil, fmt.Errorf("invalid source in migration ledger: %q", id)
		}
		if err := validateSourceLedger(state); err != nil {
			return nil, fmt.Errorf("ledger source %s: %w", id, err)
		}
	}
	return ledger, nil
}

func validateSourceLedger(state *sourceLedger) error {
	version := state.Baseline
	if version < 0 {
		return fmt.Errorf("negative migration baseline")
	}
	for _, entry := range state.Applied {
		match := fileconfig.MigrationNameRe.FindStringSubmatch(entry.Script)
		if match == nil || entry.Version <= version || entry.Checksum == "" {
			return fmt.Errorf("invalid applied migration history")
		}
		scriptVersion, _ := strconv.Atoi(match[1])
		if scriptVersion != entry.Version || match[2] != entry.Name {
			return fmt.Errorf("applied migration script/version/name mismatch")
		}
		version = entry.Version
	}
	if state.SchemaVersion != version {
		return fmt.Errorf("schemaVersion does not match applied migration history")
	}
	return nil
}

func validateAlreadyApplied(scripts []fileconfig.MigrationScript, state *sourceLedger) error {
	applied := map[int]ledgerEntry{}
	for _, entry := range state.Applied {
		applied[entry.Version] = entry
	}
	for _, script := range scripts {
		if script.Version > state.SchemaVersion {
			continue
		}
		entry, ok := applied[script.Version]
		if !ok {
			return fmt.Errorf("migration %s is below the current version but not recorded; versions cannot be inserted into applied history", script.FileName)
		}
		if entry.Checksum != script.Checksum || entry.Script != script.FileName {
			return fmt.Errorf("checksum or filename mismatch for already-applied migration %s", script.FileName)
		}
		delete(applied, script.Version)
	}
	if len(applied) > 0 {
		return fmt.Errorf("applied migration scripts are missing; replace the delivery or use a coordinated history retirement")
	}
	return nil
}

func (ledger *migrationLedger) persist() error {
	out, err := json.MarshalIndent(ledger.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := ledger.file + ".tmp"
	file, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer os.Remove(tmp)
	if _, err = file.Write(out); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(tmp, ledger.file); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(ledger.file))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

// resolveNode resolves the node executable to an absolute path, searching PATH plus common
// install locations (mirroring FileMigrationRunner.resolveNode).
func resolveNode(cfg *fileconfig.Config) (string, error) {
	configured := cfg.NodeBinary
	if strings.Contains(configured, "/") {
		return configured, nil
	}

	var searched []string
	if path := os.Getenv("PATH"); path != "" {
		for _, dir := range filepath.SplitList(path) {
			if dir != "" {
				searched = append(searched, filepath.Join(dir, configured))
			}
		}
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		searched = append(searched, filepath.Join(home, ".local", "bin", configured))
		nvm := filepath.Join(home, ".nvm", "versions", "node")
		if filesystem.IsDir(nvm) {
			if versions, err := os.ReadDir(nvm); err == nil {
				names := make([]string, 0, len(versions))
				for _, v := range versions {
					if v.IsDir() {
						names = append(names, v.Name())
					}
				}
				sort.Sort(sort.Reverse(sort.StringSlice(names))) // prefer the newest version
				for _, n := range names {
					searched = append(searched, filepath.Join(nvm, n, "bin", configured))
				}
			}
		}
	}
	searched = append(searched, filepath.Join("/usr/local/bin", configured))
	searched = append(searched, filepath.Join("/usr/bin", configured))

	for _, candidate := range searched {
		if IsExecutable(candidate) {
			logMigrate.Info("resolved migration runtime", "configured", configured, "resolved", candidate)
			return candidate, nil
		}
	}
	return "", fmt.Errorf("cannot find the '%s' executable required to run file migrations. "+
		"Install Node.js (e.g. `apt install nodejs`), or set KIAO_WORKER_MIGRATIONS_NODE_BINARY "+
		"to its absolute path, or add its directory to the service PATH. Looked in: %v", configured, searched)
}

func IsExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode().Perm()&0o111 != 0
}
