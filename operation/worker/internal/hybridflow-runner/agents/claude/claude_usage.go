package claude

import (
	"context"
	"errors"
	"fmt"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"math"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ClaudeUsageService reads Claude Code subscription rate-limit usage by issuing a 1-token probe
// to the Anthropic API and inspecting the anthropic-ratelimit-unified-* response headers. The
// OAuth token comes from the local Claude Code credentials file, which the Claude CLI owns and
// renews; see refresh.
type ClaudeUsageService struct {
	CredentialsPath string
	Http            *http.Client

	mu       sync.Mutex
	cached   *agentapi.AgentUsageDto
	cachedAt time.Time

	refreshMu sync.Mutex
}

const anthropicURL = "https://api.anthropic.com/v1/messages"

const anthropicVersion = "2023-06-01"

const anthropicBeta = "claude-code-20250219"

// probeModel is a concrete model id, because the Messages API takes those and not the CLI's
// aliases. It names the cheapest tier, and is the one line to follow when that tier is
// succeeded — a retired id would fail the probe.
const probeModel = "claude-haiku-4-5"

// refreshModel names the same tier to the CLI, which does accept the aliases. An alias is
// version-independent by design, so the renewal below survives a new model on its own; see
// claudeModels in claude_options.go. Keep it in step with kiao-claude-keepalive.sh.
const refreshModel = "haiku"

const usageHTTPTimeout = 15 * time.Second

const refreshTimeout = 60 * time.Second

// tokenLeeway treats a token that is about to expire as already expired.
const tokenLeeway = time.Minute

// errUnauthorized reports that the Anthropic API rejected the OAuth token, which is worth one
// refresh and retry.
var ErrUnauthorized = errors.New("Anthropic API rejected the OAuth token")

// claudeRefreshArgs make the CLI perform the smallest possible real API call. The call itself is
// what renews the token; its answer is discarded. MCP servers, tools and session persistence are
// disabled to keep it fast and free of side effects.
var claudeRefreshArgs = []string{
	"--print", "hi",
	"--model", refreshModel,
	"--strict-mcp-config",
	"--mcp-config", `{"mcpServers":{}}`,
	"--disable-slash-commands",
	"--tools", "",
	"--no-session-persistence",
}

func newClaudeUsageService(cfg *runnerconfig.Config) *ClaudeUsageService {
	return &ClaudeUsageService{
		CredentialsPath: cfg.ClaudeCredentialsPath,
		Http:            &http.Client{Timeout: usageHTTPTimeout},
	}
}

// getUsage returns cached usage when fresh, otherwise probes the Anthropic API. An error here
// surfaces as HTTP 503 to the caller.
func (svc *ClaudeUsageService) getUsage() (agentapi.AgentUsageDto, error) {
	svc.mu.Lock()
	if svc.cached != nil && time.Since(svc.cachedAt) < agentapi.UsageCacheTTL {
		dto := *svc.cached
		svc.mu.Unlock()
		return dto, nil
	}
	svc.mu.Unlock()

	token, err := svc.token()
	if err != nil {
		return agentapi.AgentUsageDto{}, err
	}

	dto, err := svc.Probe(token)
	if errors.Is(err, ErrUnauthorized) {
		// The token was not yet expired but the API rejected it anyway; renew it once and retry.
		if token, err = svc.refresh(); err != nil {
			return agentapi.AgentUsageDto{}, err
		}
		dto, err = svc.Probe(token)
	}
	if err != nil {
		return agentapi.AgentUsageDto{}, err
	}

	svc.mu.Lock()
	svc.cached = &dto
	svc.cachedAt = time.Now()
	svc.mu.Unlock()
	return dto, nil
}

// token returns an access token that is not expired, renewing the stored one if needed.
func (svc *ClaudeUsageService) token() (string, error) {
	token, expiresAt, err := svc.ReadCredentials()
	if err != nil {
		return "", fmt.Errorf("Claude OAuth token unusable at %s: %w", svc.CredentialsPath, err)
	}
	if time.Now().Add(tokenLeeway).Before(expiresAt) {
		return token, nil
	}
	return svc.refresh()
}

// refresh has the Claude CLI renew the OAuth token and returns the new one. The CLI owns the
// credentials file and refreshes it as a side effect of any real API call. The OAuth refresh
// endpoint itself is not a public API, so driving the CLI is the supported way to renew.
func (svc *ClaudeUsageService) refresh() (string, error) {
	svc.refreshMu.Lock()
	defer svc.refreshMu.Unlock()

	// A concurrent caller may already have renewed it while we waited for the lock.
	if token, expiresAt, err := svc.ReadCredentials(); err == nil && time.Now().Add(tokenLeeway).Before(expiresAt) {
		return token, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), refreshTimeout)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "claude", claudeRefreshArgs...).CombinedOutput(); err != nil {
		return "", fmt.Errorf("Claude token refresh failed: %w: %s", err, strings.TrimSpace(string(out)))
	}

	token, expiresAt, err := svc.ReadCredentials()
	if err != nil {
		return "", fmt.Errorf("Claude OAuth token unusable at %s after refresh: %w", svc.CredentialsPath, err)
	}
	if !time.Now().Before(expiresAt) {
		return "", fmt.Errorf("Claude OAuth token still expired after refresh; run `claude setup-token` on the host")
	}
	agentapi.LogUsage.Info("refreshed OAuth token", "expires", expiresAt.Format(time.RFC3339))
	return token, nil
}

// probe issues the 1-token request whose response headers carry the usage windows.
func (svc *ClaudeUsageService) Probe(token string) (agentapi.AgentUsageDto, error) {
	body := fmt.Sprintf(`{"model":"%s","max_tokens":1,"messages":[{"role":"user","content":"."}]}`, probeModel)
	req, err := http.NewRequest(http.MethodPost, anthropicURL, strings.NewReader(body))
	if err != nil {
		return agentapi.AgentUsageDto{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("anthropic-version", anthropicVersion)
	req.Header.Set("anthropic-beta", anthropicBeta)
	req.Header.Set("Content-Type", "application/json")

	resp, err := svc.Http.Do(req)
	if err != nil {
		return agentapi.AgentUsageDto{}, fmt.Errorf("Anthropic API call failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return agentapi.AgentUsageDto{}, ErrUnauthorized
	}
	// A spent window turns the probe away with a 429, and the refusal carries the same usage headers
	// a 2xx does — the CLI reads its own quota off them too. It is the one answer that says a window
	// is full, so it is read rather than reported as a failure, which left the quota unavailable at
	// exactly that moment. A 429 without them is a limit other than the account's, and stays an error.
	if resp.StatusCode == http.StatusTooManyRequests {
		dto, err := ParseUsageHeaders(resp.Header)
		if err != nil {
			return agentapi.AgentUsageDto{}, fmt.Errorf("Anthropic API status 429 without the usage headers: %w", err)
		}
		return dto, nil
	}
	if resp.StatusCode/100 != 2 {
		agentapi.LogUsage.Warn("Anthropic API returned non-2xx", "status", resp.StatusCode)
		return agentapi.AgentUsageDto{}, fmt.Errorf("Anthropic API status %d", resp.StatusCode)
	}
	return ParseUsageHeaders(resp.Header)
}

func ParseUsageHeaders(h http.Header) (agentapi.AgentUsageDto, error) {
	fiveHour, err := UsageWindow(h, "5h", agentapi.FiveHourWindowMinutes)
	if err != nil {
		return agentapi.AgentUsageDto{}, err
	}
	weekly, err := UsageWindow(h, "7d", agentapi.WeeklyWindowMinutes)
	if err != nil {
		return agentapi.AgentUsageDto{}, err
	}
	// Tightest first, which is the order the wire is in and the order the usage panel draws.
	return agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{fiveHour, weekly}}, nil
}

// usageWindow reads one window off the headers. The length is this file's rather than the header's:
// the header names the period in its own key (`5h`, `7d`) and never says it again in a form worth
// parsing, so the two travel together here.
func UsageWindow(h http.Header, period string, windowMinutes int) (agentapi.AgentWindow, error) {
	utilHeader := "anthropic-ratelimit-unified-" + period + "-utilization"
	resetHeader := "anthropic-ratelimit-unified-" + period + "-reset"

	utilStr := h.Get(utilHeader)
	if utilStr == "" {
		return agentapi.AgentWindow{}, fmt.Errorf("missing header %s", utilHeader)
	}
	util, err := strconv.ParseFloat(utilStr, 64)
	if err != nil {
		return agentapi.AgentWindow{}, fmt.Errorf("invalid header %s", utilHeader)
	}

	resetStr := h.Get(resetHeader)
	if resetStr == "" {
		return agentapi.AgentWindow{}, fmt.Errorf("missing header %s", resetHeader)
	}
	reset, err := strconv.ParseInt(resetStr, 10, 64)
	if err != nil {
		return agentapi.AgentWindow{}, fmt.Errorf("invalid header %s", resetHeader)
	}

	return agentapi.AgentWindow{
		WindowMinutes:       windowMinutes,
		PercentUsed:         int(math.Round(util * 100)),
		ResetAtEpochSeconds: reset,
	}, nil
}

// readCredentials returns the stored access token and its expiry. A missing or unparsable
// expiresAt yields the zero time, which every caller treats as expired.
func (svc *ClaudeUsageService) ReadCredentials() (string, time.Time, error) {
	creds, err := readClaudeCredentials(svc.CredentialsPath)
	if err != nil {
		return "", time.Time{}, err
	}
	if creds.AccessToken == "" {
		// The CLI blanks the tokens in place when a session can no longer be refreshed, so the
		// file still exists but is empty; say so rather than let it read as a missing file.
		return "", time.Time{}, fmt.Errorf("credentials hold no access token: Claude Code is logged out on this host")
	}
	return creds.AccessToken, creds.ExpiresAt, nil
}
