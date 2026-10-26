package conversations

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	"time"
)

// conversationDtoOf is that join with liveness already answered. It is a free function because the
// turn registry produces this DTO too — a `conversation` broadcast carries the same shape a REST
// read does, so a client that received one never has to reconcile two views of a conversation.
func ConversationDtoOf(meta ConversationMeta, running bool) AgentConversationDto {
	return AgentConversationDto{
		AgentVersion:      meta.AgentVersion,
		ID:                meta.ID,
		Title:             meta.Title,
		Folder:            meta.Folder,
		Agent:             agentapi.ResolvedAgent(meta.Agent),
		ProfileID:         meta.ProfileID,
		Model:             meta.Model,
		Effort:            meta.Effort,
		PermissionMode:    meta.PermissionMode,
		Thinking:          meta.Thinking,
		SessionID:         meta.SessionID,
		Running:           running,
		Archived:          meta.Archived,
		Pinned:            meta.Pinned,
		MessageCount:      meta.MessageCount,
		CreatedAt:         meta.CreatedAt,
		UpdatedAt:         meta.UpdatedAt,
		LastExitCode:      meta.LastExitCode,
		SessionLost:       meta.SessionLost,
		ForkedFrom:        meta.ForkedFrom,
		ForkedFromMessage: meta.ForkedFromMessage,
		TraceStream:       meta.TraceStream,
	}
}

// messageDto is one transcript record as it reaches a client. The two shapes are kept separate on
// purpose: the record is what this service chose to store, the DTO is what the wire promises.
//
// `text` and `tools` are *derived* from the blocks of a record that has them, rather than stored
// twice. That is what keeps this endpoint's shape additive: `blocks` is the new field and the whole
// order, while a reader that only knows the old two fields still gets the reply and the tool calls
// it always got. A record from before blocks existed simply reports what it stored.
func MessageDto(rec ConversationRecord) AgentMessageDto {
	// Historical notices resolve against their recording time, never the day they are reopened.
	at, dateErr := time.Parse(time.RFC3339Nano, rec.At)
	replyText := func(text string) string {
		if dateErr == nil && rec.Role != RoleUser {
			if fault := agentfaults.NoticeFault(text, ""); fault != nil && fault.Limit {
				return agentfaults.AbsoluteLimitNotice(text, at)
			}
		}
		return text
	}
	dto := AgentMessageDto{
		ID:        rec.ID,
		ProfileID: rec.ProfileID, Execution: rec.Execution, Queue: rec.Queue,
		Role:            rec.Role,
		Text:            replyText(rec.BlockText()),
		At:              rec.At,
		TurnID:          rec.TurnID,
		Between:         rec.Between,
		AfterBlocks:     rec.AfterBlocks,
		Model:           rec.Model,
		Effort:          rec.Effort,
		PermissionMode:  rec.PermissionMode,
		ExitCode:        rec.ExitCode,
		Interrupted:     rec.Interrupted,
		Truncated:       rec.Truncated,
		StartedAt:       rec.StartedAt,
		FinishedAt:      rec.FinishedAt,
		DurationMs:      rec.DurationMs,
		FirstBlockMs:    rec.FirstBlockMs,
		EndReason:       rec.EndReason,
		Terminal:        rec.Terminal,
		ComposedPrompt:  rec.ComposedPrompt,
		SystemPrompt:    rec.SystemPrompt,
		Instructions:    rec.Instructions,
		PlayedBy:        rec.PlayedBy,
		AgentRef:        rec.AgentRef,
		AgentVersion:    rec.AgentVersion,
		RunID:           rec.RunID,
		FlowNodeID:      rec.FlowNodeID,
		Board:           rec.Board,
		ForkFrom:        rec.ForkFrom,
		ForkFromMessage: rec.ForkFromMessage,
	}
	if dateErr == nil {
		dto.EndReason = agentfaults.AbsoluteLimitNotice(dto.EndReason, at)
	}
	if rec.Usage != nil {
		dto.Usage = &AgentTurnUsageDto{
			InputTokens:      rec.Usage.InputTokens,
			OutputTokens:     rec.Usage.OutputTokens,
			CacheReadTokens:  rec.Usage.CacheReadTokens,
			CacheWriteTokens: rec.Usage.CacheWriteTokens,
			ReasoningTokens:  rec.Usage.ReasoningTokens,
			TotalCostUSD:     rec.Usage.TotalCostUSD,
			Scope:            rec.Usage.Scope,
		}
	}
	for _, att := range rec.Attachments {
		dto.Attachments = append(dto.Attachments, AgentAttachmentDto{
			ID: att.ID, Name: att.Name, Size: att.Size, MediaType: att.MediaType,
		})
	}
	for _, tool := range rec.BlockTools() {
		dto.Tools = append(dto.Tools, AgentToolUseDto{Name: tool.Name, Input: tool.Input})
	}
	for _, block := range rec.Blocks {
		wire := BlockDtoOf(block)
		if wire.Kind == "text" {
			wire.Text = replyText(wire.Text)
		}
		dto.Blocks = append(dto.Blocks, wire)
	}
	for _, ask := range rec.Asks {
		dto.Asks = append(dto.Asks, AgentAskDto{
			ID: ask.ID, Tool: ask.Tool, DisplayName: ask.DisplayName,
			Description: ask.Description, Input: ask.Input,
			Questions: ask.Questions, Answers: ask.Answers,
			Outcome: ask.Outcome, DecidedBy: ask.DecidedBy, At: ask.At,
		})
	}
	return dto
}

// blockDtoOf is one stored block as it reaches a client, descending into a delegation's own.
func BlockDtoOf(block ConversationBlock) AgentBlockDto {
	dto := AgentBlockDto{
		Kind: block.Kind, Text: block.Text,
		Name: block.Name, Input: block.Input, Detail: block.Detail,
		ToolUseID: block.ToolUseID, Result: block.Result,
		IsError: block.IsError, ExitCode: block.ExitCode,
		At: block.At, DurationMs: block.DurationMs,
	}
	if block.Subagent != nil {
		sub := &AgentSubagentDto{
			SubagentID:     block.Subagent.SubagentID,
			ChildSessionID: block.Subagent.ChildSessionID,
			Role:           block.Subagent.Role, Objective: block.Subagent.Objective,
			Status: block.Subagent.Status, Result: block.Subagent.Result,
			DurationMs: block.Subagent.DurationMs, Truncated: block.Subagent.Truncated,
		}
		for _, nested := range block.Subagent.Blocks {
			sub.Blocks = append(sub.Blocks, BlockDtoOf(nested))
		}
		dto.Subagent = sub
	}
	return dto
}
