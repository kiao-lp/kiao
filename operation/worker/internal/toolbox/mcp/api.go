package mcp

import (
	"fmt"
	"kiao/worker/internal/core/equipment"
	"kiao/worker/internal/core/filesystem"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	"os"
	"os/exec"
	"strings"
)

// MCPServers is the whole of what this library offers the rest of the service: the servers a turn
// should be handed, right now. It is read at every turn rather than once at startup, which is what
// makes an install take effect on the next prompt instead of at the next restart.
//
// A server that is switched on but whose files have gone — a prefix deleted by hand, a bundle that
// was never staged — is left out rather than named: a turn spawned against a command that does not
// exist gets a server that fails to start, on the CLI's own stderr, which is not where anyone looks.
func (s *Registry) MCPServers() []equipment.MCPServer {
	servers, _ := s.MCPBindings()
	return servers
}

func (s *Registry) MCPBindings() ([]equipment.MCPServer, []equipment.MCPDiagnostic) {
	var servers []equipment.MCPServer
	var diagnostics []equipment.MCPDiagnostic
	for _, id := range s.ledger.EnabledServers() {
		comp, ok := s.catalog.Get(id)
		if !ok || comp.Kind != toolcatalog.KindMCP {
			continue
		}
		server, err := s.resolveServer(comp)
		if err != nil {
			diagnostics = append(diagnostics, equipment.MCPDiagnostic{Server: comp.Server, Stage: "runtime", Message: err.Error()})
			continue
		}
		servers = append(servers, server)
	}
	return servers, diagnostics
}

func (s *Registry) ServerFor(comp toolcatalog.Component) (equipment.MCPServer, bool) {
	server, err := s.resolveServer(comp)
	return server, err == nil
}

func (s *Registry) resolveServer(comp toolcatalog.Component) (equipment.MCPServer, error) {
	recipe, ok := comp.RecipeFor(s.cfg.Platform())
	if !ok {
		return equipment.MCPServer{}, fmt.Errorf("no installation recipe for this runner")
	}

	switch recipe.Channel {
	case toolcatalog.ChannelBundled:
		server, ok := s.bundled[recipe.Package]
		if !ok {
			return equipment.MCPServer{}, fmt.Errorf("MCP bundle does not provide %s", recipe.Package)
		}
		if len(server.Args) > 0 && !filesystem.FileExists(server.Args[0]) {
			return equipment.MCPServer{}, fmt.Errorf("MCP bundle is missing %s", server.Args[0])
		}
		command, err := exec.LookPath(server.Command)
		if err != nil {
			return equipment.MCPServer{}, fmt.Errorf("command %q is unavailable on the runner: %w", server.Command, err)
		}
		server.Name = comp.Server
		server.Command = command
		return server, nil

	case toolcatalog.ChannelRemote:
		token, ok := FirstSetEnv(comp.RequiresEnv)
		if len(comp.RequiresEnv) > 0 && !ok {
			return equipment.MCPServer{}, fmt.Errorf("set one of %s on the runner", strings.Join(comp.RequiresEnv, ", "))
		}
		server := equipment.MCPServer{
			Name: comp.Server,
			Type: equipment.MCPHTTP,
			URL:  recipe.URL,
		}
		if ok {
			// `${VAR}` rather than the value: the CLI expands it from its own environment, so the
			// credential is never written to the file and never appears in `ps` — the same trick
			// the per-turn kiao-mcp token already uses.
			server.Headers = map[string]string{"Authorization": "Bearer ${" + token + "}"}
		}
		return server, nil

	default:
		entry, ok := s.ledger.Get(comp.ID)
		if !ok || !entry.Installed || entry.Command == "" {
			return equipment.MCPServer{}, fmt.Errorf("install %s on the runner", comp.ID)
		}
		if !filesystem.FileExists(entry.Command) {
			return equipment.MCPServer{}, fmt.Errorf("command is missing: %s", entry.Command)
		}
		server := equipment.MCPServer{
			Name:    comp.Server,
			Type:    equipment.MCPStdio,
			Command: entry.Command,
			Args:    append(append([]string{}, entry.Args...), comp.ServerArgs...),
		}
		if len(comp.ServerEnv) > 0 {
			server.Env = map[string]string{}
			for k, v := range comp.ServerEnv {
				// Resolved here rather than written into the catalogue, because where the prefix is
				// belongs to the deployment: the same entry serves a server, a container and a laptop.
				server.Env[k] = s.cfg.ExpandTokens(v)
			}
		}
		return server, nil
	}
}

// RuntimeBinary answers where a catalogue runtime's executable is, by its catalogue id — the
// toolbox's copy first, the machine's after, exactly as a dependency check resolves it.
//
// It exists for the runtime the service spawns itself: `ffmpeg`, asked at every save of a video's
// segments. Asked each time rather than once at startup, which is the point: installing it from
// this panel has to make the click that needed it work on the next try and not at the next
// restart. Nothing about cutting is known here, and nothing about installing is known there; this
// is the whole of what passes between them.
func (s *Registry) RuntimeBinary(id string) (string, bool) {
	comp, ok := s.catalog.Get(id)
	if !ok || comp.Kind != toolcatalog.KindRuntime {
		return "", false
	}
	recipe, ok := comp.RecipeFor(s.cfg.Platform())
	if !ok || recipe.Bin == "" {
		return "", false
	}
	return locate(s.cfg, recipe.Bin)
}

// HarnessOffered answers whether a harness should be offered in the harness tab, by the name the
// hybridflow runner knows it by. It is the counterpart of MCPServers and is read the same way —
// at every ask rather than once at startup — so that switching a harness off is a click rather than
// an env file and a restart.
//
// **Offered is the answer to everything this does not know about.** A harness with no row in the
// catalogue, and a row nobody has ever touched, are both yes: the panel speaks only where somebody
// has actually said something, and whether the CLI is on the machine at all is the other half's
// question. Only an explicit switch-off says no.
func (s *Registry) HarnessOffered(name string) bool {
	comp, ok := s.catalog.ForHarness(name)
	if !ok {
		return true
	}
	entry, recorded := s.ledger.Get(comp.ID)
	return !recorded || entry.Enabled
}

// firstSetEnv answers the first of names that is set and non-empty. The list is an any-of: GitHub
// is reached with either of the two variable names its own tooling uses, and a deployment that set
// one has said everything it needs to.
func FirstSetEnv(names []string) (string, bool) {
	for _, name := range names {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return name, true
		}
	}
	return "", false
}
