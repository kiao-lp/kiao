package muse

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"os"
	"sync"
	"time"
)

// MuseUsageService shares the newest quota observation across Muse turns.
type MuseUsageService struct {
	mu     sync.Mutex
	cached *agentapi.AgentUsageDto
	// Host timestamps order observations from concurrent turns, regardless of arrival order.
	observedAtMs int64
	// Local recording time controls refresh freshness, independently of host timestamps.
	CachedAt time.Time
	Binary   string
	// Catalogue override for tests; nil queries the installed CLI.
	Catalogue func() ([]byte, error)
	// Probe override for tests; nil runs a real minimal turn.
	Probe func(ctx context.Context, binary, model string) (*MuseSubscriptionUsage, error)

	// Serialise refreshes to avoid spending two turns for one quota reading.
	refreshMu sync.Mutex
}

func NewMuseUsageService() *MuseUsageService { return &MuseUsageService{Binary: MuseBinaryName} }

// Never probe here: the runner reads quota to wait for resets and must not spend more quota.
func (svc *MuseUsageService) GetUsage() (agentapi.AgentUsageDto, error) {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.cached == nil {
		return agentapi.AgentUsageDto{}, errors.New("Muse has reported no quota yet; it is read off the turns this service runs")
	}
	return *svc.cached, nil
}

func (svc *MuseUsageService) Note(dto agentapi.AgentUsageDto, observedAtMs int64) {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.cached != nil && observedAtMs < svc.observedAtMs {
		return
	}
	svc.cached = &dto
	svc.observedAtMs = observedAtMs
	svc.CachedAt = time.Now()
}

// Reuse fresh observations; otherwise spend one minimal turn to refresh quota.
func (svc *MuseUsageService) Refresh() (agentapi.AgentUsageDto, error) {
	svc.refreshMu.Lock()
	defer svc.refreshMu.Unlock()

	svc.mu.Lock()
	if svc.cached != nil && time.Since(svc.CachedAt) < agentapi.UsageCacheTTL {
		dto := *svc.cached
		svc.mu.Unlock()
		return dto, nil
	}
	binary, catalogue, probe := svc.Binary, svc.Catalogue, svc.Probe
	svc.mu.Unlock()

	if probe == nil {
		probe = MuseProbeUsage
	}
	model := cheapestMuseModelOf(catalogue, binary)
	ctx, cancel := context.WithTimeout(context.Background(), museProbeTimeout)
	defer cancel()
	observed, err := probe(ctx, binary, model)
	if err != nil {
		return agentapi.AgentUsageDto{}, err
	}
	if observed == nil || observed.IsEmpty() {
		return agentapi.AgentUsageDto{}, errors.New("the Muse probe observed no quota to report")
	}
	// A concurrent turn may have recorded newer usage; return the newest observation.
	svc.Note(observed.Dto(), observed.ObservedAtMs)
	return svc.GetUsage()
}

// An unreadable catalogue falls back to the host default, which still observes quota.
func cheapestMuseModelOf(catalogue func() ([]byte, error), binary string) string {
	ask := catalogue
	if ask == nil {
		ask = func() ([]byte, error) { return museModels(binary) }
	}
	raw, err := ask()
	if err != nil {
		agentapi.LogClaudeWS.Debug("muse model catalogue unreadable; the usage probe runs the host default",
			"error", err)
		return ""
	}
	return CheapestMuseModel(raw)
}

// Catalogue prices are null, so approximate cheapest by oldest version. Unversioned IDs
// sort last; ties retain catalogue order.
func CheapestMuseModel(raw []byte) string {
	var catalogue museModelCatalogue
	if err := json.Unmarshal(raw, &catalogue); err != nil {
		return ""
	}
	best := ""
	var bestVersion []int
	for _, model := range catalogue.Models {
		id := model.ModelID
		if id == "" {
			continue
		}
		version := museModelVersion(id)
		switch {
		case best == "":
			best, bestVersion = id, version
		case compareMuseVersion(version, bestVersion) < 0:
			best, bestVersion = id, version
		}
	}
	return best
}

// Extract all numeric groups in order; no groups means unversioned, which sorts last.
func museModelVersion(id string) []int {
	var version []int
	current := -1
	flush := func() {
		if current >= 0 {
			version = append(version, current)
			current = -1
		}
	}
	for _, r := range id {
		if r >= '0' && r <= '9' {
			if current < 0 {
				current = 0
			}
			current = current*10 + int(r-'0')
			continue
		}
		flush()
	}
	flush()
	return version
}

// Unversioned sorts last; a common prefix sorts by length (1.2 before 1.2.1).
func compareMuseVersion(a, b []int) int {
	if len(a) == 0 && len(b) == 0 {
		return 0
	}
	if len(a) == 0 {
		return 1
	}
	if len(b) == 0 {
		return -1
	}
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(a) < len(b):
		return -1
	case len(a) > len(b):
		return 1
	default:
		return 0
	}
}

// Bound the entire probe: spawn, session, turn and usage query.
const museProbeTimeout = 120 * time.Second

const MuseProbeInput = "hi"

// museProbeUsage runs a no-reasoning turn in a temporary workspace, then reads usage.
// The session uses allowAll without a sandbox; keep probe input minimal.
// It uses the cheapest model when accepted and returns nil if the host observed nothing.
func MuseProbeUsage(ctx context.Context, binary, model string) (*MuseSubscriptionUsage, error) {
	dir, err := os.MkdirTemp("", "muse-usage-")
	if err != nil {
		return nil, fmt.Errorf("the Muse usage probe needs a directory to run in: %w", err)
	}
	defer os.RemoveAll(dir)

	conn, err := SpawnMSP(ctx, binary, MuseServeArgs(), dir, nil, nil)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	raw, err := conn.Call("session/start", map[string]any{
		"commandId": MspCommandID(), "workspaceRoot": dir, "approvalMode": "allowAll",
	})
	if err != nil {
		return nil, fmt.Errorf("the Muse usage probe could not start a session: %s", museSentence(err))
	}
	var started struct {
		Session struct {
			SessionID string `json:"sessionId"`
		} `json:"session"`
	}
	if err := json.Unmarshal(raw, &started); err != nil || started.Session.SessionID == "" {
		return nil, errors.New("Muse started a probe session and did not name it.")
	}
	sessionID := started.Session.SessionID

	// Model selection is only a cost optimisation; the host default can still observe quota.
	if model != "" {
		if _, err := conn.Call("session/setModel", map[string]any{
			"commandId": MspCommandID(), "sessionId": sessionID,
			"model": map[string]any{"modelId": model},
		}); err != nil {
			agentapi.LogClaudeWS.Debug("muse probe keeps the host default model",
				"model", model, "error", err)
		}
	}

	raw, err = conn.Call("turn/start", map[string]any{
		"commandId": MspCommandID(), "sessionId": sessionID,
		"input":           []any{map[string]any{"type": "text", "text": MuseProbeInput}},
		"reasoningEffort": "none",
		"ifBusy":          "replace",
	})
	if err != nil {
		return nil, fmt.Errorf("Muse would not start the usage probe turn: %s", museSentence(err))
	}
	var probe struct {
		TurnID string `json:"turnId"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil || probe.TurnID == "" {
		return nil, errors.New("Muse started a usage probe turn and did not say which.")
	}

	// Even an incomplete turn may have reached the provider and observed quota.
	waitMuseProbeEnd(ctx, conn, probe.TurnID)

	raw, err = conn.Call("usage/read", map[string]any{})
	if err != nil {
		return nil, fmt.Errorf("the Muse usage probe could not be read: %w", err)
	}
	return MuseUsageFromRead(raw)
}

// Wait for completion, failure/reclamation or cancellation; ignore transcript notifications.
func waitMuseProbeEnd(ctx context.Context, conn *MspConn, turnID string) {
	for {
		select {
		case <-ctx.Done():
			return
		case note, ok := <-conn.notifs:
			if !ok {
				return
			}
			if note.Method != "turn/completed" && note.Method != "turn/unqueued" {
				continue
			}
			var params struct {
				TurnID string `json:"turnId"`
			}
			_ = json.Unmarshal(note.Params, &params)
			if params.TurnID == "" || params.TurnID == turnID {
				return
			}
		}
	}
}

// MSP SubscriptionUsage appears in `usage/read`.usage and `usage/changed` params.
// Timestamps are epoch milliseconds, usage is percent, and window duration is minutes.
type MuseSubscriptionUsage struct {
	ObservedAtMs int64  `json:"observedAtMs"`
	Tier         string `json:"tier"`
	Weekly       struct {
		ResetsAtMs  int64 `json:"resetsAtMs"`
		UsedPercent int   `json:"usedPercent"`
	} `json:"weekly"`
	Window struct {
		ResetsAtMs         int64 `json:"resetsAtMs"`
		UsedPercent        int   `json:"usedPercent"`
		WindowDurationMins int   `json:"windowDurationMins"`
	} `json:"window"`
}

// A nil observation without error means the host has not observed usage yet (`{}`).
func MuseUsageFromRead(raw []byte) (*MuseSubscriptionUsage, error) {
	var result struct {
		Usage *MuseSubscriptionUsage `json:"usage"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("the Muse usage answer could not be read: %w", err)
	}
	return result.Usage, nil
}

// Reject missing resets: otherwise absent usage would display as 0% with a 1970 reset.
func (u *MuseSubscriptionUsage) IsEmpty() bool {
	return u.Weekly.ResetsAtMs == 0 && u.Window.ResetsAtMs == 0
}

// Windows are tightest first. MSP omits the weekly duration; use a rolling week.
// Convert epoch milliseconds to the wire's seconds; durations remain minutes.
func (u *MuseSubscriptionUsage) Dto() agentapi.AgentUsageDto {
	return agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{
		{
			WindowMinutes:       u.Window.WindowDurationMins,
			PercentUsed:         u.Window.UsedPercent,
			ResetAtEpochSeconds: u.Window.ResetsAtMs / 1000,
		},
		{
			WindowMinutes:       agentapi.WeeklyWindowMinutes,
			PercentUsed:         u.Weekly.UsedPercent,
			ResetAtEpochSeconds: u.Weekly.ResetsAtMs / 1000,
		},
	}}
}
