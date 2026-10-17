package hybridflowrunner

import (
	"bytes"
	"encoding/json"
	"kiao/worker/internal/core"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// newConversationTestServer builds a Service wired for the conversation endpoints, in debug auth
// mode (all requests permitted), over a fresh store root and a state directory of its own.
func newConversationTestServer(t *testing.T) (*Service, *Config) {
	t.Helper()
	cfg := &Config{
		Config: &core.Config{AuthMode: "debug", RootPath: t.TempDir(), StatePath: t.TempDir(), MaxUploadBytes: 1 << 20},
		// What LoadConfig defaults it to; a hand-built Config leaves it false, which is the
		// bypass-less deployment TestConversationsWithoutBypass covers.
		BypassEnabled: true,
	}
	store, err := newConversationStore(filepath.Join(cfg.StatePath, ConversationsDirName))
	if err != nil {
		t.Fatalf("newConversationStore: %v", err)
	}
	hub := newClaudeHub(cfg, store)
	svc := &Service{cfg: cfg, conversations: store, hub: hub}
	svc.bindAgents(hub.agents)
	return svc, cfg
}

// jsonReq builds a request carrying a JSON body, which is how create and patch are called.
func jsonReq(method, target, body string) *http.Request {
	req := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

// mustCreateThroughHandlers runs a create through the whole chain and decodes it.
func mustCreateThroughHandlers(t *testing.T, s *Service, body string) AgentConversationDto {
	t.Helper()
	rec := do(s, jsonReq(http.MethodPost, "/claude/conversations", body))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: status = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	var dto AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	return dto
}

// ── the status mapping is the contract ────────────────────────────────────────

// Every refusal has to arrive as the code the client branches on: a stale link is not a bug in the
// client, a folder outside the store is not a missing one, and a full registry is not a server
// error.
func TestConversationEndpointsStatusMapping(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	mustMkdir(t, cfg.RootPath, "units/demo")
	existing := mustCreateThroughHandlers(t, s, `{"folder": "units/demo"}`)

	cases := []struct {
		name string
		req  *http.Request
		want int
	}{
		{"unknown id", httptest.NewRequest(http.MethodGet, "/claude/conversations/conv-1700000000000-abcd", nil), http.StatusNotFound},
		{"malformed id", httptest.NewRequest(http.MethodGet, "/claude/conversations/not-an-id", nil), http.StatusBadRequest},
		{"malformed id on patch", jsonReq(http.MethodPatch, "/claude/conversations/not-an-id", `{"archived": true}`), http.StatusBadRequest},
		{"unknown id on delete", httptest.NewRequest(http.MethodDelete, "/claude/conversations/conv-1700000000000-abcd", nil), http.StatusNotFound},
		{"unknown id on fork", httptest.NewRequest(http.MethodPost, "/claude/conversations/conv-1700000000000-abcd/fork", nil), http.StatusNotFound},
		{"malformed id on fork", httptest.NewRequest(http.MethodPost, "/claude/conversations/not-an-id/fork", nil), http.StatusBadRequest},
		{"malformed body", jsonReq(http.MethodPost, "/claude/conversations", `not json`), http.StatusBadRequest},
		{"folder outside the root", jsonReq(http.MethodPost, "/claude/conversations", `{"folder": "../escape"}`), http.StatusBadRequest},
		{"folder that is gone", jsonReq(http.MethodPost, "/claude/conversations", `{"folder": "units/nope"}`), http.StatusNotFound},
		{"the store root is an ordinary folder", jsonReq(http.MethodPost, "/claude/conversations", `{"folder": ""}`), http.StatusCreated},
		{"unknown permission mode", jsonReq(http.MethodPost, "/claude/conversations", `{"folder": "units", "permissionMode": "plan"}`), http.StatusBadRequest},
		{"manual live is a mode this service drives", jsonReq(http.MethodPost, "/claude/conversations", `{"folder": "units", "permissionMode": "manualLive"}`), http.StatusCreated},
		{"unknown permission mode on patch", jsonReq(http.MethodPatch, "/claude/conversations/"+existing.ID, `{"permissionMode": "plan"}`), http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := do(s, c.req).Code; got != c.want {
				t.Errorf("status = %d, want %d", got, c.want)
			}
		})
	}
}

// Nothing deletes a conversation on the user's behalf, so a full registry is a situation the caller
// resolves — 409, not 500.
func TestCreateConversationOverTheCapIsConflict(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	mustMkdir(t, cfg.RootPath, "units")
	s.conversations.maxConversations = 1
	mustCreateThroughHandlers(t, s, `{"folder": "units"}`)

	rec := do(s, jsonReq(http.MethodPost, "/claude/conversations", `{"folder": "units"}`))
	if rec.Code != http.StatusConflict {
		t.Errorf("create over the cap: status = %d, want 409 (%s)", rec.Code, rec.Body.String())
	}
}

// TestConversationsWithoutBypass: on a service that does not allow `bypassPermissions`, the mode
// cannot be stored on a conversation — neither at creation nor by a later patch — and a creation
// that names no mode gets `manual` rather than the bypass every other deployment defaults to.
func TestConversationsWithoutBypass(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	cfg.BypassEnabled = false
	mustMkdir(t, cfg.RootPath, "units/demo")

	body := `{"folder": "units/demo", "permissionMode": "bypassPermissions"}`
	if rec := do(s, jsonReq(http.MethodPost, "/claude/conversations", body)); rec.Code != http.StatusBadRequest {
		t.Fatalf("create in bypass mode: status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}

	created := mustCreateThroughHandlers(t, s, `{"folder": "units/demo"}`)
	if created.PermissionMode != permissionModeManual {
		t.Errorf("default mode = %q, want %q on a service without bypass",
			created.PermissionMode, permissionModeManual)
	}

	patch := jsonReq(http.MethodPatch, "/claude/conversations/"+created.ID, `{"permissionMode": "bypassPermissions"}`)
	if rec := do(s, patch); rec.Code != http.StatusBadRequest {
		t.Fatalf("patch to bypass mode: status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
}

// ── the round trip ────────────────────────────────────────────────────────────

// Create, list, read, rename, archive, delete — the whole switcher, through the middleware chain.
func TestConversationRoundTripThroughTheHandlers(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	mustMkdir(t, cfg.RootPath, "units/demo")

	created := mustCreateThroughHandlers(t, s, `{"folder": "units/demo", "model": "opus", "thinking": false}`)
	if created.Title != defaultConversationTitle || created.Model != "opus" || created.Thinking {
		t.Fatalf("created = %+v, want the defaults it asked for", created)
	}
	if created.PermissionMode != permissionModeBypass || created.Effort != defaultConversationEffort {
		t.Errorf("created = %+v, want the service's own defaults for what was omitted", created)
	}
	if created.Running {
		t.Error("a conversation is not running the moment it is created")
	}

	if listed := listConversations(t, s, "/claude/conversations"); len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("list = %+v, want the new conversation", listed)
	}

	// The transcript comes from here, not from the socket, and an empty one serialises as [] — the
	// clients read messages.length without checking.
	rec := do(s, httptest.NewRequest(http.MethodGet, "/claude/conversations/"+created.ID, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("get: status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"messages":[]`)) {
		t.Errorf("body = %s, want an empty messages array", rec.Body.String())
	}

	renamed := patchConversation(t, s, created.ID, `{"title": "Release notes", "archived": true}`)
	if renamed.Title != "Release notes" || !renamed.Archived {
		t.Fatalf("patched = %+v, want the rename and the archive applied", renamed)
	}
	if listed := listConversations(t, s, "/claude/conversations"); len(listed) != 0 {
		t.Errorf("list = %+v, want the archived conversation left out", listed)
	}
	if listed := listConversations(t, s, "/claude/conversations?archived=true"); len(listed) != 1 {
		t.Errorf("list?archived=true = %+v, want it included when asked for", listed)
	}

	if code := do(s, httptest.NewRequest(http.MethodDelete, "/claude/conversations/"+created.ID, nil)).Code; code != http.StatusNoContent {
		t.Fatalf("delete: status = %d, want 204", code)
	}
	if code := do(s, httptest.NewRequest(http.MethodGet, "/claude/conversations/"+created.ID, nil)).Code; code != http.StatusNotFound {
		t.Errorf("get after a delete: status = %d, want 404", code)
	}
}

// An omitted field is left alone, not reset. Every field of the patch is a pointer for exactly
// this: a client that sends {"archived": true} must not silently clear the model the user chose.
func TestPatchLeavesOmittedFieldsAlone(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	mustMkdir(t, cfg.RootPath, "units")
	created := mustCreateThroughHandlers(t, s,
		`{"folder": "units", "title": "Release notes", "model": "opus", "effort": "max", "permissionMode": "manual", "thinking": true}`)

	patched := patchConversation(t, s, created.ID, `{"archived": true}`)
	if patched.Title != "Release notes" || patched.Model != "opus" || patched.Effort != "max" ||
		patched.PermissionMode != permissionModeManual || !patched.Thinking {
		t.Errorf("patched = %+v, want everything but archived untouched", patched)
	}
	if !patched.Archived {
		t.Error("the one field that was sent was not applied")
	}

	// An empty title is a reset rather than a rename to nothing: the conversation goes back to being
	// named after a prompt, which is what emptying a rename box looks like it should do.
	cleared := patchConversation(t, s, created.ID, `{"title": ""}`)
	if cleared.Title != defaultConversationTitle {
		t.Errorf("title = %q after being cleared, want %q", cleared.Title, defaultConversationTitle)
	}
}

// Pinning is a display choice the server stores so every tab and the next session agree on it.
// Unlike archiving, it changes nothing about what is listed: a pinned conversation is shown
// differently, not shown less.
func TestPatchPinsWithoutHidingAnything(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	mustMkdir(t, cfg.RootPath, "units")
	created := mustCreateThroughHandlers(t, s, `{"folder": "units", "title": "Release notes"}`)
	if created.Pinned {
		t.Fatal("a conversation is not pinned until someone pins it")
	}

	pinned := patchConversation(t, s, created.ID, `{"pinned": true}`)
	if !pinned.Pinned || pinned.Title != "Release notes" || pinned.Archived {
		t.Fatalf("patched = %+v, want it pinned and nothing else touched", pinned)
	}
	listed := listConversations(t, s, "/claude/conversations")
	if len(listed) != 1 || !listed[0].Pinned {
		t.Errorf("list = %+v, want the pinned conversation listed, and listed as pinned", listed)
	}

	if unpinned := patchConversation(t, s, created.ID, `{"pinned": false}`); unpinned.Pinned {
		t.Errorf("patched = %+v, want the pin taken off", unpinned)
	}
}

// ── liveness ──────────────────────────────────────────────────────────────────

// Whether a turn is running is only ever known in memory. The disk records that one was *started*
// so a restart can settle it, and reporting that as liveness would leave a conversation marked
// running for as long as its metadata said so — which, after a crash, is forever.
func TestGetConversationReportsLivenessFromTheHubNotTheDisk(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	mustMkdir(t, cfg.RootPath, "units")
	created := mustCreateThroughHandlers(t, s, `{"folder": "units"}`)

	// The metadata says a turn was started; nothing is wired to the turn registry, so the answer is
	// still "idle".
	if _, err := s.conversations.update(created.ID, func(m *conversationMeta) {
		m.RunningAt = nowConversationTime()
	}); err != nil {
		t.Fatal(err)
	}
	if got := getConversation(t, s, created.ID); got.Running {
		t.Error("running was read off the disk; it is the turn registry's answer alone")
	}

	// With the registry wired, the same metadata reports running.
	s.liveness = func(id string) bool { return id == created.ID }
	if got := getConversation(t, s, created.ID); !got.Running {
		t.Error("running = false although the turn registry says the conversation is live")
	}
	if listed := listConversations(t, s, "/claude/conversations"); len(listed) != 1 || !listed[0].Running {
		t.Errorf("list = %+v, want the running conversation marked in the list too", listed)
	}
}

// ── forking ───────────────────────────────────────────────────────────────────

// The endpoint's whole job: a second conversation over the same history, announced in the list,
// with the transcript readable through the same GET as any other.
func TestForkThroughTheHandlers(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	mustMkdir(t, cfg.RootPath, "units/demo")
	source := mustCreateThroughHandlers(t, s, `{"folder": "units/demo", "model": "opus", "thinking": false}`)
	patchConversation(t, s, source.ID, `{"title": "Rewrite the README"}`)
	if _, err := s.conversations.appendAndUpdate(source.ID,
		conversationRecord{Role: roleUser, Text: "first"},
		func(meta *conversationMeta) { meta.SessionID = "sess-7" }); err != nil {
		t.Fatal(err)
	}

	fork := forkConversation(t, s, source.ID)
	if fork.ID == source.ID {
		t.Fatal("a fork must be a conversation of its own")
	}
	if fork.Folder != source.Folder || fork.Model != "opus" || fork.Thinking {
		t.Errorf("fork = %+v, want the source's folder and settings", fork)
	}
	if fork.Title != "Rewrite the README (fork)" {
		t.Errorf("fork title = %q, want it named after the source", fork.Title)
	}
	if fork.MessageCount != 2 {
		t.Errorf("fork messageCount = %d, want the copied prompt and the fork notice", fork.MessageCount)
	}

	detail := getConversation(t, s, fork.ID)
	if len(detail.Messages) != 2 || detail.Messages[0].Text != "first" {
		t.Fatalf("fork transcript = %+v, want the source's history", detail.Messages)
	}
	if detail.Messages[1].Role != roleNotice {
		t.Errorf("last message = %+v, want the notice that says where the two part company", detail.Messages[1])
	}

	// Both are in the switcher, and the source is exactly as it was.
	listed := listConversations(t, s, "/claude/conversations")
	if len(listed) != 2 {
		t.Fatalf("list = %d conversations, want the source and its fork", len(listed))
	}
	if again := getConversation(t, s, source.ID); len(again.Messages) != 1 || again.Title != "Rewrite the README" {
		t.Errorf("source after the fork = %+v, want it untouched", again.AgentConversationDto)
	}
}

// The endpoint takes the point to fork at in its body, and a message this conversation does not
// hold is refused rather than quietly widened into a fork of everything.
func TestForkFromAMessageThroughTheHandlers(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	mustMkdir(t, cfg.RootPath, "units/demo")
	source := mustCreateThroughHandlers(t, s, `{"folder": "units/demo"}`)
	for _, rec := range []conversationRecord{
		{Role: roleUser, Text: "first"},
		{Role: roleAssistant, Text: "an answer", SessionAnchor: "uuid-1"},
		{Role: roleUser, Text: "the wrong turn"},
	} {
		if _, err := s.conversations.appendAndUpdate(source.ID, rec,
			func(meta *conversationMeta) { meta.SessionID = "sess-7" }); err != nil {
			t.Fatal(err)
		}
	}

	detail := getConversation(t, s, source.ID)
	body := `{"fromMessageId":"` + detail.Messages[2].ID + `"}`
	rec := do(s, jsonReq(http.MethodPost, "/claude/conversations/"+source.ID+"/fork", body))
	if rec.Code != http.StatusCreated {
		t.Fatalf("fork from a message: status = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	var fork AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &fork); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if fork.MessageCount != 3 {
		t.Errorf("fork messageCount = %d, want the two records before the fork point and the notice",
			fork.MessageCount)
	}

	missing := jsonReq(http.MethodPost, "/claude/conversations/"+source.ID+"/fork",
		`{"fromMessageId":"msg-1700000000000-abcd"}`)
	if rec := do(s, missing); rec.Code != http.StatusNotFound {
		t.Errorf("fork from a message that is not here: status = %d, want 404", rec.Code)
	}
}

// A turn still running is writing the transcript and the session the fork would copy, so the copy
// would land in one and not the other. It is refused — and refused rather than stopped: delete may
// stop a turn because it has no conversation left to damage, and a fork has.
func TestForkIsRefusedWhileATurnIsRunning(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	mustMkdir(t, cfg.RootPath, "units")
	source := mustCreateThroughHandlers(t, s, `{"folder": "units"}`)

	s.liveness = func(id string) bool { return id == source.ID }
	rec := do(s, httptest.NewRequest(http.MethodPost, "/claude/conversations/"+source.ID+"/fork", nil))
	if rec.Code != http.StatusConflict {
		t.Fatalf("fork of a running conversation: status = %d, want 409 (%s)", rec.Code, rec.Body.String())
	}
	if got := len(listConversations(t, s, "/claude/conversations")); got != 1 {
		t.Errorf("conversations after a refused fork = %d, want the source alone", got)
	}

	// Once the turn settles it forks like any other.
	s.liveness = func(string) bool { return false }
	forkConversation(t, s, source.ID)
}

// The folder is fixed for the new conversation's life, so one that has gone since the source was
// made is refused where the user asked for it rather than at the fork's first prompt.
func TestForkOfAConversationWhoseFolderIsGone(t *testing.T) {
	s, cfg := newConversationTestServer(t)
	mustMkdir(t, cfg.RootPath, "units/demo")
	source := mustCreateThroughHandlers(t, s, `{"folder": "units/demo"}`)
	if err := os.RemoveAll(filepath.Join(cfg.RootPath, "units/demo")); err != nil {
		t.Fatal(err)
	}

	rec := do(s, httptest.NewRequest(http.MethodPost, "/claude/conversations/"+source.ID+"/fork", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("fork into a folder that is gone: status = %d, want 404 (%s)", rec.Code, rec.Body.String())
	}
}

// ── helpers ───────────────────────────────────────────────────────────────────

func listConversations(t *testing.T, s *Service, target string) []AgentConversationDto {
	t.Helper()
	rec := do(s, httptest.NewRequest(http.MethodGet, target, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: status = %d, want 200 (%s)", target, rec.Code, rec.Body.String())
	}
	var listed []AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode %s: %v (%s)", target, err, rec.Body.String())
	}
	return listed
}

func getConversation(t *testing.T, s *Service, id string) AgentConversationDetailDto {
	t.Helper()
	rec := do(s, httptest.NewRequest(http.MethodGet, "/claude/conversations/"+id, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("get %s: status = %d, want 200 (%s)", id, rec.Code, rec.Body.String())
	}
	var dto AgentConversationDetailDto
	if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	return dto
}

func forkConversation(t *testing.T, s *Service, id string) AgentConversationDto {
	t.Helper()
	rec := do(s, httptest.NewRequest(http.MethodPost, "/claude/conversations/"+id+"/fork", nil))
	if rec.Code != http.StatusCreated {
		t.Fatalf("fork %s: status = %d, want 201 (%s)", id, rec.Code, rec.Body.String())
	}
	var dto AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	return dto
}

func patchConversation(t *testing.T, s *Service, id, body string) AgentConversationDto {
	t.Helper()
	rec := do(s, jsonReq(http.MethodPatch, "/claude/conversations/"+id, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch %s: status = %d, want 200 (%s)", id, rec.Code, rec.Body.String())
	}
	var dto AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	return dto
}

// The transcript around the reply travels over REST too: the turn id, the timings, the end
// reason, the usage, the asks, what the model was sent and what played it.
func TestMessageDtoCarriesTheTurnAroundTheReply(t *testing.T) {
	after := 2
	exit := 1
	dto := messageDto(conversationRecord{
		ID: "msg-1", Role: roleAssistant, TurnID: "turn-1",
		Blocks: []conversationBlock{{
			Kind: blockKindToolUse, Name: "Bash", ToolUseID: "toolu_7",
			Result: "ok", ExitCode: &exit, At: "2026-01-01T00:00:00.000Z",
		}},
		StartedAt: "2026-01-01T00:00:00.000Z", FinishedAt: "2026-01-01T00:00:01.000Z",
		DurationMs: 1000, FirstBlockMs: 300,
		EndReason: "stream error", Terminal: "failed",
		Usage: &conversationUsage{InputTokens: 10, ReasoningTokens: 7, Scope: usageScopeTurn},
		Asks: []conversationAsk{{
			ID: "req-1", Tool: "Edit", Outcome: askOutcomeAllow, DecidedBy: "tester",
		}},
		ComposedPrompt: "do it", SystemPrompt: "briefing", Instructions: "Be terse.",
		PlayedBy: "Reviewer", AgentRef: "agent-1",
		RunID: "run-1", FlowNodeID: "flow-node-1", Board: "major",
		ForkFrom: "conv-x", ForkFromMessage: "msg-0",
	})
	if dto.TurnID != "turn-1" || dto.StartedAt == "" || dto.DurationMs != 1000 || dto.FirstBlockMs != 300 {
		t.Errorf("dto = %+v, want the turn id and its timings", dto)
	}
	if dto.EndReason != "stream error" || dto.Terminal != "failed" {
		t.Errorf("dto = %+v, want why the turn ended", dto)
	}
	if dto.Usage == nil || dto.Usage.InputTokens != 10 || dto.Usage.ReasoningTokens != 7 || len(dto.Asks) != 1 || dto.Asks[0].DecidedBy != "tester" {
		t.Errorf("dto = %+v, want the cost and the asks", dto)
	}
	if dto.ComposedPrompt != "do it" || dto.SystemPrompt != "briefing" || dto.Instructions != "Be terse." {
		t.Errorf("dto = %+v, want what the model was sent", dto)
	}
	if dto.PlayedBy != "Reviewer" || dto.RunID != "run-1" || dto.FlowNodeID != "flow-node-1" || dto.Board != "major" {
		t.Errorf("dto = %+v, want the play", dto)
	}
	if dto.ForkFrom != "conv-x" || dto.ForkFromMessage != "msg-0" {
		t.Errorf("dto = %+v, want the fork's source", dto)
	}
	if len(dto.Blocks) != 1 || dto.Blocks[0].ToolUseID != "toolu_7" || dto.Blocks[0].Result != "ok" ||
		dto.Blocks[0].ExitCode == nil || *dto.Blocks[0].ExitCode != 1 || dto.Blocks[0].At == "" {
		t.Errorf("blocks = %+v, want the call with its outcome and its arrival", dto.Blocks)
	}

	between := messageDto(conversationRecord{
		Role: roleUser, Text: "wait", TurnID: "turn-1", Between: true, AfterBlocks: &after,
	})
	if !between.Between || between.AfterBlocks == nil || *between.AfterBlocks != 2 {
		t.Errorf("between = %+v, want where it landed in the reply", between)
	}
	if dto := conversationDtoOf(conversationMeta{ID: "c", ForkedFrom: "src", ForkedFromMessage: "m"},
		false); dto.ForkedFrom != "src" || dto.ForkedFromMessage != "m" {
		t.Errorf("conversation = %+v, want what it was forked from", dto)
	}
}
