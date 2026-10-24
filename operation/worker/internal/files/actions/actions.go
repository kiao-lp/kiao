package actions

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/http"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// actionTimeout bounds a single provider call. Generous on purpose: a long synthesis or export
// takes tens of seconds, and nginx already allows 600s upstream.
const actionTimeout = 10 * time.Minute

// registeredAction is one manifest entry: the descriptor a client is given, plus the provider URL
// it never sees. The descriptor is embedded, so both halves parse from the same JSON object.
type registeredAction struct {
	ActionDto
	Provider string `json:"provider"`
}

// ActionCatalog is the loaded manifest plus the HTTP client used to reach providers.
type ActionCatalog struct {
	actions []registeredAction
	client  *http.Client
}

// newActionCatalog builds an empty catalog — the state of the service when no manifest is
// configured. Discovery then answers an empty list and every run is an unknown action, so the
// feature is simply absent rather than broken.
func NewActionCatalog() *ActionCatalog {
	return &ActionCatalog{client: &http.Client{Timeout: actionTimeout}}
}

// loadActionCatalog reads and validates the manifest at path. A blank path yields an empty
// catalog; a malformed one is an error, so main can abort start-up rather than serve a
// half-understood action list.
func LoadActionCatalog(path string) (*ActionCatalog, error) {
	catalog := NewActionCatalog()
	if strings.TrimSpace(path) == "" {
		return catalog, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading action manifest %s: %w", path, err)
	}
	var manifest struct {
		Actions []registeredAction `json:"actions"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("parsing action manifest %s: %w", path, err)
	}
	if err := validateActions(manifest.Actions); err != nil {
		return nil, fmt.Errorf("invalid action manifest %s: %w", path, err)
	}

	catalog.actions = manifest.Actions
	return catalog, nil
}

// validateActions rejects a manifest that would only fail later, at menu-build or run time.
func validateActions(actions []registeredAction) error {
	seen := make(map[string]bool, len(actions))
	for i, a := range actions {
		switch {
		case strings.TrimSpace(a.ID) == "":
			return fmt.Errorf("action #%d has no id", i)
		case seen[a.ID]:
			return fmt.Errorf("action %q is declared twice", a.ID)
		case strings.TrimSpace(a.Label) == "":
			return fmt.Errorf("action %q has no label", a.ID)
		}
		seen[a.ID] = true

		u, err := url.Parse(a.Provider)
		if err != nil || !u.IsAbs() {
			return fmt.Errorf("action %q: provider must be an absolute URL, got %q", a.ID, a.Provider)
		}
		for _, p := range a.Params {
			if err := validateActionParam(a.ID, p); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateActionParam(actionID string, p ActionParamDto) error {
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("action %q: a parameter has no name", actionID)
	}
	switch p.Type {
	case "string", "boolean":
	case "enum":
		if len(p.Values) == 0 {
			return fmt.Errorf("action %q: enum parameter %q has no values", actionID, p.Name)
		}
	default:
		return fmt.Errorf("action %q: parameter %q has unsupported type %q (want string, boolean or enum)",
			actionID, p.Name, p.Type)
	}
	return nil
}

// descriptors returns every declared action, in manifest order. Never nil, so the JSON response
// is `[]` rather than `null`.
func (c *ActionCatalog) Descriptors() []ActionDto {
	out := make([]ActionDto, 0, len(c.actions))
	for _, a := range c.actions {
		out = append(out, a.ActionDto)
	}
	return out
}

// find returns the action with the given id, or nil.
func (c *ActionCatalog) Find(id string) *registeredAction {
	for i := range c.actions {
		if c.actions[i].ID == id {
			return &c.actions[i]
		}
	}
	return nil
}

// applicableTo returns the actions whose rule matches the entry, in manifest order.
func (c *ActionCatalog) ApplicableTo(path string, isDirectory bool) []ActionDto {
	out := []ActionDto{}
	for _, a := range c.actions {
		if ActionApplies(a.AppliesTo, path, isDirectory) {
			out = append(out, a.ActionDto)
		}
	}
	return out
}

// actionApplies evaluates the applicability rule. Every key is optional and they are AND-ed, so
// an empty rule matches everything. The vocabulary is kept deliberately small — a suffix match on
// the name and a directory flag — because both are decidable from what a client already knows
// about an entry, which is what lets the Dashboard context menu stay synchronous.
func ActionApplies(rule ActionAppliesToDto, path string, isDir bool) bool {
	if rule.Directory != nil && *rule.Directory != isDir {
		return false
	}
	if len(rule.Extensions) > 0 {
		name := strings.ToLower(path)
		if cut := strings.LastIndex(name, "/"); cut >= 0 {
			name = name[cut+1:]
		}
		matched := false
		for _, ext := range rule.Extensions {
			if strings.HasSuffix(name, strings.ToLower(ext)) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return true
}

// run forwards the request to the action's provider and returns its result.
//
// The caller's Authorization header travels with it: that is what lets a provider read and write
// the file store on the user's behalf without a service account of its own — both services
// require the same realm role. The request id travels too, so one action shows up as one
// correlated pair of traces across the two services.
func (c *ActionCatalog) Run(ctx context.Context, action *registeredAction, path string, params map[string]any, authorization, requestID string) (ActionResultDto, error) {
	if params == nil {
		// A nil map marshals to `null`, which is not the same thing as "no parameters" to a
		// provider validating its input — send the empty object the contract promises.
		params = map[string]any{}
	}
	body, err := json.Marshal(map[string]any{"path": path, "params": params})
	if err != nil {
		return ActionResultDto{}, fmt.Errorf("encoding action request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, action.Provider, bytes.NewReader(body))
	if err != nil {
		return ActionResultDto{}, fmt.Errorf("building action request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	if requestID != "" {
		req.Header.Set("X-Request-Id", requestID)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		// The provider is down, unreachable or too slow. That is an infrastructure failure, not a
		// failed operation, so it must not masquerade as {"ok": false}.
		return ActionResultDto{}, &httpkit.HTTPError{Status: http.StatusBadGateway, Msg: "action provider unavailable"}
	}
	defer resp.Body.Close()

	// The status decides what happened; the body only supplies the wording. A provider answering
	// 401 is not a refused operation, however message-shaped its body looks.
	var answer struct {
		ActionResultDto
		Error string `json:"error"`
	}
	decodeErr := json.NewDecoder(resp.Body).Decode(&answer)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if decodeErr != nil {
			return ActionResultDto{}, fmt.Errorf("action %q: provider returned an unreadable result", action.ID)
		}
		result := answer.ActionResultDto
		if result.ChangedPaths == nil {
			result.ChangedPaths = []string{}
		}
		return result, nil
	}

	// The provider refused or failed. Report it as a failed operation rather than an opaque 5xx —
	// the same choice /git/* makes for a failed git command — keeping whatever reason it gave.
	return ActionResultDto{
		OK:           false,
		Message:      providerFailureMessage(resp.StatusCode, answer.Message, answer.Error),
		ChangedPaths: []string{},
	}, nil
}

func providerFailureMessage(status int, message, errText string) string {
	for _, candidate := range []string{message, errText} {
		if s := strings.TrimSpace(candidate); s != "" {
			return fmt.Sprintf("%s (HTTP %d)", s, status)
		}
	}
	return fmt.Sprintf("provider returned HTTP %d", status)
}
