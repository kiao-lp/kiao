package migrations

import (
	"encoding/json"
	"fmt"
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/core/filesystem"
	fileconfig "kiao/worker/internal/files/configuration"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newMigrationSource(t *testing.T, id string, baseline int) string {
	t.Helper()
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "source.json"), fmt.Sprintf(`{"id":%q,"baseline":%d}`, id, baseline))
	return dir
}

func migrationTestConfig(t *testing.T, base string, extra ...string) *fileconfig.Config {
	t.Helper()
	node, err := execLookNode()
	if err != nil {
		t.Fatal("Node is required for migration runner tests")
	}
	assembly := filepath.Join(t.TempDir(), "sources.json")
	data, err := json.Marshal(fileconfig.MigrationAssembly{Base: base, Additional: extra})
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, assembly, string(data))
	return &fileconfig.Config{Config: &coreconfig.Config{RootPath: t.TempDir(), StatePath: t.TempDir(), NodeBinary: node},
		MigrationsSources: assembly, MigrationsEnabled: true, MigrationsFailOnErr: true, MigrationsTimeout: 5 * time.Second}
}

const traceMigration = `require('fs').appendFileSync(process.argv[2] + '/trace', process.env.KIAO_MIGRATION_SOURCE + ':' + process.env.KIAO_MIGRATION_VERSION + '\n');`

func addTestMigration(t *testing.T, dir string, version int, body string) string {
	t.Helper()
	file := filepath.Join(dir, fmt.Sprintf("V%03d__test.js", version))
	mustWrite(t, file, body)
	return file
}

func runMigrationsOK(t *testing.T, cfg *fileconfig.Config) {
	t.Helper()
	if err := RunMigrations(cfg); err != nil {
		t.Fatal(err)
	}
}

func readTestLedger(t *testing.T, cfg *fileconfig.Config) ledgerData {
	t.Helper()
	var ledger ledgerData
	if err := json.Unmarshal([]byte(mustRead(t, filepath.Join(cfg.StatePath, MigrationLedgerFile))), &ledger); err != nil {
		t.Fatal(err)
	}
	return ledger
}

func TestMigrationIndependentStreamsAndAssemblyChanges(t *testing.T) {
	base := newMigrationSource(t, "base", 0)
	extra := newMigrationSource(t, "extension", 0)
	addTestMigration(t, base, 1, traceMigration)
	addTestMigration(t, extra, 1, traceMigration)
	addTestMigration(t, extra, 9, traceMigration)
	cfg := migrationTestConfig(t, base)
	runMigrationsOK(t, cfg)
	ledger := readTestLedger(t, cfg)
	if len(ledger.Sources) != 1 || ledger.Sources["base"].SchemaVersion != 1 {
		t.Fatalf("base-only ledger: %+v", ledger)
	}
	manifest := cfg.MigrationsSources
	data, _ := json.Marshal(fileconfig.MigrationAssembly{Base: base, Additional: []string{extra}})
	mustWrite(t, manifest, string(data))
	runMigrationsOK(t, cfg)
	addTestMigration(t, base, 2, traceMigration)
	addTestMigration(t, extra, 10, traceMigration)
	runMigrationsOK(t, cfg)
	// Both checkout/installation locations and the assembly manifest may move.
	moved := filepath.Join(t.TempDir(), "installed")
	if err := os.Rename(extra, moved); err != nil {
		t.Fatal(err)
	}
	movedBase := filepath.Join(t.TempDir(), "base")
	if err := os.Rename(base, movedBase); err != nil {
		t.Fatal(err)
	}
	data, _ = json.Marshal(fileconfig.MigrationAssembly{Base: movedBase, Additional: []string{moved}})
	cfg.MigrationsSources = filepath.Join(t.TempDir(), "assembly.json")
	mustWrite(t, cfg.MigrationsSources, string(data))
	runMigrationsOK(t, cfg)
	if got := mustRead(t, filepath.Join(cfg.RootPath, "trace")); got != "base:1\nextension:1\nextension:9\nbase:2\nextension:10\n" {
		t.Fatalf("order or replay: %q", got)
	}
	ledger = readTestLedger(t, cfg)
	if ledger.Sources["base"].SchemaVersion != 2 || ledger.Sources["extension"].SchemaVersion != 10 {
		t.Fatalf("versions are not independent: %+v", ledger.Sources)
	}
	// A base-only restart retains the absent source's history for its later return.
	cfg.MigrationsSources, cfg.MigrationsPath = "", movedBase
	runMigrationsOK(t, cfg)
	if readTestLedger(t, cfg).Sources["extension"].SchemaVersion != 10 {
		t.Fatal("assembly switch discarded an absent source")
	}
}

func TestMigrationFailureStopsEverySourceAndRetries(t *testing.T) {
	for _, failOnError := range []bool{true, false} {
		t.Run(fmt.Sprint(failOnError), func(t *testing.T) {
			base := newMigrationSource(t, "base", 0)
			extra := newMigrationSource(t, "extension", 0)
			addTestMigration(t, base, 1, traceMigration)
			addTestMigration(t, base, 2, `const fs=require('fs'); const root=process.argv[2];
if (!fs.existsSync(root+'/partial')) fs.writeFileSync(root+'/partial','once');
if (!fs.existsSync(root+'/retry')) throw Error('retry requested');`+traceMigration)
			addTestMigration(t, base, 3, traceMigration)
			addTestMigration(t, extra, 1, traceMigration)
			cfg := migrationTestConfig(t, base, extra)
			cfg.MigrationsFailOnErr = failOnError
			if err := RunMigrations(cfg); (err != nil) != failOnError {
				t.Fatalf("failure policy: %v", err)
			}
			if got := mustRead(t, filepath.Join(cfg.RootPath, "trace")); got != "base:1\n" {
				t.Fatalf("failure did not stop all streams: %q", got)
			}
			if readTestLedger(t, cfg).Sources["base"].SchemaVersion != 1 {
				t.Fatal("failed script advanced the ledger")
			}
			mustWrite(t, filepath.Join(cfg.RootPath, "retry"), "ok")
			runMigrationsOK(t, cfg)
			runMigrationsOK(t, cfg)
			if got := mustRead(t, filepath.Join(cfg.RootPath, "trace")); got != "base:1\nbase:2\nbase:3\nextension:1\n" {
				t.Fatalf("retry/restart: %q", got)
			}
		})
	}
}

func TestMigrationChecksumFailurePreventsPendingScripts(t *testing.T) {
	for _, failOnError := range []bool{true, false} {
		t.Run(fmt.Sprint(failOnError), func(t *testing.T) {
			base := newMigrationSource(t, "base", 0)
			extra := newMigrationSource(t, "extension", 0)
			file := addTestMigration(t, extra, 1, traceMigration)
			cfg := migrationTestConfig(t, base, extra)
			runMigrationsOK(t, cfg)
			before := mustRead(t, filepath.Join(cfg.StatePath, MigrationLedgerFile))
			addTestMigration(t, base, 1, traceMigration)
			mustWrite(t, file, traceMigration+"\n// changed")
			cfg.MigrationsFailOnErr = failOnError
			if err := RunMigrations(cfg); (err != nil) != failOnError {
				t.Fatalf("checksum policy: %v", err)
			}
			if got := mustRead(t, filepath.Join(cfg.RootPath, "trace")); got != "extension:1\n" {
				t.Fatalf("pending base ran despite invalid history: %q", got)
			}
			if got := mustRead(t, filepath.Join(cfg.StatePath, MigrationLedgerFile)); got != before {
				t.Fatal("checksum failure changed the ledger")
			}
		})
	}
}

func TestMigrationLockPrecedesLedgerAndCoversAllSources(t *testing.T) {
	base := newMigrationSource(t, "base", 0)
	cfg := migrationTestConfig(t, base)
	mustWrite(t, filepath.Join(cfg.StatePath, MigrationLedgerFile), "invalid json")
	release, locked, err := filesystem.AcquireLock(filepath.Join(cfg.StatePath, migrationLockFile))
	if err != nil || !locked {
		t.Fatalf("lock: %v", err)
	}
	defer release()
	if err := RunMigrations(cfg); err == nil || !strings.Contains(err.Error(), "migration lock") {
		t.Fatalf("ledger was read outside lock: %v", err)
	}
}

func TestMigrationConcurrentStartupDuringAdditionalSource(t *testing.T) {
	base := newMigrationSource(t, "base", 0)
	extra := newMigrationSource(t, "extension", 0)
	addTestMigration(t, base, 1, traceMigration)
	addTestMigration(t, extra, 1, `const fs=require('fs'), root=process.argv[2];
fs.writeFileSync(root+'/started','yes');
const timer=setInterval(() => { if (fs.existsSync(root+'/release')) {
clearInterval(timer); fs.appendFileSync(root+'/trace','extension:1\n'); } }, 10);`)
	cfg := migrationTestConfig(t, base, extra)
	done := make(chan error, 1)
	go func() { done <- RunMigrations(cfg) }()
	defer mustWrite(t, filepath.Join(cfg.RootPath, "release"), "yes")
	deadline := time.Now().Add(4 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(cfg.RootPath, "started")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("additional source did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := RunMigrations(cfg); err == nil || !strings.Contains(err.Error(), "migration lock") {
		t.Fatalf("concurrent startup was not locked out: %v", err)
	}
	mustWrite(t, filepath.Join(cfg.RootPath, "release"), "yes")
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	runMigrationsOK(t, cfg)
	if got := mustRead(t, filepath.Join(cfg.RootPath, "trace")); got != "base:1\nextension:1\n" {
		t.Fatalf("concurrent replay: %q", got)
	}
}

func TestMigrationTimeoutStopsAdditionalStreams(t *testing.T) {
	base := newMigrationSource(t, "base", 0)
	extra := newMigrationSource(t, "extension", 0)
	addTestMigration(t, base, 1, `setTimeout(() => {}, 30000);`)
	addTestMigration(t, extra, 1, traceMigration)
	cfg := migrationTestConfig(t, base, extra)
	cfg.MigrationsTimeout = 200 * time.Millisecond
	if err := RunMigrations(cfg); err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("timeout: %v", err)
	}
	if readTestLedger(t, cfg).Sources["extension"].SchemaVersion != 0 {
		t.Fatal("timeout advanced another source")
	}
}

func TestMigrationLedgerWriteFailureIsAlwaysFatal(t *testing.T) {
	base := newMigrationSource(t, "base", 0)
	cfg := migrationTestConfig(t, base)
	cfg.MigrationsFailOnErr = false
	addTestMigration(t, base, 1, fmt.Sprintf(`require('fs').mkdirSync(%q);`, filepath.Join(cfg.StatePath, MigrationLedgerFile+".tmp")))
	if err := RunMigrations(cfg); err == nil || !strings.Contains(err.Error(), "persist applied migration") {
		t.Fatalf("persistence failure was treated as success: %v", err)
	}
	if readTestLedger(t, cfg).Sources["base"].SchemaVersion != 0 {
		t.Fatal("unpersisted result advanced the durable ledger")
	}
}

func TestMigrationRootBindingAndHistoryValidation(t *testing.T) {
	for _, kind := range []string{"root", "baseline", "missing script", "inserted version", "corrupt history"} {
		t.Run(kind, func(t *testing.T) {
			base := newMigrationSource(t, "base", 0)
			file := addTestMigration(t, base, 2, traceMigration)
			cfg := migrationTestConfig(t, base)
			runMigrationsOK(t, cfg)
			switch kind {
			case "root":
				cfg.RootPath = t.TempDir()
			case "baseline":
				mustWrite(t, filepath.Join(base, "source.json"), `{"id":"base","baseline":1}`)
			case "missing script":
				os.Remove(file)
			case "inserted version":
				addTestMigration(t, base, 1, traceMigration)
			case "corrupt history":
				ledger := readTestLedger(t, cfg)
				ledger.Sources["base"].SchemaVersion = 3
				data, _ := json.Marshal(ledger)
				mustWrite(t, filepath.Join(cfg.StatePath, MigrationLedgerFile), string(data))
			}
			if err := RunMigrations(cfg); err == nil {
				t.Fatalf("invalid %s was accepted", kind)
			}
		})
	}
}

func legacyMigrationLedger(t *testing.T, cfg *fileconfig.Config, version int) {
	t.Helper()
	entries := []ledgerEntry{}
	for i := 1; i <= version; i++ {
		entries = append(entries, ledgerEntry{Version: i, Script: fmt.Sprintf("V%03d__old.js", i)})
	}
	data, _ := json.Marshal(map[string]any{"schemaVersion": version, "dataRoot": cfg.RootPath, "applied": entries})
	mustWrite(t, filepath.Join(cfg.StatePath, MigrationLedgerFile), string(data))
}

func TestMigrationHistoryCutoverAndRestarts(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(fmt.Sprint(existing), func(t *testing.T) {
			base := newMigrationSource(t, "base", 18)
			mustWrite(t, filepath.Join(base, "source.json"), `{"id":"base","baseline":18,"legacyLastScript":"V018__old.js"}`)
			extra := newMigrationSource(t, "extension", 0)
			cfg := migrationTestConfig(t, base, extra)
			if existing {
				legacyMigrationLedger(t, cfg, 18)
			}
			// Stale scripts must block conversion, even under the permissive failure policy.
			stale := addTestMigration(t, base, 1, traceMigration)
			cfg.MigrationsFailOnErr = false
			if err := RunMigrations(cfg); err == nil || !strings.Contains(err.Error(), "retired") {
				t.Fatalf("stale script accepted: %v", err)
			}
			os.Remove(stale)
			runMigrationsOK(t, cfg)
			ledger := readTestLedger(t, cfg)
			if ledger.FormatVersion != 2 || ledger.Sources["base"].SchemaVersion != 18 || len(ledger.Sources["base"].Applied) != 0 {
				t.Fatalf("uncompacted history: %+v", ledger)
			}
			runMigrationsOK(t, cfg)
			addTestMigration(t, base, 19, traceMigration)
			addTestMigration(t, extra, 1, traceMigration)
			runMigrationsOK(t, cfg)
			runMigrationsOK(t, cfg)
			addTestMigration(t, base, 20, traceMigration)
			runMigrationsOK(t, cfg)
			if got := mustRead(t, filepath.Join(cfg.RootPath, "trace")); got != "base:19\nextension:1\nbase:20\n" {
				t.Fatalf("post-cutover replay or skip: %q", got)
			}
		})
	}
}

func TestMigrationRejectsUnsupportedLegacyAndInvalidSources(t *testing.T) {
	base := newMigrationSource(t, "base", 18)
	mustWrite(t, filepath.Join(base, "source.json"), `{"id":"base","baseline":18,"legacyLastScript":"V018__old.js"}`)
	cfg := migrationTestConfig(t, base)
	legacyMigrationLedger(t, cfg, 17)
	before := mustRead(t, filepath.Join(cfg.StatePath, MigrationLedgerFile))
	if err := RunMigrations(cfg); err == nil || !strings.Contains(err.Error(), "pre-cutover") {
		t.Fatalf("old store accepted: %v", err)
	}
	if mustRead(t, filepath.Join(cfg.StatePath, MigrationLedgerFile)) != before {
		t.Fatal("unsupported ledger changed")
	}
	for _, kind := range []string{"missing", "duplicate identity", "duplicate directory", "duplicate version", "both settings"} {
		t.Run(kind, func(t *testing.T) {
			extra := newMigrationSource(t, "extension", 0)
			switch kind {
			case "missing":
				extra = filepath.Join(extra, "missing")
			case "duplicate identity":
				mustWrite(t, filepath.Join(extra, "source.json"), `{"id":"base","baseline":0}`)
			case "duplicate directory":
				extra = base
			case "duplicate version":
				addTestMigration(t, extra, 1, traceMigration)
				mustWrite(t, filepath.Join(extra, "V01__duplicate.js"), traceMigration)
			}
			cfg := migrationTestConfig(t, base, extra)
			if kind == "both settings" {
				cfg.MigrationsPath = base
			}
			if err := RunMigrations(cfg); err == nil {
				t.Fatal("invalid assembly accepted")
			}
			if _, err := os.Stat(filepath.Join(cfg.StatePath, MigrationLedgerFile)); !os.IsNotExist(err) {
				t.Fatal("invalid assembly created a ledger")
			}
		})
	}
}

func TestMigrationDoesNotTreatOldLayoutAsFresh(t *testing.T) {
	base := newMigrationSource(t, "base", 18)
	cfg := migrationTestConfig(t, base)
	legacy := filepath.Join(cfg.RootPath, ".kiao", "migrations.json")
	mustWrite(t, legacy, `{"schemaVersion":7}`)
	if err := RunMigrations(cfg); err == nil || !strings.Contains(err.Error(), "pre-cutover upgrade") {
		t.Fatalf("old layout was treated as current content: %v", err)
	}
	if got := mustRead(t, legacy); got != `{"schemaVersion":7}` {
		t.Fatalf("old provenance was changed: %q", got)
	}
	if _, err := os.Stat(filepath.Join(cfg.StatePath, MigrationLedgerFile)); !os.IsNotExist(err) {
		t.Fatal("old layout was silently baselined")
	}
}
