package faults

import (
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"regexp"
	"strings"
	"time"
)

// The CLIs can exit zero on API failure: Claude writes a notice in the reply;
// Codex emits error/turn.failed events, sometimes without a reply.
type TurnReply struct {
	Text string
	Tail string
	// Last agentFailure event; not persisted in the transcript.
	Failure string
	// Nil when the transcript has no process exit code.
	ExitCode *int
}

func (reply TurnReply) crashed() bool { return reply.ExitCode != nil && *reply.ExitCode != 0 }

type TurnFault struct {
	Summary string
	// Whether waiting before retrying the same prompt can help.
	Retry bool
	// Usage limits wait for reset and resume the interrupted turn; see chainRunResumePrompt.
	Limit bool
	// Zero when the notice supplies no reset time; the run falls back to its own clock.
	ResetAt time.Time
}

const agentPlaceholder = "{agent}"

func namingAgent(summary, agent string) string {
	return strings.ReplaceAll(summary, agentPlaceholder, agent)
}

var faultMarkers = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^API Error\b`),
	regexp.MustCompile(`(?i)^Claude( AI)? usage limit reached\b`),
	regexp.MustCompile(`(?i)^You(’|')(ve hit your|re out of usage credits)\b`),
	regexp.MustCompile(`(?i)^Your (org is out of usage|seat type doesn|usage allocation has been|usage window resets|group(’|')s usage limit)\b`),
}

// Bound notice recognition to avoid classifying answers that discuss API errors.
const faultNoticeMaxChars = 600

type faultKind struct {
	match *regexp.Regexp
	TurnFault
}

// Match permanent faults first: authentication errors can mention a "temporary network issue".
var faultKinds = []faultKind{
	// /login must sit outside the leading word boundary: space and slash are both non-word.
	{regexp.MustCompile(`(?i)(?:\b(?:401|403|unauthorized|invalid api key|authenticat\w*|oauth|credentials)|/login)\b`),
		TurnFault{Summary: agentPlaceholder + " is not signed in", Retry: false}},
	// Credit and spend caps precede usage limits: waiting cannot replenish them.
	{regexp.MustCompile(`(?i)\b(credit balance|usage credits?|spend limit|credits.?depleted)\b`),
		TurnFault{Summary: "the account is out of credit", Retry: false}},
	{regexp.MustCompile(`(?i)\b(429|rate.?limit\w*|usage.?limit\w*|quota.?exceeded|limiting requests|` +
		`too many requests|resource_exhausted|usage window resets|` +
		`(session|weekly|monthly|opus|sonnet|fable \d+) limit)\b`),
		TurnFault{Summary: agentPlaceholder + "’s usage limit was reached", Retry: true, Limit: true}},
	{regexp.MustCompile(`(?i)\b(5\d\d|overloaded|at capacity|server-side issue|server error)\b`),
		TurnFault{Summary: agentPlaceholder + " is overloaded", Retry: true}},
	{regexp.MustCompile(`(?i)\b(dis)?connect\w*\b|\b(timed out|timeout|network|unreachable)\b`),
		TurnFault{Summary: "the connection to " + agentPlaceholder + " was lost", Retry: true}},
	{regexp.MustCompile(`(?i)\b(too long|too large|exceeds|token limit|context window)\b`),
		TurnFault{Summary: "the prompt was too long for the model", Retry: false}},
	{regexp.MustCompile(`(?i)\b(model|not available|does not exist)\b`),
		TurnFault{Summary: "the model the flow node names cannot be run", Retry: false}},
}

// Unknown errors provide no basis for retrying.
var unknownFault = TurnFault{Summary: agentPlaceholder + " answered with an error", Retry: false}

// Only capacity and busy-conversation refusals are transient; no turn has run yet.
var refusalsWorthWaiting = map[string]string{
	turnevents.ErrCodeTooManyTurns:     "the service is running as many turns as it allows",
	turnevents.ErrCodeConversationBusy: "the conversation is already working on a message",
}

var silentFault = TurnFault{Summary: "the turn ended without saying anything", Retry: false}

// Require a CLI marker and a short, whole block to distinguish notices from answer prose.
func NoticeFault(text, agent string) *TurnFault {
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
func FailureFault(message, agent string) *TurnFault {
	notice := strings.TrimSpace(message)
	if notice == "" || len([]rune(notice)) > faultNoticeMaxChars {
		return nil
	}
	return classifyFault(notice, agent)
}

func classifyFault(notice, agent string) *TurnFault {
	for _, kind := range faultKinds {
		if kind.match.MatchString(notice) {
			fault := kind.TurnFault
			fault.Summary = namingAgent(fault.Summary, agent)
			if fault.Limit {
				// Parse before discarding the notice; without a reset time, refreshAt queries the account.
				if at, said := LimitResetAt(notice, time.Now()); said {
					fault.ResetAt = at
				}
			}
			return &fault
		}
	}
	fault := unknownFault
	fault.Summary = namingAgent(fault.Summary, agent)
	return &fault
}

// A trailing notice means unfinished work even after earlier answer blocks.
// Leave the flow node in place rather than filing the partial reply as completed.
func ReplyFault(reply TurnReply, agent string) *TurnFault {
	// Reconnection progress also arrives as agentFailure. Trust it only for an empty reply
	// or a usage limit, which must override partial work.
	if fault := FailureFault(reply.Failure, agent); fault != nil {
		if fault.Limit || strings.TrimSpace(reply.Text) == "" {
			return fault
		}
	}
	if fault := NoticeFault(reply.Tail, agent); fault != nil {
		return fault
	}
	// Also support transcripts predating separate blocks.
	if fault := NoticeFault(reply.Text, agent); fault != nil {
		return fault
	}
	if strings.TrimSpace(reply.Text) == "" && reply.crashed() {
		fault := silentFault
		fault.Summary = namingAgent(fault.Summary, agent)
		return &fault
	}
	return nil
}

// Nil leaves non-transient refusals for the caller to report in the service's own words.
func RefusalFault(code string) *TurnFault {
	summary, worth := refusalsWorthWaiting[code]
	if !worth {
		return nil
	}
	return &TurnFault{Summary: summary, Retry: true}
}
