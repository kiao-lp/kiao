package muse

import (
	"context"
	"errors"
	"fmt"
	"kiao/worker/internal/hybridflow-runner/agents/login"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgUrl "net/url"
	"os/exec"
	"strings"
)

// MuseLoginService signs the server-side `muse` CLI in from the browser, so a signed-out host
// does not require a shell on the machine. Two shapes, one gate:
//
//   - the device flow, `muse login`: the CLI prints a page to open and a code to confirm, then
//     waits for the approval — driven here the way Claude's OAuth is, as one parked process
//     between the round trips, with the panel polling for the wait's end;
//   - the API key, `muse auth set --api-key-stdin`: one round trip, the key read off stdin and
//     stored, which is the whole flow.
//
// The feature is gated by KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED (default on). Either shape
// binds the host's CLI to whoever signs in, so the endpoints stay absent from deployments that do
// not want that reachable over HTTP. Neither credential is ever logged.
type MuseLoginService struct {
	Enabled bool
	// binary is the CLI to spawn. A field rather than a literal for the reason the Muse agent has
	// one: pointing it at a script standing in for the CLI is what makes the key flow testable
	// without touching the machine's own credentials. Production never changes it.
	Binary string
	login.DeviceLoginService
}

// maxAPIKeyLength rejects an implausibly long paste before it reaches the CLI.
const MaxAPIKeyLength = 4096

// deviceWaitingMarker is the line the CLI prints once the page and code are out and the wait
// begins. What it writes after this point is the wait's answer, which is the only part worth
// relaying.
const deviceWaitingMarker = "Waiting for approval"

// deviceCodeMarker introduces the code: the non-empty line after it is what the user confirms.
const deviceCodeMarker = "confirm this code matches"

func NewMuseLoginService(cfg *runnerconfig.Config) *MuseLoginService {
	svc := &MuseLoginService{Enabled: cfg.MuseLoginEnabled, Binary: MuseBinaryName}
	svc.FindPage = FindDevicePage
	svc.CleanMessage = cleanMuseDeviceMessage
	svc.LoginCmd = func(ctx context.Context) *exec.Cmd {
		return exec.CommandContext(ctx, svc.Binary, "login")
	}
	return svc
}

// submitKey stores the key with the host CLI. A non-zero exit is a refused key, not a service
// failure, so it comes back as ok=false rather than an error — the CLI's own sentence, which is
// what the panel shows.
func (svc *MuseLoginService) SubmitKey(key string) (bool, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), login.MuseAuthSetTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, svc.Binary, "auth", "set", "--api-key-stdin")
	cmd.Stdin = strings.NewReader(key)
	out, err := cmd.CombinedOutput()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return false, pkgProtocol.OrDefault(login.CleanAPIKeyMessage(out),
				fmt.Sprintf("sign-in failed (exit %d)", exitErr.ExitCode())), nil
		}
		return false, "", fmt.Errorf("could not store the API key: %w", err)
	}
	return true, pkgProtocol.OrDefault(login.CleanAPIKeyMessage(out), "Signed in."), nil
}

// findDevicePage returns the page and code if the text holds them on completed lines. Restricting
// the search to what precedes the last newline is what guarantees a match is whole: the CLI prints
// the page followed by a newline, so a partial read cannot produce a truncated one.
//
// The code is read two ways, because it is printed twice: it rides the page URL as the `code`
// query — the same code, character for character — and it is printed again under the marker. The
// URL's own is taken first; the marker's is what saves the flow if Meta ever reshapes the URL.
//
// Nothing is published on the URL alone while the code may still be on its way: the page line
// precedes the code lines, so a line-buffered read would otherwise publish a codeless page and
// never revisit it. The waiting line comes after both, so a page seen beside it is a page whose
// code is not coming — published as URL-only, which the dialog draws without the code row.
func FindDevicePage(text string) (login.DeviceLoginPage, bool) {
	end := strings.LastIndexByte(text, '\n')
	if end < 0 {
		return login.DeviceLoginPage{}, false
	}
	complete := text[:end]
	raw := login.DeviceURLRe.FindString(complete)
	if raw == "" {
		return login.DeviceLoginPage{}, false
	}
	if code := deviceCodeOf(raw); code != "" {
		return login.DeviceLoginPage{Url: raw, UserCode: code}, true
	}
	if code := deviceCodeUnder(complete); code != "" {
		return login.DeviceLoginPage{Url: raw, UserCode: code}, true
	}
	if strings.Contains(complete, deviceWaitingMarker) {
		return login.DeviceLoginPage{Url: raw}, true
	}
	return login.DeviceLoginPage{}, false
}

// deviceCodeOf reads the code the page URL carries as its `code` query.
func deviceCodeOf(raw string) string {
	parsed, err := pkgUrl.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Query().Get("code")
}

// deviceCodeUnder reads the code printed under the marker: the first non-empty line after it.
func deviceCodeUnder(complete string) string {
	lines := strings.Split(complete, "\n")
	for i, line := range lines {
		if !strings.Contains(line, deviceCodeMarker) {
			continue
		}
		for _, next := range lines[i+1:] {
			if code := strings.TrimSpace(next); code != "" {
				return code
			}
		}
	}
	return ""
}

// cleanMuseDeviceMessage removes the page-and-code banner from the approval result.
func cleanMuseDeviceMessage(raw string) string {
	if i := strings.Index(raw, deviceWaitingMarker); i >= 0 {
		if j := strings.IndexByte(raw[i:], '\n'); j >= 0 {
			raw = raw[i+j+1:]
		} else {
			raw = ""
		}
	}
	return login.CleanDeviceMessage(raw)
}
