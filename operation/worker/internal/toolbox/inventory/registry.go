package inventory

import (
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/filesystem"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	"os"
	"sort"
	"sync"
	"time"
)

// Entry records installation ownership, turn registration and handshake health
// independently. Uninstall must not remove tools merely detected on the machine.
type Entry struct {
	// Installed records service-owned installs, never tools detected by probe.
	Installed bool `json:"installed"`
	// Enabled is whether the MCP server is handed to a turn. Meaningless for a runtime.
	Enabled bool `json:"enabled"`

	Version     string `json:"version,omitempty"`
	InstalledAt string `json:"installedAt,omitempty"`

	// Command and Args are discovered at install time, not guessed from the catalogue.
	// Empty for runtimes and remote servers.
	Command string   `json:"command,omitempty"`
	Args    []string `json:"args,omitempty"`

	// Tools and ToolBytes measure the handshake tool count and per-request definition cost.
	Tools     int `json:"tools,omitempty"`
	ToolBytes int `json:"toolBytes,omitempty"`

	// Empty ProbedAt means unprobed; ProbeError means the handshake failed.
	// Installation success does not imply a working server; reinstall repairs probe failures.
	ProbedAt   string `json:"probedAt,omitempty"`
	ProbeError string `json:"probeError,omitempty"`
}

// Ledger persists entries and guards panel reads against job writes.
type Ledger struct {
	path string

	mu      sync.RWMutex
	entries map[string]Entry
}

type ledgerDoc struct {
	Version int              `json:"version"`
	Entries map[string]Entry `json:"entries"`
}

const ledgerVersion = 1

// Reject corrupt ledgers: starting empty would lose ownership records on the next write.
func OpenLedger(path string) (*Ledger, error) {
	l := &Ledger{path: path, entries: map[string]Entry{}}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return l, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the toolbox ledger %s: %w", path, err)
	}
	var doc ledgerDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parsing the toolbox ledger %s: %w", path, err)
	}
	if doc.Entries != nil {
		l.entries = doc.Entries
	}
	return l, nil
}

func (l *Ledger) Get(id string) (Entry, bool) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	e, ok := l.entries[id]
	return e, ok
}

func (l *Ledger) EnabledServers() []string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	var ids []string
	for id, e := range l.entries {
		if e.Enabled {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

func (l *Ledger) Put(id string, e Entry) error {
	l.mu.Lock()
	l.entries[id] = e
	err := l.flushLocked()
	l.mu.Unlock()
	return err
}

func (l *Ledger) Remove(id string) error {
	l.mu.Lock()
	delete(l.entries, id)
	err := l.flushLocked()
	l.mu.Unlock()
	return err
}

// setEnabled registers servers independently of installation, including bundled
// and remote servers that have nothing to install.
func (l *Ledger) SetEnabled(id string, enabled bool) error {
	l.mu.Lock()
	e := l.entries[id]
	e.Enabled = enabled
	l.entries[id] = e
	err := l.flushLocked()
	l.mu.Unlock()
	return err
}

// flushLocked requires l.mu and atomically replaces the ledger document.
func (l *Ledger) flushLocked() error {
	body, err := json.MarshalIndent(ledgerDoc{Version: ledgerVersion, Entries: l.entries}, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding the toolbox ledger: %w", err)
	}
	if err := filesystem.WriteFileAtomic(l.path, append(body, '\n'), 0o600); err != nil {
		return fmt.Errorf("writing the toolbox ledger %s: %w", l.path, err)
	}
	return nil
}

// seed adopts configured servers when entries are empty; the ledger then becomes
// authoritative instead of the environment variable.
func (l *Ledger) Seed(ids []string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.entries) > 0 {
		return nil
	}
	for _, id := range ids {
		l.entries[id] = Entry{Enabled: true}
	}
	if len(l.entries) == 0 {
		return nil
	}
	LogToolbox.Info("toolbox ledger seeded from the configured MCP servers", "servers", ids)
	return l.flushLocked()
}

// orphans lists installed components removed from the catalogue. Keep their
// records so ownership of files still on the machine is not lost.
func (l *Ledger) Orphans(catalog *toolcatalog.Catalog) []string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	var ids []string
	for id, e := range l.entries {
		if _, known := catalog.Get(id); !known && e.Installed {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

func Stamp() string { return time.Now().UTC().Format(time.RFC3339) }
