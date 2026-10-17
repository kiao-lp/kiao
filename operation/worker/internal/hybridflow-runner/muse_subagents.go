package hybridflowrunner

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Reading back what a Muse turn's subagents thought and did.
//
// A delegation on this agent is a `subagent` transcript item on the parent session, and the
// child's own transcript is a session in its own right: the item's `childSessionId` names it,
// and `session/read` reads it back — child transcript drill-down without a second protocol,
// which is what the schema documents it as. So the driver, on completing a delegation, reads the
// child back through the same host the turn runs on and files what it thought and did beneath
// the parent's summary line.
//
// The read happens while the turn runs, on the relay goroutine, for the reason every block is
// announced once and never revised: the delegation is emitted whole — metadata and transcript
// together — in the order the parent produced it. A read that fails, or a delegation that names
// no child at all, files the summary line alone, which is what every delegation was before this
// file existed. Nothing about a child is ever worth stalling the parent past the read's own
// timeout, and nothing is worth failing the turn for.

const (
	// museSubagentReadTimeout bounds one child transcript read. Past it the delegation files
	// metadata-only — the relay has a turn to follow, and a child that cannot be read back is
	// not the turn going wrong.
	museSubagentReadTimeout = 30 * time.Second
)

// museSubagentReader is the SubagentReader for Muse turns: the turn's own host, asked for its
// children's transcripts. One per turn, so the fetch budget is the turn's: every delegation of
// the turn, however deep, draws on the same fifty reads.
type museSubagentReader struct {
	conn    *mspConn
	trace   *turnTrace
	timeout time.Duration
	fetches int
}

var _ SubagentReader = (*museSubagentReader)(nil)

// newMuseSubagentReader reads children's transcripts over conn. A non-positive timeout is the
// default wait; the budget is always a whole turn's.
func newMuseSubagentReader(conn *mspConn, trace *turnTrace, timeout time.Duration) *museSubagentReader {
	if timeout <= 0 {
		timeout = museSubagentReadTimeout
	}
	return &museSubagentReader{conn: conn, trace: trace, timeout: timeout, fetches: maxSubagentFetches}
}

// ReadSubagent reads one delegation's transcript back: the child's items as blocks, in the order
// the child produced them, with its own delegations read beneath it to the depth cap.
func (r *museSubagentReader) ReadSubagent(ref SubagentRef) (*turnSubagent, error) {
	return r.read(ref, 1)
}

// read is one delegation at one depth. The depth counts delegations, not calls: the child is 1,
// its children 2, and past maxSubagentDepth a delegation files metadata-only.
func (r *museSubagentReader) read(ref SubagentRef, depth int) (*turnSubagent, error) {
	sub := &turnSubagent{
		SubagentID: ref.SubagentID, ChildSessionID: ref.ChildSessionID,
		Role: ref.Role, Objective: ref.Objective,
		Status: ref.Status, Result: ref.Summary,
		DurationMs: ref.DurationMs,
	}
	if strings.TrimSpace(ref.ChildSessionID) == "" {
		sub.Truncated = true
		return sub, nil
	}
	if depth > maxSubagentDepth || r.fetches <= 0 {
		sub.Truncated = true
		return sub, nil
	}
	if r.conn == nil {
		return nil, fmt.Errorf("no host to read the subagent back through")
	}
	r.fetches--
	raw, err := r.conn.callTimeout("session/read", map[string]any{
		"sessionId": strings.TrimSpace(ref.ChildSessionID),
		// The history is the whole point of the call: metadata-only is the default, and
		// asking for it explicitly is what serves the folded item array.
		"excludeItems": false,
	}, r.timeout)
	if err != nil {
		return nil, err
	}
	items, err := museChildItems(raw)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if asString(item["kind"]) == "subagent" {
			sub.Blocks = append(sub.Blocks, r.readNested(item, depth))
			continue
		}
		if block, ok := museBlock(item); ok {
			sub.Blocks = append(sub.Blocks, block)
		}
	}
	if capped, cut := capSubagentBlocks(sub.Blocks); cut {
		sub.Blocks, sub.Truncated = capped, true
	}
	r.trace.note("muse subagent " + orDefault(ref.SubagentID, ref.ChildSessionID) +
		fmt.Sprintf(" read back: %d blocks", len(sub.Blocks)))
	return sub, nil
}

// readNested reads one delegation the child itself made: whole while the depth and the budget
// last, metadata-only past them — and metadata-only too when the read fails, because one
// unreadable grandchild is not worth losing the child's whole transcript over.
func (r *museSubagentReader) readNested(item map[string]any, depth int) turnBlock {
	ref := museSubagentRef(item)
	text := museSubagentSummary(item)
	nested, err := r.read(ref, depth+1)
	if err != nil {
		r.trace.note("muse subagent " + orDefault(ref.SubagentID, ref.ChildSessionID) +
			" could not be read back: " + museSentence(err))
		nested = metadataSubagent(ref)
	}
	return turnBlock{kind: blockKindSubagent, text: text, subagent: nested}
}

// museChildItems is a `session/read` answer's folded item array: the child's transcript whole.
// Anything else — metadata-only, unloaded, unreadable — is an error rather than an empty
// transcript, so the caller files the summary line instead of a delegation claiming a child
// that did nothing.
func museChildItems(raw json.RawMessage) ([]map[string]any, error) {
	var answered struct {
		History struct {
			Items []map[string]any `json:"items"`
		} `json:"history"`
	}
	if err := json.Unmarshal(raw, &answered); err != nil {
		return nil, fmt.Errorf("the child session could not be understood: %w", err)
	}
	if answered.History.Items == nil {
		return nil, fmt.Errorf("the child session carried no transcript")
	}
	return answered.History.Items, nil
}

// museSubagentRef is one delegation item as the reader takes it: the durable id, the child's
// own session, what it was asked to be and to do, where it stands, and the summary it came
// back with.
func museSubagentRef(item map[string]any) SubagentRef {
	ref := SubagentRef{
		SubagentID:     asString(item["subagentId"]),
		ChildSessionID: asString(item["childSessionId"]),
		Role:           cutRunes(asString(item["role"]), maxSubagentNameChars),
		Objective:      cutRunes(asString(item["objective"]), maxSubagentObjectiveChars),
		Status:         cutRunes(museSubagentStatus(item), maxSubagentNameChars),
		Summary:        cutRunes(museResultSummary(item), maxSubagentResultChars),
	}
	if measured, ok := asInt64(item["durationMs"]); ok && measured > 0 {
		ref.DurationMs = measured
	}
	return ref
}

// museSubagentStatus is where a delegation stands in the host's own word: the generic item
// status first, the control status where that says nothing.
func museSubagentStatus(item map[string]any) string {
	return orDefault(asString(item["status"]), asString(item["controlStatus"]))
}

// museResultSummary is the summary the delegation came back with: the result envelope's bounded
// summary, which is what that field is for.
func museResultSummary(item map[string]any) string {
	result, _ := item["result"].(map[string]any)
	return asString(result["summary"])
}

// museSubagentSummary is the parent's one-line account of the delegation: the line the host
// summarised it with, which is what the delegation read as before its transcript was filed
// beneath it — and what it still reads as where that transcript could not be read.
func museSubagentSummary(item map[string]any) string {
	return orDefault(asString(item["fallbackText"]),
		orDefault(asString(item["text"]), asString(item["summary"])))
}
