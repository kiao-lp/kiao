package muse

import (
	"encoding/json"
	"fmt"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/agents/protocol"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	"strings"
	"time"
)

// museSubagentReadTimeout bounds one child transcript read. Past it the delegation files
// metadata-only — the relay has a turn to follow, and a child that cannot be read back is
// not the turn going wrong.
const museSubagentReadTimeout = 30 * time.Second

// museSubagentReader is the SubagentReader for Muse turns: the turn's own host, asked for its
// children's transcripts. One per turn, so the fetch budget is the turn's: every delegation of
// the turn, however deep, draws on the same fifty reads.
type museSubagentReader struct {
	conn    *MspConn
	trace   *turntrace.TurnTrace
	timeout time.Duration
	Fetches int
}

var _ agentapi.SubagentReader = (*museSubagentReader)(nil)

// newMuseSubagentReader reads children's transcripts over conn. A non-positive timeout is the
// default wait; the budget is always a whole turn's.
func NewMuseSubagentReader(conn *MspConn, trace *turntrace.TurnTrace, timeout time.Duration) *museSubagentReader {
	if timeout <= 0 {
		timeout = museSubagentReadTimeout
	}
	return &museSubagentReader{conn: conn, trace: trace, timeout: timeout, Fetches: agentapi.MaxSubagentFetches}
}

// ReadSubagent reads one delegation's transcript back: the child's items as blocks, in the order
// the child produced them, with its own delegations read beneath it to the depth cap.
func (r *museSubagentReader) ReadSubagent(ref agentapi.SubagentRef) (*agentapi.TurnSubagent, error) {
	return r.read(ref, 1)
}

// read is one delegation at one depth. The depth counts delegations, not calls: the child is 1,
// its children 2, and past maxSubagentDepth a delegation files metadata-only.
func (r *museSubagentReader) read(ref agentapi.SubagentRef, depth int) (*agentapi.TurnSubagent, error) {
	sub := &agentapi.TurnSubagent{
		SubagentID: ref.SubagentID, ChildSessionID: ref.ChildSessionID,
		Role: ref.Role, Objective: ref.Objective,
		Status: ref.Status, Result: ref.Summary,
		DurationMs: ref.DurationMs,
	}
	if strings.TrimSpace(ref.ChildSessionID) == "" {
		sub.Truncated = true
		return sub, nil
	}
	if depth > agentapi.MaxSubagentDepth || r.Fetches <= 0 {
		sub.Truncated = true
		return sub, nil
	}
	if r.conn == nil {
		return nil, fmt.Errorf("no host to read the subagent back through")
	}
	r.Fetches--
	raw, err := r.conn.callTimeout("session/read", map[string]any{
		"sessionId": strings.TrimSpace(ref.ChildSessionID),
		// The history is the whole point of the call: metadata-only is the default, and
		// asking for it explicitly is what serves the folded item array.
		"excludeItems": false,
	}, r.timeout)
	if err != nil {
		return nil, err
	}
	items, err := MuseChildItems(raw)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if pkgProtocol.AsString(item["kind"]) == "subagent" {
			sub.Blocks = append(sub.Blocks, r.readNested(item, depth))
			continue
		}
		if block, ok := MuseBlock(item); ok {
			sub.Blocks = append(sub.Blocks, block)
		}
	}
	if capped, cut := agentapi.CapSubagentBlocks(sub.Blocks); cut {
		sub.Blocks, sub.Truncated = capped, true
	}
	r.trace.Note("muse subagent " + pkgProtocol.OrDefault(ref.SubagentID, ref.ChildSessionID) +
		fmt.Sprintf(" read back: %d blocks", len(sub.Blocks)))
	return sub, nil
}

// readNested reads one delegation the child itself made: whole while the depth and the budget
// last, metadata-only past them — and metadata-only too when the read fails, because one
// unreadable grandchild is not worth losing the child's whole transcript over.
func (r *museSubagentReader) readNested(item map[string]any, depth int) agentapi.TurnBlock {
	ref := MuseSubagentRef(item)
	text := MuseSubagentSummary(item)
	nested, err := r.read(ref, depth+1)
	if err != nil {
		r.trace.Note("muse subagent " + pkgProtocol.OrDefault(ref.SubagentID, ref.ChildSessionID) +
			" could not be read back: " + museSentence(err))
		nested = agentapi.MetadataSubagent(ref)
	}
	return agentapi.TurnBlock{Kind: agentapi.BlockKindSubagent, Text: text, Subagent: nested}
}

// museChildItems is a `session/read` answer's folded item array: the child's transcript whole.
// Anything else — metadata-only, unloaded, unreadable — is an error rather than an empty
// transcript, so the caller files the summary line instead of a delegation claiming a child
// that did nothing.
func MuseChildItems(raw json.RawMessage) ([]map[string]any, error) {
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
func MuseSubagentRef(item map[string]any) agentapi.SubagentRef {
	ref := agentapi.SubagentRef{
		SubagentID:     pkgProtocol.AsString(item["subagentId"]),
		ChildSessionID: pkgProtocol.AsString(item["childSessionId"]),
		Role:           pkgProtocol.CutRunes(pkgProtocol.AsString(item["role"]), agentapi.MaxSubagentNameChars),
		Objective:      pkgProtocol.CutRunes(pkgProtocol.AsString(item["objective"]), agentapi.MaxSubagentObjectiveChars),
		Status:         pkgProtocol.CutRunes(MuseSubagentStatus(item), agentapi.MaxSubagentNameChars),
		Summary:        pkgProtocol.CutRunes(museResultSummary(item), agentapi.MaxSubagentResultChars),
	}
	if measured, ok := pkgProtocol.AsInt64(item["durationMs"]); ok && measured > 0 {
		ref.DurationMs = measured
	}
	return ref
}

// museSubagentStatus is where a delegation stands in the host's own word: the generic item
// status first, the control status where that says nothing.
func MuseSubagentStatus(item map[string]any) string {
	return pkgProtocol.OrDefault(pkgProtocol.AsString(item["status"]), pkgProtocol.AsString(item["controlStatus"]))
}

// museResultSummary is the summary the delegation came back with: the result envelope's bounded
// summary, which is what that field is for.
func museResultSummary(item map[string]any) string {
	result, _ := item["result"].(map[string]any)
	return pkgProtocol.AsString(result["summary"])
}

// museSubagentSummary is the parent's one-line account of the delegation: the line the host
// summarised it with, which is what the delegation read as before its transcript was filed
// beneath it — and what it still reads as where that transcript could not be read.
func MuseSubagentSummary(item map[string]any) string {
	return pkgProtocol.OrDefault(pkgProtocol.AsString(item["fallbackText"]),
		pkgProtocol.OrDefault(pkgProtocol.AsString(item["text"]), pkgProtocol.AsString(item["summary"])))
}
