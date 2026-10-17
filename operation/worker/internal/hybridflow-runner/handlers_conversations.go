package hybridflowrunner

import (
	"encoding/json"
	"errors"
	"io"
	"kiao/worker/internal/core"
	"net/http"
	"strings"
)

// The six /hybridflow-runner/conversations endpoints. They are thin, as every handler here is: parse, call the
// store, hand the error to core.WriteError. The one thing they add is the join — a conversation's
// stored state comes from disk, and whether a turn is running in it right now comes from memory.

// HandleListConversations serves GET /hybridflow-runner/conversations. Archived conversations are left out
// unless ?archived=true asks for them: archiving is how a conversation leaves the switcher without
// being lost, so including them by default would defeat it.
func (s *Service) HandleListConversations(w http.ResponseWriter, r *http.Request) {
	metas := s.conversations.list(r.URL.Query().Get("archived") == "true")
	dtos := make([]AgentConversationDto, 0, len(metas))
	for _, meta := range metas {
		dtos = append(dtos, s.conversationDto(meta))
	}
	core.WriteJSON(w, http.StatusOK, dtos)
}

// HandleCreateConversation serves POST /hybridflow-runner/conversations.
func (s *Service) HandleCreateConversation(w http.ResponseWriter, r *http.Request) {
	var req CreateConversationRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	// The agent is settled first, because both the mode and the two settings below are read against
	// it: which modes exist is the agent's answer, and so is what `opus` means.
	agent, ok := s.agents.resolve(req.Agent)
	if !ok {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest,
			Msg: "this service does not offer the agent " + req.Agent})
		return
	}
	mode := orDefault(req.PermissionMode, s.cfg.defaultPermissionMode())
	if !knownPermissionMode(mode) {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "unknown permission mode: " + mode})
		return
	}
	// Refused at creation as well as at every prompt: a conversation whose stored mode can never run
	// is a dead end, and this is the point at which the user chose it.
	if !s.cfg.allowsPermissionMode(mode) {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: bypassDisabledMessage})
		return
	}
	if !s.agents.publishesMode(agent.name, mode) {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest,
			Msg: modeUnsupportedMessage(agent.label, mode)})
		return
	}
	// Resolved here as well as before every turn: the folder is fixed for the conversation's life,
	// and one that does not exist is a dead end worth refusing at the point the user chose it.
	folder, err := resolveClaudeFolder(s.cfg.RootPath, req.Folder)
	if err != nil {
		core.WriteError(w, r, err) // outside the root → 400, gone → 404
		return
	}

	// What the conversation starts with where the client names nothing: the agent's own pair,
	// which for Muse is read out of its catalogue rather than written on its entry.
	defaultModel, defaultEffort := s.agents.defaultsFor(agent.name)
	meta, err := s.conversations.create(conversationMeta{
		Title: req.Title,
		// A title the client supplied is the user's, so the first prompt must not overwrite it.
		TitleSetByUser: strings.TrimSpace(req.Title) != "",
		Folder:         folder.virtual,
		Agent:          agent.name,
		Owner:          core.IdentityFromRequest(r).User,
		Model:          orDefault(req.Model, defaultModel),
		Effort:         orDefault(req.Effort, defaultEffort),
		PermissionMode: mode,
		// Extended thinking is on unless the client says otherwise, which is the CLI's own default.
		Thinking: req.Thinking == nil || *req.Thinking,
	})
	if err != nil {
		core.WriteError(w, r, err) // over the cap → 409
		return
	}
	s.broadcastConversation(meta)
	core.WriteJSON(w, http.StatusCreated, s.conversationDto(meta))
}

// HandleForkConversation serves POST /hybridflow-runner/conversations/{id}/fork: a copy of the conversation
// that carries on from a point in it, leaving the original untouched. It is how a user tries a
// second direction on the same context without spending the first one.
//
// The body names that point — `fromMessageId`, a message of this conversation's transcript — and
// the copy stops *short* of it, because forking is asked of a prompt and what it means is
// "everything before this is history; the prompt itself I will ask again". No body forks the
// conversation whole, which is the same request said of its end.
//
// A turn running in the source is refused rather than waited for or stopped. The fork copies the
// transcript and the session the source has *now*, and a reply still being written would land in
// one and not the other; and stopping it — the way delete does, because delete has no conversation
// left to damage — would be answering a request to copy a conversation by breaking it.
//
// The folder is resolved again here for the same reason creating one does it: it is fixed for the
// new conversation's life, and one that has gone since the source was made is a dead end worth
// refusing at the point the user asked for it.
func (s *Service) HandleForkConversation(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	source, err := s.conversations.get(id)
	if err != nil {
		core.WriteError(w, r, err) // malformed id → 400, unknown → 404
		return
	}
	// An empty body is the whole conversation, so it is read as one rather than refused: the older
	// clients that fork without a body are asking for exactly that.
	var req AgentForkRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	if s.conversationIsRunning(id) {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusConflict,
			Msg: "A turn is running in this conversation. Fork it once the turn has finished."})
		return
	}
	if _, err := resolveClaudeFolder(s.cfg.RootPath, source.Folder); err != nil {
		core.WriteError(w, r, err) // outside the root → 400, gone → 404
		return
	}

	// Which agent the copy runs on: the source's unless the body names another, which is the only
	// way there is to change one. Everything the fork carries follows from it — the session above
	// all, which a change of engine can never take with it.
	onto, ok := s.agents.resolve(orDefault(strings.TrimSpace(req.Agent), resolvedAgent(source.Agent)))
	if !ok {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest,
			Msg: "this service does not offer the agent " + req.Agent})
		return
	}
	// The settings a copy that changed engine starts with. A Codex conversation forked from a Claude
	// one must not inherit `opus`, which names nothing it can run, and must not inherit `manual`
	// either — Codex has no such mode, so the copy would be refused at its first prompt. A fork onto
	// the same agent reads none of this and keeps the source's own.
	defaultModel, defaultEffort := s.agents.defaultsFor(onto.name)
	target := forkTarget{
		agent:          onto.name,
		label:          onto.label,
		branches:       s.agents.branches(onto.name),
		model:          defaultModel,
		effort:         defaultEffort,
		permissionMode: s.forkedMode(onto.name),
	}

	meta, err := s.conversations.fork(id, core.IdentityFromRequest(r).User,
		strings.TrimSpace(req.FromMessageID), target)
	if err != nil {
		core.WriteError(w, r, err) // over the cap → 409, a message that is not here → 404
		return
	}
	s.broadcastConversation(meta)
	core.WriteJSON(w, http.StatusCreated, s.conversationDto(meta))
}

// HandleGetConversation serves GET /hybridflow-runner/conversations/{id} — the summary plus the whole
// transcript. This is where a client's history comes from; the socket carries only the live turn.
func (s *Service) HandleGetConversation(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	meta, err := s.conversations.get(id)
	if err != nil {
		core.WriteError(w, r, err) // malformed id → 400, unknown → 404
		return
	}
	records, err := s.conversations.messages(id)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	messages := make([]AgentMessageDto, 0, len(records))
	for _, rec := range records {
		messages = append(messages, messageDto(rec))
	}
	core.WriteJSON(w, http.StatusOK, AgentConversationDetailDto{
		AgentConversationDto: s.conversationDto(meta),
		Messages:             messages,
	})
}

// HandlePatchConversation serves PATCH /hybridflow-runner/conversations/{id}. An omitted field is left alone
// rather than reset, which is why every field of the request is a pointer. The folder is absent
// from the payload on purpose: it is the CLI's cwd and the owner of the CLI's own transcript, so a
// conversation that wants a different one is a different conversation.
func (s *Service) HandlePatchConversation(w http.ResponseWriter, r *http.Request) {
	var req PatchConversationRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	if req.PermissionMode != nil {
		if !knownPermissionMode(*req.PermissionMode) {
			core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "unknown permission mode: " + *req.PermissionMode})
			return
		}
		if !s.cfg.allowsPermissionMode(*req.PermissionMode) {
			core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: bypassDisabledMessage})
			return
		}
		// And one the conversation's own agent has. The agent cannot be patched, so reading it before
		// the update rather than inside it settles nothing that could change underneath: what is being
		// checked is precisely the field this endpoint refuses to touch.
		stored, err := s.conversations.get(r.PathValue("id"))
		if err != nil {
			core.WriteError(w, r, err) // malformed id → 400, unknown → 404
			return
		}
		if !s.agents.publishesMode(stored.Agent, *req.PermissionMode) {
			core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest,
				Msg: modeUnsupportedMessage(s.agents.label(stored.Agent), *req.PermissionMode)})
			return
		}
	}

	meta, err := s.conversations.update(r.PathValue("id"), func(meta *conversationMeta) {
		if req.Title != nil {
			// Clearing the field is a reset rather than a rename to nothing: the conversation goes
			// back to being named after a prompt, which is what emptying a rename box looks like it
			// should do.
			meta.Title = *req.Title
			meta.TitleSetByUser = strings.TrimSpace(*req.Title) != ""
		}
		if req.Archived != nil {
			meta.Archived = *req.Archived
		}
		if req.Pinned != nil {
			meta.Pinned = *req.Pinned
		}
		if req.Model != nil {
			meta.Model = *req.Model
		}
		if req.Effort != nil {
			meta.Effort = *req.Effort
		}
		if req.PermissionMode != nil {
			meta.PermissionMode = *req.PermissionMode
		}
		if req.Thinking != nil {
			meta.Thinking = *req.Thinking
		}
		if req.TraceStream != nil {
			meta.TraceStream = *req.TraceStream
		}
	})
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	s.broadcastConversation(meta)
	core.WriteJSON(w, http.StatusOK, s.conversationDto(meta))
}

// HandleDeleteConversation serves DELETE /hybridflow-runner/conversations/{id}.
//
// The running turn is stopped before the record goes, not after: a CLI process that outlives its
// conversation writes its result into a directory that no longer exists. The conversation is looked
// up first so that a malformed or unknown id stops nothing at all.
//
// Only this service's directory is removed. The CLI's own
// ~/.claude/projects/<slug>/<sessionId>.jsonl stays — `claude project purge` takes a directory
// rather than a session, so purging one conversation's history there is not something this service
// can do without taking the folder's other sessions with it.
func (s *Service) HandleDeleteConversation(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.conversations.get(id); err != nil {
		core.WriteError(w, r, err)
		return
	}
	if s.hub != nil {
		s.hub.stopProcess(id, core.IdentityFromRequest(r).User)
	}
	if err := s.conversations.delete(id); err != nil {
		core.WriteError(w, r, err)
		return
	}
	// A board playing in it has nowhere left to play: the run is dropped rather than left pointing at
	// a conversation nothing can resume into.
	if s.chainRunner != nil {
		s.chainRunner.conversationGone(id)
	}
	s.broadcastConversationDeleted(id)
	w.WriteHeader(http.StatusNoContent)
}

// ── keeping every tab's list live ────────────────────────────────────────────

// broadcastConversation tells every open socket that a conversation changed. The switcher is a list
// a user leaves open in one tab while working in another, and polling it would be the only
// alternative — these two lines are what make a conversation created, renamed or archived anywhere
// appear everywhere.
func (s *Service) broadcastConversation(meta conversationMeta) {
	if s.hub == nil {
		return
	}
	s.hub.broadcastRegistry(s.hub.conversationFrame(meta))
}

func (s *Service) broadcastConversationDeleted(id string) {
	if s.hub == nil {
		return
	}
	s.hub.broadcastRegistry(map[string]any{
		"type": "conversation_deleted", "conversationId": id,
	})
}

// ── joining the disk to the turn registry ────────────────────────────────────

// conversationDto is the join: everything but Running comes off the disk, and Running is the turn
// registry's answer. The disk records that a turn was *started* so a restart can settle it; whether
// one is live right now is only ever known in memory.
func (s *Service) conversationDto(meta conversationMeta) AgentConversationDto {
	return conversationDtoOf(meta, s.conversationIsRunning(meta.ID))
}

// conversationDtoOf is that join with liveness already answered. It is a free function because the
// turn registry produces this DTO too — a `conversation` broadcast carries the same shape a REST
// read does, so a client that received one never has to reconcile two views of a conversation.
func conversationDtoOf(meta conversationMeta, running bool) AgentConversationDto {
	return AgentConversationDto{
		ID:                meta.ID,
		Title:             meta.Title,
		Folder:            meta.Folder,
		Agent:             resolvedAgent(meta.Agent),
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

// conversationIsRunning reads the liveness seam, answering "idle" when nothing is wired to it. A
// Service assembled without one — every test that is not about liveness — reports every
// conversation idle rather than panicking, which is also exactly what the truth is when no turn can
// be running.
func (s *Service) conversationIsRunning(conversationID string) bool {
	if s.liveness == nil {
		return false
	}
	return s.liveness(conversationID)
}

// messageDto is one transcript record as it reaches a client. The two shapes are kept separate on
// purpose: the record is what this service chose to store, the DTO is what the wire promises.
//
// `text` and `tools` are *derived* from the blocks of a record that has them, rather than stored
// twice. That is what keeps this endpoint's shape additive: `blocks` is the new field and the whole
// order, while a reader that only knows the old two fields still gets the reply and the tool calls
// it always got. A record from before blocks existed simply reports what it stored.
func messageDto(rec conversationRecord) AgentMessageDto {
	dto := AgentMessageDto{
		ID:              rec.ID,
		Role:            rec.Role,
		Text:            rec.blockText(),
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
		RunID:           rec.RunID,
		FlowNodeID:      rec.FlowNodeID,
		Board:           rec.Board,
		ForkFrom:        rec.ForkFrom,
		ForkFromMessage: rec.ForkFromMessage,
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
	for _, tool := range rec.blockTools() {
		dto.Tools = append(dto.Tools, AgentToolUseDto{Name: tool.Name, Input: tool.Input})
	}
	for _, block := range rec.Blocks {
		dto.Blocks = append(dto.Blocks, blockDtoOf(block))
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
func blockDtoOf(block conversationBlock) AgentBlockDto {
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
			sub.Blocks = append(sub.Blocks, blockDtoOf(nested))
		}
		dto.Subagent = sub
	}
	return dto
}

// knownPermissionMode reports whether a mode is one this service can drive over the socket. An
// unknown value is never guessed at: reading it as either mode would silently give every turn of
// the conversation more or less freedom than was asked for, so it is refused where it is set rather
// than at the first prompt.
func knownPermissionMode(mode string) bool {
	return asksBeforeTools(mode) || mode == permissionModeBypass
}

// resolvedAgent is the agent a stored name refers to. Empty is the default, which is Claude by
// construction — newAgentRegistry always registers it first — and is also what every conversation
// written before the field was one actually ran on.
func resolvedAgent(name string) string {
	return orDefault(strings.TrimSpace(name), agentClaude)
}

// forkedMode is the permission mode a conversation forked onto a *different* agent starts in: the
// deployment's default when that agent has it, and otherwise the first mode the agent publishes. An
// agent that publishes none on this deployment leaves it empty, and the copy is refused at its
// first prompt — which is the truth about it, said where the user can see it rather than at
// creation where it would look like the fork itself had failed.
func (s *Service) forkedMode(agent string) string {
	preferred := s.cfg.defaultPermissionMode()
	if s.agents.publishesMode(agent, preferred) {
		return preferred
	}
	if entry, ok := s.agents.resolve(agent); ok {
		if options, ok := entry.agent.(AgentOptions); ok {
			if modes := options.Options().PermissionModes; len(modes) > 0 {
				return modes[0].Value
			}
		}
	}
	return ""
}
