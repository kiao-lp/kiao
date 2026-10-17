package hybridflowrunner

import (
	"fmt"
	"path/filepath"
	"sync"

	"kiao/worker/internal/core"
)

// MCPRegistry is queried on each prompt so toolbox changes take effect without restart.
// Nil means no MCP config and all agents with an available binary.
type MCPRegistry interface {
	MCPServers() []core.MCPServer
	AgentGate
}

type Service struct {
	cfg           *Config
	hub           *ClaudeHub
	conversations *ConversationStore
	attachments   *AttachmentStore
	chainRunner   *ChainRunner

	// Shared with the hub so conversation binding and turn spawning agree on available agents.
	agents *agentRegistry

	// Access only under heartbeatMu: stopping twice would close the same channel twice.
	stopHeartbeat func()
	heartbeatMu   sync.Mutex

	// Sign-in uses the default agent only; nil leaves its routes unmounted.
	login AgentLogin

	// Nil when no bundled MCP server can call back into the service.
	turnTokens *core.TurnTokenRegistry

	// Separate from the runner's spooled client: proxy requests need live store answers.
	boardsUpstream *hybridflowStore

	// An unwired service reports conversations idle.
	liveness func(conversationID string) bool
}

// Start returns a mountable service; errors are fatal to startup.
// Without a hybridflow-store, conversations work but Play and the boards proxy return 503.
func Start(cfg *Config, registry MCPRegistry) (*Service, error) {
	// Clear stale running metadata left by a killed predecessor before serving requests.
	conversations, err := newConversationStore(filepath.Join(cfg.StatePath, ConversationsDirName))
	if err != nil {
		return nil, fmt.Errorf("conversation store failure: %w", err)
	}
	if settled := conversations.sweepInterrupted(); settled > 0 {
		core.LogMain.Warn("settled conversations interrupted by a restart", "count", settled)
	}

	// Attachments are turn material, outside the content store. Sweep only at startup,
	// when no turn can be reading them.
	attachments, err := newAttachmentStore(filepath.Join(cfg.StatePath, attachmentsDirName))
	if err != nil {
		return nil, fmt.Errorf("attachment store failure: %w", err)
	}
	if swept := attachments.sweep(attachmentTTL); swept > 0 {
		core.LogMain.Info("swept expired Claude attachments", "count", swept)
	}

	// Skill installation failures are nonfatal.
	syncSkills(cfg)

	// Generated configs are disposable; old files may name a stale node binary or port.
	sweepMCPConfigs(cfg)

	// Re-read after validation; a failure is still fatal to avoid spawning without tools.
	bundled, err := BundledMCPServers(cfg)
	if err != nil {
		return nil, fmt.Errorf("MCP configuration failure: %w", err)
	}

	hub := newClaudeHub(cfg, conversations)
	hub.registry = registry
	if registry != nil {
		hub.agents.gate = registry
	}
	hub.bundledNames = map[string]bool{}
	for _, server := range bundled {
		hub.bundledNames[server.Name] = true
	}
	hub.attachments = attachments

	boards, where := newBoardStore(cfg)
	core.LogMain.Info("boards are kept in", "store", where)
	// Without a store, only legacy cards can play; managed agents cannot be resolved.
	var resolve agentResolver
	if svc, ok := boards.(agentResolver); ok {
		resolve = svc
	}
	var runners runnerResolver
	if svc, ok := boards.(runnerResolver); ok {
		runners = svc
	}
	chainRunner := newChainRunner(cfg, hub, conversations, boards, resolve, runners)
	hub.chainRunner = chainRunner

	var boardsUpstream *hybridflowStore
	if cfg.HybridflowURL != "" {
		boardsUpstream = newHybridflowStore(cfg.HybridflowURL, cfg.HybridflowToken)
	}

	svc := &Service{
		cfg:            cfg,
		hub:            hub,
		conversations:  conversations,
		attachments:    attachments,
		chainRunner:    chainRunner,
		liveness:       hub.isRunning,
		boardsUpstream: boardsUpstream,
		stopHeartbeat:  startRunnerHeartbeat(cfg, boardsUpstream),
	}
	svc.bindAgents(hub.agents)
	// Only bundled MCP servers receive callback credentials; third-party servers receive none.
	if len(bundled) > 0 {
		svc.turnTokens = hub.turnTokens
	}
	return svc, nil
}

// bindAgents uses the first entry, even if its CLI is absent, so sign-in routes
// exist before a CLI is installed.
func (s *Service) bindAgents(agents *agentRegistry) {
	s.agents = agents
	var def Agent
	if len(agents.entries) > 0 {
		def = agents.entries[0].agent
	}
	s.login, _ = def.(AgentLogin)
}

// offersOptions enables mounting if any agent supports options; unsupported
// agents still appear in its response with empty lists.
func (s *Service) offersOptions() bool {
	if s.agents == nil {
		return false
	}
	for _, entry := range s.agents.entries {
		if _, ok := entry.agent.(AgentOptions); ok {
			return true
		}
	}
	return false
}

// SyncEquipment reinstalls skills after CLI installation or plugin-list changes.
// Idempotent, nonfatal and serialized by skillSync across request goroutines.
func (s *Service) SyncEquipment() { syncSkills(s.cfg) }

// SyncRunnerIdentity reloads runner.json and restarts the heartbeat after a save.
// An environment ID wins for the process lifetime; read errors keep the live identity.
func (s *Service) SyncRunnerIdentity() {
	if s.cfg == nil || s.cfg.Config == nil || s.cfg.runnerFromEnv {
		return
	}
	id, err := RunnerIDFromState(s.cfg.StatePath)
	if err != nil {
		core.LogMain.Error("runner identity not re-read; keeping the old one", "error", err)
		return
	}
	s.heartbeatMu.Lock()
	defer s.heartbeatMu.Unlock()
	if s.stopHeartbeat != nil {
		s.stopHeartbeat()
		s.stopHeartbeat = nil
	}
	s.cfg.adoptRunnerID(id)
	s.stopHeartbeat = startRunnerHeartbeat(s.cfg, s.boardsUpstream)
}

// TurnTokens supplies callback credentials to the authenticator, or nil without
// bundled servers. Only the program may wire this alternative to JWT authentication.
func (s *Service) TurnTokens() *core.TurnTokenRegistry { return s.turnTokens }

// Shutdown stops the heartbeat, CLI processes and board sender. Unsent board
// updates stay spooled for the next process.
func (s *Service) Shutdown() {
	s.heartbeatMu.Lock()
	if s.stopHeartbeat != nil {
		s.stopHeartbeat()
		s.stopHeartbeat = nil
	}
	s.heartbeatMu.Unlock()
	s.hub.shutdown()
	if s.login != nil {
		s.login.LoginShutdown()
	}
	if s.agents != nil {
		for _, entry := range s.agents.entries {
			if device, ok := entry.agent.(AgentDeviceLogin); ok {
				device.DeviceLoginShutdown()
			}
		}
	}
	if s.chainRunner != nil {
		s.chainRunner.closeBoards()
	}
}
