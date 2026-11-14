package actions

// Applicability fields are optional and AND-ed; an empty rule matches any entry.
type ActionAppliesToDto struct {
	// Case-insensitive filename suffixes, e.g. ".ttst.md".
	Extensions []string `json:"extensions,omitempty"`
	Directory  *bool    `json:"directory,omitempty"`
}

// Type is "string", "boolean" or "enum"; Values is required and meaningful only for "enum".
type ActionParamDto struct {
	Name    string   `json:"name"`
	Label   string   `json:"label,omitempty"`
	Type    string   `json:"type"`
	Values  []string `json:"values,omitempty"`
	Default any      `json:"default,omitempty"`
}

// Provider URLs stay server-side in registeredAction (actions.go); clients invoke actions by ID.
type ActionDto struct {
	ID        string             `json:"id"`
	Label     string             `json:"label"`
	Group     string             `json:"group,omitempty"`
	Order     int                `json:"order,omitempty"`
	AppliesTo ActionAppliesToDto `json:"appliesTo"`
	Params    []ActionParamDto   `json:"params,omitempty"`
}

type RunActionRequestDto struct {
	ID     string         `json:"id"`
	Path   string         `json:"path"`
	Params map[string]any `json:"params,omitempty"`
}

// ChangedPaths lets clients refresh what the action touched.
type ActionResultDto struct {
	OK           bool     `json:"ok"`
	Message      string   `json:"message"`
	ChangedPaths []string `json:"changedPaths"`
}
