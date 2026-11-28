package postgres

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"kiao/hybridflow-store/adapters/auth"
	"kiao/hybridflow-store/adapters/httpapi"
	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestExecutionAPIRecordsSharedAgentPublication(t *testing.T) {
	pool, boards, nodes, boardStore, _ := wireUsage(t)
	id := aiUsageNode(t, boards, nodes, "Shared agent")
	handler := httpapi.New(httpapi.Options{
		Executions: services.NewExecutions(NewExecutionStore(pool), boardStore),
	}).Handler(auth.New(auth.Options{Mode: "debug"}), nil)
	path := "/boards/shared-agent/flow-nodes/" + id + "/executions"
	body := `{
		"id":"turn-shared", "conversationId":"conversation", "turnId":"turn-shared",
		"harness":"codex", "model":"test-model", "effort":"high", "at":"2026-11-22T07:11:28Z",
		"agent":{
			"agentId":"coder", "name":"Coder", "version":"1.0.0", "tag":"v1.0.0",
			"commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "repository":"agent-coder",
			"harness":"codex", "harnesses":["codex","claude"], "supersedes":["old-coder"],
			"model":"", "resolvedModel":"test-model", "resolvedEffort":"high", "publishedAt":"2026-11-21T18:00:00Z"
		}
	}`
	for range 2 {
		res := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusNoContent {
			t.Fatalf("record execution: %d %s", res.Code, res.Body)
		}
	}

	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
	if res.Code != http.StatusOK {
		t.Fatalf("list executions: %d %s", res.Code, res.Body)
	}
	var records []struct {
		Agent struct {
			Version    string   `json:"version"`
			Harnesses  []string `json:"harnesses"`
			Supersedes []string `json:"supersedes"`
		} `json:"agent"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &records); err != nil || len(records) != 1 {
		t.Fatalf("executions: %s (%v)", res.Body, err)
	}
	agent := records[0].Agent
	if agent.Version != "1.0.0" || !slices.Equal(agent.Harnesses, []string{"codex", "claude"}) || !slices.Equal(agent.Supersedes, []string{"old-coder"}) {
		t.Fatalf("recorded agent = %+v", agent)
	}
}

func TestExecutionProvenanceIsImmutableAndReplayIsIdempotent(t *testing.T) {
	pool, boards, nodes, _, _ := wireUsage(t)
	id := aiUsageNode(t, boards, nodes, "Execution")
	store := NewExecutionStore(pool)
	ctx := context.Background()
	execution := entities.TaskExecution{
		ID: "turn-one", FlowNodeID: id, ConversationID: "conversation", TurnID: "turn-one",
		RunnerID: "runner", Harness: "claude", Model: "opus", Effort: "high", At: time.Now().UTC(),
		Agent: entities.ExecutedAgent{
			AgentVersion: entities.AgentVersion{AgentID: testAgentID, Name: "Reviewer", Harness: entities.HarnessClaude,
				Model: "opus", Effort: "high", Repository: "agent-reviewer", Commit: strings.Repeat("a", 40), Instructions: "Frozen instructions"},
			Version: json.RawMessage(`"2.4.1"`),
		},
	}
	older := execution
	older.ID, older.TurnID, older.At = "turn-zero", "turn-zero", execution.At.Add(-time.Minute)
	older.Agent.Version = json.RawMessage(`7`)
	older.Agent.Tag = "v2.4.0"
	for range 2 {
		if err := store.RecordExecution(ctx, older); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.RecordExecution(ctx, execution); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordExecution(ctx, execution); err != nil {
		t.Fatal(err)
	}
	execution.Model = "another-model"
	if err := store.RecordExecution(ctx, execution); err == nil {
		t.Fatal("replayed different provenance under the same execution id")
	}
	if _, err := pool.Exec(ctx, `UPDATE task_execution SET effort='low' WHERE id='turn-one'`); err == nil {
		t.Fatal("updated immutable provenance")
	}
	records, err := store.Executions(ctx, id)
	if err != nil || len(records) != 2 || records[1].Model != "opus" || records[1].Agent.Instructions != "Frozen instructions" ||
		records[1].Agent.Commit != strings.Repeat("a", 40) || string(records[1].Agent.Version) != `"2.4.1"` ||
		string(records[0].Agent.Version) != `"2.4.0"` {
		t.Fatalf("stored executions: %+v %v", records, err)
	}
}
