package claude

import (
	"encoding/json"
	"kiao/worker/internal/core/filesystem"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"kiao/worker/internal/hybridflow-runner/harnesses/protocol"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type claudeUsageSnapshot struct {
	Usage harnessapi.TurnUsage `json:"usage"`
}

// Claude 2.1.277 restores modelUsage and cost from its native session.
func claudeRestoresUsage(version string) bool {
	fields := strings.Fields(version)
	if len(fields) == 0 {
		return false
	}
	parts := strings.Split(fields[0], ".")
	if len(parts) < 3 {
		return false
	}
	major, _ := strconv.Atoi(parts[0])
	minor, _ := strconv.Atoi(parts[1])
	patch, _ := strconv.Atoi(parts[2])
	return major > 2 || (major == 2 && (minor > 1 || (minor == 1 && patch >= 277)))
}

func readClaudeUsage(raw, cost any) (*harnessapi.TurnUsage, bool) {
	usage, ok := harnessapi.ReadUsage(raw, cost, harnessapi.UsageScopeTurn)
	if !ok {
		return nil, false
	}
	fields, _ := raw.(map[string]any)
	input, _ := protocol.AsInt64(protocol.FirstOf(fields, "input_tokens", "inputTokens"))
	// Claude's input excludes both cache counters.
	usage.InputTokens = max(usage.InputTokens, input+usage.CacheReadTokens+usage.CacheWriteTokens)
	return usage, true
}

func (d *ClaudeDriver) usagePath(session string) string {
	if d.cfg == nil || d.cfg.StatePath == "" || session == "" || session == "." || session == ".." || strings.ContainsAny(session, `/\`) {
		return ""
	}
	return filepath.Join(d.cfg.StatePath, "claude-usage", session+".json")
}

func (d *ClaudeDriver) loadUsageBaseline() {
	data, err := os.ReadFile(d.usagePath(d.run.SessionID))
	if err != nil {
		return
	}
	var snapshot claudeUsageSnapshot
	if json.Unmarshal(data, &snapshot) == nil {
		d.usageBaseline = &snapshot.Usage
	}
}

func (d *ClaudeDriver) resultUsage(event map[string]any) *harnessapi.TurnUsage {
	usage, found := readClaudeUsage(event["usage"], nil)
	if found {
		d.mainUsage.Add(*usage)
		d.pendingUsage = nil
	}
	models, _ := protocol.FirstOf(event, "modelUsage", "model_usage").(map[string]any)
	var total harnessapi.TurnUsage
	for _, raw := range models {
		if usage, ok := readClaudeUsage(raw, nil); ok {
			total.Add(*usage)
		}
	}
	if cost, ok := protocol.AsFloat(event["total_cost_usd"]); ok {
		total.TotalCostUSD = cost
	}
	if !found && total == (harnessapi.TurnUsage{}) {
		return nil
	}
	restores := claudeRestoresUsage(d.cliVersion)
	if total.InputTokens+total.OutputTokens > 0 && (!restores || d.run.SessionID == "" || d.usageBaseline != nil) {
		d.pendingUsage = nil
		billed := total
		if restores && d.usageBaseline != nil {
			base := d.usageBaseline
			billed.InputTokens = max(0, total.InputTokens-base.InputTokens)
			billed.OutputTokens = max(0, total.OutputTokens-base.OutputTokens)
			billed.CacheReadTokens = max(0, total.CacheReadTokens-base.CacheReadTokens)
			billed.CacheWriteTokens = max(0, total.CacheWriteTokens-base.CacheWriteTokens)
			billed.ReasoningTokens = max(0, total.ReasoningTokens-base.ReasoningTokens)
			billed.TotalCostUSD = max(0, total.TotalCostUSD-base.TotalCostUSD)
		}
		d.modelUsage = &billed
	} else if found && d.modelUsage != nil {
		d.modelUsage.Add(*usage)
	}
	if d.modelUsage != nil {
		d.modelUsage.InputTokens = max(d.modelUsage.InputTokens, d.mainUsage.InputTokens)
		d.modelUsage.OutputTokens = max(d.modelUsage.OutputTokens, d.mainUsage.OutputTokens)
		d.modelUsage.CacheReadTokens = max(d.modelUsage.CacheReadTokens, d.mainUsage.CacheReadTokens)
		d.modelUsage.CacheWriteTokens = max(d.modelUsage.CacheWriteTokens, d.mainUsage.CacheWriteTokens)
		d.modelUsage.ReasoningTokens = max(d.modelUsage.ReasoningTokens, d.mainUsage.ReasoningTokens)
		d.modelUsage.InputTokens = max(d.modelUsage.InputTokens, d.modelUsage.CacheReadTokens+d.modelUsage.CacheWriteTokens)
	}
	if restores && total.InputTokens+total.OutputTokens > 0 {
		session := protocol.OrDefault(protocol.AsString(event["session_id"]), d.run.SessionID)
		if path := d.usagePath(session); path != "" {
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err == nil {
				data, _ := json.Marshal(claudeUsageSnapshot{Usage: total})
				if err := filesystem.WriteFileAtomic(path, data, 0o600); err != nil {
					harnessapi.LogClaudeWS.Warn("could not save Claude usage baseline", "error", err)
				}
			}
		}
	}
	if d.modelUsage == nil {
		d.mainUsage.TotalCostUSD = max(d.mainUsage.TotalCostUSD, total.TotalCostUSD)
		if restores && d.usageBaseline != nil {
			d.mainUsage.TotalCostUSD = max(0, total.TotalCostUSD-d.usageBaseline.TotalCostUSD)
		} else if restores && d.run.SessionID != "" {
			d.mainUsage.TotalCostUSD = 0
		}
	}
	return d.usageSnapshot()
}

func (d *ClaudeDriver) usageSnapshot() *harnessapi.TurnUsage {
	billed := d.mainUsage
	if d.modelUsage != nil {
		billed = *d.modelUsage
	} else {
		for _, child := range d.childUsage {
			billed.Add(child)
		}
	}
	for _, message := range d.pendingUsage {
		billed.Add(message)
	}
	if billed == (harnessapi.TurnUsage{}) {
		return nil
	}
	billed.Scope = harnessapi.UsageScopeTurn
	return &billed
}

func (d *ClaudeDriver) noteChildUsage(id string, raw any) *harnessapi.TurnUsage {
	if id == "" {
		return nil
	}
	usage, ok := readClaudeUsage(raw, nil)
	if !ok {
		return nil
	}
	if d.childUsage == nil {
		d.childUsage = map[string]harnessapi.TurnUsage{}
	}
	if d.childUsage[id] == *usage {
		return nil
	}
	d.childUsage[id] = *usage
	if d.modelUsage != nil {
		return nil
	}
	return d.usageSnapshot()
}

func (d *ClaudeDriver) noteMessageUsage(message map[string]any) *harnessapi.TurnUsage {
	id := protocol.AsString(message["id"])
	usage, ok := readClaudeUsage(message["usage"], nil)
	if id == "" || !ok {
		return nil
	}
	if d.pendingUsage == nil {
		d.pendingUsage = map[string]harnessapi.TurnUsage{}
	}
	prior := d.pendingUsage[id]
	usage.InputTokens = max(usage.InputTokens, prior.InputTokens)
	usage.OutputTokens = max(usage.OutputTokens, prior.OutputTokens)
	usage.CacheReadTokens = max(usage.CacheReadTokens, prior.CacheReadTokens)
	usage.CacheWriteTokens = max(usage.CacheWriteTokens, prior.CacheWriteTokens)
	usage.ReasoningTokens = max(usage.ReasoningTokens, prior.ReasoningTokens)
	if prior == *usage {
		return nil
	}
	d.pendingUsage[id] = *usage
	return d.usageSnapshot()
}

func (d *ClaudeDriver) streamUsageEvents(event map[string]any) []harnessapi.HarnessEvent {
	if protocol.AsString(event["parent_tool_use_id"]) != "" {
		return nil
	}
	stream, _ := event["event"].(map[string]any)
	var usage *harnessapi.TurnUsage
	switch protocol.AsString(stream["type"]) {
	case "message_start":
		message, _ := stream["message"].(map[string]any)
		d.streamMessage = protocol.AsString(message["id"])
		usage = d.noteMessageUsage(message)
	case "message_delta":
		usage = d.noteMessageUsage(map[string]any{"id": d.streamMessage, "usage": stream["usage"]})
	case "message_stop":
		d.streamMessage = ""
	}
	if usage == nil {
		return nil
	}
	return []harnessapi.HarnessEvent{{Kind: harnessapi.EventUsage, Usage: usage}}
}
