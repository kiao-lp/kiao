package assembly

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/hybridflow-runner/conversations"
)

// AdoptHarnessState upgrades only runner-owned records while the process holds the state lock.
func AdoptHarnessState(state string) error {
	if strings.TrimSpace(state) == "" {
		return filesystem.ErrEmptyStatePath
	}
	marker := filepath.Join(state, "harness-state.json")
	if body, err := os.ReadFile(marker); err == nil {
		var version struct {
			Version int `json:"version"`
		}
		if json.Unmarshal(body, &version) != nil || version.Version != 1 {
			return fmt.Errorf("unsupported harness state version in %s", marker)
		}
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	renamed := [][2]string{{"agent-profiles.json", "harness-profiles.json"}, {"agent-secrets", "harness-secrets"}}
	for _, pair := range renamed {
		old, next := filepath.Join(state, pair[0]), filepath.Join(state, pair[1])
		if _, err := os.Lstat(old); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		if _, err := os.Lstat(next); err == nil {
			return fmt.Errorf("both %s and %s exist; reconcile their contents before starting", old, next)
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	for _, pair := range renamed {
		if err := os.Rename(filepath.Join(state, pair[0]), filepath.Join(state, pair[1])); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	for _, family := range []string{"conversations", "chain-runs"} {
		entries, err := os.ReadDir(filepath.Join(state, family))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if !entry.IsDir() || (family == "conversations" && !conversations.ConversationIDRe.MatchString(entry.Name())) {
				continue
			}
			dir := filepath.Join(state, family, entry.Name())
			paths := []string{filepath.Join(dir, "run.jsonl")}
			if family == "conversations" {
				paths = []string{filepath.Join(dir, "meta.json"), filepath.Join(dir, "transcript.jsonl")}
				traces, err := filepath.Glob(filepath.Join(dir, "turns", "turn-*.jsonl"))
				if err != nil {
					return err
				}
				paths = append(paths, traces...)
			}
			for _, path := range paths {
				if err := adoptHarnessRecord(path); err != nil {
					return fmt.Errorf("upgrade harness state %s: %w", path, err)
				}
			}
		}
	}
	if err := os.MkdirAll(state, 0o700); err != nil {
		return err
	}
	return filesystem.WriteFileAtomic(marker, []byte("{\"version\":1}\n"), 0o600)
}

func adoptHarnessRecord(path string) error {
	body, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	lines := [][]byte{body}
	if strings.HasSuffix(path, ".jsonl") {
		lines = bytes.Split(body, []byte{'\n'})
	}
	changed := false
	for i, line := range lines {
		var record map[string]json.RawMessage
		if json.Unmarshal(line, &record) != nil || record == nil {
			continue
		}
		updated := renameHarnessField(record, "agent")
		var asks []map[string]json.RawMessage
		if json.Unmarshal(record["asks"], &asks) == nil {
			changedAsks := false
			for _, ask := range asks {
				if bytes.Equal(ask["decidedBy"], []byte(`"agent"`)) {
					ask["decidedBy"] = json.RawMessage(`"harness"`)
					changedAsks = true
				}
			}
			if changedAsks {
				record["asks"], err = json.Marshal(asks)
				if err != nil {
					return err
				}
				updated = true
			}
		}
		var version map[string]json.RawMessage
		if json.Unmarshal(record["agentVersion"], &version) == nil && version != nil && renameHarnessField(version, "platform") {
			record["agentVersion"], err = json.Marshal(version)
			if err != nil {
				return err
			}
			updated = true
		}
		if updated {
			lines[i], err = json.Marshal(record)
			if err != nil {
				return err
			}
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return filesystem.WriteFileAtomic(path, bytes.Join(lines, []byte{'\n'}), filesystem.ExistingFileMode(path, 0o600))
}

func renameHarnessField(record map[string]json.RawMessage, old string) bool {
	value, exists := record[old]
	if !exists {
		return false
	}
	if _, current := record["harness"]; !current {
		record["harness"] = value
	}
	delete(record, old)
	return true
}
