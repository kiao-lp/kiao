package equipment

const (
	PiVersion     = "1.5.2"
	PiRPCProtocol = "pi-rpc-1.5"
)

// HarnessInstallation identifies an exact executable, independently of PATH order.
// The toolbox owns managed installations; an execution profile may declare an external one.
type HarnessInstallation struct {
	ID string `json:"id"`
	// The persisted profile format calls the harness ID "engine".
	Harness  string `json:"engine"`
	Version  string `json:"version"`
	Path     string `json:"path"`
	Protocol string `json:"protocol"`
	External bool   `json:"external,omitempty"`
}
