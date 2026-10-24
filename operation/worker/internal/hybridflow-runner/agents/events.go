package agents

import (
	"encoding/json"
	"fmt"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	"strings"
)

func NotStarted(err error) error {
	return fmt.Errorf("The Claude process could not be started: %w", err)
}

func ReadBlock(kind string, block map[string]any) TurnBlock {
	if kind == BlockKindToolUse {
		// Keep a short chip label and a detailed audit view; toolUseID joins the later result.
		return TurnBlock{
			Kind:      kind,
			Name:      protocol.OrDefault(protocol.AsString(block["name"]), "tool"),
			Input:     SummarizeToolInput(block["input"]),
			Detail:    protocol.PermissionInputSummary(block["input"]),
			ToolUseID: protocol.AsString(block["id"]),
		}
	}
	// Retain redacted thinking as an empty block to record where reasoning occurred.
	text := protocol.AsString(block["text"])
	if kind == BlockKindThinking {
		text = protocol.OrDefault(protocol.AsString(block["thinking"]), text)
	}
	return TurnBlock{Kind: kind, Text: text}
}

func SummarizeToolInput(input any) string {
	if input == nil {
		return ""
	}
	var raw string
	if s, ok := input.(string); ok {
		raw = s
	} else {
		b, _ := json.Marshal(input)
		raw = string(b)
	}
	if len(raw) > 80 {
		return raw[:80] + "…"
	}
	return raw
}

const MaxQuestions = 8

const MaxQuestionOptions = 12

const MaxQuestionChars = 2000

// Malformed questions fall back to a permission card showing raw input so the user
// can still unblock the turn.
func AskedQuestions(input any) (questions []map[string]any, keys []string) {
	asked, _ := input.(map[string]any)
	raw, _ := asked["questions"].([]any)
	if len(raw) == 0 {
		return nil, nil
	}
	for _, entry := range raw {
		if len(questions) == MaxQuestions {
			break
		}
		asked, _ := entry.(map[string]any)
		key := protocol.AsString(asked["question"])
		if key == "" {
			// Reject the whole question list; dropping an entry could misalign later answers.
			return nil, nil
		}
		question := map[string]any{
			"question": protocol.CutRunes(key, MaxQuestionChars),
			"options":  askedOptions(asked["options"]),
		}
		if header := protocol.CutRunes(protocol.AsString(asked["header"]), MaxQuestionChars); header != "" {
			question["header"] = header
		}
		if multi, ok := asked["multiSelect"].(bool); ok && multi {
			question["multiSelect"] = true
		}
		questions = append(questions, question)
		keys = append(keys, key)
	}
	return questions, keys
}

// No options still permits a free-text answer, equivalent to the CLI's Other choice.
func askedOptions(raw any) []map[string]any {
	entries, _ := raw.([]any)
	options := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if len(options) == MaxQuestionOptions {
			break
		}
		asked, _ := entry.(map[string]any)
		label := protocol.CutRunes(protocol.AsString(asked["label"]), MaxQuestionChars)
		if label == "" {
			continue
		}
		option := map[string]any{"label": label}
		if description := protocol.CutRunes(protocol.AsString(asked["description"]), MaxQuestionChars); description != "" {
			option["description"] = description
		}
		// Previews need the larger permission-input limit to show the choice being offered.
		if preview := protocol.CutRunes(protocol.AsString(asked["preview"]), protocol.MaxPermissionInputChars); preview != "" {
			option["preview"] = preview
		}
		options = append(options, option)
	}
	return options
}

// Normalize agent usage and cost spellings. Missing, unreadable or all-zero
// reports mean unknown, not free.
func ReadUsage(raw, cost any, scope string) (*TurnUsage, bool) {
	usage, _ := raw.(map[string]any)
	report := &TurnUsage{Scope: scope}
	found := false
	set := func(field *int64, keys ...string) {
		if tokens, ok := protocol.AsInt64(protocol.FirstOf(usage, keys...)); ok {
			*field = tokens
			found = found || tokens != 0
		}
	}
	set(&report.InputTokens, "input_tokens", "inputTokens", "totalInputTokens", "prompt_tokens")
	set(&report.OutputTokens, "output_tokens", "outputTokens", "totalOutputTokens", "completion_tokens")
	set(&report.CacheReadTokens, "cache_read_input_tokens", "cacheReadTokens", "cachedInputTokens", "cached_tokens", "cachedTokens")
	set(&report.CacheWriteTokens, "cache_creation_input_tokens", "cacheCreationTokens", "cache_write_tokens", "cacheWriteTokens")
	if amount, ok := protocol.AsFloat(cost); ok && amount != 0 {
		report.TotalCostUSD, found = amount, true
	} else if amount, ok := protocol.AsFloat(protocol.FirstOf(usage, "cost", "costUSD", "total_cost_usd")); ok && amount != 0 {
		report.TotalCostUSD, found = amount, true
	}
	if !found {
		return nil, false
	}
	return report, true
}

// Read output and outcome from completed items used by the other drivers.
func ToolOutcome(item map[string]any) (result string, isError bool, exitCode *int, durationMs int64, ok bool) {
	if output := protocol.FirstOf(item, "output", "aggregated_output", "result", "response", "results", "visibleOutput"); output != nil {
		if rendered := protocol.ResultSummary(output); rendered != "" {
			result, ok = rendered, true
		}
	}
	if protocol.AsBool(item["is_error"]) || protocol.AsBool(item["isError"]) {
		isError, ok = true, true
	}
	if raw := protocol.FirstOf(item, "error", "errorMessage", "failureReason"); raw != nil {
		if rendered := protocol.ResultSummary(raw); rendered != "" {
			switch {
			case result == "":
				result = rendered
			case !strings.Contains(result, rendered):
				// Retain the failure reason alongside output unless already present verbatim.
				result += "\n" + rendered
			}
			isError, ok = true, true
		} else {
			isError, ok = true, true
		}
	}
	switch status := protocol.AsString(protocol.FirstOf(item, "status", "state")); status {
	case "failed", "error", "denied", "cancelled":
		isError, ok = true, true
	}
	if code, found := protocol.AsInt64(protocol.FirstOf(item, "exit_code", "exitCode")); found {
		code := int(code)
		exitCode, ok = &code, true
		if code != 0 {
			isError = true
		}
	}
	if measured, found := protocol.AsInt64(protocol.FirstOf(item, "duration_ms", "durationMs")); found && measured > 0 {
		durationMs, ok = measured, true
	}
	return result, isError, exitCode, durationMs, ok
}
