package runnerhttp

import (
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/core/equipment"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	picli "kiao/worker/internal/hybridflow-runner/agents/pi"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	"path/filepath"
	"testing"
)

func piTestSetup(t *testing.T, binary string) (*runnerconfig.Config, *picli.PiProfiles, *pkgConversations.ConversationStore, pkgConversations.ConversationMeta) {
	t.Helper()
	root := t.TempDir()
	cfg := &runnerconfig.Config{Config: &coreconfig.Config{RootPath: root, StatePath: filepath.Join(root, ".kiao-config"), AuthMode: "debug"}, BypassEnabled: true, MaxTurns: 4}
	if binary == "" {
		var err error
		binary, err = filepath.Abs("../agents/pi/testdata/fake-pi.mjs")
		if err != nil {
			t.Fatal(err)
		}
	}
	profiles := picli.NewPiProfiles(cfg)
	doc := agentapi.PiProfilesDocument{Version: 1, DefaultPiProfileID: "work", Installations: []equipment.AgentInstallation{{ID: "reference", Engine: agentapi.AgentPi, Version: "1.3.0", Path: binary, Protocol: picli.PiRPCProtocol, External: true}}, Profiles: []agentapi.PiProfile{{ID: "work", Name: "Work", InstallationID: "reference", DefaultModel: "openai/shared-model", DefaultEffort: "off", Connections: []agentapi.PiConnection{{Provider: "openai", API: "openai-completions", BaseURL: "http://127.0.0.1:1/v1", Models: []agentapi.PiModel{{ID: "shared-model", Reasoning: true, Input: []string{"text", "image"}, ContextWindow: 10000, MaxTokens: 1024}}}}}}}
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	store, err := pkgConversations.NewConversationStore(filepath.Join(cfg.StatePath, pkgConversations.ConversationsDirName))
	if err != nil {
		t.Fatal(err)
	}
	meta, err := store.Create(pkgConversations.ConversationMeta{Agent: agentapi.AgentPi, ProfileID: "work", Model: "openai/shared-model", Effort: "off", PermissionMode: runnerconfig.PermissionModeBypass, Thinking: true})
	if err != nil {
		t.Fatal(err)
	}
	return cfg, profiles, store, meta
}
