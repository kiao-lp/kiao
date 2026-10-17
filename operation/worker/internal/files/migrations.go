package files

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// File-store migrations (kiao.worker.FileMigrationRunner): versioned V<NNN>__<name>.js
// scripts are run once, in order, via `node`, and recorded in a ledger that lives with the rest of
// the service's own state, at <StatePath>/files-migrations.json.

const (
	migrationLedgerFile = "files-migrations.json"
	migrationLockFile   = "files-migrations.lock"
)

var migrationNameRe = regexp.MustCompile(`^V(\d+)__(.+)\.js$`)

type migrationScript struct {
	version  int
	name     string
	fileName string
	path     string
	checksum string
}

type ledgerEntry struct {
	Version    int    `json:"version"`
	Name       string `json:"name"`
	Script     string `json:"script"`
	Checksum   string `json:"checksum"`
	AppliedAt  string `json:"appliedAt"`
	DurationMs int64  `json:"durationMs"`
}

type ledgerData struct {
	SchemaVersion int           `json:"schemaVersion"`
	Applied       []ledgerEntry `json:"applied"`
	// DataRoot records which store the versions above were applied to. The ledger used to live
	// inside that store and could not be wrong about it; now it lives with the service's own state,
	// which one home directory shares between every store the user ever points a service at. A
	// ledger read against a different root would skip every migration as already applied, so the
	// root is recorded and a mismatch is warned about loudly — see migrate.
	DataRoot string `json:"dataRoot,omitempty"`
}

type migrationLedger struct {
	file          string
	schemaVersion int
	applied       []ledgerEntry
	dataRoot      string
}

// RunMigrations applies pending migrations on startup. It returns an error (which aborts
// startup) when a migration fails and failOnError is set.
func RunMigrations(cfg *Config) error {
	if !cfg.MigrationsEnabled {
		logMigrate.Info("file migrations disabled; skipping")
		return nil
	}
	if strings.TrimSpace(cfg.MigrationsPath) == "" {
		logMigrate.Info("no migrations path configured; skipping")
		return nil
	}
	migrationsDir := cfg.MigrationsPath
	if !core.IsDir(migrationsDir) {
		logMigrate.Warn("migrations path is not a directory; skipping", "path", migrationsDir)
		return nil
	}
	return migrate(cfg, cfg.RootPath, migrationsDir)
}

func migrate(cfg *Config, dataRoot, migrationsDir string) error {
	scripts, err := discoverMigrations(migrationsDir)
	if err != nil {
		return err
	}
	ledger, err := loadLedger(cfg.StatePath)
	if err != nil {
		return err
	}
	// A warning rather than a refusal: pointing one machine's service at a second store is a
	// legitimate thing to do, and the fix is a second KIAO_WORKER_STATE_PATH — but doing it
	// unknowingly means this store is silently declared migrated to a version nothing ever applied
	// to it, which is a discovery nobody should have to make from a broken document.
	if ledger.dataRoot != "" && ledger.dataRoot != dataRoot {
		logMigrate.Warn("the migration ledger was written for a different data root; this store may "+
			"be treated as migrated when it is not — give this service its own "+
			"KIAO_WORKER_STATE_PATH",
			"ledger", ledger.file, "ledger_root", ledger.dataRoot, "data_root", dataRoot)
	}
	ledger.dataRoot = dataRoot

	if err := validateAlreadyApplied(scripts, ledger, cfg.MigrationsFailOnErr); err != nil {
		return err
	}

	var pending []migrationScript
	for _, s := range scripts {
		if s.version > ledger.schemaVersion {
			pending = append(pending, s)
		}
	}
	if len(pending) == 0 {
		logMigrate.Info("file store up to date; nothing to apply",
			"version", ledger.schemaVersion, "scripts_on_disk", len(scripts))
		return nil
	}
	logMigrate.Info("applying pending migrations",
		"version", ledger.schemaVersion, "pending", len(pending))
	// Logged before the first script runs, and only when something is actually going to run: what a
	// migration left alone is invisible afterwards, so the one chance to record that a rule was in
	// force — or that the operator's file has a typo in its name and none was — is here.

	node, err := resolveNode(cfg)
	if err != nil {
		return err
	}

	// The state directory is created at startup, before anything under it is read or written, so
	// the lock file only has to be opened here.
	release, locked, err := core.AcquireLock(filepath.Join(cfg.StatePath, migrationLockFile))
	if err != nil {
		return fmt.Errorf("failed to acquire migration lock: %w", err)
	}
	if !locked {
		return fmt.Errorf("another process holds the migration lock; aborting")
	}
	defer release()

	for _, script := range pending {
		applied, fatal := applyOne(cfg, node, script, dataRoot, ledger)
		if fatal != nil {
			return fatal
		}
		if !applied {
			logMigrate.Warn("migrations halted", "version", ledger.schemaVersion)
			return nil
		}
	}
	logMigrate.Info("file store migrated", "version", ledger.schemaVersion)
	return nil
}

// applyOne runs a single migration. It returns (applied, fatalErr): applied=false with a nil
// fatal means a non-fatal failure that halts the batch (failOnError=false).
func applyOne(cfg *Config, node string, script migrationScript, dataRoot string, ledger *migrationLedger) (bool, error) {
	logMigrate.Info("applying migration", "script", script.fileName)
	start := time.Now()
	result := core.RunProc(
		[]string{node, script.path, dataRoot},
		dataRoot,
		cfg.MigrationsTimeout,
		// The declaration a script must honour is no longer passed: `.kiao-files` sits at the data
		// root under a fixed name, and nested ones are found by walking down from it, so a script
		// resolves the whole set from KIAO_DATA_ROOT alone. The state directory being configurable
		// was the only reason the old migration-ignore had to be named here.
		map[string]string{
			"KIAO_DATA_ROOT":         dataRoot,
			"KIAO_MIGRATION_VERSION": strconv.Itoa(script.version),
		},
	)
	durationMs := time.Since(start).Milliseconds()
	output := result.Combined()

	if result.OK() {
		if strings.TrimSpace(output) != "" {
			logMigrate.Info("migration output", "script", script.fileName, "output", output)
		}
		if err := ledger.record(script, durationMs); err != nil {
			return false, err
		}
		logMigrate.Info("applied migration", "script", script.fileName, "duration_ms", durationMs)
		return true, nil
	}

	message := fmt.Sprintf("migration %s failed (exit %d):\n%s", script.fileName, result.Exit, output)
	if cfg.MigrationsFailOnErr {
		return false, fmt.Errorf("%s", message)
	}
	logMigrate.Warn("migration failed; halting further migrations (failOnError=false)", "detail", message)
	return false, nil
}

// discoverMigrations finds valid V<NNN>__<name>.js scripts in dir, sorted by ascending version.
func discoverMigrations(dir string) ([]migrationScript, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to list migration scripts in %s: %w", dir, err)
	}
	var scripts []migrationScript
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		m := migrationNameRe.FindStringSubmatch(e.Name())
		if m == nil {
			logMigrate.Info("ignoring non-migration file in migrations dir", "name", e.Name())
			continue
		}
		version, _ := strconv.Atoi(m[1])
		full := filepath.Join(dir, e.Name())
		sum, err := fileChecksum(full)
		if err != nil {
			return nil, err
		}
		scripts = append(scripts, migrationScript{
			version: version, name: m[2], fileName: e.Name(), path: full, checksum: sum,
		})
	}
	sort.Slice(scripts, func(i, j int) bool { return scripts[i].version < scripts[j].version })
	for i := 1; i < len(scripts); i++ {
		if scripts[i].version == scripts[i-1].version {
			return nil, fmt.Errorf("duplicate migration version %d: %s and %s",
				scripts[i].version, scripts[i-1].fileName, scripts[i].fileName)
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

func loadLedger(statePath string) (*migrationLedger, error) {
	file := filepath.Join(statePath, migrationLedgerFile)
	data, err := os.ReadFile(file)
	if err != nil {
		if os.IsNotExist(err) {
			return &migrationLedger{file: file, schemaVersion: 0, applied: []ledgerEntry{}}, nil
		}
		return nil, fmt.Errorf("failed to read migration ledger %s: %w", file, err)
	}
	var d ledgerData
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("failed to parse migration ledger %s: %w", file, err)
	}
	if d.Applied == nil {
		d.Applied = []ledgerEntry{}
	}
	return &migrationLedger{
		file:          file,
		schemaVersion: d.SchemaVersion,
		applied:       d.Applied,
		dataRoot:      d.DataRoot,
	}, nil
}

func (l *migrationLedger) findApplied(version int) (ledgerEntry, bool) {
	for _, e := range l.applied {
		if e.Version == version {
			return e, true
		}
	}
	return ledgerEntry{}, false
}

func (l *migrationLedger) record(script migrationScript, durationMs int64) error {
	l.applied = append(l.applied, ledgerEntry{
		Version:    script.version,
		Name:       script.name,
		Script:     script.fileName,
		Checksum:   script.checksum,
		AppliedAt:  time.Now().UTC().Format(time.RFC3339),
		DurationMs: durationMs,
	})
	if script.version > l.schemaVersion {
		l.schemaVersion = script.version
	}
	return l.persist()
}

func (l *migrationLedger) persist() error {
	if err := os.MkdirAll(filepath.Dir(l.file), 0o755); err != nil {
		return err
	}
	out, err := json.MarshalIndent(ledgerData{
		SchemaVersion: l.schemaVersion,
		Applied:       l.applied,
		DataRoot:      l.dataRoot,
	}, "", "  ")
	if err != nil {
		return err
	}
	tmp := l.file + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, l.file)
}

func validateAlreadyApplied(scripts []migrationScript, ledger *migrationLedger, failOnError bool) error {
	for _, s := range scripts {
		if s.version > ledger.schemaVersion {
			continue
		}
		entry, ok := ledger.findApplied(s.version)
		if !ok {
			logMigrate.Warn("migration is below current version but not recorded in the ledger; skipping",
				"script", s.fileName, "version", s.version, "current_version", ledger.schemaVersion)
			continue
		}
		if entry.Checksum != s.checksum {
			message := fmt.Sprintf("checksum mismatch for already-applied migration %s: ledger=%s disk=%s",
				s.fileName, entry.Checksum, s.checksum)
			if failOnError {
				return fmt.Errorf("%s", message)
			}
			logMigrate.Warn("checksum mismatch; continuing (failOnError=false)", "detail", message)
		}
	}
	return nil
}

// resolveNode resolves the node executable to an absolute path, searching PATH plus common
// install locations (mirroring FileMigrationRunner.resolveNode).
func resolveNode(cfg *Config) (string, error) {
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
		if core.IsDir(nvm) {
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
		if isExecutable(candidate) {
			logMigrate.Info("resolved migration runtime", "configured", configured, "resolved", candidate)
			return candidate, nil
		}
	}
	return "", fmt.Errorf("cannot find the '%s' executable required to run file migrations. "+
		"Install Node.js (e.g. `apt install nodejs`), or set KIAO_WORKER_MIGRATIONS_NODE_BINARY "+
		"to its absolute path, or add its directory to the service PATH. Looked in: %v", configured, searched)
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode().Perm()&0o111 != 0
}
