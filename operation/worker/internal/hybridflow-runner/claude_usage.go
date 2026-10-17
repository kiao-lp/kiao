package hybridflowrunner

import (
	"context"
	"errors"
	"fmt"
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
	credentialsPath string
	http            *http.Client

	mu       sync.Mutex
	cached   *AgentUsageDto
	cachedAt time.Time

	refreshMu sync.Mutex
}

const (
	anthropicURL     = "https://api.anthropic.com/v1/messages"
	anthropicVersion = "2023-06-01"
	anthropicBeta    = "claude-code-20250219"
	// probeModel is a concrete model id, because the Messages API takes those and not the CLI's
	// aliases. It names the cheapest tier, and is the one line to follow when that tier is
	// succeeded — a retired id would fail the probe.
	probeModel = "claude-haiku-4-5"
	// refreshModel names the same tier to the CLI, which does accept the aliases. An alias is
	// version-independent by design, so the renewal below survives a new model on its own; see
	// claudeModels in claude_options.go. Keep it in step with kiao-claude-keepalive.sh.
	refreshModel     = "haiku"
	usageCacheTTL    = 30 * time.Second
	usageHTTPTimeout = 15 * time.Second
	refreshTimeout   = 60 * time.Second
	// tokenLeeway treats a token that is about to expire as already expired.
	tokenLeeway = time.Minute
)

// errUnauthorized reports that the Anthropic API rejected the OAuth token, which is worth one
// refresh and retry.
var errUnauthorized = errors.New("Anthropic API rejected the OAuth token")

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

func newClaudeUsageService(cfg *Config) *ClaudeUsageService {
	return &ClaudeUsageService{
		credentialsPath: cfg.ClaudeCredentialsPath,
		http:            &http.Client{Timeout: usageHTTPTimeout},
	}
}

// getUsage returns cached usage when fresh, otherwise probes the Anthropic API. An error here
// surfaces as HTTP 503 to the caller.
func (svc *ClaudeUsageService) getUsage() (AgentUsageDto, error) {
	svc.mu.Lock()
	if svc.cached != nil && time.Since(svc.cachedAt) < usageCacheTTL {
		dto := *svc.cached
		svc.mu.Unlock()
		return dto, nil
	}
	svc.mu.Unlock()

	token, err := svc.token()
	if err != nil {
		return AgentUsageDto{}, err
	}

	dto, err := svc.probe(token)
	if errors.Is(err, errUnauthorized) {
		// The token was not yet expired but the API rejected it anyway; renew it once and retry.
		if token, err = svc.refresh(); err != nil {
			return AgentUsageDto{}, err
		}
		dto, err = svc.probe(token)
	}
	if err != nil {
		return AgentUsageDto{}, err
	}

	svc.mu.Lock()
	svc.cached = &dto
	svc.cachedAt = time.Now()
	svc.mu.Unlock()
	return dto, nil
}

// token returns an access token that is not expired, renewing the stored one if needed.
func (svc *ClaudeUsageService) token() (string, error) {
	token, expiresAt, err := svc.readCredentials()
	if err != nil {
		return "", fmt.Errorf("Claude OAuth token unusable at %s: %w", svc.credentialsPath, err)
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
	if token, expiresAt, err := svc.readCredentials(); err == nil && time.Now().Add(tokenLeeway).Before(expiresAt) {
		return token, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), refreshTimeout)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "claude", claudeRefreshArgs...).CombinedOutput(); err != nil {
		return "", fmt.Errorf("Claude token refresh failed: %w: %s", err, strings.TrimSpace(string(out)))
	}

	token, expiresAt, err := svc.readCredentials()
	if err != nil {
		return "", fmt.Errorf("Claude OAuth token unusable at %s after refresh: %w", svc.credentialsPath, err)
	}
	if !time.Now().Before(expiresAt) {
		return "", fmt.Errorf("Claude OAuth token still expired after refresh; run `claude setup-token` on the host")
	}
	logUsage.Info("refreshed OAuth token", "expires", expiresAt.Format(time.RFC3339))
	return token, nil
}

// probe issues the 1-token request whose response headers carry the usage windows.
func (svc *ClaudeUsageService) probe(token string) (AgentUsageDto, error) {
	body := fmt.Sprintf(`{"model":"%s","max_tokens":1,"messages":[{"role":"user","content":"."}]}`, probeModel)
	req, err := http.NewRequest(http.MethodPost, anthropicURL, strings.NewReader(body))
	if err != nil {
		return AgentUsageDto{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("anthropic-version", anthropicVersion)
	req.Header.Set("anthropic-beta", anthropicBeta)
	req.Header.Set("Content-Type", "application/json")

	resp, err := svc.http.Do(req)
	if err != nil {
		return AgentUsageDto{}, fmt.Errorf("Anthropic API call failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return AgentUsageDto{}, errUnauthorized
	}
	// A spent window turns the probe away with a 429, and the refusal carries the same usage headers
	// a 2xx does — the CLI reads its own quota off them too. It is the one answer that says a window
	// is full, so it is read rather than reported as a failure, which left the quota unavailable at
	// exactly that moment. A 429 without them is a limit other than the account's, and stays an error.
	if resp.StatusCode == http.StatusTooManyRequests {
		dto, err := parseUsageHeaders(resp.Header)
		if err != nil {
			return AgentUsageDto{}, fmt.Errorf("Anthropic API status 429 without the usage headers: %w", err)
		}
		return dto, nil
	}
	if resp.StatusCode/100 != 2 {
		logUsage.Warn("Anthropic API returned non-2xx", "status", resp.StatusCode)
		return AgentUsageDto{}, fmt.Errorf("Anthropic API status %d", resp.StatusCode)
	}
	return parseUsageHeaders(resp.Header)
}

func parseUsageHeaders(h http.Header) (AgentUsageDto, error) {
	fiveHour, err := usageWindow(h, "5h", fiveHourWindowMinutes)
	if err != nil {
		return AgentUsageDto{}, err
	}
	weekly, err := usageWindow(h, "7d", weeklyWindowMinutes)
	if err != nil {
		return AgentUsageDto{}, err
	}
	// Tightest first, which is the order the wire is in and the order the usage panel draws.
	return AgentUsageDto{Windows: []agentWindow{fiveHour, weekly}}, nil
}

// usageWindow reads one window off the headers. The length is this file's rather than the header's:
// the header names the period in its own key (`5h`, `7d`) and never says it again in a form worth
// parsing, so the two travel together here.
func usageWindow(h http.Header, period string, windowMinutes int) (agentWindow, error) {
	utilHeader := "anthropic-ratelimit-unified-" + period + "-utilization"
	resetHeader := "anthropic-ratelimit-unified-" + period + "-reset"

	utilStr := h.Get(utilHeader)
	if utilStr == "" {
		return agentWindow{}, fmt.Errorf("missing header %s", utilHeader)
	}
	util, err := strconv.ParseFloat(utilStr, 64)
	if err != nil {
		return agentWindow{}, fmt.Errorf("invalid header %s", utilHeader)
	}

	resetStr := h.Get(resetHeader)
	if resetStr == "" {
		return agentWindow{}, fmt.Errorf("missing header %s", resetHeader)
	}
	reset, err := strconv.ParseInt(resetStr, 10, 64)
	if err != nil {
		return agentWindow{}, fmt.Errorf("invalid header %s", resetHeader)
	}

	return agentWindow{
		WindowMinutes:       windowMinutes,
		PercentUsed:         int(math.Round(util * 100)),
		ResetAtEpochSeconds: reset,
	}, nil
}

// readCredentials returns the stored access token and its expiry. A missing or unparsable
// expiresAt yields the zero time, which every caller treats as expired.
func (svc *ClaudeUsageService) readCredentials() (string, time.Time, error) {
	creds, err := readClaudeCredentials(svc.credentialsPath)
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
