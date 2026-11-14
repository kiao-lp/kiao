package assembly

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAdoptHarnessStatePreservesWorkflowHarnessesAndNativeSessions(t *testing.T) {
	state := t.TempDir()
	conv := "conversations/conv-1700000000000-abcd/"
	files := map[string]string{
		"agent-profiles.json":                        `{"version":1,"profiles":[{"id":"account","name":"agent platform"}]}`,
		"agent-secrets/key":                          "private-value",
		conv + "meta.json":                           `{"id":"conv-1700000000000-abcd","agent":"codex","sessionId":"native-session","agentVersion":{"agentId":"workflow-agent","platform":"codex","instructions":"agent platform"},"extra":{"agent":"untouched"}}`,
		conv + "transcript.jsonl":                    "{\"role\":\"user\",\"text\":\"agent platform\",\"agentRef\":\"workflow-agent\",\"agentVersion\":3}\n",
		conv + "turns/turn-1700000000000-abcd.jsonl": "{\"kind\":\"start\",\"agent\":\"codex\",\"agentRef\":\"workflow-agent\"}\n{partial",
		conv + "pi/native.jsonl":                     `{"agent":"native-protocol","platform":"external"}`,
		"chain-runs/run-example/run.jsonl":           "{\"kind\":\"turn\",\"agent\":\"codex\",\"text\":\"agent platform\"}\n",
	}
	for name, body := range files {
		path := filepath.Join(state, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := AdoptHarnessState(state); err != nil {
		t.Fatal(err)
	}
	read := func(name string) string {
		t.Helper()
		body, err := os.ReadFile(filepath.Join(state, name))
		if err != nil {
			t.Fatal(err)
		}
		return string(body)
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(read(conv+"meta.json")), &meta); err != nil {
		t.Fatal(err)
	}
	version := meta["agentVersion"].(map[string]any)
	if meta["harness"] != "codex" || meta["agent"] != nil || meta["sessionId"] != "native-session" ||
		version["agentId"] != "workflow-agent" || version["harness"] != "codex" || version["platform"] != nil ||
		version["instructions"] != "agent platform" || meta["extra"].(map[string]any)["agent"] != "untouched" {
		t.Fatalf("metadata changed incorrectly: %#v", meta)
	}
	for _, name := range []string{conv + "transcript.jsonl", conv + "pi/native.jsonl"} {
		if read(name) != files[name] {
			t.Fatalf("%s changed", name)
		}
	}
	if read("harness-profiles.json") != files["agent-profiles.json"] || read("harness-secrets/key") != "private-value" {
		t.Fatal("profile or credentials changed")
	}
	trace := read(conv + "turns/turn-1700000000000-abcd.jsonl")
	if !strings.Contains(trace, `"harness":"codex"`) || !strings.HasSuffix(trace, "\n{partial") {
		t.Fatalf("trace or partial final record changed incorrectly: %s", trace)
	}
	before := read(conv + "meta.json")
	if err := AdoptHarnessState(state); err != nil {
		t.Fatal(err)
	}
	if read(conv+"meta.json") != before {
		t.Fatal("a second adoption rewrote metadata")
	}
	info, err := os.Stat(filepath.Join(state, conv, "meta.json"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("metadata permissions: %v, %v", info, err)
	}
}

func TestAdoptHarnessStateRefusesCollisionsBeforeMovingCredentials(t *testing.T) {
	state := t.TempDir()
	for _, name := range []string{"agent-profiles.json", "agent-secrets", "harness-secrets"} {
		if err := os.WriteFile(filepath.Join(state, name), []byte(name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := AdoptHarnessState(state); err == nil {
		t.Fatal("a credential collision must be reported")
	}
	if _, err := os.Stat(filepath.Join(state, "agent-profiles.json")); err != nil {
		t.Fatal("a collision moved the profile before checking credentials")
	}
}
