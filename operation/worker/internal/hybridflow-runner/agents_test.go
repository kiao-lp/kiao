package hybridflowrunner

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"kiao/worker/internal/core"
)

// Which agents a deployment offers, what binding a conversation to one means, and what happens when
// a request asks an agent for something it does not have.

// withCodex puts a Codex agent in a service's registry, with its catalogue stubbed so that no
// `codex` need be on the host. Everything about the agent that these tests are concerned with — its
// one permission mode, that it does not branch sessions — is this service's own knowledge.
func withCodex(t *testing.T, svc *Service) {
	t.Helper()
	svc.agents.set(agentCodex, codexAgentAt(svc.cfg, "codex-stub"))
}

// withMuse is the same for Muse: its three permission modes and its branching sessions are this
// service's own knowledge, so no `muse` need be on the host.
func withMuse(t *testing.T, svc *Service) {
	t.Helper()
	svc.agents.set(agentMuse, museAgentAt(svc.cfg, "muse-stub"))
}

// withOpenCode is the same for OpenCode: its one permission mode, its curated models and its
// branching sessions are this service's own knowledge, so no `opencode` need be on the host.
func withOpenCode(t *testing.T, svc *Service) {
	t.Helper()
	svc.agents.set(agentOpenCode, opencodeAgentAt(svc.cfg, "opencode-stub"))
}

// The default is Claude, and a conversation that names no agent is bound to it: every conversation
// written before agents were a choice named none, and every one of them was Claude's.
func TestAgentRegistryDefaultsToClaude(t *testing.T) {
	registry := newAgentRegistry(&Config{Config: &core.Config{}, BypassEnabled: true})

	if registry.defaultName() != agentClaude {
		t.Errorf("default = %q, want Claude", registry.defaultName())
	}
	if entry, ok := registry.resolve(""); !ok || entry.name != agentClaude {
		t.Errorf("resolve(\"\") = %+v/%v, want the default entry", entry, ok)
	}
	// An agent this deployment does not offer is refused rather than falling back to the default:
	// running a turn on an agent the caller did not ask for is worse than saying no.
	if _, ok := registry.resolve("gemini"); ok {
		t.Error("an unknown agent must be refused rather than resolved to the default")
	}
}

// An agent is offered when its CLI is on the machine, and the machine is asked afresh every time.
// This is what makes installing one from the configuration panel a thing that takes effect on the
// next page rather than at the next restart — and it is why the two CLIs are no longer baked into
// the `kiao` image.
func TestAgentRegistryOffersWhatIsOnTheMachine(t *testing.T) {
	registry := newAgentRegistry(&Config{Config: &core.Config{}})

	withCLIsOnPath(t, "claude")
	if got := registry.names(); len(got) != 1 || got[0] != agentClaude {
		t.Errorf("with claude alone on the machine, names = %v, want [claude]", got)
	}

	// The same registry, a minute later, after an install.
	withCLIsOnPath(t, "claude", "codex")
	if got := registry.names(); len(got) != 2 {
		t.Errorf("with both on the machine, names = %v, want both", got)
	}

	// And a machine with neither offers neither — an empty list is a real answer, and the panel
	// says "install one" rather than drawing a dropdown that fails at the first prompt.
	withCLIsOnPath(t)
	if got := registry.names(); len(got) != 0 {
		t.Errorf("with no CLI on the machine, names = %v, want none", got)
	}
	if _, ok := registry.resolve(""); ok {
		t.Error("a host with no agent CLI must resolve no default agent")
	}
	// It is still Claude that a conversation would be *recorded* under: a name has to be written,
	// and every conversation from before agents were a choice reads as Claude's.
	if registry.defaultName() != agentClaude {
		t.Errorf("default = %q, want Claude even where nothing is installed", registry.defaultName())
	}
}

// The deployment's veto is separate from what is on the machine, and there is one per agent — which
// is the whole point: turning Codex off must not cost anyone Claude.
func TestAgentRegistryHonoursThePerAgentVeto(t *testing.T) {
	withCLIsOnPath(t, "claude", "codex")

	noCodex := newAgentRegistry(&Config{Config: &core.Config{}, CodexDisabled: true})
	if noCodex.known(agentCodex) {
		t.Error("Codex must be withheld where the deployment vetoed it, binary or no binary")
	}
	if !noCodex.known(agentClaude) {
		t.Error("vetoing Codex must not cost the deployment Claude")
	}

	noClaude := newAgentRegistry(&Config{Config: &core.Config{}, ClaudeDisabled: true})
	if noClaude.known(agentClaude) {
		t.Error("Claude must be withheld where the deployment vetoed it")
	}
	if noClaude.defaultName() != agentCodex {
		t.Errorf("default = %q, want the one agent left offered", noClaude.defaultName())
	}
}

// The configuration panel's switch is the third answer, and it is read at every ask rather than at
// startup — a row switched off in the panel takes an agent out of the tab with no restart.
func TestAgentRegistryHonoursTheConfigurationPanel(t *testing.T) {
	withCLIsOnPath(t, "claude", "codex")
	withdrawn := map[string]bool{}
	registry := newAgentRegistry(&Config{Config: &core.Config{}})
	registry.gate = gateFunc(func(name string) bool { return !withdrawn[name] })

	if len(registry.names()) != 2 {
		t.Fatalf("names = %v, want both before anything is switched off", registry.names())
	}
	withdrawn[agentCodex] = true
	if got := registry.names(); len(got) != 1 || got[0] != agentClaude {
		t.Errorf("names = %v, want Codex withdrawn by the panel", got)
	}
	// Withdrawn, not forgotten: a conversation already bound to it still renders under its label.
	if registry.label(agentCodex) != "Codex" {
		t.Errorf("label(codex) = %q, want a withdrawn agent still to render", registry.label(agentCodex))
	}
}

// gateFunc is the toolbox's answer, as a function.
type gateFunc func(name string) bool

func (f gateFunc) AgentOffered(name string) bool { return f(name) }

// The two agents publish different modes, which is the whole reason the gate is per agent rather
// than per deployment.
func TestAgentRegistryPublishesModesPerAgent(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)

	if !svc.agents.publishesMode(agentClaude, permissionModeManual) {
		t.Error("Claude must publish manual: it is the mode that asks")
	}
	if svc.agents.publishesMode(agentCodex, permissionModeManual) {
		t.Error("Codex must not publish manual: `codex exec` has no channel to ask on")
	}
	if !svc.agents.publishesMode(agentCodex, permissionModeBypass) {
		t.Error("Codex must publish bypass, which is the one mode it has")
	}
	// A fork of a Claude conversation is one Claude remembers; a Codex thread can be continued and
	// not branched, so a fork of one carries the transcript and no session.
	if !svc.agents.branches(agentClaude) || svc.agents.branches(agentCodex) {
		t.Errorf("branches: claude=%v codex=%v, want true/false",
			svc.agents.branches(agentClaude), svc.agents.branches(agentCodex))
	}
}

// Muse publishes all three modes, like Claude: its host asks over its own wire and the driver
// relays both the calls and the questions. And sessions branch, so a fork of a Muse conversation
// is one Muse remembers.
func TestAgentRegistryMusePublishesEveryMode(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withMuse(t, svc)

	for _, mode := range []string{permissionModeManual, permissionModeManualLive, permissionModeBypass} {
		if !svc.agents.publishesMode(agentMuse, mode) {
			t.Errorf("Muse must publish %s, like Claude", mode)
		}
	}
	if !svc.agents.branches(agentMuse) {
		t.Error("Muse must branch sessions: session/fork copies one under an id of its own")
	}
}

// A conversation binds to Muse like to any other agent — including in manual mode, which is the
// mode that asks.
func TestCreateConversationBindsMuse(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withMuse(t, svc)

	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations",
		`{"folder":"","agent":"muse","permissionMode":"manual"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create on muse = %d (%s), want 201", rec.Code, rec.Body.String())
	}
	var created AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Agent != agentMuse {
		t.Errorf("agent = %q, want the one the request named", created.Agent)
	}
	// The stub catalogue holds a single Spark, offered beside its `-contributor` twin — and
	// the twin is the default, at `max` like every Muse conversation that names nothing.
	if created.Model != "meta/muse-spark-1.2-contributor" || created.Effort != "max" {
		t.Errorf("model/effort = %q/%q, want the twinned contributor at max",
			created.Model, created.Effort)
	}
}

// A create that names neither model nor effort stores its agent's own pair — which is what the
// cross-agent starter above the switcher makes, since it sends no settings of its own.
func TestCreateConversationStoresTheAgentDefaults(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)

	created := mustCreateThrough(t, svc, `{"folder":""}`)
	if created.Agent != agentClaude || created.Model != "opus" || created.Effort != "max" {
		t.Errorf("created = %+v, want a Claude conversation on opus at max", created)
	}

	codex := mustCreateThrough(t, svc, `{"folder":"","agent":"codex","permissionMode":"bypassPermissions"}`)
	if codex.Model != "" || codex.Effort != "" {
		t.Errorf("model/effort = %q/%q, want nothing stored: a Codex turn that names neither runs the host's own",
			codex.Model, codex.Effort)
	}
}

// The pair a conversation that names neither starts with, per agent: `opus` at `max` on Claude,
// the newest Spark contributor build at `max` on Muse, and nothing on Codex — whose host default
// is the right one.
func TestRegistryDefaultsForArePerAgent(t *testing.T) {
	cfg := &Config{Config: &core.Config{}, BypassEnabled: true}
	registry := newAgentRegistry(cfg)
	muse := museAgentAt(cfg, "muse-stub")
	muse.options.catalogue = func() ([]byte, error) {
		return []byte(`{"models":[
			{"modelId":"muse-spark-1.2-contributor","displayLabel":"Spark 1.2"},
			{"modelId":"muse-spark-1.3-contributor","displayLabel":"Spark 1.3"}]}`), nil
	}
	registry.set(agentMuse, muse)

	if model, effort := registry.defaultsFor(agentClaude); model != "opus" || effort != "max" {
		t.Errorf("claude defaults = %q/%q, want opus/max", model, effort)
	}
	if model, effort := registry.defaultsFor(agentCodex); model != "" || effort != "" {
		t.Errorf("codex defaults = %q/%q, want no opinion", model, effort)
	}
	if model, effort := registry.defaultsFor(agentMuse); model != "muse-spark-1.3-contributor" || effort != "max" {
		t.Errorf("muse defaults = %q/%q, want the newest contributor at max", model, effort)
	}
	if model, effort := registry.defaultsFor("gemini"); model != defaultConversationModel || effort != defaultConversationEffort {
		t.Errorf("unknown agent defaults = %q/%q, want the service's own", model, effort)
	}
}

// A conversation is bound to its agent at creation, like its folder, and the endpoint refuses one
// this deployment does not offer rather than quietly making a Claude conversation instead.
func TestCreateConversationBindsTheAgent(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)

	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations",
		`{"folder":"","agent":"codex","permissionMode":"bypassPermissions"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create on codex = %d (%s), want 201", rec.Code, rec.Body.String())
	}
	var created AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Agent != agentCodex {
		t.Errorf("agent = %q, want the one the request named", created.Agent)
	}

	// A conversation created without naming one reports the default rather than an empty string, so
	// a client never has to know what the default is to render a chip.
	rec = do(svc, jsonReq(http.MethodPost, "/claude/conversations", `{"folder":""}`))
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Agent != agentClaude {
		t.Errorf("agent = %q, want the default resolved", created.Agent)
	}

	if rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations",
		`{"folder":"","agent":"gemini"}`)); rec.Code != http.StatusBadRequest {
		t.Errorf("create on an unknown agent = %d, want 400", rec.Code)
	}
}

// A mode the agent does not have is refused at creation as well as at every prompt — the same
// reasoning that refuses a mode the deployment does not allow. A conversation whose stored mode can
// never run is a dead end, and this is the point at which the user chose it.
func TestCreateConversationRefusesAModeTheAgentLacks(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)

	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations",
		`{"folder":"","agent":"codex","permissionMode":"manual"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("create = %d, want 400", rec.Code)
	}
	// The message names both, because neither half is guessable from the other: the same mode is
	// ordinary on Claude, and the same agent runs perfectly well in another mode.
	if body := rec.Body.String(); !strings.Contains(body, "Codex") || !strings.Contains(body, "manual") {
		t.Errorf("refusal = %q, want it to name the agent and the mode", body)
	}
}

// The agent cannot be patched. It is fixed for the conversation's life for a stronger reason than
// the folder is: a session id belongs to one engine, so a conversation that changed agent would hold
// a session nothing could resume under a transcript claiming it had been continued.
func TestPatchCannotChangeTheAgent(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)
	created := mustCreateThrough(t, svc, `{"folder":"","agent":"codex","permissionMode":"bypassPermissions"}`)

	rec := do(svc, jsonReq(http.MethodPatch, "/claude/conversations/"+created.ID, `{"agent":"claude"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch = %d (%s), want 200: an unknown field is ignored", rec.Code, rec.Body.String())
	}
	var patched AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &patched); err != nil {
		t.Fatal(err)
	}
	if patched.Agent != agentCodex {
		t.Errorf("agent = %q, want it unchanged: changing it is a fork", patched.Agent)
	}
	// A mode the conversation's own agent does not have is refused here too.
	if rec := do(svc, jsonReq(http.MethodPatch, "/claude/conversations/"+created.ID,
		`{"permissionMode":"manualLive"}`)); rec.Code != http.StatusBadRequest {
		t.Errorf("patch to a mode Codex lacks = %d, want 400", rec.Code)
	}
}

// Changing agent is a fork, and the fork says what it costs: the copy runs on the new engine, starts
// a session of its own, and carries the transcript as a preamble to read rather than to remember.
func TestForkOntoAnotherAgentDropsTheSession(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)
	source := mustCreateThrough(t, svc, `{"folder":"","model":"sonnet","effort":"high"}`)
	mustAppend(t, svc.conversations, source.ID, conversationRecord{Role: roleUser, Text: "first"},
		func(meta *conversationMeta) { meta.SessionID = "claude-session-7" })

	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations/"+source.ID+"/fork", `{"agent":"codex"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("fork onto codex = %d (%s), want 201", rec.Code, rec.Body.String())
	}
	var fork AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &fork); err != nil {
		t.Fatal(err)
	}
	if fork.Agent != agentCodex {
		t.Errorf("agent = %q, want the copy on the agent the fork named", fork.Agent)
	}
	if fork.SessionID != "" {
		t.Errorf("sessionId = %q, want none: a session id is one engine's own", fork.SessionID)
	}
	// A Codex conversation must not inherit `sonnet`, which names nothing it can run, nor a mode it
	// does not have — the copy would be refused at its first prompt.
	if fork.Model == "sonnet" {
		t.Errorf("model = %q, want the new agent's own rather than a word from the old one's vocabulary", fork.Model)
	}
	if fork.PermissionMode != permissionModeBypass {
		t.Errorf("permissionMode = %q, want a mode Codex actually has", fork.PermissionMode)
	}

	// And the transcript says so where the user reads it, rather than leaving them to find out by
	// asking the new agent about something it has never seen.
	detail := do(svc, jsonReq(http.MethodGet, "/claude/conversations/"+fork.ID, ""))
	var full AgentConversationDetailDto
	if err := json.Unmarshal(detail.Body.Bytes(), &full); err != nil {
		t.Fatal(err)
	}
	last := full.Messages[len(full.Messages)-1]
	if last.Role != roleNotice || !strings.Contains(last.Text, "Codex") {
		t.Errorf("fork notice = %+v, want it to name the agent that was not given the history", last)
	}
	if !strings.Contains(last.Text, "read, not remembered") {
		t.Errorf("fork notice = %q, want it to say the history is not remembered", last.Text)
	}

	// The source is untouched, as it is by every other fork.
	reread, err := svc.conversations.get(source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reread.SessionID != "claude-session-7" || resolvedAgent(reread.Agent) != agentClaude {
		t.Errorf("source = %+v, want it left exactly as it was", reread)
	}
}

// A fork onto the *same* agent is the fork it always was: same settings, and the session carried
// where that agent can branch one.
func TestForkOntoTheSameAgentIsUnchanged(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)
	source := mustCreateThrough(t, svc, `{"folder":"","model":"opus","effort":"max"}`)
	mustAppend(t, svc.conversations, source.ID, conversationRecord{Role: roleUser, Text: "first"},
		func(meta *conversationMeta) { meta.SessionID = "claude-session-7" })

	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations/"+source.ID+"/fork", `{}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("fork = %d (%s), want 201", rec.Code, rec.Body.String())
	}
	var fork AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &fork); err != nil {
		t.Fatal(err)
	}
	if fork.Agent != agentClaude || fork.Model != "opus" || fork.Effort != "max" {
		t.Errorf("fork = %+v, want the source's agent and settings", fork)
	}
	if fork.SessionID != "claude-session-7" {
		t.Errorf("sessionId = %q, want the session Claude can branch", fork.SessionID)
	}
}

// /claude/options answers for every agent, and keeps the default agent's three lists at the top
// level so a client written before agents were a choice reads exactly what it always did.
func TestOptionsAnswerPerAgent(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	svc.agents.set(agentClaude, &claudeAgent{options: &ClaudeOptionsService{
		bypassEnabled: true, help: func() (string, error) { return wrappedHelpExcerpt, nil },
	}})
	withCodex(t, svc)
	withMuse(t, svc)
	withOpenCode(t, svc)

	rec := do(svc, jsonReq(http.MethodGet, "/claude/options", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /claude/options = %d, want 200", rec.Code)
	}
	var opts agentOptionsDto
	if err := json.Unmarshal(rec.Body.Bytes(), &opts); err != nil {
		t.Fatal(err)
	}
	if opts.DefaultAgent != agentClaude || len(opts.Agents) != 4 {
		t.Fatalf("options = %+v, want every agent and Claude as the default", opts)
	}
	if opts.Agents[0].Value != agentClaude || opts.Agents[1].Value != agentCodex ||
		opts.Agents[2].Value != agentMuse || opts.Agents[3].Value != agentOpenCode {
		t.Errorf("agents = %+v, want the default first", opts.Agents)
	}
	// The top level is the default agent's, verbatim.
	assertValues(t, opts.PermissionModes, effortValues(opts.Agents[0].PermissionModes))
	assertValues(t, opts.Agents[1].PermissionModes, []string{permissionModeBypass})
	if opts.Agents[1].Label != "Codex" {
		t.Errorf("label = %q, want something to put on a chip", opts.Agents[1].Label)
	}
	if opts.Agents[2].Label != "Muse" || len(opts.Agents[2].Models) != 2 {
		t.Errorf("muse = %+v, want it published with its catalogue and the contributor twin",
			opts.Agents[2])
	}
	assertValues(t, opts.Agents[3].PermissionModes, []string{permissionModeBypass})
	if opts.Agents[3].Label != "OpenCode" || len(opts.Agents[3].Models) != 3 {
		t.Errorf("opencode = %+v, want it published with the curated two and its catalogue", opts.Agents[3])
	}
	// Each entry advertises the pair a new conversation on it starts with — the same pair a
	// create that names neither stores.
	if opts.Agents[0].DefaultModel != "opus" || opts.Agents[0].DefaultEffort != "max" {
		t.Errorf("claude defaults = %q/%q, want opus/max",
			opts.Agents[0].DefaultModel, opts.Agents[0].DefaultEffort)
	}
	if opts.Agents[1].DefaultModel != "" || opts.Agents[1].DefaultEffort != "" {
		t.Errorf("codex defaults = %q/%q, want no opinion",
			opts.Agents[1].DefaultModel, opts.Agents[1].DefaultEffort)
	}
	if opts.Agents[2].DefaultModel != "meta/muse-spark-1.2-contributor" || opts.Agents[2].DefaultEffort != "max" {
		t.Errorf("muse defaults = %q/%q, want the twinned contributor at max",
			opts.Agents[2].DefaultModel, opts.Agents[2].DefaultEffort)
	}
	if opts.Agents[3].DefaultModel != "" || opts.Agents[3].DefaultEffort != "" {
		t.Errorf("opencode defaults = %q/%q, want no opinion",
			opts.Agents[3].DefaultModel, opts.Agents[3].DefaultEffort)
	}
	// And the top level carries the default agent's, like the lists beside it.
	if opts.DefaultModel != "opus" || opts.DefaultEffort != "max" {
		t.Errorf("top-level defaults = %q/%q, want the default agent's",
			opts.DefaultModel, opts.DefaultEffort)
	}
}

// mustCreateThrough creates a conversation through the endpoint, which is where the agent is bound
// and where the refusals these tests are about are made.
func mustCreateThrough(t *testing.T, svc *Service, body string) AgentConversationDto {
	t.Helper()
	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations", body))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create %s = %d (%s), want 201", body, rec.Code, rec.Body.String())
	}
	var created AgentConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	return created
}

// ── the gates on the way to a turn ────────────────────────────────────────────

// A prompt is refused where the conversation's agent does not have the mode. It is a second gate and
// not a repeat of the deployment's: what the deployment allows says what may be run at all, this
// says what this engine can do.
func TestAPromptIsRefusedForAModeTheAgentLacks(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)
	created := mustCreateThrough(t, svc, `{"folder":"","agent":"codex","permissionMode":"bypassPermissions"}`)

	_, refusal := svc.hub.startTurnFor(nil, core.Identity{User: "tester"}, turnRequest{
		conversationID: created.ID, prompt: "hello", permissionMode: permissionModeManualLive,
	})
	if refusal == nil || refusal.code != errCodeModeUnsupported {
		t.Fatalf("refusal = %+v, want %q", refusal, errCodeModeUnsupported)
	}
	if !strings.Contains(refusal.message, "Codex") {
		t.Errorf("refusal = %q, want it to name the agent that does not have the mode", refusal.message)
	}
	// The same conversation in the mode Codex does have gets past this gate. It fails later, at the
	// spawn, because the stub binary is not there — which is a turn that ran and ended badly rather
	// than a prompt refused, and comes back as a job with no refusal.
	job, refused := svc.hub.startTurnFor(nil, core.Identity{User: "tester"}, turnRequest{
		conversationID: created.ID, prompt: "hello",
	})
	if refused != nil || job == nil {
		t.Fatalf("refusal = %+v, want the mode Codex has to get past the gate", refused)
	}
}

// A conversation whose agent this deployment no longer offers is refused with a code of its own: the
// session belongs to that engine and cannot be moved, so saying so — and pointing at the fork — is
// all there is left to do with it.
func TestAPromptIsRefusedForAnAgentThatIsGone(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)
	created := mustCreateThrough(t, svc, `{"folder":"","agent":"codex","permissionMode":"bypassPermissions"}`)

	// The deployment switches Codex off, and the conversation created on it outlives the change.
	svc.hub.agents.entries = svc.hub.agents.entries[:1]

	_, refusal := svc.hub.startTurnFor(nil, core.Identity{User: "tester"}, turnRequest{
		conversationID: created.ID, prompt: "hello",
	})
	if refusal == nil || refusal.code != errCodeUnknownAgent {
		t.Fatalf("refusal = %+v, want %q", refusal, errCodeUnknownAgent)
	}
	if !strings.Contains(refusal.message, "Fork it") {
		t.Errorf("refusal = %q, want it to name the way out", refusal.message)
	}
}
