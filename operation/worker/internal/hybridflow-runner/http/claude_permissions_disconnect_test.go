package runnerhttp

import (
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestClaudePermissionsAfterObserverDisconnects(t *testing.T) {
	for _, scenario := range []struct {
		name, mode, prompt string
		failure            bool
	}{
		{"countdown", runnerconfig.PermissionModeManualLive, "fixture:tools", false},
		{"manual", runnerconfig.PermissionModeManual, "fixture:tools", false},
		{"closed approval stream", runnerconfig.PermissionModeManualLive, "fixture:approval-stream-closed", true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			store, cfg := newTurnRegistry(t)
			srv := newSocketTestServerWith(t, cfg, store)
			binary, err := filepath.Abs("../harnesses/claude/testdata/permissions/claude")
			if err != nil {
				t.Fatal(err)
			}
			srv.hub.Harnesses.Set(harnessapi.HarnessClaude, claudeAgentAt(cfg, binary))
			srv.hub.AutoAllowDelay = 50 * time.Millisecond
			ts := httptest.NewServer(srv.handler())
			defer ts.Close()
			defer srv.hub.Shutdown()
			conversation, err := store.Create(pkgConversations.ConversationMeta{
				Folder: "/", Owner: "tester", Harness: harnessapi.HarnessClaude,
				PermissionMode: scenario.mode, Model: "opus", Effort: "high", Thinking: true,
			})
			if err != nil {
				t.Fatal(err)
			}
			conn := dialClaude(t, ts.URL)
			defer conn.Close()
			readUntil(t, conn, "hello")
			sendFrame(t, conn, map[string]any{"type": "prompt", "conversationId": conversation.ID, "prompt": scenario.prompt})
			readUntil(t, conn, "permission_request")
			if scenario.mode == runnerconfig.PermissionModeManual {
				sendFrame(t, conn, map[string]any{"type": "permission_decision", "conversationId": conversation.ID,
					"requestId": "first", "behavior": "allow"})
			}
			readUntil(t, conn, "output")
			job := srv.hub.GetJob(conversation.ID)
			conn.Close()
			awaitPermissionCondition(t, func() bool { return srv.hub.SubscriberCount(conversation.ID) == 0 })
			if err := os.WriteFile(filepath.Join(cfg.RootPath, "permission-fixture-continue"), nil, 0o600); err != nil {
				t.Fatal(err)
			}
			if scenario.mode == runnerconfig.PermissionModeManual {
				awaitPermissionCondition(t, func() bool {
					job.Mu.Lock()
					defer job.Mu.Unlock()
					return len(job.Pending) == 1
				})
				conn = dialClaude(t, ts.URL)
				defer conn.Close()
				readUntil(t, conn, "hello")
				sendFrame(t, conn, map[string]any{"type": "subscribe", "conversationId": conversation.ID})
				sync := readUntil(t, conn, "sync")
				pending, _ := sync["pendingPermissions"].([]any)
				if len(pending) != 1 || pending[0].(map[string]any)["requestId"] != "second" {
					t.Fatalf("pending requests after reconnect = %v", pending)
				}
				sendFrame(t, conn, map[string]any{"type": "permission_decision", "conversationId": conversation.ID,
					"requestId": "second", "behavior": "allow"})
			}
			awaitProcessRelease(t, job)
			records, err := store.Messages(conversation.ID)
			if err != nil {
				t.Fatal(err)
			}
			// A failed approval channel also drops the session, so its notice can follow the reply.
			last := records[len(records)-1]
			for i := len(records) - 1; i >= 0; i-- {
				if records[i].Role == pkgConversations.RoleAssistant {
					last = records[i]
					break
				}
			}
			if last.ExitCode == nil || (*last.ExitCode != 0) != scenario.failure || last.Interrupted {
				t.Fatalf("unexpected turn outcome: %+v", last)
			}
			second := filepath.Join(cfg.RootPath, "permission-fixture-second.txt")
			if scenario.failure {
				if last.Terminal != "permission_channel_closed" || !strings.Contains(last.EndReason, "approval channel closed") {
					t.Fatalf("failure reason = %q, terminal = %q", last.EndReason, last.Terminal)
				}
				if _, err := os.Stat(second); !os.IsNotExist(err) {
					t.Fatalf("failed tool wrote a file: %v", err)
				}
				if strings.Contains(last.BlockTail(), "Incorrectly continuing") {
					t.Fatal("the failed turn continued consuming model output")
				}
			} else {
				if _, err := os.ReadFile(second); err != nil {
					t.Fatalf("tool did not write after disconnect: %v", err)
				}
				if len(last.Asks) != 2 || last.Asks[1].Outcome != pkgConversations.AskOutcomeAllow {
					t.Fatalf("recorded permissions = %+v", last.Asks)
				}
				by := "countdown"
				if scenario.mode == runnerconfig.PermissionModeManual {
					by = "anonymous"
				}
				if last.Asks[1].DecidedBy != by {
					t.Fatalf("second approval by %q, want %q", last.Asks[1].DecidedBy, by)
				}
			}
		})
	}
}

func awaitPermissionCondition(t *testing.T, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !ready() {
		if time.Now().After(deadline) {
			t.Fatal("permission condition not reached")
		}
		time.Sleep(2 * time.Millisecond)
	}
}
