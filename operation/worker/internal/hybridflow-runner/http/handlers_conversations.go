package runnerhttp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/errors"
	"kiao/worker/internal/core/http"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"kiao/worker/internal/hybridflow-runner/harnesses/protocol"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"net/http"
	"path/filepath"
	"strings"
)

// HandleListConversations serves GET /hybridflow-runner/conversations. Archived conversations are left out
// unless ?archived=true asks for them: archiving is how a conversation leaves the switcher without
// being lost, so including them by default would defeat it.
func (s *Service) HandleListConversations(w http.ResponseWriter, r *http.Request) {
	metas := s.conversations.List(r.URL.Query().Get("archived") == "true")
	dtos := make([]pkgConversations.HarnessConversationDto, 0, len(metas))
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
	folder, err := s.cfg.ResolveFolder(req.Folder)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	var agent *pkgBoards.ManagedAgentVersion
	var draft *pkgBoards.DraftAgentPackage
	if req.UseDraft {
		draft, err = s.draftAgentPackage(r.Context(), req.AgentID)
		if err == nil {
			agent = &draft.Agent
		}
	} else {
		agent, err = s.agentPublication(req.AgentID)
	}
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	agent, err = agent.SelectHarness(req.Harness, req.ProfileID)
	if err != nil {
		httpkit.WriteError(w, r, faults.Invalid(err.Error()))
		return
	}
	settings, err := s.executionSettings(agent, strings.TrimSpace(req.Model), req.Effort)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	mode, err := s.conversationPermissionMode(agent.Harness, req.PermissionMode)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	if draft != nil {
		if err := pkgBoards.InstallDraftAgentPackage(s.cfg.StatePath, s.cfg.NodeBinary, "http://127.0.0.1:"+s.cfg.Port, draft); err != nil {
			httpkit.WriteError(w, r, err)
			return
		}
	}

	meta, err := s.conversations.Create(pkgConversations.ConversationMeta{
		AgentVersion: pkgBoards.ConfiguredAgentVersion(agent, settings.Model, settings.ProfileID, settings.Effort),
		Title:        req.Title,
		// A title the client supplied is the user's, so the first prompt must not overwrite it.
		TitleSetByUser: strings.TrimSpace(req.Title) != "",
		Folder:         folder.Virtual,
		Harness:        agent.Harness,
		ProfileID:      settings.ProfileID,
		Owner:          access.IdentityFromRequest(r).User,
		Model:          settings.Model,
		Effort:         settings.Effort,
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
	var req pkgConversations.HarnessForkRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	if s.conversationIsRunning(id) {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusConflict,
			Msg: "A turn is running in this conversation. Fork it once the turn has finished."})
		return
	}
	if _, err := s.cfg.ResolveFolder(source.Folder); err != nil {
		httpkit.WriteError(w, r, err) // outside the root → 400, gone → 404
		return
	}

	agentID := strings.TrimSpace(req.AgentID)
	if agentID == "" && source.AgentVersion != nil {
		agentID = source.AgentVersion.AgentID
	}
	agent, err := s.agentPublication(agentID)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}

	harness, profileID := req.Harness, req.ProfileID
	if harness == "" && len(agent.Harnesses) != 0 && source.AgentVersion != nil &&
		source.AgentVersion.AgentID == agentID && agent.SupportsHarness(source.Harness) {
		harness = source.Harness
		if profileID == "" {
			profileID = source.ProfileID
		}
	}
	agent, err = agent.SelectHarness(harness, profileID)
	if err != nil {
		httpkit.WriteError(w, r, faults.Invalid(err.Error()))
		return
	}
	model, effort := strings.TrimSpace(req.Model), ""
	if prior := source.AgentVersion; prior != nil && prior.AgentID == agent.AgentID &&
		prior.Harness == agent.Harness && (prior.ProfileID == agent.ProfileID || source.ProfileID == agent.ProfileID) {
		if (model == "" && prior.Model == agent.Model) || (model != "" && model == prior.ConversationModel(source.Model)) {
			effort = source.Effort
		}
	}
	settings, err := s.executionSettings(agent, model, effort)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	mode := source.PermissionMode
	if source.Harness != agent.Harness || s.validatePermission(agent.Harness, mode) != nil {
		mode, err = s.conversationPermissionMode(agent.Harness, "")
		if err != nil {
			httpkit.WriteError(w, r, err)
			return
		}
	}
	target := pkgConversations.ForkTarget{
		AgentVersion:   agent,
		ReplaceVersion: true,
		Harness:        agent.Harness,
		Label:          s.harnesses.Label(agent.Harness),
		Branches:       s.harnesses.Branches(agent.Harness),
		ProfileID:      settings.ProfileID,
		Model:          settings.Model,
		Effort:         settings.Effort,
		PermissionMode: mode,
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

// HandleGetConversation serves the summary, transcript and on-disk locations.
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
	messages := make([]pkgConversations.HarnessMessageDto, 0, len(records))
	for _, rec := range records {
		messages = append(messages, pkgConversations.MessageDto(rec))
	}
	locations := s.conversations.Locations(id)
	if folder, err := s.cfg.ResolveFolder(meta.Folder); err == nil {
		locations.WorkingDirectory, _ = filepath.Abs(folder.Abs)
	}
	if s.attachments != nil {
		locations.AttachmentsDirectory = s.attachments.Dir
	}
	httpkit.WriteJSON(w, http.StatusOK, pkgConversations.HarnessConversationDetailDto{
		HarnessConversationDto: s.conversationDto(meta),
		Locations:              locations,
		Messages:               messages,
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
	if req.Model != nil || req.ProfileID != nil {
		httpkit.WriteError(w, r, faults.Invalid("choose a published agent to change the model or execution profile"))
		return
	}
	if req.PermissionMode != nil {
		stored, err := s.conversations.Get(r.PathValue("id"))
		if err == nil {
			err = s.validatePermission(stored.Harness, *req.PermissionMode)
		}
		if err != nil {
			httpkit.WriteError(w, r, err)
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
func (s *Service) conversationDto(meta pkgConversations.ConversationMeta) pkgConversations.HarnessConversationDto {
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

func (s *Service) agentPublication(id string) (*pkgBoards.ManagedAgentVersion, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, faults.Invalid("select a published agent for this conversation")
	}
	if s.agents == nil {
		return nil, &httpkit.HTTPError{Status: http.StatusServiceUnavailable, Msg: "no agent catalogue is configured"}
	}
	definition, err := s.agents.Agent(id)
	if errors.Is(err, pkgBoards.ErrAgentUnknown) {
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no agent with id " + id}
	}
	if err != nil {
		return nil, err
	}
	agent, err := definition.ActivePublication()
	if err != nil {
		return nil, faults.Invalid(err.Error())
	}
	if s.cfg.RequireAgentPackages && agent.Commit == "" {
		return nil, faults.Invalid("publish this agent as an APM package before using it")
	}
	return agent, nil
}

func (s *Service) draftAgentPackage(ctx context.Context, id string) (*pkgBoards.DraftAgentPackage, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, faults.Invalid("select a local agent for this conversation")
	}
	catalogue, ok := s.agents.(*pkgBoards.HybridflowStore)
	if !ok {
		return nil, &httpkit.HTTPError{Status: http.StatusServiceUnavailable, Msg: "no agent resource manager is configured"}
	}
	return catalogue.DraftAgentPackage(ctx, id)
}

func (s *Service) executionSettings(agent *pkgBoards.ManagedAgentVersion, model, effort string) (harnessapi.ExecutionSettings, error) {
	entry, available := s.harnesses.Resolve(agent.Harness)
	if agent.Harness == "" || !available {
		return harnessapi.ExecutionSettings{}, faults.Invalid("the agent “" + agent.Name + "” requires the unavailable harness " + agent.Harness)
	}
	agentEffort := agent.Effort
	if model != "" && entry.Name != harnessapi.HarnessPi {
		var models []harnessapi.HarnessOption
		if source, ok := entry.Harness.(harnessapi.HarnessOptions); ok {
			models = source.Options().Models
		}
		choice, ok := harnessapi.FindHarnessOption(models, model)
		if !ok {
			return harnessapi.ExecutionSettings{}, faults.Invalid("choose a model from the " + entry.Label + " catalogue")
		}
		if len(choice.Efforts) > 0 && !harnessapi.HasHarnessOption(choice.Efforts, agentEffort) {
			agentEffort = ""
		}
	}
	settings, err := s.harnesses.ResolveExecutionSettings(agent.Harness, harnessapi.ExecutionSettings{
		ProfileID: agent.ProfileID, Model: protocol.OrDefault(model, agent.Model), Effort: protocol.OrDefault(effort, agentEffort),
		CaptureDefaults: len(agent.Harnesses) != 0,
	})
	if err != nil && agent.Harness != harnessapi.HarnessPi {
		return settings, faults.Invalid(err.Error())
	}
	return settings, err
}

func (s *Service) validatePermission(harness, mode string) error {
	if !runnerconfig.KnownPermissionMode(mode) {
		return faults.Invalid("unknown permission mode: " + mode)
	}
	if !s.cfg.AllowsPermissionMode(mode) {
		return faults.Invalid(turnevents.BypassDisabledMessage)
	}
	if !s.harnesses.PublishesMode(harness, mode) {
		return faults.Invalid(harnessapi.ModeUnsupportedMessage(s.harnesses.Label(harness), mode))
	}
	return nil
}

func (s *Service) conversationPermissionMode(harness, requested string) (string, error) {
	if requested != "" {
		return requested, s.validatePermission(harness, requested)
	}
	for _, mode := range []string{runnerconfig.PermissionModeBypass, runnerconfig.PermissionModeManualLive, runnerconfig.PermissionModeManual} {
		if s.cfg.AllowsPermissionMode(mode) && s.harnesses.PublishesMode(harness, mode) {
			return mode, nil
		}
	}
	return "", faults.Invalid(s.harnesses.Label(harness) + " has no available permission modes.")
}
