package configuration

const (
	// The program adopts these two legacy documents from the data root.
	ConfigDocDashboard = "dashboard.json"
	ConfigDocViewState = "dashboard-view-state.json"
	// Separate narrow-screen state prevents phone and desktop layouts overwriting each other.
	ConfigDocViewStateSmall = "dashboard-view-state-small.json"

	// ConfigDocRunner stores {"runnerId": "…"}, set by the runners panel and read by
	// hybridflow-runner at startup and on every save.
	ConfigDocRunner = "runner.json"

	// Owner-only: view state contains paths of files the user has worked on.
	ConfigDocPerm = 0o600

	// Bound view state, which grows with opened files and is only pruned by the user.
	MaxConfigDocBytes = 1 << 20
)

// Use an explicit allowlist: the state directory also holds the migration ledger
// and other service files that this endpoint must not expose or overwrite.
var ConfigDocNames = []string{ConfigDocDashboard, ConfigDocViewState, ConfigDocViewStateSmall, ConfigDocRunner}
