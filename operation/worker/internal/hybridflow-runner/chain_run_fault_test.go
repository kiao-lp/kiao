package hybridflowrunner

import (
	"errors"
	"testing"
	"time"
)

// Reading a reply as one of the CLI's error notices rather than as an answer. What is at stake is a
// flowNode marked done by the one sentence saying it was not — and, the other way round, an answer
// *about* API errors read as one.

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
		fault := replyFault(oneBlockReply(c.reply), "Claude")
		if fault == nil {
			t.Errorf("replyFault(%q) = nil, want %q", c.reply, c.summary)
			continue
		}
		if fault.summary != c.summary || fault.retry != c.retry {
			t.Errorf("replyFault(%q) = %+v, want %q retry=%v", c.reply, *fault, c.summary, c.retry)
		}
	}
}

// oneBlockReply is a turn that said one thing and exited cleanly — the shape of a turn that failed
// before it did anything, which is the reply the notices above arrive as on their own.
func oneBlockReply(text string) turnReply {
	zero := 0
	return turnReply{text: text, tail: text, exitCode: &zero}
}

// A turn blocked twice is not an error a wait fixes: its driver already waited out two idle
// waits and resumed it once, so the runner forks the conversation rather than waiting and
// sending the flow node again.
func TestReplyFaultLeavesABlockedTwiceTurnToTheFork(t *testing.T) {
	fault := replyFault(turnReply{failure: museBlockedTwiceMessage}, "Muse")
	if fault == nil {
		t.Fatalf("replyFault(blocked twice) = nil, want the unknown error rather than an answer")
	}
	if fault.retry {
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
		if fault := replyFault(oneBlockReply(answer), "Claude"); fault != nil {
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
		reply := turnReply{text: work + c.notice, tail: c.notice}
		fault := replyFault(reply, "Claude")
		if fault == nil {
			t.Errorf("replyFault(…%q) = nil, want %q — an hour of work does not make a limit an answer",
				c.notice, c.summary)
			continue
		}
		if fault.summary != c.summary || fault.retry != c.retry {
			t.Errorf("replyFault(…%q) = %+v, want %q retry=%v", c.notice, *fault, c.summary, c.retry)
		}
	}
}

// A notice is a whole block. An answer whose last block merely ends on one is an answer.
func TestReplyFaultLeavesAnAnswerThatMentionsALimitAlone(t *testing.T) {
	tail := "Done — the run now stops when the reply ends with “You've hit your session limit”."
	reply := turnReply{text: "Looking at the classifier." + tail, tail: tail}
	if fault := replyFault(reply, "Claude"); fault != nil {
		t.Errorf("replyFault = %+v, want an answer about limits read as an answer", *fault)
	}
}

// A turn that said nothing at all and whose process ended badly did not do the flow node either.
// The answer is not there to be read, so the exit code is all there is — and a turn that says
// nothing and exits cleanly is left alone, a quiet turn being a turn.
func TestReplyFaultReadsATurnThatSaidNothing(t *testing.T) {
	one, zero := 1, 0
	fault := replyFault(turnReply{exitCode: &one}, "Claude")
	if fault == nil || fault.retry {
		t.Errorf("replyFault(crashed) = %v, want a fault nothing but the user clears", fault)
	}
	if fault := replyFault(turnReply{exitCode: &zero}, "Claude"); fault != nil {
		t.Errorf("replyFault(quiet) = %+v, want a turn that simply said little left alone", *fault)
	}
	if fault := replyFault(turnReply{}, "Claude"); fault != nil {
		t.Errorf("replyFault(no exit code) = %+v, want nothing invented about a record that does not say",
			*fault)
	}
}

// ── the other channel ─────────────────────────────────────────────────────────
//
// `codex exec` writes its errors on its stream and its reply nowhere, then exits zero. Read as text
// alone, such a turn is an empty answer and a flow node marked done — which is the
// whole of what "the refresh wait does not work for Codex" came to.

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
		reply := turnReply{failure: c.failure, exitCode: &zero}
		fault := replyFault(reply, "Codex")
		if fault == nil {
			t.Errorf("replyFault(failure=%q) = nil, want %q", c.failure, c.summary)
			continue
		}
		if fault.summary != c.summary || fault.retry != c.retry || fault.limit != c.limit {
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
	reply := turnReply{failure: "not logged in: run /login to add an API key", exitCode: &zero}
	fault := replyFault(reply, "Muse")
	if fault == nil {
		t.Fatal("replyFault = nil, want the sign-in read as a sign-in")
	}
	if fault.summary != "Muse is not signed in" || fault.retry || fault.limit {
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
		reply := turnReply{text: answer, tail: answer, failure: notice, exitCode: &zero}
		if fault := replyFault(reply, "Codex"); fault != nil {
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
	reply := turnReply{
		text: work, tail: work, exitCode: &zero,
		failure: `{"type":"error","status":429,"error":{"type":"usage_limit_reached"}}`,
	}
	fault := replyFault(reply, "Codex")
	if fault == nil || !fault.limit || !fault.retry {
		t.Fatalf("replyFault = %v, want a limit held rather than an hour of work filed as the flow node", fault)
	}
}

// The summary names the engine the turn ran on. "Claude is overloaded" under a Codex card is a
// sentence about a service the flow node never touched.
func TestFaultSummariesNameTheAgentThatRanTheTurn(t *testing.T) {
	notice := "API Error: 529 Overloaded. This is a server-side issue, usually temporary."
	for agent, want := range map[string]string{"Claude": "Claude is overloaded", "Codex": "Codex is overloaded"} {
		fault := replyFault(oneBlockReply(notice), agent)
		if fault == nil || fault.summary != want {
			t.Errorf("replyFault(%s) = %v, want %q", agent, fault, want)
		}
	}
}

// The refusals a run waits out: no turn ran, and the reason it did not is one that passes.
// Everything else is somebody's to fix, and twenty minutes changes none of it.
func TestRefusalFaultOnlyWaitsForWhatPasses(t *testing.T) {
	for _, code := range []string{errCodeTooManyTurns, errCodeConversationBusy} {
		fault := refusalFault(code)
		if fault == nil || !fault.retry {
			t.Errorf("refusalFault(%q) = %v, want a fault worth waiting out", code, fault)
		}
	}
	for _, code := range []string{errCodeBadFolder, errCodeBypassDisabled, errCodeUnknownConversation,
		errCodeSpawnFailed, errCodeBadAttachment} {
		if fault := refusalFault(code); fault != nil {
			t.Errorf("refusalFault(%q) = %+v, want it left to the caller to report", code, *fault)
		}
	}
}

// ── when a limit lifts ────────────────────────────────────────────────────────
//
// A usage limit is the one notice that says when it stops being true, and the whole of what the run
// does with it is read out of these words: how long it holds the flow node, and — since it holds it
// rather than sending it again — that it is a limit at all.

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
		at, ok := limitResetAt(c.notice, now)
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
	at, ok := limitResetAt("You’ve hit your session limit · resets 7:10pm (Europe/Paris)", now)
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
		if at, ok := limitResetAt(notice, now); ok {
			t.Errorf("limitResetAt(%q) = %s, want nothing read out of it", notice, at.Format(time.RFC3339))
		}
	}
}

// A limit is told from the other errors that pass, because the run answers it differently: it waits
// on the notice's clock rather than on its own, and what it sends afterwards picks the cut-off turn
// back up instead of asking for the flow node again.
func TestReplyFaultTellsALimitFromTheOtherErrorsThatPass(t *testing.T) {
	fault := replyFault(oneBlockReply("Claude AI usage limit reached|1750000000"), "Claude")
	if fault == nil || !fault.limit {
		t.Fatalf("replyFault = %v, want a limit read as a limit", fault)
	}
	if !fault.resetAt.Equal(time.Unix(1750000000, 0)) {
		t.Errorf("resetAt = %s, want the moment the notice named", fault.resetAt.Format(time.RFC3339))
	}
	for _, notice := range []string{
		"API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.",
		"API Error: Connection to the API was lost (ECONNRESET). This is usually temporary — try again.",
		"API Error: 401 Invalid API key · Please run /login",
		"You’re out of usage credits · resets 7:10pm",
	} {
		if fault := replyFault(oneBlockReply(notice), "Claude"); fault != nil && fault.limit {
			t.Errorf("replyFault(%q) = %+v, want an error that is not a window closing", notice, *fault)
		}
	}
	// A refused turn never reached the API at all, so nothing about it is a limit.
	if fault := refusalFault(errCodeTooManyTurns); fault == nil || fault.limit {
		t.Errorf("refusalFault = %v, want a refusal waited out as a refusal", fault)
	}
}

// ── when the notice does not say ──────────────────────────────────────────────
//
// A limit that names no moment used to be waited out blind, on the twenty minutes every other error
// that passes gets — which against a five-hour window spends every try inside the first hour and
// gives up on a flow node nothing was ever wrong with. `codex exec` names no moment ever: it
// reports a 429 and stops. So the agent's own account is asked, which is the same quota the usage
// panel draws.

// usageAgent is an agent whose only side port is the quota, answering whatever a test wrote.
type usageAgent struct {
	stubAgent
	dto AgentUsageDto
	err error
}

func (a *usageAgent) Usage() (AgentUsageDto, error) { return a.dto, a.err }

// runnerWithUsage is a runner whose Codex agent reports the windows a test names.
func runnerWithUsage(t *testing.T, dto AgentUsageDto, err error) *ChainRunner {
	t.Helper()
	convs, cfg := newTurnRegistry(t)
	hub := newClaudeHub(cfg, convs)
	hub.agents.set(agentCodex, &usageAgent{dto: dto, err: err})
	runner := newChainRunner(cfg, hub, convs, nil, nil, nil)
	runner.retryWait = time.Hour
	runner.refreshLeeway = 0
	return runner
}

func TestRefreshAtAsksTheAccountWhenTheNoticeNamesNoMoment(t *testing.T) {
	// The five-hour window is spent and comes round first; the weekly is spent too but is days off.
	// The tighter one lifting is what lets the flow node be tried at all, so it is the one waited for.
	soon := time.Now().Add(90 * time.Minute).Truncate(time.Second)
	later := time.Now().Add(3 * 24 * time.Hour).Truncate(time.Second)
	runner := runnerWithUsage(t, AgentUsageDto{Windows: []agentWindow{
		{WindowMinutes: 300, PercentUsed: 100, ResetAtEpochSeconds: soon.Unix()},
		{WindowMinutes: 10080, PercentUsed: 98, ResetAtEpochSeconds: later.Unix()},
	}}, nil)

	at := runner.refreshAt(turnFault{limit: true, retry: true}, agentCodex)
	if !at.Equal(soon) {
		t.Errorf("refreshAt = %s, want the account's own %s", at.Format(time.RFC3339), soon.Format(time.RFC3339))
	}
}

// What the notice says still wins: it is the CLI talking about the very window it just met, where
// the account is a second reading taken a moment later.
func TestRefreshAtPrefersTheMomentTheNoticeNamed(t *testing.T) {
	named := time.Now().Add(20 * time.Minute).Truncate(time.Second)
	runner := runnerWithUsage(t, AgentUsageDto{Windows: []agentWindow{
		{WindowMinutes: 300, PercentUsed: 100, ResetAtEpochSeconds: time.Now().Add(time.Hour).Unix()},
	}}, nil)

	at := runner.refreshAt(turnFault{limit: true, retry: true, resetAt: named}, agentCodex)
	if !at.Equal(named) {
		t.Errorf("refreshAt = %s, want the notice's own %s", at.Format(time.RFC3339), named.Format(time.RFC3339))
	}
}

// A window nobody has filled is not the window the turn met — a spend cap and an organisation's
// ceiling refuse turns without moving any of these bars — and waiting on it would be a run asleep
// for a week over something a wait does not fix. Same for an account that could not be asked.
func TestRefreshAtFallsBackWhereTheAccountExplainsNothing(t *testing.T) {
	half := AgentUsageDto{Windows: []agentWindow{
		{WindowMinutes: 300, PercentUsed: 40, ResetAtEpochSeconds: time.Now().Add(time.Minute).Unix()},
	}}
	for name, runner := range map[string]*ChainRunner{
		"no window is full":     runnerWithUsage(t, half, nil),
		"the account is unread": runnerWithUsage(t, AgentUsageDto{}, errors.New("signed out")),
		"the agent has none":    runnerWithUsage(t, AgentUsageDto{}, nil),
	} {
		agent := agentCodex
		if name == "the agent has none" {
			// Claude is left as the real agent here, which would spawn a CLI; a name nothing offers
			// is the case being tested and reaches no agent at all.
			agent = "an-agent-this-build-never-had"
		}
		at := runner.refreshAt(turnFault{limit: true, retry: true}, agent)
		if wait := time.Until(at); wait < 55*time.Minute {
			t.Errorf("%s: refreshAt is in %s, want the blind wait the runner falls back on", name, wait)
		}
	}
}
