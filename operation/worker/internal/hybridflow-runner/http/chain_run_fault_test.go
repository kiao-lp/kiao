package runnerhttp

import (
	"errors"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	"kiao/worker/internal/hybridflow-runner/assembly"
	"kiao/worker/internal/hybridflow-runner/playback"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"testing"
	"time"
)

func TestReplyFaultReadsTheCLIsNotices(t *testing.T) {
	cases := []struct {
		reply   string
		summary string
		retry   bool
	}{
		{"API Error: 401 Invalid API key · Please run /login", "Claude is not signed in", false},
		{"API Error: Your credit balance is too low to run this request.",
			"the account is out of credit", false},
		{"Claude AI usage limit reached|1750000000", "Claude’s usage limit was reached", true},
		{"API Error: 429 Too many requests", "Claude’s usage limit was reached", true},
		{"API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.",
			"Claude is overloaded", true},
		{"API Error: Connection to the API was lost (ECONNRESET). This is usually temporary — try again.",
			"the connection to Claude was lost", true},
		{"API Error: prompt is too long: 210000 tokens > 200000 maximum",
			"the prompt was too long for the model", false},
		{"API Error (opus): The model is not available on your deployment",
			"the model the flow node names cannot be run", false},
		{"API Error: something nobody has a word for", "Claude answered with an error", false},
	}
	for _, c := range cases {
		fault := agentfaults.ReplyFault(oneBlockReply(c.reply), "Claude")
		if fault == nil {
			t.Errorf("replyFault(%q) = nil, want %q", c.reply, c.summary)
			continue
		}
		if fault.Summary != c.summary || fault.Retry != c.retry {
			t.Errorf("replyFault(%q) = %+v, want %q retry=%v", c.reply, *fault, c.summary, c.retry)
		}
	}
}

// oneBlockReply is a turn that said one thing and exited cleanly — the shape of a turn that failed
// before it did anything, which is the reply the notices above arrive as on their own.
func oneBlockReply(text string) agentfaults.TurnReply {
	zero := 0
	return agentfaults.TurnReply{Text: text, Tail: text, ExitCode: &zero}
}

// A turn blocked twice is not an error a wait fixes: its driver already waited out two idle
// waits and resumed it once, so the runner forks the conversation rather than waiting and
// sending the flow node again.
func TestReplyFaultLeavesABlockedTwiceTurnToTheFork(t *testing.T) {
	fault := agentfaults.ReplyFault(agentfaults.TurnReply{Failure: agentfaults.MuseBlockedTwiceMessage}, "Muse")
	if fault == nil {
		t.Fatalf("replyFault(blocked twice) = nil, want the unknown error rather than an answer")
	}
	if fault.Retry {
		t.Errorf("replyFault(blocked twice) = %+v, want no retry: the fork owns this one", fault)
	}
}

// A notice is matched at the head of the reply and nowhere else: these texts are prose, and prose
// about API errors is something an answer may perfectly well contain.
func TestReplyFaultLeavesAnAnswerAlone(t *testing.T) {
	answers := []string{
		"",
		"I have added the retry: a 529 Overloaded now waits and tries again.",
		"Done. The handler reports `API Error: 429` as a rate limit, and the tests cover it. " +
			"I also renamed the field, moved the constant into the config, wrote the two tests you " +
			"asked for and committed all of it — the branch is ready to look at whenever you are, " +
			"and nothing has been pushed. The error handling now distinguishes the three cases that " +
			"matter and the notice text is the CLI's own, quoted where it is matched so it can be " +
			"read beside the pattern that matches it.",
	}
	for _, answer := range answers {
		if fault := agentfaults.ReplyFault(oneBlockReply(answer), "Claude"); fault != nil {
			t.Errorf("replyFault(%q) = %+v, want an answer read as an answer", answer, *fault)
		}
	}
}

// The notice a long run actually meets: the turn works for an hour, the five-hour window closes
// under it, and the CLI writes the limit as one more block at the end of everything already said.
// Read only at the head, that reply is an answer — and the flow node it belongs to is marked done
// by the very sentence saying it was not finished.
func TestReplyFaultReadsANoticeAtTheFootOfAWorkedTurn(t *testing.T) {
	work := "I'll start by exploring the hybridflow code.Now the classifier itself.Let me refine two details."
	cases := []struct {
		notice  string
		summary string
		retry   bool
	}{
		{"You've hit your session limit · resets 7:10pm (Europe/Paris)",
			"Claude’s usage limit was reached", true},
		{"You've hit your session limit · resets 7:10pm (Europe/Paris) · progress saved",
			"Claude’s usage limit was reached", true},
		{"You've hit your weekly limit · resets Mon 9am", "Claude’s usage limit was reached", true},
		{"You've hit your Opus limit · resets 7:10pm", "Claude’s usage limit was reached", true},
		{"You're out of usage credits · resets 7:10pm", "the account is out of credit", false},
		{"You've hit your monthly spend limit. /model to switch models.",
			"the account is out of credit", false},
		{"Your seat type doesn't include usage credits", "the account is out of credit", false},
		{"API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.",
			"Claude is overloaded", true},
	}
	for _, c := range cases {
		reply := agentfaults.TurnReply{Text: work + c.notice, Tail: c.notice}
		fault := agentfaults.ReplyFault(reply, "Claude")
		if fault == nil {
			t.Errorf("replyFault(…%q) = nil, want %q — an hour of work does not make a limit an answer",
				c.notice, c.summary)
			continue
		}
		if fault.Summary != c.summary || fault.Retry != c.retry {
			t.Errorf("replyFault(…%q) = %+v, want %q retry=%v", c.notice, *fault, c.summary, c.retry)
		}
	}
}

// A notice is a whole block. An answer whose last block merely ends on one is an answer.
func TestReplyFaultLeavesAnAnswerThatMentionsALimitAlone(t *testing.T) {
	tail := "Done — the run now stops when the reply ends with “You've hit your session limit”."
	reply := agentfaults.TurnReply{Text: "Looking at the classifier." + tail, Tail: tail}
	if fault := agentfaults.ReplyFault(reply, "Claude"); fault != nil {
		t.Errorf("replyFault = %+v, want an answer about limits read as an answer", *fault)
	}
}

// A turn that said nothing at all and whose process ended badly did not do the flow node either.
// The answer is not there to be read, so the exit code is all there is — and a turn that says
// nothing and exits cleanly is left alone, a quiet turn being a turn.
func TestReplyFaultReadsATurnThatSaidNothing(t *testing.T) {
	one, zero := 1, 0
	fault := agentfaults.ReplyFault(agentfaults.TurnReply{ExitCode: &one}, "Claude")
	if fault == nil || fault.Retry {
		t.Errorf("replyFault(crashed) = %v, want a fault nothing but the user clears", fault)
	}
	if fault := agentfaults.ReplyFault(agentfaults.TurnReply{ExitCode: &zero}, "Claude"); fault != nil {
		t.Errorf("replyFault(quiet) = %+v, want a turn that simply said little left alone", *fault)
	}
	if fault := agentfaults.ReplyFault(agentfaults.TurnReply{}, "Claude"); fault != nil {
		t.Errorf("replyFault(no exit code) = %+v, want nothing invented about a record that does not say",
			*fault)
	}
}

// A Codex turn refused for a limit says so on its failure channel and nothing at all where the
// answer goes. The run has to read that as the limit it is, or hold nothing and mark the flow node
// done.
func TestReplyFaultReadsWhatTheAgentReportedWhenItSaidNothingElse(t *testing.T) {
	zero := 0
	cases := []struct {
		failure string
		summary string
		retry   bool
		limit   bool
	}{
		// The API's own body, which is what `turn.failed` carries verbatim.
		{`{"type":"error","status":429,"error":{"type":"usage_limit_reached","message":"You've hit your usage limit."}}`,
			"Codex’s usage limit was reached", true, true},
		{`{"type":"error","status":429,"error":{"type":"rate_limit_exceeded","message":"Too many requests"}}`,
			"Codex’s usage limit was reached", true, true},
		{`{"type":"error","status":500,"error":{"message":"internal server error"}}`,
			"Codex is overloaded", true, false},
		{`{"type":"error","status":401,"error":{"message":"unauthorized"}}`,
			"Codex is not signed in", false, false},
		{"stream disconnected", "the connection to Codex was lost", true, false},
	}
	for _, c := range cases {
		reply := agentfaults.TurnReply{Failure: c.failure, ExitCode: &zero}
		fault := agentfaults.ReplyFault(reply, "Codex")
		if fault == nil {
			t.Errorf("replyFault(failure=%q) = nil, want %q", c.failure, c.summary)
			continue
		}
		if fault.Summary != c.summary || fault.Retry != c.retry || fault.Limit != c.limit {
			t.Errorf("replyFault(failure=%q) = %+v, want %q retry=%v limit=%v",
				c.failure, *fault, c.summary, c.retry, c.limit)
		}
	}
}

// A Muse turn refused for want of credentials says so on its failure channel and nothing at all
// where the answer goes. The run has to read that as the sign-in it is — named, and not retried,
// since no wait signs a host in.
func TestReplyFaultReadsAMuseTurnThatWantsCredentials(t *testing.T) {
	zero := 0
	reply := agentfaults.TurnReply{Failure: "not logged in: run /login to add an API key", ExitCode: &zero}
	fault := agentfaults.ReplyFault(reply, "Muse")
	if fault == nil {
		t.Fatal("replyFault = nil, want the sign-in read as a sign-in")
	}
	if fault.Summary != "Muse is not signed in" || fault.Retry || fault.Limit {
		t.Errorf("replyFault = %+v, want Muse named, held, and not waited on", *fault)
	}
}

// The failure channel carries progress notices too, and a turn that reported one and then answered
// is a turn that answered. Reading that channel unconditionally would fail every Codex turn that
// met a hiccup on its way to the right answer.
func TestReplyFaultLeavesAnAnsweredTurnAloneWhateverItReportedOnTheWay(t *testing.T) {
	zero := 0
	answer := "Done — the two handlers now share the retry."
	for _, notice := range []string{"Reconnecting... 1/5", "stream disconnected", "retrying request"} {
		reply := agentfaults.TurnReply{Text: answer, Tail: answer, Failure: notice, ExitCode: &zero}
		if fault := agentfaults.ReplyFault(reply, "Codex"); fault != nil {
			t.Errorf("replyFault(answer, failure=%q) = %+v, want the answer read as an answer",
				notice, *fault)
		}
	}
}

// A limit is the exception, and it is the case that matters: a turn works for an hour, the window
// closes under it, and the CLI reports it where it reports errors. There is an answer to weigh it
// against and it is still not the flow node being done.
func TestReplyFaultReadsALimitReportedAtTheFootOfAWorkedTurn(t *testing.T) {
	zero := 0
	work := "I have read the board and started on the first card."
	reply := agentfaults.TurnReply{
		Text: work, Tail: work, ExitCode: &zero,
		Failure: `{"type":"error","status":429,"error":{"type":"usage_limit_reached"}}`,
	}
	fault := agentfaults.ReplyFault(reply, "Codex")
	if fault == nil || !fault.Limit || !fault.Retry {
		t.Fatalf("replyFault = %v, want a limit held rather than an hour of work filed as the flow node", fault)
	}
}

// The summary names the engine the turn ran on. "Claude is overloaded" under a Codex card is a
// sentence about a service the flow node never touched.
func TestFaultSummariesNameTheAgentThatRanTheTurn(t *testing.T) {
	notice := "API Error: 529 Overloaded. This is a server-side issue, usually temporary."
	for agent, want := range map[string]string{"Claude": "Claude is overloaded", "Codex": "Codex is overloaded"} {
		fault := agentfaults.ReplyFault(oneBlockReply(notice), agent)
		if fault == nil || fault.Summary != want {
			t.Errorf("replyFault(%s) = %v, want %q", agent, fault, want)
		}
	}
}

// The refusals a run waits out: no turn ran, and the reason it did not is one that passes.
// Everything else is somebody's to fix, and twenty minutes changes none of it.
func TestRefusalFaultOnlyWaitsForWhatPasses(t *testing.T) {
	for _, code := range []string{turnevents.ErrCodeTooManyTurns, turnevents.ErrCodeConversationBusy} {
		fault := agentfaults.RefusalFault(code)
		if fault == nil || !fault.Retry {
			t.Errorf("refusalFault(%q) = %v, want a fault worth waiting out", code, fault)
		}
	}
	for _, code := range []string{turnevents.ErrCodeBadFolder, turnevents.ErrCodeBypassDisabled, turnevents.ErrCodeUnknownConversation,
		turnevents.ErrCodeSpawnFailed, turnevents.ErrCodeBadAttachment} {
		if fault := agentfaults.RefusalFault(code); fault != nil {
			t.Errorf("refusalFault(%q) = %+v, want it left to the caller to report", code, *fault)
		}
	}
}

func TestLimitResetAtReadsWhenTheLimitLifts(t *testing.T) {
	// A Wednesday afternoon, so a weekly window naming a weekday has somewhere ahead of it to land.
	now := time.Date(2026, time.September, 2, 14, 30, 0, 0, time.Local)
	day := func(add int, hour, minute int) time.Time {
		return time.Date(2026, time.September, 2+add, hour, minute, 0, 0, time.Local)
	}
	cases := []struct {
		notice string
		want   time.Time
	}{
		// The instant itself, which is how the CLI says the five-hour window on its own line.
		{"Claude AI usage limit reached|1750000000", time.Unix(1750000000, 0)},
		// The same in milliseconds, which some builds write.
		{"Claude AI usage limit reached|1750000000000", time.Unix(1750000000, 0)},
		// A wall clock later today, and one that has gone round to tomorrow.
		{"You’ve hit your session limit · resets 7:10pm", day(0, 19, 10)},
		{"You’ve hit your session limit · resets 7:10pm · progress saved", day(0, 19, 10)},
		{"You’ve hit your session limit · resets at 19:10", day(0, 19, 10)},
		{"You’ve hit your Opus limit · resets 3am", day(1, 3, 0)},
		{"You’ve hit your session limit · resets 12am", day(1, 0, 0)},
		// The weekly window names the day as well, and 9am on Wednesday is behind us.
		{"You’ve hit your weekly limit · resets Mon 9am", day(5, 9, 0)},
		{"You’ve hit your weekly limit · resets Thursday at 9am", day(1, 9, 0)},
		// The API's own header, quoted: a delay rather than a moment, in seconds unless it says.
		{"API Error: 429 rate limit exceeded, retry-after: 1800", now.Add(30 * time.Minute)},
		{"API Error: 429 rate limit exceeded — try again in 45 minutes", now.Add(45 * time.Minute)},
	}
	for _, c := range cases {
		at, ok := agentfaults.LimitResetAt(c.notice, now)
		if !ok {
			t.Errorf("limitResetAt(%q) said nothing, want %s", c.notice, c.want.Format(time.RFC3339))
			continue
		}
		if !at.Equal(c.want) {
			t.Errorf("limitResetAt(%q) = %s, want %s", c.notice,
				at.Format(time.RFC3339), c.want.Format(time.RFC3339))
		}
	}
}

// The zone the notice names is the zone its clock is read in: 7:10pm in Paris is not 7:10pm here,
// and a run that waits by the wrong one goes back in an hour early — one try spent for nothing.
func TestLimitResetAtReadsTheZoneTheNoticeNames(t *testing.T) {
	paris, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		t.Skip("no zone database on this host")
	}
	now := time.Date(2026, time.September, 2, 14, 30, 0, 0, time.UTC)
	at, ok := agentfaults.LimitResetAt("You’ve hit your session limit · resets 7:10pm (Europe/Paris)", now)
	if !ok {
		t.Fatal("limitResetAt said nothing about a notice naming both a clock and its zone")
	}
	if want := time.Date(2026, time.September, 2, 19, 10, 0, 0, paris); !at.Equal(want) {
		t.Errorf("limitResetAt = %s, want %s", at.Format(time.RFC3339), want.Format(time.RFC3339))
	}
}

// Nothing is invented, and nothing absurd is believed: a notice that names no moment leaves the run
// to wait the way it waits for every other error that passes, and one that names a moment years off
// is this reader having misread a number rather than a limit that lasts until 2285.
func TestLimitResetAtSaysNothingWhereThereIsNothingToRead(t *testing.T) {
	now := time.Date(2026, time.September, 2, 14, 30, 0, 0, time.Local)
	for _, notice := range []string{
		"API Error: 429 Too many requests",
		"Claude AI usage limit reached",
		"API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.",
		"Claude AI usage limit reached|9950000000",
	} {
		if at, ok := agentfaults.LimitResetAt(notice, now); ok {
			t.Errorf("limitResetAt(%q) = %s, want nothing read out of it", notice, at.Format(time.RFC3339))
		}
	}
}

// A limit is told from the other errors that pass, because the run answers it differently: it waits
// on the notice's clock rather than on its own, and what it sends afterwards picks the cut-off turn
// back up instead of asking for the flow node again.
func TestReplyFaultTellsALimitFromTheOtherErrorsThatPass(t *testing.T) {
	fault := agentfaults.ReplyFault(oneBlockReply("Claude AI usage limit reached|1750000000"), "Claude")
	if fault == nil || !fault.Limit {
		t.Fatalf("replyFault = %v, want a limit read as a limit", fault)
	}
	if !fault.ResetAt.Equal(time.Unix(1750000000, 0)) {
		t.Errorf("resetAt = %s, want the moment the notice named", fault.ResetAt.Format(time.RFC3339))
	}
	for _, notice := range []string{
		"API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.",
		"API Error: Connection to the API was lost (ECONNRESET). This is usually temporary — try again.",
		"API Error: 401 Invalid API key · Please run /login",
		"You’re out of usage credits · resets 7:10pm",
	} {
		if fault := agentfaults.ReplyFault(oneBlockReply(notice), "Claude"); fault != nil && fault.Limit {
			t.Errorf("replyFault(%q) = %+v, want an error that is not a window closing", notice, *fault)
		}
	}
	// A refused turn never reached the API at all, so nothing about it is a limit.
	if fault := agentfaults.RefusalFault(turnevents.ErrCodeTooManyTurns); fault == nil || fault.Limit {
		t.Errorf("refusalFault = %v, want a refusal waited out as a refusal", fault)
	}
}

// usageAgent is an agent whose only side port is the quota, answering whatever a test wrote.
type usageAgent struct {
	stubAgent
	dto agentapi.AgentUsageDto
	err error
}

func (a *usageAgent) Usage() (agentapi.AgentUsageDto, error) { return a.dto, a.err }

// runnerWithUsage is a runner whose Codex agent reports the windows a test names.
func runnerWithUsage(t *testing.T, dto agentapi.AgentUsageDto, err error) *playback.ChainRunner {
	t.Helper()
	convs, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, convs)
	hub.Agents.Set(agentapi.AgentCodex, &usageAgent{dto: dto, err: err})
	runner := playback.NewChainRunner(cfg, hub, convs, nil, nil, nil)
	runner.RetryWait = time.Hour
	runner.RefreshLeeway = 0
	return runner
}

func TestRefreshAtAsksTheAccountWhenTheNoticeNamesNoMoment(t *testing.T) {
	// The five-hour window is spent; the weekly window still has capacity.
	soon := time.Now().Add(90 * time.Minute).Truncate(time.Second)
	later := time.Now().Add(3 * 24 * time.Hour).Truncate(time.Second)
	runner := runnerWithUsage(t, agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 100, ResetAtEpochSeconds: soon.Unix()},
		{WindowMinutes: 10080, PercentUsed: 98, ResetAtEpochSeconds: later.Unix()},
	}}, nil)

	at := runner.RefreshAt(agentfaults.TurnFault{Limit: true, Retry: true}, agentapi.AgentCodex)
	if !at.Equal(soon) {
		t.Errorf("refreshAt = %s, want the account's own %s", at.Format(time.RFC3339), soon.Format(time.RFC3339))
	}
}

// What the notice says still wins: it is the CLI talking about the very window it just met, where
// the account is a second reading taken a moment later.
func TestRefreshAtPrefersTheMomentTheNoticeNamed(t *testing.T) {
	named := time.Now().Add(20 * time.Minute).Truncate(time.Second)
	runner := runnerWithUsage(t, agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 100, ResetAtEpochSeconds: time.Now().Add(time.Hour).Unix()},
	}}, nil)

	at := runner.RefreshAt(agentfaults.TurnFault{Limit: true, Retry: true, ResetAt: named}, agentapi.AgentCodex)
	if !at.Equal(named) {
		t.Errorf("refreshAt = %s, want the notice's own %s", at.Format(time.RFC3339), named.Format(time.RFC3339))
	}
}

// A window nobody has filled is not the window the turn met — a spend cap and an organisation's
// ceiling refuse turns without moving any of these bars — and waiting on it would be a run asleep
// for a week over something a wait does not fix. Same for an account that could not be asked.
func TestRefreshAtFallsBackWhereTheAccountExplainsNothing(t *testing.T) {
	half := agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 40, ResetAtEpochSeconds: time.Now().Add(time.Minute).Unix()},
	}}
	for name, runner := range map[string]*playback.ChainRunner{
		"no window is full":     runnerWithUsage(t, half, nil),
		"the account is unread": runnerWithUsage(t, agentapi.AgentUsageDto{}, errors.New("signed out")),
		"the agent has none":    runnerWithUsage(t, agentapi.AgentUsageDto{}, nil),
	} {
		agent := agentapi.AgentCodex
		if name == "the agent has none" {
			// Claude is left as the real agent here, which would spawn a CLI; a name nothing offers
			// is the case being tested and reaches no agent at all.
			agent = "an-agent-this-build-never-had"
		}
		at := runner.RefreshAt(agentfaults.TurnFault{Limit: true, Retry: true}, agent)
		if wait := time.Until(at); wait < 55*time.Minute {
			t.Errorf("%s: refreshAt is in %s, want the blind wait the runner falls back on", name, wait)
		}
	}
}
