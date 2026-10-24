package runnerhttp

import (
	"encoding/json"
	"fmt"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	opencodecli "kiao/worker/internal/hybridflow-runner/agents/opencode"
	"kiao/worker/internal/hybridflow-runner/assembly"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	"strings"
	"testing"
	"time"
)

func TestLimitResetProviderFormats(t *testing.T) {
	now := time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	want := time.Date(2026, 10, 23, 9, 59, 32, 0, time.UTC)
	for _, tc := range []struct {
		name, notice string
		want         time.Time
	}{
		{"Muse UTC", "Your usage window resets at 2026-10-23T09:59:32Z", want},
		{"Muse offset", "Your usage window resets at 2026-10-23T11:59:32+02:00", want},
		{"Muse fractional seconds", "Your usage window resets at 2026-10-23T09:59:32.123Z", want.Add(123 * time.Millisecond)},
		{"Claude seconds", fmt.Sprintf("Claude AI usage limit reached|%d", want.Unix()), want},
		{"Claude milliseconds", fmt.Sprintf("Claude AI usage limit reached|%d", want.UnixMilli()+123), want.Add(123 * time.Millisecond)},
		{"Claude zoned clock", "You've hit your session limit · resets 11:59:32 (Europe/Paris)", want},
		{"Codex dated reset", "You've hit your usage limit. Try again at Oct 23rd, 2026 11:59 AM.", time.Date(2026, 10, 23, 11, 59, 0, 0, time.Local)},
		{"OpenCode HTTP Retry-After", "429 Too many requests; Retry-After: Fri, 23 Oct 2026 09:59:32 GMT", want},
		{"Pi seconds", "429 rate limit; retry-after: 7172", want},
		{"relative hours and minutes", "429 rate limit; try again in 1 hour 59 minutes 32 seconds.", want},
		{"compact duration", "429 rate limit; try again in 1h59m32s.", want},
		{"milliseconds", "429 rate limit; retry-after: 1500ms", now.Add(1500 * time.Millisecond)},
		{"decimal minutes", "429 rate limit; try again in 1.5 minutes", now.Add(90 * time.Second)},
		{"monthly window", "Your usage window resets at 2026-11-22T08:00:00Z", now.AddDate(0, 0, 30)},
		{"already elapsed", "Your usage window resets at 2026-10-23T07:59:32Z", now.Add(-28 * time.Second)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			at, ok := agentfaults.LimitResetAt(tc.notice, now)
			if !ok || !at.Equal(tc.want) {
				t.Fatalf("limitResetAt(%q) = %s, %v; want %s", tc.notice, at.Format(time.RFC3339Nano), ok, tc.want.Format(time.RFC3339Nano))
			}
			canonical := agentfaults.AbsoluteLimitNotice(tc.notice, now)
			if !strings.Contains(canonical, tc.want.UTC().Format(time.RFC3339Nano)) {
				t.Fatalf("canonical notice = %q, want the absolute reset", canonical)
			}
			if at, ok := agentfaults.LimitResetAt(canonical, now.Add(time.Minute)); !ok || !at.Equal(tc.want) {
				t.Fatalf("persisted notice moved its reset: %q -> %s, %v", canonical, at, ok)
			}
			if twice := agentfaults.AbsoluteLimitNotice(canonical, now.Add(time.Minute)); twice != canonical {
				t.Fatalf("canonicalizing twice changed %q into %q", canonical, twice)
			}
		})
	}
}

func TestLimitResetRejectsIncompleteOrInvalidClocks(t *testing.T) {
	now := time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	for _, notice := range []string{
		"resets at 2026-10-23",
		"resets at 2026-10-23T09:59:32",
		"resets at 2026-10-23T25:59:32Z",
		"resets at 2026-13-23T09:59:32Z",
		"resets at 25:00", "resets at 13pm", "resets at 0am", "resets at 19:99",
		"resets at 19:10:99", "resets at 19:10 (Unknown/Zone)",
		"retry-after: 20 elephants", "retry-after: -20", "retry-after: 9999999999999999999999",
		"try again in 20 months", "try again in 999999999999999999999h",
		"resets at 2028-10-23T09:59:32Z",
	} {
		if at, ok := agentfaults.LimitResetAt(notice, now); ok {
			t.Errorf("limitResetAt(%q) invented %s", notice, at.Format(time.RFC3339))
		}
	}
}

func TestLimitClockAcrossDaylightSavingChange(t *testing.T) {
	now := time.Date(2026, 10, 24, 23, 30, 0, 0, time.UTC)
	at, ok := agentfaults.LimitResetAt("resets Sun 3am (Europe/Paris)", now)
	want := time.Date(2026, 10, 25, 2, 0, 0, 0, time.UTC)
	if !ok || !at.Equal(want) {
		t.Fatalf("reset = %s, %v; want %s", at, ok, want)
	}
}

func TestEveryPlatformRecognizesAResetOnTheFailureChannel(t *testing.T) {
	reset := time.Now().Add(time.Hour).Truncate(time.Second)
	for _, platform := range []string{agentapi.AgentClaude, agentapi.AgentCodex, agentapi.AgentMuse, agentapi.AgentOpenCode, agentapi.AgentPi} {
		t.Run(platform, func(t *testing.T) {
			notice := "Your usage window resets at " + reset.UTC().Format(time.RFC3339)
			fault := agentfaults.ReplyFault(agentfaults.TurnReply{Text: "Work already started.", Failure: notice}, platform)
			if fault == nil || !fault.Limit || !fault.Retry || !fault.ResetAt.Equal(reset) {
				t.Fatalf("fault = %+v; want an interrupted turn held until %s", fault, reset)
			}
		})
	}
}

func TestRefreshAtWaitsForEveryExhaustedWindow(t *testing.T) {
	soon := time.Now().Add(time.Hour).Truncate(time.Second)
	later := time.Now().Add(3 * 24 * time.Hour).Truncate(time.Second)
	for _, platform := range []string{agentapi.AgentClaude, agentapi.AgentCodex, agentapi.AgentMuse} {
		t.Run(platform, func(t *testing.T) {
			runner := runnerWithUsage(t, agentapi.AgentUsageDto{}, nil)
			runner.Hub.AgentRegistry().Set(platform, &usageAgent{dto: agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{
				{WindowMinutes: 300, PercentUsed: 100, ResetAtEpochSeconds: soon.Unix()},
				{WindowMinutes: 10080, PercentUsed: 100, ResetAtEpochSeconds: later.Unix()},
			}}})
			runner.RefreshLeeway = time.Minute
			if at := runner.RefreshAt(agentfaults.TurnFault{Limit: true}, platform); !at.Equal(later.Add(time.Minute)) {
				t.Fatalf("refreshAt = %s, want every window open plus the leeway", at)
			}
		})
	}
}

func TestQuotaResetIgnoresExpiredAndMissingResets(t *testing.T) {
	now := time.Now()
	future := now.Add(30 * 24 * time.Hour).Truncate(time.Second)
	runner := runnerWithUsage(t, agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 100, ResetAtEpochSeconds: now.Add(-time.Hour).Unix()},
		{WindowMinutes: 10080, PercentUsed: 100},
		{WindowMinutes: 43200, PercentUsed: 100, ResetAtEpochSeconds: future.Unix()},
	}}, nil)
	if at, ok := runner.QuotaResetAt(agentapi.AgentCodex); !ok || !at.Equal(future) {
		t.Fatalf("quotaResetAt = %s, %v; want the valid monthly reset %s", at, ok, future)
	}
	runner.Hub.AgentRegistry().Set(agentapi.AgentMuse, &usageAgent{dto: agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{
		{PercentUsed: 100, ResetAtEpochSeconds: now.Add(-time.Hour).Unix()},
	}}})
	if at := runner.RefreshAt(agentfaults.TurnFault{Limit: true}, agentapi.AgentMuse); at.Before(now.Add(runner.RetryWait)) {
		t.Fatalf("stale cached quota caused an immediate retry: %s", at)
	}
}

func TestRefreshAtKeepsLeewayAfterAnElapsedReset(t *testing.T) {
	runner := runnerWithUsage(t, agentapi.AgentUsageDto{}, nil)
	runner.RefreshLeeway = time.Minute
	now := time.Now()
	at := runner.RefreshAt(agentfaults.TurnFault{Limit: true, ResetAt: now.Add(-time.Hour)}, agentapi.AgentMuse)
	if at.Before(now.Add(time.Minute)) || at.After(time.Now().Add(time.Minute)) {
		t.Fatalf("refreshAt = %s; want the leeway after now", at)
	}
}

func TestOpenCodePreservesTheProvidersRetryAfter(t *testing.T) {
	now := time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		headers string
		delay   time.Duration
	}{
		{`{"retry-after":"1800"}`, 30 * time.Minute},
		{`{"Retry-After":"Fri, 23 Oct 2026 09:59:32 GMT"}`, time.Hour + 59*time.Minute + 32*time.Second},
		{`{"retry-after-ms":"1500","retry-after":"60"}`, 1500 * time.Millisecond},
	} {
		var failure map[string]any
		if err := json.Unmarshal([]byte(`{"name":"APIError","data":{"message":"Request rejected","statusCode":429,"responseHeaders":`+tc.headers+`}}`), &failure); err != nil {
			t.Fatal(err)
		}
		event := opencodecli.OpencodeFailure(failure)
		fault := agentfaults.FailureFault(event.Message, "OpenCode")
		if event.Kind != agentapi.EventFailure || fault == nil || !fault.Limit {
			t.Fatalf("provider refusal lost its status: %+v", event)
		}
		at, ok := agentfaults.LimitResetAt(event.Message, now)
		if !ok || !at.Equal(now.Add(tc.delay)) {
			t.Fatalf("provider reset lost: %q -> %s, %v", event.Message, at, ok)
		}
	}
}

func TestHubRecordsProviderResetAsAnAbsoluteInstant(t *testing.T) {
	convs, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, convs)
	job := &pkgTurns.Turn{AgentName: agentapi.AgentClaude}
	at := time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	hub.ApplyBlock(job, agentapi.AgentEvent{Block: agentapi.TurnBlock{
		Kind: agentapi.BlockKindText, Text: "You've hit your session limit · resets 11:59:32 (Europe/Paris)", At: at,
	}})
	const expected = "You've hit your session limit · resets at 2026-10-23T09:59:32Z"
	if job.Blocks[0].Text != expected {
		t.Fatalf("recorded block = %q, want %q", job.Blocks[0].Text, expected)
	}
	prose := "The fixture says `resets 11:59:32 (Europe/Paris)` in its example."
	hub.ApplyBlock(job, agentapi.AgentEvent{Block: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: prose, At: at}})
	if job.Blocks[1].Text != prose {
		t.Fatalf("model prose was rewritten: %q", job.Blocks[1].Text)
	}
	hub.Apply(job, agentapi.AgentEvent{Kind: agentapi.EventFailure, Message: "429 Too many requests; retry-after: 1800"})
	if !strings.Contains(job.FailureNotice, "try again at ") || strings.Contains(job.FailureNotice, "retry-after") {
		t.Fatalf("failure kept a moving relative reset: %q", job.FailureNotice)
	}
}

func TestHistoricalResetNoticesUseTheirRecordingDate(t *testing.T) {
	const notice = "You've hit your session limit · resets 11:59:32 (Europe/Paris)"
	const expected = "You've hit your session limit · resets at 2026-01-23T10:59:32Z"
	legacy := pkgConversations.ConversationRecord{Role: pkgConversations.RoleAssistant, At: "2026-01-23T08:00:00Z", Text: notice}
	if dto := pkgConversations.MessageDto(legacy); dto.Text != expected {
		t.Fatalf("legacy notice = %q, want its original reset %q", dto.Text, expected)
	}
	ordered := pkgConversations.ConversationRecord{
		Role: pkgConversations.RoleAssistant, At: legacy.At, EndReason: "429; retry-after: 1800",
		Blocks: []pkgConversations.ConversationBlock{{Kind: "text", Text: notice}},
	}
	dto := pkgConversations.MessageDto(ordered)
	if dto.Blocks[0].Text != expected || dto.EndReason != "429; try again at 2026-01-23T08:30:00Z" {
		t.Fatalf("historical reply = %+v", dto)
	}
	if ordered.Blocks[0].Text != notice {
		t.Fatal("display conversion changed the stored transcript")
	}
	legacy.Role = pkgConversations.RoleUser
	if dto := pkgConversations.MessageDto(legacy); dto.Text != notice {
		t.Fatalf("user prompt was rewritten: %q", dto.Text)
	}
	legacy.Role, legacy.At = pkgConversations.RoleAssistant, ""
	if dto := pkgConversations.MessageDto(legacy); dto.Text != notice {
		t.Fatalf("invented a recording date: %q", dto.Text)
	}
}
