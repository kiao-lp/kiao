package runnerhttp

import (
	"encoding/json"
	"errors"
	"io"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/errors"
	"kiao/worker/internal/core/http"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	"kiao/worker/internal/hybridflow-runner/playback"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"net/http"
	"strings"
)

// HandleListConversations serves GET /hybridflow-runner/conversations. Archived conversations are left out
// unless ?archived=true asks for them: archiving is how a conversation leaves the switcher without
// being lost, so including them by default would defeat it.
func (s *Service) HandleListConversations(w http.ResponseWriter, r *http.Request) {
	metas := s.conversations.List(r.URL.Query().Get("archived") == "true")
	dtos := make([]pkgConversations.AgentConversationDto, 0, len(metas))
	for _, meta := range metas {
		dtos = append(dtos, s.conversationDto(meta))
	}
	httpkit.WriteJSON(w, http.StatusOK, dtos)
}

// HandleCreateConversation serves POST /hybridflow-runner/conversations.
func (s *Service) HandleCreateConversation(w http.ResponseWriter, r *http.Request) {
	var req CreateConversationRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	// The agent is settled first, because both the mode and the two settings below are read against
	// it: which modes exist is the agent's answer, and so is what `opus` means.
	agent, ok := s.agents.Resolve(req.Agent)
	if !ok {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest,
			Msg: "this service does not offer the agent " + req.Agent})
		return
	}
	mode := protocol.OrDefault(req.PermissionMode, s.cfg.DefaultPermissionMode())
	if !runnerconfig.KnownPermissionMode(mode) {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "unknown permission mode: " + mode})
		return
	}
	// Refused at creation as well as at every prompt: a conversation whose stored mode can never run
	// is a dead end, and this is the point at which the user chose it.
	if !s.cfg.AllowsPermissionMode(mode) {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: turnevents.BypassDisabledMessage})
		return
	}
	if !s.agents.PublishesMode(agent.Name, mode) {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest,
			Msg: agentapi.ModeUnsupportedMessage(agent.Label, mode)})
		return
	}
	// Resolved here as well as before every turn: the folder is fixed for the conversation's life,
	// and one that does not exist is a dead end worth refusing at the point the user chose it.
	folder, err := runnerconfig.ResolveFolder(s.cfg.RootPath, req.Folder)
	if err != nil {
		httpkit.WriteError(w, r, err) // outside the root → 400, gone → 404
		return
	}

	// What the conversation starts with where the client names nothing: the agent's own pair,
	// which for Muse is read out of its catalogue rather than written on its entry.
	defaultModel, defaultEffort := s.agents.DefaultsFor(agent.Name)
	if agent.Name == agentapi.AgentPi {
		resolved, err := s.agents.Profiles.ResolveProfile(req.ProfileID, req.Model, req.Effort)
		if err != nil {
			httpkit.WriteError(w, r, err)
			return
		}
		req.ProfileID, req.Model, req.Effort = resolved.Profile.ID, resolved.Provider+"/"+resolved.ModelID, resolved.Effort
	}
	meta, err := s.conversations.Create(pkgConversations.ConversationMeta{
		Title: req.Title,
		// A title the client supplied is the user's, so the first prompt must not overwrite it.
		TitleSetByUser: strings.TrimSpace(req.Title) != "",
		Folder:         folder.Virtual,
		Agent:          agent.Name,
		ProfileID:      req.ProfileID,
		Owner:          access.IdentityFromRequest(r).User,
		Model:          protocol.OrDefault(req.Model, defaultModel),
		Effort:         protocol.OrDefault(req.Effort, defaultEffort),
		PermissionMode: mode,
		// Extended thinking is on unless the client says otherwise, which is the CLI's own default.
		Thinking: req.Thinking == nil || *req.Thinking,
	})
	if err != nil {
		httpkit.WriteError(w, r, err) // over the cap → 409
		return
	}
	s.broadcastConversation(meta)
	httpkit.WriteJSON(w, http.StatusCreated, s.conversationDto(meta))
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
	source, err := s.conversations.Get(id)
	if err != nil {
		httpkit.WriteError(w, r, err) // malformed id → 400, unknown → 404
		return
	}
	// An empty body is the whole conversation, so it is read as one rather than refused: the older
	// clients that fork without a body are asking for exactly that.
	var req pkgConversations.AgentForkRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	if s.conversationIsRunning(id) {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusConflict,
			Msg: "A turn is running in this conversation. Fork it once the turn has finished."})
		return
	}
	if _, err := runnerconfig.ResolveFolder(s.cfg.RootPath, source.Folder); err != nil {
		httpkit.WriteError(w, r, err) // outside the root → 400, gone → 404
		return
	}

	// Which agent the copy runs on: the source's unless the body names another, which is the only
	// way there is to change one. Everything the fork carries follows from it — the session above
	// all, which a change of engine can never take with it.
	engine := protocol.OrDefault(strings.TrimSpace(req.Agent), agentapi.ResolvedAgent(source.Agent))
	var publication *pkgBoards.ManagedAgentVersion
	if source.AgentVersion != nil && engine == agentapi.ResolvedAgent(source.Agent) {
		if s.boardsUpstream == nil {
			httpkit.WriteError(w, r, faults.Invalid("the agent's latest publication cannot be read without a hybridflow store"))
			return
		}
		definition, err := s.boardsUpstream.Agent(source.AgentVersion.AgentID)
		if err != nil {
			httpkit.WriteError(w, r, faults.Invalid("the agent's latest publication could not be read: "+err.Error()))
			return
		}
		resolved, err := playback.ActivePublication(definition)
		if err != nil {
			httpkit.WriteError(w, r, faults.Invalid(err.Error()))
			return
		}
		publication, engine = resolved.Snapshot, resolved.Platform
	}
	onto, ok := s.agents.Resolve(engine)
	if !ok {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest,
			Msg: "this service does not offer the agent " + req.Agent})
		return
	}
	// The settings a copy that changed engine starts with. A Codex conversation forked from a Claude
	// one must not inherit `opus`, which names nothing it can run, and must not inherit `manual`
	// either — Codex has no such mode, so the copy would be refused at its first prompt. A fork onto
	// the same agent reads none of this and keeps the source's own.
	defaultModel, defaultEffort := s.agents.DefaultsFor(onto.Name)
	target := pkgConversations.ForkTarget{
		Agent:          onto.Name,
		Label:          onto.Label,
		Branches:       s.agents.Branches(onto.Name),
		Model:          defaultModel,
		Effort:         defaultEffort,
		PermissionMode: s.forkedMode(onto.Name),
	}
	if publication != nil {
		target.AgentVersion, target.ReplaceVersion = publication, true
		target.Model, target.ProfileID = protocol.OrDefault(publication.Model, defaultModel), publication.ProfileID
		if onto.Name == agentapi.ResolvedAgent(source.Agent) {
			target.Effort = source.Effort
		}
		if s.agents.PublishesMode(onto.Name, source.PermissionMode) {
			target.PermissionMode = source.PermissionMode
		}
	}

	if onto.Name == agentapi.AgentPi {
		if !target.ReplaceVersion {
			target.ProfileID = req.ProfileID
		}
		if !target.ReplaceVersion && target.ProfileID == "" && agentapi.ResolvedAgent(source.Agent) == agentapi.AgentPi {
			target.ProfileID = source.ProfileID
		}
		model, effort := "", ""
		if target.ReplaceVersion {
			model, effort = publication.Model, target.Effort
		} else if target.ProfileID == source.ProfileID {
			model, effort = source.Model, source.Effort
		}
		resolved, err := s.agents.Profiles.ResolveProfile(target.ProfileID, model, effort)
		if err != nil {
			httpkit.WriteError(w, r, err)
			return
		}
		target.ProfileID, target.Model, target.Effort = resolved.Profile.ID, resolved.Provider+"/"+resolved.ModelID, resolved.Effort
	}
	meta, err := s.conversations.Fork(id, access.IdentityFromRequest(r).User,
		strings.TrimSpace(req.FromMessageID), target)
	if err != nil {
		httpkit.WriteError(w, r, err) // over the cap → 409, a message that is not here → 404
		return
	}
	s.broadcastConversation(meta)
	httpkit.WriteJSON(w, http.StatusCreated, s.conversationDto(meta))
}

// HandleGetConversation serves GET /hybridflow-runner/conversations/{id} — the summary plus the whole
// transcript. This is where a client's history comes from; the socket carries only the live turn.
func (s *Service) HandleGetConversation(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	meta, err := s.conversations.Get(id)
	if err != nil {
		httpkit.WriteError(w, r, err) // malformed id → 400, unknown → 404
		return
	}
	records, err := s.conversations.Messages(id)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	messages := make([]pkgConversations.AgentMessageDto, 0, len(records))
	for _, rec := range records {
		messages = append(messages, pkgConversations.MessageDto(rec))
	}
	httpkit.WriteJSON(w, http.StatusOK, pkgConversations.AgentConversationDetailDto{
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
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	if req.ProfileID != nil {
		httpkit.WriteError(w, r, faults.Invalid("change the execution profile by forking the conversation"))
		return
	}
	if req.Model != nil {
		stored, err := s.conversations.Get(r.PathValue("id"))
		if err != nil {
			httpkit.WriteError(w, r, err)
			return
		}
		if stored.AgentVersion != nil && *req.Model != stored.Model {
			httpkit.WriteError(w, r, faults.Invalid("the published agent configuration is fixed for this conversation"))
			return
		}
	}
	if req.PermissionMode != nil {
		if !runnerconfig.KnownPermissionMode(*req.PermissionMode) {
			httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "unknown permission mode: " + *req.PermissionMode})
			return
		}
		if !s.cfg.AllowsPermissionMode(*req.PermissionMode) {
			httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: turnevents.BypassDisabledMessage})
			return
		}
		// And one the conversation's own agent has. The agent cannot be patched, so reading it before
		// the update rather than inside it settles nothing that could change underneath: what is being
		// checked is precisely the field this endpoint refuses to touch.
		stored, err := s.conversations.Get(r.PathValue("id"))
		if err != nil {
			httpkit.WriteError(w, r, err) // malformed id → 400, unknown → 404
			return
		}
		if !s.agents.PublishesMode(stored.Agent, *req.PermissionMode) {
			httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest,
				Msg: agentapi.ModeUnsupportedMessage(s.agents.Label(stored.Agent), *req.PermissionMode)})
			return
		}
	}

	meta, err := s.conversations.Update(r.PathValue("id"), func(meta *pkgConversations.ConversationMeta) {
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
		httpkit.WriteError(w, r, err)
		return
	}
	s.broadcastConversation(meta)
	httpkit.WriteJSON(w, http.StatusOK, s.conversationDto(meta))
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
	if _, err := s.conversations.Get(id); err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	if s.hub != nil {
		s.hub.StopProcess(id, access.IdentityFromRequest(r).User)
	}
	if err := s.conversations.Delete(id); err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	// A board playing in it has nowhere left to play: the run is dropped rather than left pointing at
	// a conversation nothing can resume into.
	if s.chainRunner != nil {
		s.chainRunner.ConversationGone(id)
	}
	s.broadcastConversationDeleted(id)
	w.WriteHeader(http.StatusNoContent)
}

// broadcastConversation tells every open socket that a conversation changed. The switcher is a list
// a user leaves open in one tab while working in another, and polling it would be the only
// alternative — these two lines are what make a conversation created, renamed or archived anywhere
// appear everywhere.
func (s *Service) broadcastConversation(meta pkgConversations.ConversationMeta) {
	if s.hub == nil {
		return
	}
	s.hub.BroadcastRegistry(s.hub.ConversationFrame(meta))
}

func (s *Service) broadcastConversationDeleted(id string) {
	if s.hub == nil {
		return
	}
	s.hub.BroadcastRegistry(map[string]any{
		"type": "conversation_deleted", "conversationId": id,
	})
}

// conversationDto is the join: everything but Running comes off the disk, and Running is the turn
// registry's answer. The disk records that a turn was *started* so a restart can settle it; whether
// one is live right now is only ever known in memory.
func (s *Service) conversationDto(meta pkgConversations.ConversationMeta) pkgConversations.AgentConversationDto {
	return pkgConversations.ConversationDtoOf(meta, s.conversationIsRunning(meta.ID))
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

// forkedMode is the permission mode a conversation forked onto a *different* agent starts in: the
// deployment's default when that agent has it, and otherwise the first mode the agent publishes. An
// agent that publishes none on this deployment leaves it empty, and the copy is refused at its
// first prompt — which is the truth about it, said where the user can see it rather than at
// creation where it would look like the fork itself had failed.
func (s *Service) forkedMode(agent string) string {
	preferred := s.cfg.DefaultPermissionMode()
	if s.agents.PublishesMode(agent, preferred) {
		return preferred
	}
	if entry, ok := s.agents.Resolve(agent); ok {
		if options, ok := entry.Agent.(agentapi.AgentOptions); ok {
			if modes := options.Options().PermissionModes; len(modes) > 0 {
				return modes[0].Value
			}
		}
	}
	return ""
}
