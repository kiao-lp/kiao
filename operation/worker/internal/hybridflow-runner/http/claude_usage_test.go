package runnerhttp

import (
	"errors"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	claudecli "kiao/worker/internal/hybridflow-runner/agents/claude"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// TestReadCredentials pins the credentials-file shape the Claude CLI writes, in particular that
// expiresAt is epoch milliseconds. Reading it as seconds would make every token look long expired
// and trigger a CLI refresh on every request.
func TestReadCredentials(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".credentials.json")
	if err := os.WriteFile(path, []byte(`{"claudeAiOauth":{"accessToken":"sk-ant-oat01-x","expiresAt":1784247755376}}`), 0o600); err != nil {
		t.Fatalf("write credentials: %v", err)
	}
	svc := &claudecli.ClaudeUsageService{CredentialsPath: path}

	token, expiresAt, err := svc.ReadCredentials()
	if err != nil {
		t.Fatalf("readCredentials: %v", err)
	}
	if token != "sk-ant-oat01-x" {
		t.Errorf("token = %q", token)
	}
	if want := time.UnixMilli(1784247755376); !expiresAt.Equal(want) {
		t.Errorf("expiresAt = %s, want %s", expiresAt, want)
	}
}

// TestReadCredentialsErrors covers the cases that must not yield a usable token: a missing file,
// malformed JSON, and a file with no token. A missing expiresAt is not an error — it maps to the
// zero time, which callers treat as expired and refresh.
func TestReadCredentialsErrors(t *testing.T) {
	dir := t.TempDir()

	svc := &claudecli.ClaudeUsageService{CredentialsPath: filepath.Join(dir, "absent.json")}
	if _, _, err := svc.ReadCredentials(); err == nil {
		t.Errorf("missing file: expected error")
	}

	for name, body := range map[string]string{
		"malformed": `{not json`,
		"no token":  `{"claudeAiOauth":{"expiresAt":1784247755376}}`,
	} {
		path := filepath.Join(dir, name+".json")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
		svc := &claudecli.ClaudeUsageService{CredentialsPath: path}
		if _, _, err := svc.ReadCredentials(); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}

	path := filepath.Join(dir, "no-expiry.json")
	if err := os.WriteFile(path, []byte(`{"claudeAiOauth":{"accessToken":"sk-ant-oat01-x"}}`), 0o600); err != nil {
		t.Fatalf("write no-expiry: %v", err)
	}
	svc = &claudecli.ClaudeUsageService{CredentialsPath: path}
	_, expiresAt, err := svc.ReadCredentials()
	if err != nil {
		t.Fatalf("no expiry: %v", err)
	}
	if time.Now().Before(expiresAt) {
		t.Errorf("missing expiresAt should read as expired, got %s", expiresAt)
	}
}

// TestParseUsageHeaders captures one realistic set of anthropic-ratelimit-unified-* headers and
// pins the transformation into an AgentUsageDto: utilization is a 0..1 fraction rounded to a whole
// percent, reset is a raw epoch-seconds integer, and each window says its own length in minutes —
// the header names the period in its key and nowhere else, so losing it here would leave the client
// with two bars it could not label.
//
// The order is pinned too: tightest window first, which is what the usage panel draws.
func TestParseUsageHeaders(t *testing.T) {
	h := http.Header{}
	h.Set("anthropic-ratelimit-unified-5h-utilization", "0.256")
	h.Set("anthropic-ratelimit-unified-5h-reset", "1720000000")
	h.Set("anthropic-ratelimit-unified-7d-utilization", "0.5")
	h.Set("anthropic-ratelimit-unified-7d-reset", "1720500000")

	dto, err := claudecli.ParseUsageHeaders(h)
	if err != nil {
		t.Fatalf("parseUsageHeaders: %v", err)
	}
	want := []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 26, ResetAtEpochSeconds: 1720000000}, // round(25.6)
		{WindowMinutes: 10080, PercentUsed: 50, ResetAtEpochSeconds: 1720500000},
	}
	if !reflect.DeepEqual(dto.Windows, want) {
		t.Errorf("windows = %+v, want %+v", dto.Windows, want)
	}
}

func TestUsageWindowRounding(t *testing.T) {
	cases := []struct {
		util string
		want int
	}{
		{"0", 0},
		{"0.004", 0},   // round(0.4) -> 0
		{"0.005", 1},   // round(0.5) -> 1 (half away from zero)
		{"0.999", 100}, // round(99.9) -> 100
		{"1", 100},
	}
	for _, c := range cases {
		h := http.Header{}
		h.Set("anthropic-ratelimit-unified-5h-utilization", c.util)
		h.Set("anthropic-ratelimit-unified-5h-reset", "1")
		w, err := claudecli.UsageWindow(h, "5h", agentapi.FiveHourWindowMinutes)
		if err != nil {
			t.Fatalf("usageWindow(%q): %v", c.util, err)
		}
		if w.PercentUsed != c.want {
			t.Errorf("usageWindow(util=%q).PercentUsed = %d, want %d", c.util, w.PercentUsed, c.want)
		}
	}
}

func TestUsageWindowErrors(t *testing.T) {
	full := func() http.Header {
		h := http.Header{}
		h.Set("anthropic-ratelimit-unified-5h-utilization", "0.5")
		h.Set("anthropic-ratelimit-unified-5h-reset", "1720000000")
		return h
	}

	// Missing utilization header.
	h := full()
	h.Del("anthropic-ratelimit-unified-5h-utilization")
	if _, err := claudecli.UsageWindow(h, "5h", agentapi.FiveHourWindowMinutes); err == nil {
		t.Errorf("missing utilization: expected error")
	}

	// Non-numeric utilization.
	h = full()
	h.Set("anthropic-ratelimit-unified-5h-utilization", "not-a-number")
	if _, err := claudecli.UsageWindow(h, "5h", agentapi.FiveHourWindowMinutes); err == nil {
		t.Errorf("invalid utilization: expected error")
	}

	// Missing reset header.
	h = full()
	h.Del("anthropic-ratelimit-unified-5h-reset")
	if _, err := claudecli.UsageWindow(h, "5h", agentapi.FiveHourWindowMinutes); err == nil {
		t.Errorf("missing reset: expected error")
	}

	// Non-integer reset.
	h = full()
	h.Set("anthropic-ratelimit-unified-5h-reset", "12.5")
	if _, err := claudecli.UsageWindow(h, "5h", agentapi.FiveHourWindowMinutes); err == nil {
		t.Errorf("invalid reset: expected error")
	}
}

// roundTripFunc answers a request in-process, so probe runs through a real http.Client without a
// network.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// probeAnswered runs probe against one canned answer from the Anthropic API.
func probeAnswered(status int, header http.Header) (agentapi.AgentUsageDto, error) {
	answer := roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: status, Header: header, Body: http.NoBody}, nil
	})
	svc := &claudecli.ClaudeUsageService{Http: &http.Client{Transport: answer}}
	return svc.Probe("sk-ant-oat01-x")
}

// spentHeaders is the refusal a probe meets once the five-hour window is spent: the rejection's own
// status and claim, and both windows as any other answer carries them.
func spentHeaders() http.Header {
	h := http.Header{}
	h.Set("anthropic-ratelimit-unified-status", "rejected")
	h.Set("anthropic-ratelimit-unified-representative-claim", "five_hour")
	h.Set("anthropic-ratelimit-unified-5h-utilization", "1")
	h.Set("anthropic-ratelimit-unified-5h-reset", "1720000000")
	h.Set("anthropic-ratelimit-unified-7d-utilization", "0.42")
	h.Set("anthropic-ratelimit-unified-7d-reset", "1720500000")
	return h
}

// TestProbeReadsASpentWindow pins that a probe the quota refuses is read rather than failed. The 429
// is the one answer that says the window is full, and reporting it as an error made the panel say the
// quota was unavailable at exactly that moment.
func TestProbeReadsASpentWindow(t *testing.T) {
	dto, err := probeAnswered(http.StatusTooManyRequests, spentHeaders())
	if err != nil {
		t.Fatalf("probe on a spent window: %v", err)
	}
	want := []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 100, ResetAtEpochSeconds: 1720000000},
		{WindowMinutes: 10080, PercentUsed: 42, ResetAtEpochSeconds: 1720500000},
	}
	if !reflect.DeepEqual(dto.Windows, want) {
		t.Errorf("windows = %+v, want %+v", dto.Windows, want)
	}
}

// TestProbeErrors covers the answers that say nothing about the account: a 429 without the usage
// headers is some other limit, a 401 is the token and worth one refresh, and any other non-2xx is the
// API failing, headers or not.
func TestProbeErrors(t *testing.T) {
	if _, err := probeAnswered(http.StatusTooManyRequests, http.Header{}); err == nil {
		t.Errorf("429 without usage headers: expected error")
	}
	if _, err := probeAnswered(http.StatusUnauthorized, spentHeaders()); !errors.Is(err, claudecli.ErrUnauthorized) {
		t.Errorf("401: err = %v, want errUnauthorized", err)
	}
	if _, err := probeAnswered(http.StatusInternalServerError, spentHeaders()); err == nil {
		t.Errorf("500: expected error")
	}
}
