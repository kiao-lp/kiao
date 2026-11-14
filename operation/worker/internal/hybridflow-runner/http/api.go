package runnerhttp

import (
	"fmt"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/equipment"
	"kiao/worker/internal/core/logging"
	"kiao/worker/internal/hybridflow-runner/assembly"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	claudecli "kiao/worker/internal/hybridflow-runner/harnesses/claude"
	"kiao/worker/internal/hybridflow-runner/playback"
	"kiao/worker/internal/hybridflow-runner/skills"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	"path/filepath"
	pkgSync "sync"
)

type Service struct {
	cfg           *runnerconfig.Config
	hub           *pkgTurns.Engine
	conversations *pkgConversations.ConversationStore
	attachments   *pkgConversations.AttachmentStore
	chainRunner   *playback.ChainRunner

	// Shared with the hub so conversation binding and turn spawning agree on available harnesses.
	harnesses *harnessapi.HarnessRegistry

	// Access only under heartbeatMu: stopping twice would close the same channel twice.
	stopHeartbeat func()
	heartbeatMu   pkgSync.Mutex

	// Sign-in uses the default harness only; nil leaves its routes unmounted.
	login harnessapi.HarnessLogin

	// Nil when no bundled MCP server can call back into the service.
	turnTokens *access.TurnTokenRegistry

	// Separate from the runner's spooled client: proxy requests need live store answers.
	boardsUpstream *pkgBoards.HybridflowStore

	// An unwired service reports conversations idle.
	liveness func(conversationID string) bool
}

// Start returns a mountable service; errors are fatal to startup.
// Without a hybridflow-store, conversations work but Play and the boards proxy return 503.
func Start(cfg *runnerconfig.Config, registry harnessapi.MCPRegistry) (*Service, error) {
	if err := assembly.AdoptHarnessState(cfg.StatePath); err != nil {
		return nil, err
	}
	if installations, ok := registry.(interface {
		HarnessInstallations() []equipment.HarnessInstallation
	}); ok {
		cfg.PiInstallations = installations.HarnessInstallations
	}
	// Clear stale running metadata left by a killed predecessor before serving requests.
	conversations, err := pkgConversations.NewConversationStore(filepath.Join(cfg.StatePath, pkgConversations.ConversationsDirName))
	if err != nil {
		return nil, fmt.Errorf("conversation store failure: %w", err)
	}
	if settled := conversations.SweepInterrupted(); settled > 0 {
		logging.LogMain.Warn("settled conversations interrupted by a restart", "count", settled)
	}

	// Attachments are turn material, outside the document store. Sweep only at startup,
	// when no turn can be reading them.
	attachments, err := pkgConversations.NewAttachmentStore(filepath.Join(cfg.StatePath, pkgConversations.AttachmentsDirName))
	if err != nil {
		return nil, fmt.Errorf("attachment store failure: %w", err)
	}
	if swept := attachments.Sweep(pkgConversations.AttachmentTTL); swept > 0 {
		logging.LogMain.Info("swept expired Claude attachments", "count", swept)
	}

	// Skill installation failures are nonfatal.
	skills.SyncSkills(cfg)

	// Generated configs are disposable; old files may name a stale node binary or port.
	claudecli.SweepMCPConfigs(cfg)

	// Re-read after validation; a failure is still fatal to avoid spawning without tools.
	bundled, err := runnerconfig.BundledMCPServers(cfg)
	if err != nil {
		return nil, fmt.Errorf("MCP configuration failure: %w", err)
	}

	hub := assembly.NewEngine(cfg, conversations)
	hub.Registry = registry
	if registry != nil {
		hub.Harnesses.Gate = registry
	}
	hub.BundledNames = map[string]bool{}
	for _, server := range bundled {
		hub.BundledNames[server.Name] = true
	}
	hub.Attachments = attachments
	if removals, ok := registry.(interface{ OnHarnessInstallationRemoval(func(string) []string) }); ok {
		removals.OnHarnessInstallationRemoval(func(installationID string) []string {
			var refs []string
			doc, err := hub.Harnesses.Profiles.ReadProfiles()
			if err != nil {
				return []string{"unreadable execution profiles"}
			}
			for _, profile := range doc.Profiles {
				if profile.InstallationID == installationID {
					refs = append(refs, profile.Name)
				}
			}
			hub.Mu.Lock()
			defer hub.Mu.Unlock()
			for _, job := range hub.Jobs {
				job.Mu.Lock()
				if job.ProcessPending && job.InstallationID == installationID {
					refs = append(refs, "running conversation "+job.ConversationID)
				}
				job.Mu.Unlock()
			}
			return refs
		})
	}

	boards, where := pkgBoards.NewBoardStore(cfg)
	logging.LogMain.Info("boards are kept in", "store", where)
	// Without a store, only legacy cards can play; managed harnesses cannot be resolved.
	var resolve pkgBoards.AgentResolver
	if svc, ok := boards.(pkgBoards.AgentResolver); ok {
		resolve = svc
	}
	var runners pkgBoards.RunnerResolver
	if svc, ok := boards.(pkgBoards.RunnerResolver); ok {
		runners = svc
	}
	chainRunner := playback.NewChainRunner(cfg, hub, conversations, boards, resolve, runners)
	hub.ChainRunner = chainRunner

	var boardsUpstream *pkgBoards.HybridflowStore
	if cfg.HybridflowURL != "" {
		boardsUpstream = pkgBoards.NewHybridflowStore(cfg.HybridflowURL, cfg.HybridflowToken)
	}

	svc := &Service{
		cfg:            cfg,
		hub:            hub,
		conversations:  conversations,
		attachments:    attachments,
		chainRunner:    chainRunner,
		liveness:       hub.IsRunning,
		boardsUpstream: boardsUpstream,
		stopHeartbeat:  pkgBoards.StartRunnerHeartbeat(cfg, boardsUpstream),
	}
	svc.bindHarnesses(hub.Harnesses)
	// Only bundled MCP servers receive callback credentials; third-party servers receive none.
	if len(bundled) > 0 {
		svc.turnTokens = hub.TurnTokens
	}
	return svc, nil
}

// bindHarnesses uses the first entry, even if its CLI is absent, so sign-in routes
// exist before a CLI is installed.
func (s *Service) bindHarnesses(harnesses *harnessapi.HarnessRegistry) {
	s.harnesses = harnesses
	var def harnessapi.Harness
	if len(harnesses.Entries) > 0 {
		def = harnesses.Entries[0].Harness
	}
	s.login, _ = def.(harnessapi.HarnessLogin)
}

// offersOptions enables mounting if any harness supports options; unsupported
// harnesses still appear in its response with empty lists.
func (s *Service) offersOptions() bool {
	if s.harnesses == nil {
		return false
	}
	for _, entry := range s.harnesses.Entries {
		if _, ok := entry.Harness.(harnessapi.HarnessOptions); ok {
			return true
		}
	}
	return false
}

func (s *Service) offersAuth() bool {
	if s.harnesses != nil {
		for _, entry := range s.harnesses.Entries {
			if _, ok := entry.Harness.(harnessapi.HarnessAuth); ok {
				return true
			}
		}
	}
	return false
}

// SyncEquipment reinstalls skills after CLI installation or plugin-list changes.
// Idempotent, nonfatal and serialized by skillSync across request goroutines.
func (s *Service) SyncEquipment() { skills.SyncSkills(s.cfg) }

// SyncRunnerIdentity reloads runner.json and restarts the heartbeat after a save.
// An environment ID wins for the process lifetime; read errors keep the live identity.
func (s *Service) SyncRunnerIdentity() {
	if s.cfg == nil || s.cfg.Config == nil || s.cfg.RunnerFromEnv {
		return
	}
	id, err := runnerconfig.RunnerIDFromState(s.cfg.StatePath)
	if err != nil {
		logging.LogMain.Error("runner identity not re-read; keeping the old one", "error", err)
		return
	}
	s.heartbeatMu.Lock()
	defer s.heartbeatMu.Unlock()
	if s.stopHeartbeat != nil {
		s.stopHeartbeat()
		s.stopHeartbeat = nil
	}
	s.cfg.AdoptRunnerID(id)
	s.stopHeartbeat = pkgBoards.StartRunnerHeartbeat(s.cfg, s.boardsUpstream)
}

// TurnTokens supplies callback credentials to the authenticator, or nil without
// bundled servers. Only the program may wire this alternative to JWT authentication.
func (s *Service) TurnTokens() *access.TurnTokenRegistry { return s.turnTokens }

// Shutdown stops the heartbeat, CLI processes and board sender. Unsent board
// updates stay spooled for the next process.
func (s *Service) Shutdown() {
	s.heartbeatMu.Lock()
	if s.stopHeartbeat != nil {
		s.stopHeartbeat()
		s.stopHeartbeat = nil
	}
	s.heartbeatMu.Unlock()
	s.hub.Shutdown()
	if s.login != nil {
		s.login.LoginShutdown()
	}
	if s.harnesses != nil {
		for _, entry := range s.harnesses.Entries {
			if device, ok := entry.Harness.(harnessapi.HarnessDeviceLogin); ok {
				device.DeviceLoginShutdown()
			}
		}
	}
	if s.chainRunner != nil {
		s.chainRunner.CloseBoards()
	}
}
