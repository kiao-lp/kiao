package conversations

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
)

type ConversationSubagent struct {
	SubagentID     string              `json:"subagentId,omitempty"`
	ChildSessionID string              `json:"childSessionId,omitempty"`
	Role           string              `json:"role,omitempty"`
	Objective      string              `json:"objective,omitempty"`
	Status         string              `json:"status,omitempty"`
	Result         string              `json:"result,omitempty"`
	DurationMs     int64               `json:"durationMs,omitempty"`
	Truncated      bool                `json:"truncated,omitempty"`
	Blocks         []ConversationBlock `json:"blocks,omitempty"`
}

func SubagentToRecord(sub *agentapi.TurnSubagent) *ConversationSubagent {
	if sub == nil {
		return nil
	}
	out := &ConversationSubagent{
		SubagentID: sub.SubagentID, ChildSessionID: sub.ChildSessionID,
		Role: sub.Role, Objective: sub.Objective,
		Status: sub.Status, Result: sub.Result,
		DurationMs: sub.DurationMs, Truncated: sub.Truncated,
	}
	for _, block := range sub.Blocks {
		out.Blocks = append(out.Blocks, BlockToRecord(block))
	}
	return out
}

func BlockToRecord(block agentapi.TurnBlock) ConversationBlock {
	at := ""
	if !block.At.IsZero() {
		at = block.At.UTC().Format(protocol.ConversationTimeFormat)
	}
	return ConversationBlock{
		Kind: block.Kind, Text: block.Text,
		Name: block.Name, Input: block.Input, Detail: block.Detail,
		ToolUseID: block.ToolUseID, Result: block.Result,
		IsError: block.IsError, ExitCode: block.ExitCode,
		At: at, DurationMs: block.DurationMs,
		Subagent: SubagentToRecord(block.Subagent),
	}
}
