package runnerhttp

import (
	"encoding/json"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestClaudeContinuationKeepsApprovalsBeforeItsFirstTool(t *testing.T) {
	t.Setenv("CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS", "0")
	t.Setenv("CLAUDE_CODE_BG_TASKS_REPORT_RUNNING", "0")
	for _, resumed := range []bool{false, true} {
		name := "fresh conversation"
		if resumed {
			name = "resumed after observer disconnect"
		}
		t.Run(name, func(t *testing.T) {
			store, cfg := newTurnRegistry(t)
			srv := newSocketTestServerWith(t, cfg, store)
			binary, err := filepath.Abs("../harnesses/claude/testdata/permissions/claude")
			if err != nil {
				t.Fatal(err)
			}
			srv.hub.Harnesses.Set(harnessapi.HarnessClaude, claudeAgentAt(cfg, binary))
			srv.hub.AutoAllowDelay = 25 * time.Millisecond
			ts := httptest.NewServer(srv.handler())
			defer ts.Close()
			defer srv.hub.Shutdown()
			conversation, err := store.Create(pkgConversations.ConversationMeta{
				Folder: "/", Owner: "tester", Harness: harnessapi.HarnessClaude,
				PermissionMode: runnerconfig.PermissionModeManualLive, Model: "opus", Effort: "high", Thinking: true,
			})
			if err != nil {
				t.Fatal(err)
			}
			conn := dialClaude(t, ts.URL)
			defer conn.Close()
			readUntil(t, conn, "hello")
			gate := filepath.Join(cfg.RootPath, "permission-fixture-continue")
			var previous *pkgTurns.Turn
			if resumed {
				sendFrame(t, conn, map[string]any{"type": "prompt", "conversationId": conversation.ID, "prompt": "fixture:tools"})
				readUntil(t, conn, "output")
				previous = srv.hub.GetJob(conversation.ID)
				conn.Close()
				awaitPermissionCondition(t, func() bool { return srv.hub.SubscriberCount(conversation.ID) == 0 })
				mustWrite(t, gate, "")
				awaitProcessRelease(t, previous)
				for _, file := range []string{"permission-fixture-continue", "permission-fixture-first.txt", "permission-fixture-second.txt"} {
					if err := os.Remove(filepath.Join(cfg.RootPath, file)); err != nil {
						t.Fatal(err)
					}
				}
				conn = dialClaude(t, ts.URL)
				defer conn.Close()
				readUntil(t, conn, "hello")
			}
			sendFrame(t, conn, map[string]any{"type": "prompt", "conversationId": conversation.ID, "prompt": "fixture:continuation"})
			readUntil(t, conn, "output")
			job := srv.hub.GetJob(conversation.ID)
			mustWrite(t, gate, "")
			readUntil(t, conn, "done")
			awaitProcessRelease(t, job)
			if previous != nil && previous.Harness() == job.Harness() {
				t.Fatal("the new turn reused the preceding turn's driver")
			}
			records := mustMessages(t, store, conversation.ID)
			reply := records[len(records)-1]
			if reply.Role != pkgConversations.RoleAssistant || reply.ExitCode == nil || *reply.ExitCode != 0 {
				t.Fatalf("continuation outcome = %+v, want a successful reply", reply)
			}
			if len(reply.Asks) != 2 {
				t.Fatalf("permissions = %+v, want both requests after the intermediate result", reply.Asks)
			}
			for _, ask := range reply.Asks {
				if ask.Outcome != pkgConversations.AskOutcomeAllow || ask.DecidedBy != "countdown" {
					t.Fatalf("permission = %+v, want a delivered countdown approval", ask)
				}
			}
			for _, file := range []string{"permission-fixture-first.txt", "permission-fixture-second.txt"} {
				if _, err := os.ReadFile(filepath.Join(cfg.RootPath, file)); err != nil {
					t.Fatalf("continuation did not write %s: %v", file, err)
				}
			}
			meta, err := store.Get(conversation.ID)
			if err != nil || meta.SessionID != "permission-fixture-session" || meta.SessionLost {
				t.Fatalf("session after continuation = %+v, error = %v", meta, err)
			}
			data, err := os.ReadFile(filepath.Join(cfg.RootPath, "permission-fixture-runs.jsonl"))
			if err != nil {
				t.Fatal(err)
			}
			runs := strings.Split(strings.TrimSpace(string(data)), "\n")
			var last struct {
				Resume, EmitState, ReportBackground string
			}
			if err := json.Unmarshal([]byte(runs[len(runs)-1]), &last); err != nil {
				t.Fatal(err)
			}
			if (last.Resume != "") != resumed || last.EmitState != "1" || last.ReportBackground != "1" {
				t.Fatalf("CLI session and state contract = %+v", last)
			}
		})
	}
}
