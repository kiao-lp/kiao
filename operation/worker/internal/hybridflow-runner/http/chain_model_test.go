package runnerhttp

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A stale catalogue or an older conversation default must not change the model the managed
// agent names. Check the actual CLI arguments on both a new conversation and a resumed session.
func TestPlayedCodexTaskKeepsItsManagedModel(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"A Sol task","body":"Do a thing","settings":{"agent":"agent-sol",
		 "effort":"ultra","permission":"bypassPermissions","folder":"/"}}]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-sol": {Name: "Sol", Platform: agentapi.AgentCodex, Model: "gpt-6.1-sol@priority"},
	}}
	binary := filepath.Join(rt.binDir, "codex-stub")
	script := `#!/bin/sh
dir=$(dirname "$0")
printf '%s\n' "$@" >> "$dir/args.jsonl"
cat > /dev/null
printf '%s\n' '{"type":"thread.started","thread_id":"sol-session"}'
printf '%s\n' '{"type":"item.completed","item":{"id":"reply","type":"agent_message","text":"Done."}}'
printf '%s\n' '{"type":"turn.completed"}'
`
	if err := os.WriteFile(binary, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	// This stand-in advertises only GPT-5.1; catalogue membership does not gate an explicit model.
	rt.hub.Agents.Set(agentapi.AgentCodex, codexAgentAt(rt.cfg, binary))

	var chat string
	for play := 0; play < 2; play++ {
		rt.play("flow-node-1")
		rt.waitIdle()
		node := rt.board().FlowNode("flow-node-1")
		if node.Status != pkgBoards.FlowNodeStatusDone {
			t.Fatalf("play %d: status = %q, want done", play, node.Status)
		}
		if play > 0 && node.Chat != chat {
			t.Fatalf("replay chat = %q, want %q", node.Chat, chat)
		}
		chat = node.Chat
		meta, err := rt.convs.Get(chat)
		if err != nil {
			t.Fatal(err)
		}
		if meta.Agent != agentapi.AgentCodex || meta.Model != "gpt-6.1-sol@priority" || meta.Effort != "ultra" {
			t.Fatalf("play %d: conversation settings = %q/%q/%q", play, meta.Agent, meta.Model, meta.Effort)
		}
		if play == 0 {
			if _, err := rt.convs.Update(chat, func(meta *pkgConversations.ConversationMeta) {
				meta.Model, meta.Effort = "gpt-5.6-sol", "low"
			}); err != nil {
				t.Fatal(err)
			}
		}
	}

	args := strings.Split(strings.TrimSpace(rt.invoked()), "\n")
	models := argsAfter(t, args, "-m")
	if len(models) != 2 || models[0] != "gpt-6.1-sol" || models[1] != "gpt-6.1-sol" {
		t.Errorf("CLI models = %q, want Sol 6.1 on both turns", models)
	}
	if !hasArg(args, "resume") || !hasArg(args, "sol-session") {
		t.Error("the second play did not resume the first session")
	}
	for _, override := range []string{`service_tier="priority"`, `model_reasoning_effort="ultra"`} {
		if count := strings.Count(rt.invoked(), override); count != 2 {
			t.Errorf("%s sent %d times, want both turns", override, count)
		}
	}
}
