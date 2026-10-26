package codex

import (
	"context"
	"errors"
	"fmt"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/login"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// CodexLoginService uses the host CLI's own credential store, including CODEX_HOME and
// keyring configuration. Device auth works on remote hosts without a localhost callback.
type CodexLoginService struct {
	Enabled bool
	Binary  string
	login.DeviceLoginService
}

func NewCodexLoginService(cfg *runnerconfig.Config) *CodexLoginService {
	svc := &CodexLoginService{Enabled: cfg.CodexLoginEnabled, Binary: CodexBinaryName}
	svc.LoginCmd = func(ctx context.Context) *exec.Cmd {
		return exec.CommandContext(ctx, svc.Binary, "login", "--device-auth")
	}
	svc.FindPage = FindCodexDevicePage
	// A completed device flow has already published its page and code; only its outcome
	// belongs in the status response, never the one-time code again.
	svc.CleanMessage = func(raw string) string {
		if strings.Contains(raw, "Successfully logged in") {
			return "Signed in."
		}
		lines := strings.Split(strings.TrimSpace(loginANSI.ReplaceAllString(raw, "")), "\n")
		return login.CleanDeviceMessage(lines[len(lines)-1])
	}
	return svc
}

const codexAuthStatusTimeout = 10 * time.Second

// status checks credentials without a model call. A CLI failure is not a signed-out
// account: only its explicit "Not logged in" result establishes that.
func (svc *CodexLoginService) Status() (agentapi.AgentAuthStatusDto, error) {
	dto := agentapi.AgentAuthStatusDto{LoginEnabled: svc.Enabled}
	// exec accepts this per-run key even though `login status` ignores it. Workload
	// identity takes precedence and must still be checked by the CLI when configured.
	if strings.TrimSpace(os.Getenv("CODEX_API_KEY")) != "" &&
		os.Getenv("OPENAI_FEDERATION_RULE_ID") == "" && os.Getenv("OPENAI_IDENTITY_TOKEN_FILE") == "" {
		dto.LoggedIn = true
		return dto, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), codexAuthStatusTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, svc.Binary, "login", "status").CombinedOutput()
	if err == nil {
		dto.LoggedIn = true
		return dto, nil
	}
	var exit *exec.ExitError
	if ctx.Err() == nil && errors.As(err, &exit) && exit.ExitCode() == 1 &&
		strings.Contains(string(out), "Not logged in") {
		return dto, nil
	}
	// The status output can contain part of an API key; never forward it or log it.
	return agentapi.AgentAuthStatusDto{}, fmt.Errorf("could not read Codex login status: %w", err)
}

func (svc *CodexLoginService) submitKey(key string) (bool, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), login.MuseAuthSetTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, svc.Binary, "login", "--with-api-key")
	cmd.Stdin = strings.NewReader(key)
	out, err := cmd.CombinedOutput()
	message := login.CleanAPIKeyMessage([]byte(strings.ReplaceAll(string(out), key, "[redacted]")))
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return false, protocol.OrDefault(message, "The API key was refused."), nil
		}
		return false, "", fmt.Errorf("could not store the API key: %w", err)
	}
	return true, protocol.OrDefault(message, "Signed in."), nil
}

var (
	loginANSI       = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)
	codexDeviceCode = regexp.MustCompile(`^[A-Z0-9]{4,}-[A-Z0-9]{4,}$`)
)

// Parse completed lines so a split stdout/stderr read cannot truncate the URL or code.
// Codex prints the page before the code, with ANSI formatting even in some non-TTY builds.
func FindCodexDevicePage(raw string) (login.DeviceLoginPage, bool) {
	end := strings.LastIndexByte(raw, '\n')
	if end < 0 {
		return login.DeviceLoginPage{}, false
	}
	text := loginANSI.ReplaceAllString(raw[:end], "")
	page := login.DeviceLoginPage{}
	for _, line := range strings.Split(text, "\n") {
		if page.Url == "" {
			page.Url = login.DeviceURLRe.FindString(line)
		}
		if code := strings.TrimSpace(line); codexDeviceCode.MatchString(code) {
			page.UserCode = code
		}
		if page.Url != "" && page.UserCode != "" {
			return page, true
		}
	}
	return login.DeviceLoginPage{}, false
}
