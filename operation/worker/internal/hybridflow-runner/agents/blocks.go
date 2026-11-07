package agents

import (
	"time"
)

const BlockKindText = "text"

const BlockKindThinking = "thinking"

const BlockKindToolUse = "tool_use"

const BlockKindSubagent = "subagent"

// turnBlock preserves the agent's reply order.
type TurnBlock struct {
	Kind string
	// text carries blockKindText and blockKindThinking. A redacted thinking block has none.
	Text string
	// For tool_use: tool name, short input summary, and full input.
	Name   string
	Input  string
	Detail string
	// toolUseID joins separately arriving calls and results.
	ToolUseID string
	// Codex/Muse results arrive with the call; Claude results are filled in later.
	Result   string
	IsError  bool
	ExitCode *int
	// Timing is transcript-only; the wire omits it.
	At         time.Time
	DurationMs int64
	// subagent is non-nil only for blockKindSubagent.
	Subagent *TurnSubagent
}

// wireBlock is the live subset of a transcript block, also used by sync. Timing stays on disk.
func WireBlock(block TurnBlock) map[string]any {
	frame := map[string]any{"kind": block.Kind}
	if block.Kind == BlockKindSubagent {
		frame["text"] = block.Text
		if block.Subagent != nil {
			frame["subagent"] = WireSubagent(block.Subagent)
		}
		return frame
	}
	if block.Kind == BlockKindToolUse {
		frame["name"] = block.Name
		if block.Input != "" {
			frame["input"] = block.Input
		}
		if block.Detail != "" {
			frame["detail"] = block.Detail
		}
		if block.ToolUseID != "" {
			frame["toolUseId"] = block.ToolUseID
		}
		if block.Result != "" {
			frame["result"] = block.Result
		}
		if block.IsError {
			frame["isError"] = true
		}
		if block.ExitCode != nil {
			frame["exitCode"] = *block.ExitCode
		}
		return frame
	}
	frame["text"] = block.Text
	return frame
}

// wireSubagent includes nested delegation blocks recursively.
func WireSubagent(sub *TurnSubagent) map[string]any {
	frame := map[string]any{}
	if sub.SubagentID != "" {
		frame["subagentId"] = sub.SubagentID
	}
	if sub.ChildSessionID != "" {
		frame["childSessionId"] = sub.ChildSessionID
	}
	if sub.Role != "" {
		frame["role"] = sub.Role
	}
	if sub.Objective != "" {
		frame["objective"] = sub.Objective
	}
	if sub.Status != "" {
		frame["status"] = sub.Status
	}
	if sub.Result != "" {
		frame["result"] = sub.Result
	}
	if sub.DurationMs != 0 {
		frame["durationMs"] = sub.DurationMs
	}
	if sub.Truncated {
		frame["truncated"] = true
	}
	if len(sub.Blocks) > 0 {
		blocks := make([]any, 0, len(sub.Blocks))
		for _, block := range sub.Blocks {
			blocks = append(blocks, WireBlock(block))
		}
		frame["blocks"] = blocks
	}
	return frame
}

// promptFile covers uploaded attachments and store images; store images have no upload id or TTL.
type PromptFile struct {
	Path      string
	MediaType string
	Size      int64
}
