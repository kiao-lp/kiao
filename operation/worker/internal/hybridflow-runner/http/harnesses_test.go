package runnerhttp

import (
	"encoding/json"
	"kiao/worker/internal/core/access"
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/hybridflow-runner/assembly"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	claudecli "kiao/worker/internal/hybridflow-runner/harnesses/claude"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"net/http"
	"strings"
	"testing"
)

// withCodex puts a Codex harness in a service's registry, with its catalogue stubbed so that no
// `codex` need be on the host. Everything about the harness that these tests are concerned with — its
// one permission mode, that it does not branch sessions — is this service's own knowledge.
func withCodex(t *testing.T, svc *Service) {
	t.Helper()
	svc.harnesses.Set(harnessapi.HarnessCodex, codexHarnessAt(svc.cfg, "codex-stub"))
}

// withMuse is the same for Muse: its three permission modes and its branching sessions are this
// service's own knowledge, so no `muse` need be on the host.
func withMuse(t *testing.T, svc *Service) {
	t.Helper()
	svc.harnesses.Set(harnessapi.HarnessMuse, museHarnessAt(svc.cfg, "muse-stub"))
}

// withOpenCode is the same for OpenCode: its one permission mode, its curated models and its
// branching sessions are this service's own knowledge, so no `opencode` need be on the host.
func withOpenCode(t *testing.T, svc *Service) {
	t.Helper()
	svc.harnesses.Set(harnessapi.HarnessOpenCode, opencodeHarnessAt(svc.cfg, "opencode-stub"))
}

// The default is Claude, and a conversation that names no harness is bound to it: every conversation
// written before harnesses were a choice named none, and every one of them was Claude's.
func TestHarnessRegistryDefaultsToClaude(t *testing.T) {
	registry := assembly.NewHarnessRegistry(&runnerconfig.Config{Config: &coreconfig.Config{}, BypassEnabled: true})

	if registry.DefaultName() != harnessapi.HarnessClaude {
		t.Errorf("default = %q, want Claude", registry.DefaultName())
	}
	if entry, ok := registry.Resolve(""); !ok || entry.Name != harnessapi.HarnessClaude {
		t.Errorf("resolve(\"\") = %+v/%v, want the default entry", entry, ok)
	}
	// A harness this deployment does not offer is refused rather than falling back to the default:
	// running a turn on a harness the caller did not ask for is worse than saying no.
	if _, ok := registry.Resolve("gemini"); ok {
		t.Error("an unknown harness must be refused rather than resolved to the default")
	}
}

// CLI availability is checked per request, so installing a harness makes it available
// on the next read without a worker restart.
func TestHarnessRegistryOffersWhatIsOnTheMachine(t *testing.T) {
	registry := assembly.NewHarnessRegistry(&runnerconfig.Config{Config: &coreconfig.Config{}})

	withCLIsOnPath(t, "claude")
	if got := registry.Names(); len(got) != 1 || got[0] != harnessapi.HarnessClaude {
		t.Errorf("with claude alone on the machine, names = %v, want [claude]", got)
	}

	// The same registry, a minute later, after an install.
	withCLIsOnPath(t, "claude", "codex")
	if got := registry.Names(); len(got) != 2 {
		t.Errorf("with both on the machine, names = %v, want both", got)
	}

	// And a machine with neither offers neither — an empty list is a real answer, and the panel
	// says "install one" rather than drawing a dropdown that fails at the first prompt.
	withCLIsOnPath(t)
	if got := registry.Names(); len(got) != 0 {
		t.Errorf("with no CLI on the machine, names = %v, want none", got)
	}
	if _, ok := registry.Resolve(""); ok {
		t.Error("a host with no harness CLI must resolve no default harness")
	}
	// It is still Claude that a conversation would be *recorded* under: a name has to be written,
	// and every conversation from before harnesses were a choice reads as Claude's.
	if registry.DefaultName() != harnessapi.HarnessClaude {
		t.Errorf("default = %q, want Claude even where nothing is installed", registry.DefaultName())
	}
}

// The deployment's veto is separate from what is on the machine, and there is one per harness — which
// is the whole point: turning Codex off must not cost anyone Claude.
func TestHarnessRegistryHonoursThePerHarnessVeto(t *testing.T) {
	withCLIsOnPath(t, "claude", "codex")

	noCodex := assembly.NewHarnessRegistry(&runnerconfig.Config{Config: &coreconfig.Config{}, CodexDisabled: true})
	if noCodex.Known(harnessapi.HarnessCodex) {
		t.Error("Codex must be withheld where the deployment vetoed it, binary or no binary")
	}
	if !noCodex.Known(harnessapi.HarnessClaude) {
		t.Error("vetoing Codex must not cost the deployment Claude")
	}

	noClaude := assembly.NewHarnessRegistry(&runnerconfig.Config{Config: &coreconfig.Config{}, ClaudeDisabled: true})
	if noClaude.Known(harnessapi.HarnessClaude) {
		t.Error("Claude must be withheld where the deployment vetoed it")
	}
	if noClaude.DefaultName() != harnessapi.HarnessCodex {
		t.Errorf("default = %q, want the one harness left offered", noClaude.DefaultName())
	}
}

// The configuration panel's switch is the third answer, and it is read at every ask rather than at
// startup — a row switched off in the panel takes a harness out of the tab with no restart.
func TestHarnessRegistryHonoursTheConfigurationPanel(t *testing.T) {
	withCLIsOnPath(t, "claude", "codex")
	withdrawn := map[string]bool{}
	registry := assembly.NewHarnessRegistry(&runnerconfig.Config{Config: &coreconfig.Config{}})
	registry.Gate = gateFunc(func(name string) bool { return !withdrawn[name] })

	if len(registry.Names()) != 2 {
		t.Fatalf("names = %v, want both before anything is switched off", registry.Names())
	}
	withdrawn[harnessapi.HarnessCodex] = true
	if got := registry.Names(); len(got) != 1 || got[0] != harnessapi.HarnessClaude {
		t.Errorf("names = %v, want Codex withdrawn by the panel", got)
	}
	// Withdrawn, not forgotten: a conversation already bound to it still renders under its label.
	if registry.Label(harnessapi.HarnessCodex) != "Codex" {
		t.Errorf("label(codex) = %q, want a withdrawn harness still to render", registry.Label(harnessapi.HarnessCodex))
	}
}

// gateFunc is the toolbox's answer, as a function.
type gateFunc func(name string) bool

func (f gateFunc) HarnessOffered(name string) bool { return f(name) }

// The two harnesses publish different modes, which is the whole reason the gate is per harness rather
// than per deployment.
func TestHarnessRegistryPublishesModesPerHarness(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)

	if !svc.harnesses.PublishesMode(harnessapi.HarnessClaude, runnerconfig.PermissionModeManual) {
		t.Error("Claude must publish manual: it is the mode that asks")
	}
	if svc.harnesses.PublishesMode(harnessapi.HarnessCodex, runnerconfig.PermissionModeManual) {
		t.Error("Codex must not publish manual: `codex exec` has no channel to ask on")
	}
	if !svc.harnesses.PublishesMode(harnessapi.HarnessCodex, runnerconfig.PermissionModeBypass) {
		t.Error("Codex must publish bypass, which is the one mode it has")
	}
	// A fork of a Claude conversation is one Claude remembers; a Codex thread can be continued and
	// not branched, so a fork of one carries the transcript and no session.
	if !svc.harnesses.Branches(harnessapi.HarnessClaude) || svc.harnesses.Branches(harnessapi.HarnessCodex) {
		t.Errorf("branches: claude=%v codex=%v, want true/false",
			svc.harnesses.Branches(harnessapi.HarnessClaude), svc.harnesses.Branches(harnessapi.HarnessCodex))
	}
}

// Muse publishes all three modes, like Claude: its host asks over its own wire and the driver
// relays both the calls and the questions. And sessions branch, so a fork of a Muse conversation
// is one Muse remembers.
func TestHarnessRegistryMusePublishesEveryMode(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withMuse(t, svc)

	for _, mode := range []string{runnerconfig.PermissionModeManual, runnerconfig.PermissionModeManualLive, runnerconfig.PermissionModeBypass} {
		if !svc.harnesses.PublishesMode(harnessapi.HarnessMuse, mode) {
			t.Errorf("Muse must publish %s, like Claude", mode)
		}
	}
	if !svc.harnesses.Branches(harnessapi.HarnessMuse) {
		t.Error("Muse must branch sessions: session/fork copies one under an id of its own")
	}
}

// A conversation binds to Muse like to any other harness — including in manual mode, which is the
// mode that asks.
func TestCreateConversationBindsMuse(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withMuse(t, svc)

	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations",
		`{"folder":"","harness":"muse","permissionMode":"manual"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create on muse = %d (%s), want 201", rec.Code, rec.Body.String())
	}
	var created pkgConversations.HarnessConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Harness != harnessapi.HarnessMuse {
		t.Errorf("harness = %q, want the one the request named", created.Harness)
	}
	// The stub catalogue holds a single Spark, offered beside its `-contributor` twin — and
	// the twin is the default, at `max` like every Muse conversation that names nothing.
	if created.Model != "meta/muse-spark-1.2-contributor" || created.Effort != "max" {
		t.Errorf("model/effort = %q/%q, want the twinned contributor at max",
			created.Model, created.Effort)
	}
}

// A create that names neither model nor effort stores its harness's own pair — which is what the
// cross-harness starter above the switcher makes, since it sends no settings of its own.
func TestCreateConversationStoresTheHarnessDefaults(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)

	created := mustCreateThrough(t, svc, `{"folder":""}`)
	if created.Harness != harnessapi.HarnessClaude || created.Model != "opus" || created.Effort != "max" {
		t.Errorf("created = %+v, want a Claude conversation on opus at max", created)
	}

	codex := mustCreateThrough(t, svc, `{"folder":"","harness":"codex","permissionMode":"bypassPermissions"}`)
	if codex.Model != "" || codex.Effort != "" {
		t.Errorf("model/effort = %q/%q, want nothing stored: a Codex turn that names neither runs the host's own",
			codex.Model, codex.Effort)
	}
}

// The pair a conversation that names neither starts with, per harness: `opus` at `max` on Claude,
// the newest Spark contributor build at `max` on Muse, and nothing on Codex — whose host default
// is the right one.
func TestRegistryDefaultsForArePerHarness(t *testing.T) {
	cfg := &runnerconfig.Config{Config: &coreconfig.Config{}, BypassEnabled: true}
	registry := assembly.NewHarnessRegistry(cfg)
	muse := museHarnessAt(cfg, "muse-stub")
	muse.OptionsService.Catalogue = func() ([]byte, error) {
		return []byte(`{"models":[
			{"modelId":"muse-spark-1.2-contributor","displayLabel":"Spark 1.2"},
			{"modelId":"muse-spark-1.3-contributor","displayLabel":"Spark 1.3"}]}`), nil
	}
	registry.Set(harnessapi.HarnessMuse, muse)

	if model, effort := registry.DefaultsFor(harnessapi.HarnessClaude); model != "opus" || effort != "max" {
		t.Errorf("claude defaults = %q/%q, want opus/max", model, effort)
	}
	if model, effort := registry.DefaultsFor(harnessapi.HarnessCodex); model != "" || effort != "" {
		t.Errorf("codex defaults = %q/%q, want no opinion", model, effort)
	}
	if model, effort := registry.DefaultsFor(harnessapi.HarnessMuse); model != "muse-spark-1.3-contributor" || effort != "max" {
		t.Errorf("muse defaults = %q/%q, want the newest contributor at max", model, effort)
	}
	if model, effort := registry.DefaultsFor("gemini"); model != harnessapi.DefaultConversationModel || effort != harnessapi.DefaultConversationEffort {
		t.Errorf("unknown harness defaults = %q/%q, want the service's own", model, effort)
	}
}

// A conversation is bound to its harness at creation, like its folder, and the endpoint refuses one
// this deployment does not offer rather than quietly making a Claude conversation instead.
func TestCreateConversationBindsTheHarness(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)

	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations",
		`{"folder":"","harness":"codex","permissionMode":"bypassPermissions"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create on codex = %d (%s), want 201", rec.Code, rec.Body.String())
	}
	var created pkgConversations.HarnessConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Harness != harnessapi.HarnessCodex {
		t.Errorf("harness = %q, want the one the request named", created.Harness)
	}

	// A conversation created without naming one reports the default rather than an empty string, so
	// a client never has to know what the default is to render a chip.
	rec = do(svc, jsonReq(http.MethodPost, "/claude/conversations", `{"folder":""}`))
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Harness != harnessapi.HarnessClaude {
		t.Errorf("harness = %q, want the default resolved", created.Harness)
	}

	if rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations",
		`{"folder":"","harness":"gemini"}`)); rec.Code != http.StatusBadRequest {
		t.Errorf("create on an unknown harness = %d, want 400", rec.Code)
	}
}

// A mode the harness does not have is refused at creation as well as at every prompt — the same
// reasoning that refuses a mode the deployment does not allow. A conversation whose stored mode can
// never run is a dead end, and this is the point at which the user chose it.
func TestCreateConversationRefusesAModeTheHarnessLacks(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)

	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations",
		`{"folder":"","harness":"codex","permissionMode":"manual"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("create = %d, want 400", rec.Code)
	}
	// The message names both, because neither half is guessable from the other: the same mode is
	// ordinary on Claude, and the same harness runs perfectly well in another mode.
	if body := rec.Body.String(); !strings.Contains(body, "Codex") || !strings.Contains(body, "manual") {
		t.Errorf("refusal = %q, want it to name the harness and the mode", body)
	}
}

// The harness cannot be patched. It is fixed for the conversation's life for a stronger reason than
// the folder is: a session id belongs to one engine, so a conversation that changed harness would hold
// a session nothing could resume under a transcript claiming it had been continued.
func TestPatchCannotChangeTheHarness(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)
	created := mustCreateThrough(t, svc, `{"folder":"","harness":"codex","permissionMode":"bypassPermissions"}`)

	rec := do(svc, jsonReq(http.MethodPatch, "/claude/conversations/"+created.ID, `{"harness":"claude"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch = %d (%s), want 200: an unknown field is ignored", rec.Code, rec.Body.String())
	}
	var patched pkgConversations.HarnessConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &patched); err != nil {
		t.Fatal(err)
	}
	if patched.Harness != harnessapi.HarnessCodex {
		t.Errorf("harness = %q, want it unchanged: changing it is a fork", patched.Harness)
	}
	// A mode the conversation's own harness does not have is refused here too.
	if rec := do(svc, jsonReq(http.MethodPatch, "/claude/conversations/"+created.ID,
		`{"permissionMode":"manualLive"}`)); rec.Code != http.StatusBadRequest {
		t.Errorf("patch to a mode Codex lacks = %d, want 400", rec.Code)
	}
}

// Changing harness is a fork, and the fork says what it costs: the copy runs on the new engine, starts
// a session of its own, and carries the transcript as a preamble to read rather than to remember.
func TestForkOntoAnotherHarnessDropsTheSession(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)
	source := mustCreateThrough(t, svc, `{"folder":"","model":"sonnet","effort":"high"}`)
	mustAppend(t, svc.conversations, source.ID, pkgConversations.ConversationRecord{Role: pkgConversations.RoleUser, Text: "first"},
		func(meta *pkgConversations.ConversationMeta) { meta.SessionID = "claude-session-7" })

	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations/"+source.ID+"/fork", `{"harness":"codex"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("fork onto codex = %d (%s), want 201", rec.Code, rec.Body.String())
	}
	var fork pkgConversations.HarnessConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &fork); err != nil {
		t.Fatal(err)
	}
	if fork.Harness != harnessapi.HarnessCodex {
		t.Errorf("harness = %q, want the copy on the harness the fork named", fork.Harness)
	}
	if fork.SessionID != "" {
		t.Errorf("sessionId = %q, want none: a session id is one engine's own", fork.SessionID)
	}
	// A Codex conversation must not inherit `sonnet`, which names nothing it can run, nor a mode it
	// does not have — the copy would be refused at its first prompt.
	if fork.Model == "sonnet" {
		t.Errorf("model = %q, want the new harness's own rather than a word from the old one's vocabulary", fork.Model)
	}
	if fork.PermissionMode != runnerconfig.PermissionModeBypass {
		t.Errorf("permissionMode = %q, want a mode Codex actually has", fork.PermissionMode)
	}

	// And the transcript says so where the user reads it, rather than leaving them to find out by
	// asking the new harness about something it has never seen.
	detail := do(svc, jsonReq(http.MethodGet, "/claude/conversations/"+fork.ID, ""))
	var full pkgConversations.HarnessConversationDetailDto
	if err := json.Unmarshal(detail.Body.Bytes(), &full); err != nil {
		t.Fatal(err)
	}
	last := full.Messages[len(full.Messages)-1]
	if last.Role != pkgConversations.RoleNotice || !strings.Contains(last.Text, "Codex") {
		t.Errorf("fork notice = %+v, want it to name the harness that was not given the history", last)
	}
	if !strings.Contains(last.Text, "read, not remembered") {
		t.Errorf("fork notice = %q, want it to say the history is not remembered", last.Text)
	}

	// The source is untouched, as it is by every other fork.
	reread, err := svc.conversations.Get(source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reread.SessionID != "claude-session-7" || harnessapi.ResolvedHarness(reread.Harness) != harnessapi.HarnessClaude {
		t.Errorf("source = %+v, want it left exactly as it was", reread)
	}
}

// A fork onto the *same* harness is the fork it always was: same settings, and the session carried
// where that harness can branch one.
func TestForkOntoTheSameHarnessIsUnchanged(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)
	source := mustCreateThrough(t, svc, `{"folder":"","model":"opus","effort":"max"}`)
	mustAppend(t, svc.conversations, source.ID, pkgConversations.ConversationRecord{Role: pkgConversations.RoleUser, Text: "first"},
		func(meta *pkgConversations.ConversationMeta) { meta.SessionID = "claude-session-7" })

	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations/"+source.ID+"/fork", `{}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("fork = %d (%s), want 201", rec.Code, rec.Body.String())
	}
	var fork pkgConversations.HarnessConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &fork); err != nil {
		t.Fatal(err)
	}
	if fork.Harness != harnessapi.HarnessClaude || fork.Model != "opus" || fork.Effort != "max" {
		t.Errorf("fork = %+v, want the source's harness and settings", fork)
	}
	if fork.SessionID != "claude-session-7" {
		t.Errorf("sessionId = %q, want the session Claude can branch", fork.SessionID)
	}
}

// /claude/options answers for every harness, and keeps the default harness's three lists at the top
// level so a client written before harnesses were a choice reads exactly what it always did.
func TestOptionsAnswerPerHarness(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	svc.harnesses.Set(harnessapi.HarnessClaude, &claudecli.ClaudeHarness{OptionsService: &claudecli.ClaudeOptionsService{
		BypassEnabled: true, Help: func() (string, error) { return wrappedHelpExcerpt, nil },
	}})
	withCodex(t, svc)
	withMuse(t, svc)
	withOpenCode(t, svc)

	rec := do(svc, jsonReq(http.MethodGet, "/claude/options", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /claude/options = %d, want 200", rec.Code)
	}
	var opts harnessapi.HarnessOptionsDto
	if err := json.Unmarshal(rec.Body.Bytes(), &opts); err != nil {
		t.Fatal(err)
	}
	if opts.DefaultHarness != harnessapi.HarnessClaude || len(opts.Harnesses) != 4 {
		t.Fatalf("options = %+v, want every harness and Claude as the default", opts)
	}
	if opts.Harnesses[0].Value != harnessapi.HarnessClaude || opts.Harnesses[1].Value != harnessapi.HarnessCodex ||
		opts.Harnesses[2].Value != harnessapi.HarnessMuse || opts.Harnesses[3].Value != harnessapi.HarnessOpenCode {
		t.Errorf("harnesses = %+v, want the default first", opts.Harnesses)
	}
	// The top level is the default harness's, verbatim.
	assertValues(t, opts.PermissionModes, effortValues(opts.Harnesses[0].PermissionModes))
	assertValues(t, opts.Harnesses[1].PermissionModes, []string{runnerconfig.PermissionModeBypass})
	if opts.Harnesses[1].Label != "Codex" {
		t.Errorf("label = %q, want something to put on a chip", opts.Harnesses[1].Label)
	}
	if opts.Harnesses[2].Label != "Muse" || len(opts.Harnesses[2].Models) != 2 {
		t.Errorf("muse = %+v, want it published with its catalogue and the contributor twin",
			opts.Harnesses[2])
	}
	assertValues(t, opts.Harnesses[3].PermissionModes, []string{runnerconfig.PermissionModeBypass})
	if opts.Harnesses[3].Label != "OpenCode" || len(opts.Harnesses[3].Models) != 3 {
		t.Errorf("opencode = %+v, want it published with the curated two and its catalogue", opts.Harnesses[3])
	}
	// Each entry advertises the pair a new conversation on it starts with — the same pair a
	// create that names neither stores.
	if opts.Harnesses[0].DefaultModel != "opus" || opts.Harnesses[0].DefaultEffort != "max" {
		t.Errorf("claude defaults = %q/%q, want opus/max",
			opts.Harnesses[0].DefaultModel, opts.Harnesses[0].DefaultEffort)
	}
	if opts.Harnesses[1].DefaultModel != "" || opts.Harnesses[1].DefaultEffort != "" {
		t.Errorf("codex defaults = %q/%q, want no opinion",
			opts.Harnesses[1].DefaultModel, opts.Harnesses[1].DefaultEffort)
	}
	if opts.Harnesses[2].DefaultModel != "meta/muse-spark-1.2-contributor" || opts.Harnesses[2].DefaultEffort != "max" {
		t.Errorf("muse defaults = %q/%q, want the twinned contributor at max",
			opts.Harnesses[2].DefaultModel, opts.Harnesses[2].DefaultEffort)
	}
	if opts.Harnesses[3].DefaultModel != "" || opts.Harnesses[3].DefaultEffort != "" {
		t.Errorf("opencode defaults = %q/%q, want no opinion",
			opts.Harnesses[3].DefaultModel, opts.Harnesses[3].DefaultEffort)
	}
	// And the top level carries the default harness's, like the lists beside it.
	if opts.DefaultModel != "opus" || opts.DefaultEffort != "max" {
		t.Errorf("top-level defaults = %q/%q, want the default harness's",
			opts.DefaultModel, opts.DefaultEffort)
	}
}

// mustCreateThrough creates a conversation through the endpoint, which is where the harness is bound
// and where the refusals these tests are about are made.
func mustCreateThrough(t *testing.T, svc *Service, body string) pkgConversations.HarnessConversationDto {
	t.Helper()
	rec := do(svc, jsonReq(http.MethodPost, "/claude/conversations", body))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create %s = %d (%s), want 201", body, rec.Code, rec.Body.String())
	}
	var created pkgConversations.HarnessConversationDto
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	return created
}

// A prompt is refused where the conversation's harness does not have the mode. It is a second gate and
// not a repeat of the deployment's: what the deployment allows says what may be run at all, this
// says what this engine can do.
func TestAPromptIsRefusedForAModeTheHarnessLacks(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)
	created := mustCreateThrough(t, svc, `{"folder":"","harness":"codex","permissionMode":"bypassPermissions"}`)

	_, refusal := svc.hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
		ConversationID: created.ID, Prompt: "hello", PermissionMode: runnerconfig.PermissionModeManualLive,
	})
	if refusal == nil || refusal.Code != turnevents.ErrCodeModeUnsupported {
		t.Fatalf("refusal = %+v, want %q", refusal, turnevents.ErrCodeModeUnsupported)
	}
	if !strings.Contains(refusal.Message, "Codex") {
		t.Errorf("refusal = %q, want it to name the harness that does not have the mode", refusal.Message)
	}
	// The same conversation in the mode Codex does have gets past this gate. It fails later, at the
	// spawn, because the stub binary is not there — which is a turn that ran and ended badly rather
	// than a prompt refused, and comes back as a job with no refusal.
	job, refused := svc.hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
		ConversationID: created.ID, Prompt: "hello",
	})
	if refused != nil || job == nil {
		t.Fatalf("refusal = %+v, want the mode Codex has to get past the gate", refused)
	}
}

// A conversation whose harness this deployment no longer offers is refused with a code of its own: the
// session belongs to that engine and cannot be moved, so saying so — and pointing at the fork — is
// all there is left to do with it.
func TestAPromptIsRefusedForAnHarnessThatIsGone(t *testing.T) {
	svc, _ := newConversationTestServer(t)
	withCodex(t, svc)
	created := mustCreateThrough(t, svc, `{"folder":"","harness":"codex","permissionMode":"bypassPermissions"}`)

	// The deployment switches Codex off, and the conversation created on it outlives the change.
	svc.hub.Harnesses.Entries = svc.hub.Harnesses.Entries[:1]

	_, refusal := svc.hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
		ConversationID: created.ID, Prompt: "hello",
	})
	if refusal == nil || refusal.Code != turnevents.ErrCodeUnknownHarness {
		t.Fatalf("refusal = %+v, want %q", refusal, turnevents.ErrCodeUnknownHarness)
	}
	if !strings.Contains(refusal.Message, "Fork it") {
		t.Errorf("refusal = %q, want it to name the way out", refusal.Message)
	}
}
