package muse

import (
	"kiao/worker/internal/core/equipment"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
)

type MuseHarness struct {
	Cfg *runnerconfig.Config
	// binary is the CLI to spawn. A field rather than a literal for the reason the Claude harness has
	// one: pointing it at a name that does not exist is the only way to reach the failure branch of
	// the spawn path without a real CLI on the host. Production never changes it.
	Binary string

	OptionsService *MuseOptionsService
	Quota          *MuseUsageService
	Login          *MuseLoginService
}

const MuseBinaryName = "muse"

var (
	_ harnessapi.Harness             = (*MuseHarness)(nil)
	_ harnessapi.HarnessOptions      = (*MuseHarness)(nil)
	_ harnessapi.HarnessUsage        = (*MuseHarness)(nil)
	_ harnessapi.HarnessUsageRefresh = (*MuseHarness)(nil)
	_ harnessapi.HarnessMCP          = (*MuseHarness)(nil)
	_ harnessapi.HarnessBranching    = (*MuseHarness)(nil)
	_ harnessapi.HarnessAPIKeyLogin  = (*MuseHarness)(nil)
	_ harnessapi.HarnessDeviceLogin  = (*MuseHarness)(nil)
)

func NewMuseHarness(cfg *runnerconfig.Config) *MuseHarness {
	harness := &MuseHarness{Cfg: cfg, Binary: MuseBinaryName,
		OptionsService: NewMuseOptionsService(cfg), Quota: NewMuseUsageService(),
		Login: NewMuseLoginService(cfg)}
	harness.OptionsService.Binary = harness.Binary
	harness.Quota.Binary = harness.Binary
	harness.Login.Binary = harness.Binary
	return harness
}

// Driver returns the driver for one turn.
func (a *MuseHarness) Driver() harnessapi.HarnessDriver {
	return &MuseDriver{Cfg: a.Cfg, Binary: a.Binary, EventStream: make(chan harnessapi.HarnessEvent), Usage: a.Quota}
}

// Options is the model, effort and permission-mode choices the prompt offers (muse_options.go).
func (a *MuseHarness) Options() harnessapi.HarnessOptionsDto { return a.OptionsService.Get() }

// Usage is the account's rolling rate-limit windows as the turns have last observed them
// (muse_usage.go).
func (a *MuseHarness) Usage() (harnessapi.HarnessUsageDto, error) { return a.Quota.GetUsage() }

// RefreshUsage is the same windows, refreshed: with nothing fresh to answer, one minimal turn is
// run on the cheapest model and what its host observed is recorded like any turn's. It is what
// the usage endpoint answers; the runner stays on Usage, which never spends a turn.
func (a *MuseHarness) RefreshUsage() (harnessapi.HarnessUsageDto, error) { return a.Quota.Refresh() }

// RenderMCP turns the servers the toolbox offers into the `mcp_servers` fragment a turn's staged
// settings.json is written from (muse_mcp.go). The hub carries the answer to Spawn without reading
// it.
func (a *MuseHarness) RenderMCP(servers []equipment.MCPServer) (string, error) {
	return BuildMuseMCPConfig(servers), nil
}

// BranchesSessions is yes: session/fork copies a session through a cut point under an id of its
// own, so a fork of a Muse conversation is one Muse remembers.
func (a *MuseHarness) BranchesSessions() bool { return true }

// APIKeyLoginEnabled is the deployment's say on signing in from the panel (muse_login.go).
func (a *MuseHarness) APIKeyLoginEnabled() bool { return a.Login.Enabled }

// SubmitAPIKey stores the key with the host CLI: `muse auth set --api-key-stdin`, the key on
// stdin and never in the process arguments.
func (a *MuseHarness) SubmitAPIKey(key string) (bool, string, error) { return a.Login.SubmitKey(key) }

// APIKeyHostCommand is what to run on the host where the deployment keeps the endpoint off. It
// names the real CLI rather than the test's override: it is documentation, not an invocation.
func (a *MuseHarness) APIKeyHostCommand() string { return MuseBinaryName + " auth set --api-key-stdin" }

// DeviceLoginEnabled is the deployment's say on the device flow (muse_login.go): the same gate as
// the API key, since either shape binds the host's CLI to whoever signs in.
func (a *MuseHarness) DeviceLoginEnabled() bool { return a.Login.Enabled }

// DeviceLoginStart spawns `muse login` and returns the page to open and the code to confirm.
func (a *MuseHarness) DeviceLoginStart() (string, string, error) { return a.Login.StartDevice() }

// DeviceLoginStatus reports the approval wait: pending while the CLI is still parked, and once it
// has exited whether the approval landed.
func (a *MuseHarness) DeviceLoginStatus() (bool, bool, string, error) {
	return a.Login.DeviceStatus()
}

// DeviceLoginCancel kills the device flow in progress, reporting whether there was one.
func (a *MuseHarness) DeviceLoginCancel() bool { return a.Login.CancelDevice() }

// DeviceLoginHostCommand is what to run on the host where the deployment keeps the endpoint off.
func (a *MuseHarness) DeviceLoginHostCommand() string { return MuseBinaryName + " login" }

// DeviceLoginShutdown kills the parked device flow, so none survives the service.
func (a *MuseHarness) DeviceLoginShutdown() { a.Login.ShutdownDevice() }
