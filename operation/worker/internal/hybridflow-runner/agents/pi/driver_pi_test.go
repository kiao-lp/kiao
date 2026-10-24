package pi

import (
	"bufio"
	"encoding/json"
	"fmt"
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/core/equipment"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/conversations"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func piTestSetup(t *testing.T, binary string) (*runnerconfig.Config, *PiProfiles, *conversations.ConversationStore, conversations.ConversationMeta) {
	t.Helper()
	root := t.TempDir()
	cfg := &runnerconfig.Config{Config: &coreconfig.Config{RootPath: root, StatePath: filepath.Join(root, ".kiao-config"), AuthMode: "debug"}, BypassEnabled: true, MaxTurns: 4}
	if binary == "" {
		var err error
		binary, err = filepath.Abs("testdata/fake-pi.mjs")
		if err != nil {
			t.Fatal(err)
		}
	}
	profiles := NewPiProfiles(cfg)
	doc := agentapi.PiProfilesDocument{Version: 1, DefaultPiProfileID: "work", Installations: []equipment.AgentInstallation{{ID: "reference", Engine: agentapi.AgentPi, Version: "1.3.0", Path: binary, Protocol: PiRPCProtocol, External: true}}, Profiles: []agentapi.PiProfile{{ID: "work", Name: "Work", InstallationID: "reference", DefaultModel: "openai/shared-model", DefaultEffort: "off", Connections: []agentapi.PiConnection{{Provider: "openai", API: "openai-completions", BaseURL: "http://127.0.0.1:1/v1", Models: []agentapi.PiModel{{ID: "shared-model", Reasoning: true, Input: []string{"text", "image"}, ContextWindow: 10000, MaxTokens: 1024}}}}}}}
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	store, err := conversations.NewConversationStore(filepath.Join(cfg.StatePath, conversations.ConversationsDirName))
	if err != nil {
		t.Fatal(err)
	}
	meta, err := store.Create(conversations.ConversationMeta{Agent: agentapi.AgentPi, ProfileID: "work", Model: "openai/shared-model", Effort: "off", PermissionMode: runnerconfig.PermissionModeBypass, Thinking: true})
	if err != nil {
		t.Fatal(err)
	}
	return cfg, profiles, store, meta
}

func piTestRun(cfg *runnerconfig.Config, meta conversations.ConversationMeta, prompt string) agentapi.AgentRun {
	return agentapi.AgentRun{Conversation: meta.ID, Turn: "turn-test", ProfileID: meta.ProfileID, Model: meta.Model, Effort: "off", PermissionMode: runnerconfig.PermissionModeBypass, AllowBypass: true, Thinking: true, Prompt: prompt, WorkDir: cfg.RootPath, StoreRoot: cfg.RootPath, SessionID: meta.SessionID, ForkSession: meta.ForkPending, ResumeAt: meta.ForkAnchor}
}

func collectPi(t *testing.T, d *PiDriver, run agentapi.AgentRun, action func(agentapi.AgentEvent)) []agentapi.AgentEvent {
	t.Helper()
	if err := d.Spawn(run); err != nil {
		t.Fatal(err)
	}
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	var events []agentapi.AgentEvent
	for {
		select {
		case event, ok := <-d.Events():
			if !ok {
				return events
			}
			events = append(events, event)
			if action != nil {
				action(event)
			}
		case <-timer.C:
			d.Stop()
			t.Fatal("Pi turn timed out")
			return nil
		}
	}
}

func terminalPi(t *testing.T, events []agentapi.AgentEvent, want int) {
	t.Helper()
	count := 0
	for _, event := range events {
		if event.Kind == agentapi.EventDone {
			count++
			if event.ExitCode != want {
				t.Errorf("terminal = %+v, want %d", event, want)
			}
		}
	}
	if count != 1 || events[len(events)-1].Kind != agentapi.EventDone {
		t.Fatalf("expected exactly one final done, got %+v", events)
	}
}

func TestPiRPCFinishedBlocksRetriesAndTools(t *testing.T) {
	for _, scenario := range []string{"Bonjour\u2028世界", "retry", "tools", "failure", "crash"} {
		t.Run(scenario, func(t *testing.T) {
			cfg, profiles, _, meta := piTestSetup(t, "")
			d := NewPiAgent(cfg, profiles).Driver().(*PiDriver)
			events := collectPi(t, d, piTestRun(cfg, meta, scenario), nil)
			want := 0
			if scenario == "failure" || scenario == "crash" {
				want = 1
			}
			terminalPi(t, events, want)
			if scenario == "retry" {
				notices := 0
				for _, event := range events {
					if event.Kind == agentapi.EventNotice {
						notices++
					}
				}
				if notices == 0 {
					t.Fatal("Pi retries were hidden")
				}
			}
			if scenario == "tools" {
				calls, results := map[string]bool{}, map[string]bool{}
				for _, e := range events {
					if e.Kind == agentapi.EventBlock && e.Block.Kind == agentapi.BlockKindToolUse {
						if calls[e.Block.ToolUseID] {
							t.Fatal("duplicate tool call")
						}
						calls[e.Block.ToolUseID] = true
					}
					if e.Kind == agentapi.EventToolResult {
						results[e.ToolUseID] = true
					}
				}
				if len(calls) != 3 || len(results) != 3 {
					t.Fatalf("nested tools lost: %v %v", calls, results)
				}
			}
			if scenario == "Bonjour\u2028世界" {
				text := ""
				for _, e := range events {
					if e.Kind == agentapi.EventBlock {
						text += e.Block.Text
					}
				}
				if !strings.Contains(text, scenario) {
					t.Fatalf("LF framing lost Unicode: %q", text)
				}
			}
		})
	}
}

func TestPiDeferredDeliveryCancellationAndStop(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(fmt.Sprint(cancel), func(t *testing.T) {
			cfg, profiles, _, meta := piTestSetup(t, "")
			log := filepath.Join(t.TempDir(), "commands")
			t.Setenv("KIAO_TEST_PI_COMMAND_LOG", log)
			d := NewPiAgent(cfg, profiles).Driver().(*PiDriver)
			sent := false
			stopped := false
			delivered := false
			cancelled := false
			events := collectPi(t, d, piTestRun(cfg, meta, "slow"), func(e agentapi.AgentEvent) {
				if e.Kind == agentapi.EventSession && !sent {
					sent = true
					go func() {
						if err := d.FollowUp("one", "after work"); err != nil {
							t.Error(err)
						}
					}()
				}
				if e.Kind == agentapi.EventQueue {
					for _, m := range e.Queue {
						if m.State == "pending" && cancel && !stopped {
							stopped = true
							d.Stop()
						}
						delivered = delivered || m.State == "delivered"
						cancelled = cancelled || m.State == "cancelled"
					}
				}
			})
			if cancel {
				terminalPi(t, events, -1)
				if !cancelled || delivered {
					t.Fatalf("queue cancellation = delivered:%v cancelled:%v", delivered, cancelled)
				}
				commands := strings.Fields(mustRead(t, log))
				clear, abort := slices.Index(commands, "clear_queue"), slices.Index(commands, "abort")
				if clear < 0 || abort < 0 || clear > abort {
					t.Fatalf("cancellation order: %v", commands)
				}
			} else {
				terminalPi(t, events, 0)
				if !delivered {
					t.Fatal("follow-up delivery was not reported")
				}
			}
		})
	}
}

func TestPiQuestionPermissionAndStop(t *testing.T) {
	for _, scenario := range []string{"question", "permission"} {
		for _, stop := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%v", scenario, stop), func(t *testing.T) {
				cfg, profiles, _, meta := piTestSetup(t, "")
				d := NewPiAgent(cfg, profiles).Driver().(*PiDriver)
				seen := false
				run := piTestRun(cfg, meta, scenario)
				run.PermissionMode = runnerconfig.PermissionModeManual
				events := collectPi(t, d, run, func(e agentapi.AgentEvent) {
					if e.Kind == agentapi.EventAsk {
						seen = true
						if e.Ask.IsQuestion() != (scenario == "question") {
							t.Error("question was confused with a permission")
						}
						if stop {
							d.Stop()
						} else {
							go func() {
								if err := d.Answer(e.Ask.ID, agentapi.AskDecision{Allow: true, Input: map[string]any{"answers": map[string]any{"Choose a colour": "Blue"}}}); err != nil {
									t.Error(err)
								}
							}()
						}
					}
				})
				if !seen {
					t.Fatal("missing request")
				}
				want := 0
				if stop {
					want = -1
				}
				terminalPi(t, events, want)
			})
		}
	}
}

func TestPiNativeForkCompactionAndResume(t *testing.T) {
	cfg, profiles, store, meta := piTestSetup(t, "")
	first := collectPi(t, NewPiAgent(cfg, profiles).Driver().(*PiDriver), piTestRun(cfg, meta, "first"), nil)
	session, anchor := "", ""
	for _, e := range first {
		if e.Kind == agentapi.EventSession {
			session = e.SessionID
			if e.MessageID != "" {
				anchor = e.MessageID
			}
		}
	}
	if anchor == "" {
		t.Fatal("no native anchor")
	}
	_, err := store.AppendAndUpdate(meta.ID, conversations.ConversationRecord{Role: conversations.RoleAssistant, SessionAnchor: anchor}, func(m *conversations.ConversationMeta) { m.SessionID = session })
	if err != nil {
		t.Fatal(err)
	}
	source := mustRead(t, session)
	fork, err := store.Fork(meta.ID, "", "", conversations.ForkTarget{Agent: agentapi.AgentPi, ProfileID: "work", Branches: true})
	if err != nil {
		t.Fatal(err)
	}
	second := collectPi(t, NewPiAgent(cfg, profiles).Driver().(*PiDriver), piTestRun(cfg, fork, "second"), nil)
	terminalPi(t, second, 0)
	if mustRead(t, session) != source {
		t.Fatal("fork modified the source session")
	}
	for _, e := range second {
		if e.Kind == agentapi.EventSession {
			fork.SessionID = e.SessionID
			fork.ForkPending = false
		}
	}
	if fork.SessionID == session {
		t.Fatal("two conversations share one session")
	}
	compact := collectPi(t, NewPiAgent(cfg, profiles).Driver().(*PiDriver), piTestRun(cfg, fork, "/compact"), nil)
	terminalPi(t, compact, 0)
	resumed := collectPi(t, NewPiAgent(cfg, profiles).Driver().(*PiDriver), piTestRun(cfg, fork, "resumed"), nil)
	terminalPi(t, resumed, 0)
	usage := 0.0
	for _, e := range compact {
		if e.Kind == agentapi.EventUsage {
			usage = e.Usage.TotalCostUSD
		}
	}
	if usage != 0.002 {
		t.Fatalf("compaction cost %v", usage)
	}
}

func TestPiProfilesSeparateSecretsAndSnapshot(t *testing.T) {
	cfg, profiles, _, _ := piTestSetup(t, "")
	_ = cfg
	t.Setenv("KIAO_TEST_PI_KEY_A", "private-A")
	t.Setenv("KIAO_TEST_PI_KEY_B", "private-B")
	doc, _ := profiles.ReadProfiles()
	doc.Profiles[0].Connections[0].SecretRef = "env:KIAO_TEST_PI_KEY_A"
	var second agentapi.PiProfile
	raw, _ := json.Marshal(doc.Profiles[0])
	_ = json.Unmarshal(raw, &second)
	second.ID, second.Name = "other", "Other"
	second.Connections[0].SecretRef = "env:KIAO_TEST_PI_KEY_B"
	second.Connections[0].BaseURL = "http://127.0.0.2:1/v1"
	doc.Profiles = append(doc.Profiles, second)
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	a, err := profiles.ResolveProfile("work", "", "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := profiles.ResolveProfile("other", "", "")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for _, p := range []*agentapi.PiResolvedProfile{a, b} {
		wg.Add(1)
		go func(p *agentapi.PiResolvedProfile) {
			defer wg.Done()
			dir, env, _, err := materializePi(p, t.TempDir(), "")
			if err != nil {
				t.Error(err)
				return
			}
			body := mustRead(t, filepath.Join(dir, "models.json"))
			if strings.Contains(body, "private-") {
				t.Error("secret written to generated configuration")
			}
			value := strings.Join(env, "\n")
			if p.Profile.ID == "work" && (!strings.Contains(value, "private-A") || strings.Contains(value, "private-B")) {
				t.Error("mixed credentials")
			}
			if p.Profile.ID == "other" && (!strings.Contains(value, "private-B") || strings.Contains(value, "private-A")) {
				t.Error("mixed credentials")
			}
		}(p)
	}
	wg.Wait()
	doc.Profiles[0].DefaultEffort = "high"
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	after, _ := profiles.ResolveProfile("work", "", "")
	unchanged, _ := profiles.ResolveProfile("other", "", "")
	if unchanged.Profile.Revision != b.Profile.Revision {
		t.Fatal("editing one profile changed another profile revision")
	}
	if after.Profile.Revision <= a.Profile.Revision || a.Effort != "off" {
		t.Fatal("profile mutation changed an accepted turn snapshot")
	}
	offers, _ := json.Marshal(profiles.OfferedProfiles())
	if strings.Contains(string(offers), "private-A") {
		t.Fatal("profile read leaked a secret")
	}
	if _, err := profiles.ResolveProfile("missing", "", ""); err == nil {
		t.Fatal("missing runner profile was silently selected")
	}
}

// Optional real-runtime qualification: still uses a simulated endpoint, never a paid API.
func TestPiReferenceRPCIntegration(t *testing.T) {
	binary := os.Getenv("KIAO_PI_TEST_CLI")
	if binary == "" {
		t.Skip("set KIAO_PI_TEST_CLI to a qualified Pi executable")
	}
	const imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
	var receivedImage atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Error("wrong profile key")
			w.WriteHeader(401)
			return
		}
		var request map[string]any
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Error("invalid API request")
		}
		body, _ := json.Marshal(request)
		if strings.Contains(string(body), "data:image/png;base64,"+imageData) {
			receivedImage.Store(true)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"id\":\"fixture\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Bonjour ✓\\u2028Pi\"},\"finish_reason\":null}]}\n\n")
		fmt.Fprint(w, "data: {\"id\":\"fixture\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":10,\"total_tokens\":30}}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	cfg, profiles, _, meta := piTestSetup(t, binary)
	doc, _ := profiles.ReadProfiles()
	doc.Profiles[0].Connections[0].BaseURL = server.URL + "/v1"
	doc.Profiles[0].Connections[0].SecretRef = "env:KIAO_TEST_PI_REAL_KEY"
	t.Setenv("KIAO_TEST_PI_REAL_KEY", "fixture-key")
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	if _, err := profiles.Models("work", true); err != nil {
		t.Fatal(err)
	}
	driver := NewPiAgent(cfg, profiles).Driver().(*PiDriver)
	run := piTestRun(cfg, meta, "hello")
	run.Images = []agentapi.AgentImage{{Type: "image", MimeType: "image/png", Data: imageData}}
	events := collectPi(t, driver, run, nil)
	terminalPi(t, events, 0)
	if !receivedImage.Load() {
		t.Fatal("native image did not reach the selected model API")
	}
	found := false
	for _, e := range events {
		if e.Kind == agentapi.EventBlock && strings.Contains(e.Block.Text, "Bonjour ✓\u2028Pi") {
			found = true
		}
		if e.Kind == agentapi.EventSession {
			meta.SessionID = e.SessionID
		}
	}
	if !found {
		t.Fatal("real Pi lost Unicode text")
	}
	events = collectPi(t, NewPiAgent(cfg, profiles).Driver().(*PiDriver), piTestRun(cfg, meta, "resumed"), nil)
	terminalPi(t, events, 0)
}

func TestPiTerminalWaitsForDescendants(t *testing.T) {
	for _, scenario := range []string{"descendant", "descendant-stop", "descendant-crash"} {
		t.Run(scenario, func(t *testing.T) {
			cfg, profiles, _, meta := piTestSetup(t, "")
			pidFile := filepath.Join(t.TempDir(), "pid")
			t.Setenv("KIAO_TEST_PI_CHILD_PID", pidFile)
			d := NewPiAgent(cfg, profiles).Driver().(*PiDriver)
			events := collectPi(t, d, piTestRun(cfg, meta, scenario), func(e agentapi.AgentEvent) {
				if scenario == "descendant-stop" && e.Kind == agentapi.EventSession {
					d.Stop()
				}
			})
			want := 0
			if scenario == "descendant-stop" {
				want = -1
			}
			if scenario == "descendant-crash" {
				want = 1
			}
			terminalPi(t, events, want)
			pid, err := strconv.Atoi(mustRead(t, pidFile))
			if err != nil {
				t.Fatal(err)
			}
			if err := syscall.Kill(pid, 0); err != syscall.ESRCH {
				t.Fatalf("Pi left descendant %d after done: %v", pid, err)
			}
		})
	}
}

func TestPiForkAtMessageBranchesBeforeTheNextUserEntry(t *testing.T) {
	cfg, profiles, store, meta := piTestSetup(t, "")
	var session, anchor string
	for _, text := range []string{"first", "second"} {
		events := collectPi(t, NewPiAgent(cfg, profiles).Driver().(*PiDriver), piTestRun(cfg, meta, text), nil)
		terminalPi(t, events, 0)
		for _, event := range events {
			if event.Kind == agentapi.EventSession {
				session = event.SessionID
				if event.MessageID != "" {
					anchor = event.MessageID
				}
			}
		}
		_, err := store.AppendAndUpdate(meta.ID, conversations.ConversationRecord{Role: conversations.RoleUser, Text: text}, nil)
		if err != nil {
			t.Fatal(err)
		}
		meta, err = store.AppendAndUpdate(meta.ID, conversations.ConversationRecord{Role: conversations.RoleAssistant, Text: "answer " + text, SessionAnchor: anchor}, func(m *conversations.ConversationMeta) { m.SessionID = session })
		if err != nil {
			t.Fatal(err)
		}
	}
	before := mustRead(t, session)
	records := mustMessages(t, store, meta.ID)
	fork, err := store.Fork(meta.ID, "", records[2].ID, conversations.ForkTarget{Agent: agentapi.AgentPi, ProfileID: "work", Branches: true})
	if err != nil {
		t.Fatal(err)
	}
	events := collectPi(t, NewPiAgent(cfg, profiles).Driver().(*PiDriver), piTestRun(cfg, fork, "replacement"), nil)
	terminalPi(t, events, 0)
	for _, event := range events {
		if event.Kind == agentapi.EventSession {
			fork.SessionID = event.SessionID
		}
	}
	if mustRead(t, session) != before {
		t.Fatal("message fork modified its source")
	}
	content := mustRead(t, fork.SessionID)
	if !strings.Contains(content, "first") || strings.Contains(content, `"text":"second"`) {
		t.Fatalf("fork retained the excluded prompt: %s", content)
	}
}

func TestPiReferenceParallelProfilesIntegration(t *testing.T) {
	binary := os.Getenv("KIAO_PI_TEST_CLI")
	if binary == "" {
		t.Skip("set KIAO_PI_TEST_CLI for simulated-API runtime qualification")
	}
	cfg, profiles, store, a := piTestSetup(t, binary)
	var continuedContext atomic.Bool
	mock := func(key string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+key {
				t.Error("concurrent profiles mixed API keys")
				w.WriteHeader(401)
				return
			}
			var request map[string]any
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			body, _ := json.Marshal(request)
			if strings.Contains(string(body), "multi-provider continuation") && strings.Contains(string(body), "parallel accounts") {
				continuedContext.Store(true)
			}
			w.Header().Set("Content-Type", "text/event-stream")
			chunks := []any{map[string]any{"id": "parallel", "object": "chat.completion.chunk", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"role": "assistant", "content": "echo " + key}, "finish_reason": nil}}}, map[string]any{"id": "parallel", "object": "chat.completion.chunk", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30}}}
			for _, chunk := range chunks {
				raw, _ := json.Marshal(chunk)
				fmt.Fprintf(w, "data: %s\n\n", raw)
			}
			fmt.Fprint(w, "data: [DONE]\n\n")
		}))
	}
	serverA, serverB := mock("fixture-account-A"), mock("fixture-account-B")
	defer serverA.Close()
	defer serverB.Close()
	t.Setenv("KIAO_TEST_PI_PARALLEL_A", "fixture-account-A")
	t.Setenv("KIAO_TEST_PI_PARALLEL_B", "fixture-account-B")
	doc, _ := profiles.ReadProfiles()
	doc.Profiles[0].Connections[0].BaseURL = serverA.URL + "/v1"
	doc.Profiles[0].Connections[0].SecretRef = "env:KIAO_TEST_PI_PARALLEL_A"
	var other agentapi.PiProfile
	raw, _ := json.Marshal(doc.Profiles[0])
	_ = json.Unmarshal(raw, &other)
	other.ID, other.Name = "other", "Other account"
	other.Connections[0].BaseURL = serverB.URL + "/v1"
	other.Connections[0].SecretRef = "env:KIAO_TEST_PI_PARALLEL_B"
	doc.Profiles = append(doc.Profiles, other)
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	b, err := store.Create(conversations.ConversationMeta{Agent: agentapi.AgentPi, ProfileID: "other", Model: a.Model, Effort: "off", Thinking: true, PermissionMode: runnerconfig.PermissionModeBypass})
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		events []agentapi.AgentEvent
		err    error
		trace  *turntrace.TurnTrace
	}
	results := make(chan result, 2)
	for _, meta := range []conversations.ConversationMeta{a, b} {
		go func(meta conversations.ConversationMeta) {
			run := piTestRun(cfg, meta, "parallel accounts")
			run.Trace = store.OpenTurnTrace(meta.ID, run.Turn, true, nil)
			driver := NewPiAgent(cfg, profiles).Driver().(*PiDriver)
			if err := driver.Spawn(run); err != nil {
				results <- result{err: err}
				return
			}
			var events []agentapi.AgentEvent
			for event := range driver.Events() {
				events = append(events, event)
			}
			run.Trace.Close()
			results <- result{events: events}
		}(meta)
	}
	sessions := map[string]bool{}
	for range 2 {
		select {
		case result := <-results:
			if result.err != nil {
				t.Fatal(result.err)
			}
			terminalPi(t, result.events, 0)
			for _, event := range result.events {
				if event.Kind == agentapi.EventSession {
					sessions[event.SessionID] = true
					if strings.HasPrefix(event.SessionID, store.ConvDir(a.ID)+string(os.PathSeparator)) {
						a.SessionID = event.SessionID
					}
				}
				if strings.Contains(event.Block.Text, "fixture-account-") {
					t.Fatal("secret in transcript event")
				}
			}
		case <-time.After(30 * time.Second):
			t.Fatal("parallel runtime qualification timed out")
		}
	}
	if len(sessions) != 2 {
		t.Fatal("parallel profiles share native sessions")
	}
	// The same profile can expose both APIs and switch provider without losing its native context.
	connection := doc.Profiles[1].Connections[0]
	connection.Provider = "deepseek"
	doc.Profiles[0].Connections = append(doc.Profiles[0].Connections, connection)
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	run := piTestRun(cfg, a, "multi-provider continuation")
	run.Model = "deepseek/shared-model"
	continued := collectPi(t, NewPiAgent(cfg, profiles).Driver().(*PiDriver), run, nil)
	terminalPi(t, continued, 0)
	for _, event := range continued {
		if event.Kind == agentapi.EventSession && event.SessionID != a.SessionID {
			t.Fatal("model change replaced the profile's native session")
		}
		if strings.Contains(event.Block.Text, "fixture-account-") {
			t.Fatal("multi-provider profile leaked a secret")
		}
	}
	if !continuedContext.Load() {
		t.Fatal("changing provider lost the conversation context")
	}
	for _, meta := range []conversations.ConversationMeta{a, b} {
		raw := mustRead(t, filepath.Join(store.ConvDir(meta.ID), turntrace.TurnsDirName, "turn-test.jsonl"))
		if strings.Contains(raw, "fixture-account-") {
			t.Fatal("secret in turn trace")
		}
	}
}

func TestPiQualifiedRPCFixtures(t *testing.T) {
	for _, version := range []string{"1.3.0", "1.2.0"} {
		t.Run(version, func(t *testing.T) {
			file, err := os.Open(filepath.Join("testdata", "rpc-"+version+".jsonl"))
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			scanner := bufio.NewScanner(file)
			scanner.Buffer(make([]byte, 4096), 16<<20)
			pending := map[string]string{}
			commands := map[string]bool{}
			events := map[string]bool{}
			unicode := false
			for scanner.Scan() {
				var record struct {
					Direction string                     `json:"direction"`
					Record    map[string]json.RawMessage `json:"record"`
				}
				if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
					t.Fatal(err)
				}
				kind := rawString(record.Record, "type")
				id := rawString(record.Record, "id")
				unicode = unicode || strings.Contains(scanner.Text(), "\u2028")
				if record.Direction == "in" && kind != "extension_ui_response" {
					pending[id] = kind
					commands[kind] = true
				}
				if record.Direction == "out" && kind == "response" {
					if pending[id] != rawString(record.Record, "command") {
						t.Fatalf("uncorrelated response %s", id)
					}
					delete(pending, id)
				} else if record.Direction == "out" {
					events[kind] = true
				}
			}
			if err := scanner.Err(); err != nil {
				t.Fatal(err)
			}
			if len(pending) > 0 || !unicode {
				t.Fatalf("incomplete fixture: pending %v Unicode %v", pending, unicode)
			}
			for _, kind := range []string{"set_model", "get_available_thinking_levels", "prompt", "clone", "fork", "compact", "steer", "follow_up", "clear_queue", "abort"} {
				if !commands[kind] {
					t.Errorf("qualification omitted %s", kind)
				}
			}
			for _, kind := range []string{"agent_end", "agent_settled", "queue_update", "extension_ui_request", "tool_execution_start", "tool_execution_end"} {
				if !events[kind] {
					t.Errorf("qualification omitted %s", kind)
				}
			}
		})
	}
}

func TestPiRejectsUnsupportedImagesBeforePrompt(t *testing.T) {
	cfg, profiles, _, meta := piTestSetup(t, "")
	doc, _ := profiles.ReadProfiles()
	doc.Profiles[0].Connections[0].Models[0].Input = []string{"text"}
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(t.TempDir(), "commands")
	t.Setenv("KIAO_TEST_PI_COMMAND_LOG", log)
	run := piTestRun(cfg, meta, "describe image")
	run.Images = []agentapi.AgentImage{{Type: "image", MimeType: "image/png", Data: "unused"}}
	events := collectPi(t, NewPiAgent(cfg, profiles).Driver().(*PiDriver), run, nil)
	terminalPi(t, events, 1)
	if slices.Contains(strings.Fields(mustRead(t, log)), "prompt") {
		t.Fatal("unsupported image reached the model")
	}
}
