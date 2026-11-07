package pi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"kiao/worker/internal/core/equipment"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// models queries Pi itself; the allowlist limits what a profile exposes. No hard-coded
// reasoning catalogue or assumption that a provider's models all accept the same inputs.
func (s *PiProfiles) models(id string, fresh bool) ([]agentapi.PiModelOffer, error) {
	profile, in, err := s.profile(id)
	if err != nil {
		return nil, err
	}
	return s.modelsFor(profile, in, fresh)
}

func (s *PiProfiles) modelsFor(profile agentapi.PiProfile, in equipment.AgentInstallation, fresh bool) ([]agentapi.PiModelOffer, error) {
	fingerprint, _ := json.Marshal(struct {
		Profile agentapi.PiProfile
		Path    string
		Version string
	}{profile, in.Path, in.Version})
	digest := sha256.Sum256(fingerprint)
	key := hex.EncodeToString(digest[:])
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if !fresh {
		if models, ok := s.Cache[key]; ok {
			return models, nil
		}
	}
	resolved := &agentapi.PiResolvedProfile{Profile: profile, Installation: in, Keys: map[string]string{}}
	for _, c := range profile.Connections {
		if c.SecretRef == "" {
			resolved.Keys[c.Provider] = "pi-local"
		} else if value, ok := s.secret(c.SecretRef); ok {
			resolved.Keys[c.Provider] = value
		} else if len(c.Models) > 0 {
			return nil, fmt.Errorf("API key %s for %s is missing. Store the key or select another reference before checking models", c.SecretRef, c.Provider)
		}
	}
	dir, env, secrets, err := materializePi(resolved, filepath.Join(s.cfg.StatePath, "pi-runs"), "")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	// Verify external declarations too: neither PATH order nor a replaced executable selects a version.
	if err := verifyPiVersion(in, piEnvironment(env)); err != nil {
		return nil, err
	}
	rpc, err := startPiRPC(in.Path, piArgs(dir, filepath.Join(dir, "sessions"), ""), piEnvironment(env), s.cfg.RootPath, nil, secrets)
	if err != nil {
		return nil, errors.New("Pi installation could not start RPC")
	}
	// A catalogue query cannot prompt, but still drain extension notifications.
	go func() {
		for range rpc.events {
		}
	}()
	defer rpc.close()
	data, err := rpc.call("get_available_models", nil, piCommandTimeout)
	if err != nil {
		return nil, err
	}
	var available []struct {
		Provider string   `json:"provider"`
		ID       string   `json:"id"`
		Name     string   `json:"name"`
		Input    []string `json:"input"`
	}
	if err := json.Unmarshal(data["models"], &available); err != nil {
		return nil, errors.New("Pi returned an invalid model catalogue")
	}
	models := []agentapi.PiModelOffer{}
	for _, c := range profile.Connections {
		for _, wanted := range c.Models {
			var match *struct {
				Provider string   `json:"provider"`
				ID       string   `json:"id"`
				Name     string   `json:"name"`
				Input    []string `json:"input"`
			}
			for i := range available {
				if available[i].Provider == c.Provider && available[i].ID == wanted.ID {
					match = &available[i]
					break
				}
			}
			if match == nil {
				return nil, fmt.Errorf("Pi model %s/%s is unavailable; check this connection's configuration", c.Provider, wanted.ID)
			}
			if _, err := rpc.call("set_model", map[string]any{"provider": c.Provider, "modelId": wanted.ID}, piCommandTimeout); err != nil {
				return nil, err
			}
			levels, err := rpc.call("get_available_thinking_levels", nil, piCommandTimeout)
			if err != nil {
				return nil, err
			}
			var choices []string
			_ = json.Unmarshal(levels["levels"], &choices)
			efforts := make([]agentapi.AgentOption, 0, len(choices))
			for _, choice := range choices {
				efforts = append(efforts, agentapi.AgentOption{Value: choice, Label: agentapi.EffortLabel(choice)})
			}
			models = append(models, agentapi.PiModelOffer{AgentOption: agentapi.AgentOption{Value: c.Provider + "/" + wanted.ID, Label: protocol.OrDefault(match.Name, wanted.ID) + " · " + c.Provider}, Provider: c.Provider, ModelID: wanted.ID, Efforts: efforts, Capabilities: agentapi.AgentCapabilities{Steer: true, FollowUp: true, Compact: true, Branch: true, ForkAtMessage: true, ImageInput: slices.Contains(match.Input, "image")}})
		}
	}
	s.Cache[key] = models
	return models, nil
}

// A connection diagnostic makes one bounded model request; it is explicit in the panel.
type PiConnectionDiagnostic struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

func (diagnostic *PiConnectionDiagnostic) Error() string {
	if diagnostic.Details == "" {
		return diagnostic.Message
	}
	return diagnostic.Message + "\n" + diagnostic.Details
}

func (s *PiProfiles) checkConnection(id, model string) error {
	resolved, err := s.resolve(id, model, "")
	if err != nil {
		return &PiConnectionDiagnostic{Status: "configuration_error", Message: "The Pi profile needs attention before its API connection can be tested.", Details: err.Error()}
	}
	// The test uses a private copy; it never changes the profile's normal output limit.
	resolved.Profile.Connections = append([]agentapi.PiConnection{}, resolved.Profile.Connections...)
	for index, connection := range resolved.Profile.Connections {
		connection.Models = append([]agentapi.PiModel{}, connection.Models...)
		for at, model := range connection.Models {
			if model.MaxTokens == 0 || model.MaxTokens > 256 {
				connection.Models[at].MaxTokens = 256
			}
		}
		resolved.Profile.Connections[index] = connection
	}
	dir, env, secrets, err := materializePi(resolved, filepath.Join(s.cfg.StatePath, "pi-runs"), "")
	if err != nil {
		return &PiConnectionDiagnostic{Status: "runtime_error", Message: "The worker could not prepare the Pi connection test. API access was not tested.", Details: err.Error()}
	}
	defer os.RemoveAll(dir)
	rpc, err := startPiRPC(resolved.Installation.Path, append(piArgs(dir, filepath.Join(dir, "sessions"), ""), "--no-tools"), piEnvironment(env), s.cfg.RootPath, nil, secrets)
	if err != nil {
		return &PiConnectionDiagnostic{Status: "runtime_error", Message: "Pi could not start. API access was not tested.", Details: err.Error()}
	}
	defer rpc.close()
	runtimeFailure := func(message string, cause error) error {
		var rejected *piCommandRejected
		if errors.As(cause, &rejected) {
			return &PiConnectionDiagnostic{Status: "configuration_error", Message: "Pi rejected the test setup. Check the profile's model and settings. API access was not tested.", Details: rpc.scrub(rejected.Error())}
		}
		details := ""
		if cause != nil {
			details = rpc.scrub(cause.Error()) + "\n"
		}
		return &PiConnectionDiagnostic{Status: "runtime_error", Message: message + " API access could not be verified.", Details: details + rpc.exitDetails()}
	}
	apiFailure := func(details string) error {
		return &PiConnectionDiagnostic{Status: "api_error", Message: "The model API request failed for " + resolved.Provider + "/" + resolved.ModelID + ". See the API error details below.", Details: rpc.scrub(details)}
	}
	// This explicit diagnostic is never used by automatic availability or quota reads.
	if _, err := rpc.call("set_model", map[string]any{"provider": resolved.Provider, "modelId": resolved.ModelID}, piCommandTimeout); err != nil {
		return runtimeFailure("Pi could not select the model for this test.", err)
	}
	if _, err := rpc.call("set_thinking_level", map[string]any{"level": "off"}, piCommandTimeout); err != nil {
		return runtimeFailure("Pi could not prepare the test request.", err)
	}
	if _, err := rpc.call("prompt", map[string]any{"message": "Reply with OK."}, piCommandTimeout); err != nil {
		return runtimeFailure("Pi could not start the test request.", err)
	}
	timer := time.NewTimer(60 * time.Second)
	defer timer.Stop()
	failure := ""
	replied := false
	for {
		select {
		case event, ok := <-rpc.events:
			if !ok {
				if failure != "" {
					return apiFailure(failure + "\n" + rpc.exitDetails())
				}
				return runtimeFailure("Pi stopped unexpectedly before completing the connection test.", nil)
			}
			if rawString(event, "type") == "message_end" {
				var message struct {
					Role         string `json:"role"`
					StopReason   string `json:"stopReason"`
					ErrorMessage string `json:"errorMessage"`
				}
				_ = json.Unmarshal(event["message"], &message)
				if message.Role != "assistant" {
					continue
				}
				if message.StopReason == "error" {
					failure = protocol.OrDefault(message.ErrorMessage, "Pi connection failed")
					replied = false
				} else if message.StopReason == "aborted" {
					replied = false
				} else {
					failure = ""
					replied = true
				}
			}
			if rawString(event, "type") == "agent_settled" {
				if failure != "" {
					return apiFailure(failure)
				}
				if !replied {
					return runtimeFailure("Pi finished the connection test without a model reply.", nil)
				}
				return nil
			}
		case <-timer.C:
			rpc.Process.Stop()
			return &PiConnectionDiagnostic{Status: "timeout", Message: "The connection test timed out after 60 seconds. Check network access and retry.", Details: rpc.scrub(failure)}
		}
	}
}

func verifyPiVersion(in equipment.AgentInstallation, env []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), piCommandTimeout)
	defer cancel()
	check := exec.CommandContext(ctx, in.Path, "--version")
	check.Env = env
	if version, err := check.Output(); err != nil || strings.TrimSpace(string(version)) != in.Version {
		return errors.New("Pi executable version differs from its declared installation")
	}
	return nil
}

func (s *PiProfiles) Models(id string, fresh bool) ([]agentapi.PiModelOffer, error) {
	return s.models(id, fresh)
}

func (s *PiProfiles) ModelsFor(profile agentapi.PiProfile, in equipment.AgentInstallation, fresh bool) ([]agentapi.PiModelOffer, error) {
	return s.modelsFor(profile, in, fresh)
}

func (s *PiProfiles) CheckConnection(id, model string) error { return s.checkConnection(id, model) }
