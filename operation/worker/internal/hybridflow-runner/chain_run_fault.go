package hybridflowrunner

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// The CLIs can exit zero on API failure: Claude writes a notice in the reply;
// Codex emits error/turn.failed events, sometimes without a reply.
type turnReply struct {
	text string
	tail string
	// Last agentFailure event; not persisted in the transcript.
	failure string
	// Nil when the transcript has no process exit code.
	exitCode *int
}

func (reply turnReply) crashed() bool { return reply.exitCode != nil && *reply.exitCode != 0 }

type turnFault struct {
	summary string
	// Whether waiting before retrying the same prompt can help.
	retry bool
	// Usage limits wait for reset and resume the interrupted turn; see chainRunResumePrompt.
	limit bool
	// Zero when the notice supplies no reset time; the run falls back to its own clock.
	resetAt time.Time
}

const agentPlaceholder = "{agent}"

func namingAgent(summary, agent string) string {
	return strings.ReplaceAll(summary, agentPlaceholder, agent)
}

var faultMarkers = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^API Error\b`),
	regexp.MustCompile(`(?i)^Claude( AI)? usage limit reached\b`),
	regexp.MustCompile(`(?i)^You(’|')(ve hit your|re out of usage credits)\b`),
	regexp.MustCompile(`(?i)^Your (org is out of usage|seat type doesn|usage allocation has been|group(’|')s usage limit)\b`),
}

// Bound notice recognition to avoid classifying answers that discuss API errors.
const faultNoticeMaxChars = 600

type faultKind struct {
	match *regexp.Regexp
	turnFault
}

// Match permanent faults first: authentication errors can mention a "temporary network issue".
var faultKinds = []faultKind{
	// /login must sit outside the leading word boundary: space and slash are both non-word.
	{regexp.MustCompile(`(?i)(?:\b(?:401|403|unauthorized|invalid api key|authenticat\w*|oauth|credentials)|/login)\b`),
		turnFault{summary: agentPlaceholder + " is not signed in", retry: false}},
	// Credit and spend caps precede usage limits: waiting cannot replenish them.
	{regexp.MustCompile(`(?i)\b(credit balance|usage credits?|spend limit|credits.?depleted)\b`),
		turnFault{summary: "the account is out of credit", retry: false}},
	{regexp.MustCompile(`(?i)\b(429|rate.?limit\w*|usage.?limit\w*|quota.?exceeded|limiting requests|` +
		`(session|weekly|monthly|opus|sonnet|fable \d+) limit)\b`),
		turnFault{summary: agentPlaceholder + "’s usage limit was reached", retry: true, limit: true}},
	{regexp.MustCompile(`(?i)\b(5\d\d|overloaded|at capacity|server-side issue|server error)\b`),
		turnFault{summary: agentPlaceholder + " is overloaded", retry: true}},
	{regexp.MustCompile(`(?i)\b(dis)?connect\w*\b|\b(timed out|timeout|network|unreachable)\b`),
		turnFault{summary: "the connection to " + agentPlaceholder + " was lost", retry: true}},
	{regexp.MustCompile(`(?i)\b(too long|too large|exceeds|token limit|context window)\b`),
		turnFault{summary: "the prompt was too long for the model", retry: false}},
	{regexp.MustCompile(`(?i)\b(model|not available|does not exist)\b`),
		turnFault{summary: "the model the flow node names cannot be run", retry: false}},
}

// Unknown errors provide no basis for retrying.
var unknownFault = turnFault{summary: agentPlaceholder + " answered with an error", retry: false}

// Only capacity and busy-conversation refusals are transient; no turn has run yet.
var refusalsWorthWaiting = map[string]string{
	errCodeTooManyTurns:     "the service is running as many turns as it allows",
	errCodeConversationBusy: "the conversation is already working on a message",
}

var silentFault = turnFault{summary: "the turn ended without saying anything", retry: false}

// Allow eight days for weekly resets; reject more distant, likely misread timestamps.
const refreshCeiling = 8 * 24 * time.Hour

var (
	// Accept epoch seconds or milliseconds after the pipe.
	limitEpochRe = regexp.MustCompile(`\|\s*(\d{9,14})\b`)
	// Wall clock with an optional weekday, e.g. "resets Mon 9am".
	limitClockRe = regexp.MustCompile(`(?i)\bresets?\s+(?:on\s+)?` +
		`(mon|tue|wed|thu|fri|sat|sun)?[a-z]*\.?,?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`)
	limitZoneRe = regexp.MustCompile(`\(([A-Za-z]+(?:/[A-Za-z0-9_+-]+)+)\)`)
	// retry-after / try again in; a bare number means seconds.
	limitDelayRe = regexp.MustCompile(`(?i)\b(?:retry[ _-]?after|try again in)\b[:\s]*(\d{1,6})\s*([a-z]*)`)
)

// limitResetAt returns false for absent or implausibly distant reset times.
func limitResetAt(notice string, now time.Time) (time.Time, bool) {
	at, ok := limitEpoch(notice)
	if !ok {
		at, ok = limitClock(notice, now)
	}
	if !ok {
		at, ok = limitDelay(notice, now)
	}
	if !ok || at.Sub(now) > refreshCeiling {
		return time.Time{}, false
	}
	return at, true
}

func limitEpoch(notice string) (time.Time, bool) {
	match := limitEpochRe.FindStringSubmatch(notice)
	if match == nil {
		return time.Time{}, false
	}
	value, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		return time.Time{}, false
	}
	// Seconds and milliseconds occupy distinct magnitude ranges for current dates.
	if value > 1e11 {
		return time.UnixMilli(value), true
	}
	return time.Unix(value, 0), true
}

// Use the next occurrence of the clock/weekday, in the named zone or time.Local.
// Fall back to local time if the host cannot resolve the zone.
func limitClock(notice string, now time.Time) (time.Time, bool) {
	match := limitClockRe.FindStringSubmatch(notice)
	if match == nil {
		return time.Time{}, false
	}
	hour, err := strconv.Atoi(match[2])
	if err != nil || hour > 23 {
		return time.Time{}, false
	}
	minute := 0
	if match[3] != "" {
		if minute, err = strconv.Atoi(match[3]); err != nil || minute > 59 {
			return time.Time{}, false
		}
	}
	switch strings.ToLower(match[4]) {
	case "pm":
		if hour < 12 {
			hour += 12
		}
	case "am":
		if hour == 12 {
			hour = 0
		}
	}
	zone := time.Local
	if name := limitZoneRe.FindStringSubmatch(notice); name != nil {
		if loaded, err := time.LoadLocation(name[1]); err == nil {
			zone = loaded
		}
	}
	here := now.In(zone)
	at := time.Date(here.Year(), here.Month(), here.Day(), hour, minute, 0, 0, zone)
	if !at.After(now) {
		at = at.AddDate(0, 0, 1)
	}
	if weekday, named := limitWeekdays[strings.ToLower(match[1])]; named {
		for at.Weekday() != weekday {
			at = at.AddDate(0, 0, 1)
		}
	}
	return at, true
}

var limitWeekdays = map[string]time.Weekday{
	"mon": time.Monday, "tue": time.Tuesday, "wed": time.Wednesday, "thu": time.Thursday,
	"fri": time.Friday, "sat": time.Saturday, "sun": time.Sunday,
}

func limitDelay(notice string, now time.Time) (time.Time, bool) {
	match := limitDelayRe.FindStringSubmatch(notice)
	if match == nil {
		return time.Time{}, false
	}
	value, err := strconv.Atoi(match[1])
	if err != nil {
		return time.Time{}, false
	}
	unit := time.Second
	switch {
	case strings.HasPrefix(strings.ToLower(match[2]), "m"):
		unit = time.Minute
	case strings.HasPrefix(strings.ToLower(match[2]), "h"):
		unit = time.Hour
	}
	return now.Add(time.Duration(value) * unit), true
}

// Require a CLI marker and a short, whole block to distinguish notices from answer prose.
func noticeFault(text, agent string) *turnFault {
	notice := strings.TrimSpace(text)
	if notice == "" || len([]rune(notice)) > faultNoticeMaxChars {
		return nil
	}
	marked := false
	for _, marker := range faultMarkers {
		if marker.MatchString(notice) {
			marked = true
			break
		}
	}
	if !marked {
		return nil
	}
	return classifyFault(notice, agent)
}

// Failure events need no reply marker. The length bound excludes malformed JSONL dumps.
func failureFault(message, agent string) *turnFault {
	notice := strings.TrimSpace(message)
	if notice == "" || len([]rune(notice)) > faultNoticeMaxChars {
		return nil
	}
	return classifyFault(notice, agent)
}

func classifyFault(notice, agent string) *turnFault {
	for _, kind := range faultKinds {
		if kind.match.MatchString(notice) {
			fault := kind.turnFault
			fault.summary = namingAgent(fault.summary, agent)
			if fault.limit {
				// Parse before discarding the notice; without a reset time, refreshAt queries the account.
				if at, said := limitResetAt(notice, time.Now()); said {
					fault.resetAt = at
				}
			}
			return &fault
		}
	}
	fault := unknownFault
	fault.summary = namingAgent(fault.summary, agent)
	return &fault
}

// A trailing notice means unfinished work even after earlier answer blocks.
// Leave the flow node in place rather than filing the partial reply as completed.
func replyFault(reply turnReply, agent string) *turnFault {
	// Reconnection progress also arrives as agentFailure. Trust it only for an empty reply
	// or a usage limit, which must override partial work.
	if fault := failureFault(reply.failure, agent); fault != nil {
		if fault.limit || strings.TrimSpace(reply.text) == "" {
			return fault
		}
	}
	if fault := noticeFault(reply.tail, agent); fault != nil {
		return fault
	}
	// Also support transcripts predating separate blocks.
	if fault := noticeFault(reply.text, agent); fault != nil {
		return fault
	}
	if strings.TrimSpace(reply.text) == "" && reply.crashed() {
		fault := silentFault
		fault.summary = namingAgent(fault.summary, agent)
		return &fault
	}
	return nil
}

// Nil leaves non-transient refusals for the caller to report in the service's own words.
func refusalFault(code string) *turnFault {
	summary, worth := refusalsWorthWaiting[code]
	if !worth {
		return nil
	}
	return &turnFault{summary: summary, retry: true}
}
